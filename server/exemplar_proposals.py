# server/exemplar_proposals.py
"""Agendi eksemplari-ettepanekud (#703, ADR 0076 §7, ADR 0058 täiendus 2026-11-01).

Sama piir nagu osade ettepanekutel (`work_part_proposals`): MCP esitab agendikoodiga
AINULT ootel ettepaneku (`state/` SQLite, väljaspool teadusandmete gitti). Superadmin
otsustab teose halduse vahekaardil „Eksemplarid" rea kaupa või valitud read ühe
partiina; vastuvõtt käib `work_exemplars.apply_proposal_ops` kaudu (work_lock →
metadata_lock → `bulk_update_works`, üks commit).

Rida on kas uus eksemplar (`create`) või olemasoleva väljade muudatus (`update` +
`base`). Konflikt on rea tasemel: `review_state` arvutatakse igal lugemisel elava
`_metadata.json`-i ja hoidjate registri vastu, mitte ei salvestata — hoidja lisamine
registrisse vabastab rea ilma uue esituseta, toimetaja hilisem parandus teeb rea
`stale`-iks.

Aegumine kustutab ainult ettepaneku, mille ükski rida pole otsustatud. Otsustatud
ridadega ettepanek jääb alles („töödeldud" märge hilisemale läbikäigule); tema ootel
read on `expired` ega ole kinnitatavad.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager
from functools import wraps
from typing import Optional

from .config import STATE_DIR
from . import agent_handoff
from . import work_exemplars as we

DB_PATH = os.path.join(STATE_DIR, "exemplar_proposals.sqlite3")
KIND = "exemplars"
MAX_USES = 20
MAX_ROWS = 30
MAX_BODY_BYTES = 64_000
MAX_NOTE = 1000
MAX_QUOTE = 500
MAX_BATCH = 200
PROPOSAL_TTL = 14 * 24 * 60 * 60
ESTER_REF = re.compile(r"^b\d{7,8}$")
_ROW_KEYS = {"op", "exemplar_id", "fields", "base", "source"}
_SOURCE_KEYS = {"kind", "ref", "quote"}
_DECIDED = ("accepted", "rejected")

# Otsus loeb ettepaneku, kirjutab teose ja siis payload'i tervikuna tagasi; kaks
# kiiret otsust kirjutaksid teineteise üle (vt work_part_proposals, #615).
# Järjekord: _DECIDE_LOCK → work_lock → metadata_lock.
_DECIDE_LOCK = threading.RLock()


def _serialized(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        with _DECIDE_LOCK:
            return fn(*args, **kwargs)
    return wrapper


class ProposalError(ValueError):
    """Vigane, aegunud või mittekinnitatav ettepanek; ei ole serveri sisemine viga."""


@contextmanager
def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    # 0644: varundus (`meelisf`) peab root'i loodud faili lugeda saama (#131, #619).
    try:
        fd = os.open(DB_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    db = sqlite3.connect(DB_PATH, timeout=5)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=5000")
        # WAL keelatud: koodi kulutus ja INSERT on üks mitme faili tehing (ADR 0058).
        agent_handoff.attach(db)
        db.executescript("""
            CREATE TABLE IF NOT EXISTS proposal (
                id TEXT PRIMARY KEY, work_id TEXT NOT NULL, username TEXT NOT NULL,
                created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
                note TEXT, payload TEXT NOT NULL
            );
        """)
        with db:
            yield db
    finally:
        db.close()


def _clean(db, now: int) -> None:
    """Aegunud ja täiesti otsustamata ettepanekud välja; otsustatud ridadega jäävad."""
    for row in db.execute("SELECT id, payload FROM proposal WHERE expires_at < ?", (now,)).fetchall():
        if not any(r.get("status") in _DECIDED for r in json.loads(row["payload"])["rows"]):
            db.execute("DELETE FROM proposal WHERE id=?", (row["id"],))


def issue_handoff(username: str, code: Optional[str] = None, work_id: Optional[str] = None) -> dict:
    """Ainult eksemplaride kood (testidele); tavatee on ühtne agendikood (`agent_proposals`)."""
    out = agent_handoff.issue(username, "", {KIND: (work_id, MAX_USES)}, code=code)
    return {**out, "max_uses": MAX_USES}


# ── Esitus ───────────────────────────────────────────────────────────────────

def _read_meta(work_dir: str) -> dict:
    try:
        with open(os.path.join(work_dir, "_metadata.json"), encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, ValueError):
        return {}


def _clean_source(raw, label: str) -> dict:
    if not isinstance(raw, dict) or set(raw) != _SOURCE_KEYS or raw.get("kind") != "ester":
        raise ProposalError(f"invalid_source: {label}.source")
    ref, quote = raw.get("ref"), raw.get("quote")
    if not isinstance(ref, str) or not ESTER_REF.fullmatch(ref):
        raise ProposalError(f"invalid_source: {label}.source.ref")
    if not isinstance(quote, str) or not quote.strip() or len(quote) > MAX_QUOTE:
        raise ProposalError(f"invalid_source: {label}.source.quote")
    return {"kind": "ester", "ref": ref, "quote": quote.strip()}


def _clean_fields(raw, label: str, create: bool) -> dict:
    """Väljad salvestatavale kujule samade puhastajatega nagu käsitsi muutmisel."""
    if not isinstance(raw, dict) or not raw or set(raw) - set(we.EDITABLE_FIELDS):
        raise ProposalError(f"invalid_field: {label}.fields")
    out = {}
    for f, v in raw.items():
        try:
            out[f] = we._norm_field(f, v)
        except we.ExemplarError as e:
            raise ProposalError(f"{label}.fields.{f}: {e}")
    if create:
        if not out.get("holder"):
            raise ProposalError(f"invalid_field: {label}.fields.holder")
        out = {k: v for k, v in out.items() if v is not None}
    elif "holder" in out and not out["holder"]:
        raise ProposalError(f"invalid_field: {label}.fields.holder")
    try:
        we.normalize_exemplar({"id": "x", "holder": out.get("holder") or "x",
                               **{k: v for k, v in out.items() if k != "holder"}})
    except we.ExemplarError as e:
        raise ProposalError(f"{label}.fields: {e}")
    return out


def _clean_row(raw, i: int, live: dict) -> dict:
    label = f"rows[{i}]"
    if not isinstance(raw, dict) or set(raw) - _ROW_KEYS or raw.get("op") not in ("create", "update"):
        raise ProposalError(f"invalid_row: {label}")
    create = raw["op"] == "create"
    row = {"op": raw["op"], "fields": _clean_fields(raw.get("fields"), label, create),
           "source": _clean_source(raw.get("source"), label), "status": "pending"}
    if create:
        if "exemplar_id" in raw or "base" in raw:
            raise ProposalError(f"invalid_row: {label}")
        return row
    ex_id = raw.get("exemplar_id")
    if not isinstance(ex_id, str) or ex_id not in live:
        raise ProposalError(f"unknown_exemplar: {label}.exemplar_id")
    base = raw.get("base")
    if not isinstance(base, dict) or set(base) != set(row["fields"]):
        raise ProposalError(f"invalid_base: {label}.base")
    try:
        clean_base = {f: we._norm_field(f, v) for f, v in base.items()}
    except we.ExemplarError as e:
        raise ProposalError(f"invalid_base: {label}.base: {e}")
    # Agent nägi teist seisu kui praegu → pole mõtet talletada (ADR 0076 §7).
    if any(clean_base[f] != live[ex_id].get(f) for f in clean_base):
        raise ProposalError(f"stale_base: {label}.base")
    return {**row, "exemplar_id": ex_id, "base": clean_base}


def submit(code: str, work_id: str, work_dir: str, rows: list, note: Optional[str] = None) -> dict:
    """Talletab ainult ootel ettepaneku; teost ei muudeta."""
    if not isinstance(code, str) or len(code) > agent_handoff.MAX_CODE_LEN:
        raise ProposalError("invalid_or_expired_handoff")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise ProposalError("invalid_rows")
    if note is not None and (not isinstance(note, str) or len(note) > MAX_NOTE):
        raise ProposalError("invalid_note")
    # Kood ENNE teose lugemist: otspunkt on autentimata. Ainult lugemine — kulub INSERT-iga.
    agent_handoff.check(code, KIND, work_id, ProposalError, need_use=True)
    live = {x["id"]: x for x in _read_meta(work_dir).get("exemplars") or [] if isinstance(x, dict)}
    clean = [_clean_row(r, i, live) for i, r in enumerate(rows)]
    payload = json.dumps({"rows": clean}, ensure_ascii=False)
    if len(payload.encode()) > MAX_BODY_BYTES:
        raise ProposalError("proposal_too_large")
    now = int(time.time())
    proposal_id = secrets.token_urlsafe(16)
    with _db() as db:
        _clean(db, now)
        handoff = agent_handoff.consume(db, code, KIND, work_id, now, ProposalError)
        db.execute("INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?, ?)",
                   (proposal_id, work_id, handoff["username"], now, now + PROPOSAL_TTL,
                    (note or "").strip() or None, payload))
    return {"proposal_id": proposal_id, "work_id": work_id, "status": "pending",
            "rows": len(clean), "expires_at": now + PROPOSAL_TTL}


# ── Ülevaatus ────────────────────────────────────────────────────────────────

def _holders() -> set:
    # Sama lugemisviis mis `work_exemplars._check_holder`: register ja kinnitus ei tohi lahku minna.
    from .config import ARCHIVES_FILE
    try:
        with open(ARCHIVES_FILE, encoding="utf-8") as f:
            return set(json.load(f) or {})
    except (OSError, ValueError):
        return set()


def _review_state(row: dict, expired: bool, live: dict, holders: set) -> str:
    """Rea olek elava seisu vastu (järjekord on tähenduslik)."""
    if row["status"] != "pending":
        return row["status"]
    if expired:
        return "expired"
    if row["op"] == "update":
        x = live.get(row["exemplar_id"])
        if x is None or any(row["base"][f] != x.get(f) for f in row["base"]):
            return "stale"
        return "pending"
    fields = row["fields"]
    if fields["holder"] not in holders:
        return "blocked_holder"
    if fields.get("shelfmark"):
        key = we.shelfmark_key(fields["holder"], fields["shelfmark"])
        if any(we.shelfmark_key(x.get("holder"), x.get("shelfmark")) == key for x in live.values()):
            return "duplicate"
    return "pending"


def _view(row: dict, index: int, expired: bool, live: dict, holders: set) -> dict:
    out = {"index": index, **row, "review_state": _review_state(row, expired, live, holders),
           "current": live.get(row["exemplar_id"]) if row["op"] == "update" else None}
    return out


def _live(work_dir: str) -> dict:
    return {x["id"]: x for x in _read_meta(work_dir).get("exemplars") or [] if isinstance(x, dict)}


def list_for_work(work_id: str, work_dir: str, username: str) -> list[dict]:
    """Kasutaja ettepanekud teosele (uuemad ees), ootel ja otsustatud read koos olekuga."""
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        rows = db.execute("SELECT * FROM proposal WHERE work_id=? AND username=? ORDER BY created_at DESC",
                          (work_id, username)).fetchall()
    live, holders = _live(work_dir), _holders()
    out = []
    for p in rows:
        expired = p["expires_at"] <= now
        items = json.loads(p["payload"])["rows"]
        out.append({"proposal_id": p["id"], "created_at": p["created_at"], "expires_at": p["expires_at"],
                    "note": p["note"],
                    "rows": [_view(r, i, expired, live, holders) for i, r in enumerate(items)]})
    return out


def list_pending_summary(username: str) -> list[dict]:
    """Kasutaja ettepanekud, kus on kinnitamata ridu (ülevaatuse loend `/review`).
    `stale` = ootel read, mida praegu kinnitada ei saa (aegunud alus, topelt, hoidja)."""
    from .utils import find_directory_by_id
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        rows = db.execute("SELECT * FROM proposal WHERE username=? AND expires_at>? ORDER BY created_at DESC",
                          (username, now)).fetchall()
    holders, cache, out = _holders(), {}, []
    for p in rows:
        items = json.loads(p["payload"])["rows"]
        pending = [r for r in items if r["status"] == "pending"]
        if not pending:
            continue
        if p["work_id"] not in cache:
            work_dir = find_directory_by_id(p["work_id"])
            cache[p["work_id"]] = _live(work_dir) if work_dir else {}
        live = cache[p["work_id"]]
        stale = sum(1 for r in pending if _review_state(r, False, live, holders) != "pending")
        out.append({"proposal_id": p["id"], "work_id": p["work_id"], "created_at": p["created_at"],
                    "pending": len(pending), "stale": stale})
    return out


def _parse_picks(picks) -> list[tuple[str, int]]:
    if not isinstance(picks, list) or not 0 < len(picks) <= MAX_BATCH:
        raise ProposalError("invalid_decision")
    keys = []
    for pick in picks:
        pid, index = pick if isinstance(pick, (list, tuple)) and len(pick) == 2 else (None, None)
        if not isinstance(pid, str) or not isinstance(index, int) or isinstance(index, bool):
            raise ProposalError("invalid_decision")
        keys.append((pid, index))
    if len(set(keys)) != len(keys):
        raise ProposalError("invalid_decision")
    return keys


@_serialized
def decide(work_id: str, work_dir: str, username: str, picks: list, action: str,
           background_tasks=None) -> dict:
    """Valitud read (`[(proposal_id, index)]`) vastu ÜHE kirjutusega või tagasi.

    Klient saadab read, mida kasutaja nägi. Iga rida peab olema praegu `pending`
    (mitte aegunud alus, topelt, registrist puuduv hoidja ega aegunud ettepanek).
    Atomaarne: üks mittekinnitatav rida → midagi ei kirjutata.
    """
    if action not in ("accept", "reject"):
        raise ProposalError("invalid_decision")
    keys = _parse_picks(picks)
    now = int(time.time())
    with _db() as db:
        loaded: dict = {}
        for pid, _ in keys:
            if pid not in loaded:
                row = db.execute("SELECT * FROM proposal WHERE id=? AND work_id=? AND username=?",
                                 (pid, work_id, username)).fetchone()
                if row is None:
                    raise ProposalError("proposal_not_found")
                loaded[pid] = (json.loads(row["payload"])["rows"], row["expires_at"] <= now)
        live, holders = _live(work_dir), _holders()
        for pid, index in keys:
            items, expired = loaded[pid]
            if not 0 <= index < len(items) or _review_state(items[index], expired, live, holders) != "pending":
                raise ProposalError(f"not_decidable: {pid}/{index}")
        accepted: list = []
        if action == "accept":
            ops = []
            for pid, index in keys:
                r = loaded[pid][0][index]
                op = {"op": r["op"], "fields": r["fields"], "source_ref": r["source"]["ref"]}
                if r["op"] == "update":
                    op.update(exemplar_id=r["exemplar_id"], base=r["base"])
                ops.append(op)
            refs = ", ".join(dict.fromkeys(op["source_ref"] for op in ops))
            message = f"Eksemplar: {len(ops)} agendi ettepanekut vastu võetud (ESTER {refs})"
            try:
                accepted = we.apply_proposal_ops(work_dir, ops, username, message, background_tasks)
            except we.ExemplarError as e:
                code, _, i = str(e).partition(":")
                if code in ("stale", "duplicate") and i.isdigit():
                    pid, index = keys[int(i)]
                    raise ProposalError(f"{code}: {pid}/{index}")
                raise ProposalError(f"invalid_row: {e}")
        stamp = {"decided_by": username, "decided_at": now}
        for n, (pid, index) in enumerate(keys):
            r = loaded[pid][0][index]
            r.update(stamp, status="accepted" if action == "accept" else "rejected")
            if action == "accept" and r["op"] == "create":
                r["created_exemplar_id"] = accepted[n]
        for pid, (items, _) in loaded.items():
            db.execute("UPDATE proposal SET payload=? WHERE id=?",
                       (json.dumps({"rows": items}, ensure_ascii=False), pid))
    return {"accepted": accepted, "rejected": len(keys) if action == "reject" else 0}
