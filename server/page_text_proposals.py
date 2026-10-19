"""Agendi lehe teksti ettepanekud (#641, ADR 0058 täiendus 2026-10-19).

MCP-agent loeb lehe TOORTEKSTI koodiga (`read_source`) ja esitab asendused
(`submit`). VUTT talletab need AINULT ootel ettepanekuna; lehte ei muudeta.
Superadmin kinnitab Workspace'is (`/save` + `proposal`-viide) või terve paki
korraga (`apply_pack`, taustatöö).

Lukkude järjekord KÕIGIS teedes (spekk): ettepanekulukud id järjekorras →
`page_lock` tüve järjekorras → `_git_write_lock` (save_with_git sees).
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import threading
import time
import weakref
from contextlib import ExitStack, contextmanager
from typing import Optional

from .config import STATE_DIR
from .page_locks import page_lock
from .page_merge import read_page_view
from .page_text import normalize_page_text, text_hash
from .vutt_tags import ann_tokens, has_ann_token, new_markup_errors
from . import work_parts as wp

DB_PATH = os.path.join(STATE_DIR, "page_text_proposals.sqlite3")
CODE_TTL = 8 * 60 * 60
MAX_USES = 20
PROPOSAL_TTL = 14 * 24 * 60 * 60
MAX_PAGES = 200
MAX_EDITS = 100
MAX_BODY_BYTES = 2_000_000
MAX_NOTE = 2000
REVIEW_STATES = ("pending", "stale")


class ProposalError(ValueError):
    """Sõnum on masinloetav kood (nt `stale_page:t-001`), MCP annab selle agendile."""


# ── SQLite ────────────────────────────────────────────────────────────────

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
        db.executescript("""
            CREATE TABLE IF NOT EXISTS handoff (
                code_hash TEXT PRIMARY KEY, work_id TEXT, username TEXT NOT NULL,
                expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS proposal (
                id TEXT PRIMARY KEY, work_id TEXT NOT NULL, username TEXT NOT NULL,
                note TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS proposal_page (
                proposal_id TEXT NOT NULL, stem TEXT NOT NULL, page_no INTEGER NOT NULL,
                base_text TEXT NOT NULL, proposed_text TEXT NOT NULL, note TEXT NOT NULL,
                state TEXT NOT NULL, decided_by TEXT, decided_at INTEGER,
                PRIMARY KEY (proposal_id, stem)
            );
        """)
        with db:
            yield db
    finally:
        db.close()


def _clean(db, now: int) -> None:
    db.execute("DELETE FROM handoff WHERE expires_at < ?", (now,))
    db.execute("DELETE FROM proposal_page WHERE proposal_id IN "
               "(SELECT id FROM proposal WHERE expires_at < ?)", (now,))
    db.execute("DELETE FROM proposal WHERE expires_at < ?", (now,))


def _digest(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


# ── Ettepaneku lukk ───────────────────────────────────────────────────────

class _Lukk:
    __slots__ = ("lock", "__weakref__")

    def __init__(self):
        self.lock = threading.Lock()


_guard = threading.Lock()
_locks: "weakref.WeakValueDictionary[str, _Lukk]" = weakref.WeakValueDictionary()


@contextmanager
def proposal_lock(proposal_id: str):
    """Sama ettepaneku olekumuutused (kinnitus, tagasilükkamine, superseded)
    järjestatakse. Võetakse ENNE lehelukke."""
    with _guard:
        lukk = _locks.get(proposal_id)
        if lukk is None:
            lukk = _Lukk()
            _locks[proposal_id] = lukk
    with lukk.lock:
        yield


# ── Kood ──────────────────────────────────────────────────────────────────

def issue_handoff(work_id: Optional[str], username: str) -> dict:
    """Kood agendile: üks teos või (`None`) kõik teosed. Õiguse kontrollib router."""
    code = secrets.token_urlsafe(32)
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        db.execute("INSERT INTO handoff VALUES (?, ?, ?, ?, ?, 0)",
                   (_digest(code), work_id, username, now + CODE_TTL, MAX_USES))
    return {"code": code, "expires_at": now + CODE_TTL, "max_uses": MAX_USES, "work_id": work_id}


def revoke_handoffs(username: str) -> int:
    """Kustutab kasutaja koodid (konto kustutus / rolli muutus, #619)."""
    if not os.path.exists(DB_PATH):
        return 0
    with _db() as db:
        return db.execute("DELETE FROM handoff WHERE username=?", (username,)).rowcount


def check_code(code: str, work_id: str) -> sqlite3.Row:
    """Kehtiv kood, mille ulatuses on teos. Ainult lugemine — ei kuluta."""
    if not isinstance(code, str) or not code or len(code) > 100:
        raise ProposalError("invalid_or_expired_handoff")
    with _db() as db:
        row = db.execute("SELECT * FROM handoff WHERE code_hash=?", (_digest(code),)).fetchone()
    if row is None or row["expires_at"] <= int(time.time()) \
            or (row["work_id"] is not None and row["work_id"] != work_id):
        raise ProposalError("invalid_or_expired_handoff")
    return row


# ── Leht ──────────────────────────────────────────────────────────────────

def _txt_path(work_dir: str, stem: str) -> str:
    return os.path.join(work_dir, stem + ".txt")


def read_raw(path: str) -> str:
    """Lehe toortekst baithaaval (ilma reavahetuste teisenduseta); puuduv fail = ""."""
    try:
        with open(path, "rb") as f:
            return f.read().decode("utf-8")
    except FileNotFoundError:
        return ""


def read_source(code: str, work_id: str, work_dir: str, page: int) -> dict:
    """Lehe toortekst agendile: tüvi on püsiv identifikaator, räsi toorbaitidest."""
    check_code(code, work_id)
    stems = wp.page_stems(work_dir)
    if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= len(stems):
        raise ProposalError("unknown_page")
    stem = stems[page - 1]
    path = _txt_path(work_dir, stem)
    with page_lock(path):
        text = read_raw(path)
        status = read_page_view(path, os.path.splitext(path)[0] + ".json")["status"]
    return {"work_id": work_id, "page": page, "stem": stem, "text": text,
            "text_hash": text_hash(text), "status": status}


def _apply_edits(stem: str, raw: str, edits) -> str:
    if not isinstance(edits, list) or not edits:
        raise ProposalError(f"invalid_edits:{stem}")
    if len(edits) > MAX_EDITS:
        raise ProposalError(f"too_many_edits:{stem}")
    text = raw
    for i, e in enumerate(edits):
        if not isinstance(e, dict) or set(e) != {"old", "new"} \
                or not isinstance(e["old"], str) or not isinstance(e["new"], str) or not e["old"]:
            raise ProposalError(f"invalid_edits:{stem}:{i}")
        # Ankrut ei lisata, kustutata ega nihutata (spekk): tokenit ei tohi asendus puudutada.
        if has_ann_token(e["old"]) or has_ann_token(e["new"]):
            raise ProposalError(f"anchor_touched:{stem}:{i}")
        n = text.count(e["old"])
        if n == 0:
            raise ProposalError(f"old_not_found:{stem}:{i}")
        if n > 1:
            raise ProposalError(f"old_ambiguous:{stem}:{i}")
        text = text.replace(e["old"], e["new"], 1)
    return text


def check_proposed(stem: str, base: str, proposed: str) -> None:
    """Muudatus ei tohi tekitada uusi märgendusvigu ega muuta ankruid."""
    uued = new_markup_errors(base, proposed)
    if uued:
        kind, tag = uued[0]
        raise ProposalError(f"invalid_markup:{stem}:{kind}:{tag}")
    if ann_tokens(base) != ann_tokens(proposed):
        raise ProposalError(f"anchor_touched:{stem}:*")


def _short_note(value, field: str) -> str:
    if value is None:
        return ""
    if not isinstance(value, str) or len(value) > MAX_NOTE:
        raise ProposalError(f"invalid_{field}")
    return value


# ── Esitus ────────────────────────────────────────────────────────────────

def submit(code: str, work_id: str, work_dir: str, pages: list, note: str) -> dict:
    """Talletab ainult ootel ettepaneku; lehti ei muudeta."""
    row = check_code(code, work_id)
    if row["uses"] >= row["max_uses"]:
        raise ProposalError("handoff_used_up")
    if not isinstance(pages, list) or not pages:
        raise ProposalError("invalid_pages")
    if len(pages) > MAX_PAGES:
        raise ProposalError("too_many_pages")
    note = _short_note(note, "note")
    stems = wp.page_stems(work_dir)
    numbers = {s: i + 1 for i, s in enumerate(stems)}
    wanted = []
    for p in pages:
        if not isinstance(p, dict) or not {"stem", "text_hash", "edits"} <= set(p) \
                or not set(p) <= {"stem", "text_hash", "edits", "note"}:
            raise ProposalError("invalid_pages")
        if p["stem"] not in numbers:
            raise ProposalError("unknown_page")
        wanted.append(p)
    if len({p["stem"] for p in wanted}) != len(wanted):
        raise ProposalError("duplicate_page")

    with _db() as db:
        older = sorted({r["proposal_id"] for r in db.execute(
            "SELECT pp.proposal_id FROM proposal_page pp JOIN proposal p ON p.id = pp.proposal_id "
            f"WHERE p.work_id=? AND pp.state IN {REVIEW_STATES} AND pp.stem IN "
            f"({','.join('?' * len(wanted))})", (work_id, *[p["stem"] for p in wanted]))})

    results = []
    with ExitStack() as stack:
        for pid in older:
            stack.enter_context(proposal_lock(pid))
        for p in sorted(wanted, key=lambda p: p["stem"]):
            stack.enter_context(page_lock(_txt_path(work_dir, p["stem"])))
        for p in wanted:
            stem = p["stem"]
            raw = read_raw(_txt_path(work_dir, stem))
            if text_hash(raw) != p["text_hash"]:
                raise ProposalError(f"stale_page:{stem}")
            proposed = normalize_page_text(_apply_edits(stem, raw, p["edits"]))
            check_proposed(stem, raw, proposed)
            if proposed != raw:
                results.append((stem, numbers[stem], raw, proposed, _short_note(p.get("note"), "page_note")))
        if not results:
            raise ProposalError("no_changes")

        now = int(time.time())
        proposal_id = secrets.token_urlsafe(16)
        changed = [r[0] for r in results]
        with _db() as db:
            _clean(db, now)
            if db.execute("UPDATE handoff SET uses = uses + 1 WHERE code_hash=? AND uses < max_uses "
                          "AND expires_at > ?", (_digest(code), now)).rowcount != 1:
                raise ProposalError("handoff_used_up")
            superseded = [[r["proposal_id"], r["stem"]] for r in db.execute(
                "SELECT pp.proposal_id, pp.stem FROM proposal_page pp JOIN proposal p ON p.id = pp.proposal_id "
                f"WHERE p.work_id=? AND pp.state IN {REVIEW_STATES} AND pp.stem IN "
                f"({','.join('?' * len(changed))}) ORDER BY pp.proposal_id, pp.stem", (work_id, *changed))]
            for pid, stem in superseded:
                db.execute("UPDATE proposal_page SET state='superseded', decided_at=? "
                           f"WHERE proposal_id=? AND stem=? AND state IN {REVIEW_STATES}", (now, pid, stem))
            db.execute("INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?)",
                       (proposal_id, work_id, row["username"], note, now, now + PROPOSAL_TTL))
            db.executemany(
                "INSERT INTO proposal_page VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)",
                [(proposal_id, stem, no, base, prop, pnote) for stem, no, base, prop, pnote in results])
    return {"proposal_id": proposal_id, "work_id": work_id, "pages": len(results),
            "superseded": superseded, "expires_at": now + PROPOSAL_TTL}
