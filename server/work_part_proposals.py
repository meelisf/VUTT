# server/work_part_proposals.py
"""Agendi teose osade ettepanekud (#492 samm 2, ADR 0058 laiendus).

Sama piir nagu isikute ettepanekutel: MCP esitab üleandmiskoodiga AINULT ootel
ettepaneku (`state/` SQLite, väljaspool teadusandmete gitti); toimetaja otsustab
teose halduses osa kaupa ja vastuvõtt käib `work_parts.create_part` kaudu (ADR 0057:
valideerimine, metadata_lock, git, indeksid).

Agent annab lehed LEHEKÜLJENUMBRITENA (/work/{id}/{nr}); server teisendab need
esitusel tüvedeks ja salvestab tüved — lehetoiming pärast esitust ei nihuta
ettepanekut vale lehe peale. `pages_version` (tüvede järjekorra räsi) peab esitusel
klappima: agent nägi sama lehtede järjekorda.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Optional

from .config import STATE_DIR
from . import work_parts as wp

DB_PATH = os.path.join(STATE_DIR, "work_part_proposals.sqlite3")
CODE_TTL = 8 * 60 * 60
MAX_USES = 20
PROPOSAL_TTL = 14 * 24 * 60 * 60
MAX_PARTS = 50
MAX_BODY_BYTES = 64_000
_PART_KEYS = {"kind", "title", "incipit", "notes", "abstract_et", "abstract_en", "pages", "creators", "dating", "place",
              "place_to", "languages", "attached_to", "evidence", "part_id"}
# Liitmine olemasoleva osaga: inimese kirjutatud tekst jääb, kui on täidetud.
_KEEP_EXISTING_TEXT = ("title", "incipit", "notes", "abstract_et", "abstract_en")
_EVIDENCE_KEYS = {"page", "quote"}
MAX_PERSONS = 50
_PERSON_KEYS = {"ref", "name", "aliases", "birth_year", "death_year", "identifiers", "note", "evidence"}
_PERSON_SCHEMES = {"gnd", "wikidata", "viaf"}
_REF = re.compile(r"^[A-Za-z0-9_-]{1,20}$")


class ProposalError(ValueError):
    """Vigane või aegunud ettepanek; ei ole serveri sisemine viga."""


def pages_version(work_dir: str) -> str:
    return hashlib.sha256("\n".join(wp.page_stems(work_dir)).encode()).hexdigest()[:16]


@contextmanager
def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=5)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=5000")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS handoff (
                code_hash TEXT PRIMARY KEY, work_id TEXT NOT NULL, username TEXT NOT NULL,
                expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS proposal (
                id TEXT PRIMARY KEY, work_id TEXT NOT NULL, username TEXT NOT NULL,
                pages_version TEXT NOT NULL, created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL, payload TEXT NOT NULL
            );
        """)
        with db:
            yield db
    finally:
        db.close()


def _clean(db, now: int) -> None:
    db.execute("DELETE FROM handoff WHERE expires_at < ?", (now,))
    db.execute("DELETE FROM proposal WHERE expires_at < ?", (now,))


def issue_handoff(work_id: str, work_dir: str, username: str) -> dict:
    """Kood ühe teose osade ettepanekuteks; `can_write_work` kontrollib router."""
    code = secrets.token_urlsafe(32)
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        db.execute("INSERT INTO handoff VALUES (?, ?, ?, ?, ?, 0)",
                   (hashlib.sha256(code.encode()).hexdigest(), work_id, username, now + CODE_TTL, MAX_USES))
    return {"code": code, "expires_at": now + CODE_TTL, "max_uses": MAX_USES,
            "work_id": work_id, "pages_version": pages_version(work_dir)}


def _short(value, limit: int) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _evidence_ok(evidence) -> bool:
    return isinstance(evidence, list) and len(evidence) <= 5 and all(
        isinstance(e, dict) and not set(e) - _EVIDENCE_KEYS and isinstance(e.get("page"), int)
        and _short(e.get("quote", ""), 1000) for e in evidence)


def _clean_persons(persons) -> list[dict]:
    """Agendi pakutud uued isikud (#492): ootel, kuni toimetaja loob, seob või jätab nimeks."""
    if persons is None:
        return []
    if not isinstance(persons, list) or len(persons) > MAX_PERSONS:
        raise ProposalError("invalid_persons")
    out, refs = [], set()
    for p in persons:
        if not isinstance(p, dict) or set(p) - _PERSON_KEYS or not _short(p.get("ref"), 20) \
                or not _REF.fullmatch(p["ref"]) or p["ref"] in refs:
            raise ProposalError("invalid_person")
        name = p.get("name")
        if not _short(name, 200) or not name.strip():
            raise ProposalError("invalid_person")
        aliases = p.get("aliases") or []
        ids = p.get("identifiers") or []
        if not isinstance(aliases, list) or len(aliases) > 10 or not all(_short(a, 200) for a in aliases):
            raise ProposalError("invalid_person")
        if not isinstance(ids, list) or len(ids) > 5 or not all(
                isinstance(i, dict) and set(i) == {"scheme", "id"} and i["scheme"] in _PERSON_SCHEMES
                and _short(i["id"], 40) and i["id"].strip() for i in ids):
            raise ProposalError("invalid_person")
        for key in ("birth_year", "death_year"):
            if p.get(key) is not None and (not isinstance(p[key], int) or isinstance(p[key], bool)):
                raise ProposalError("invalid_person")
        if p.get("note") is not None and not _short(p["note"], 1000):
            raise ProposalError("invalid_person")
        if not _evidence_ok(p.get("evidence") or []):
            raise ProposalError("invalid_person")
        refs.add(p["ref"])
        out.append({**{k: v for k, v in p.items() if v not in (None, [], "")},
                    "name": name.strip(), "status": "pending", "person_id": None})
    return out


def _clean_part(raw: dict, index: int, count: int, stems: list[str],
                persons: Optional[dict] = None, existing_ids: Optional[set] = None) -> dict:
    """Agendi osa → work_parts kuju (tüvedega); valideerib nagu käsitsi lisamine.

    Isik võib viidata ettepaneku uuele isikule (`person_ref`): osas on ta seni NIMENA,
    viide jääb `creator_refs`-i ja lahendub, kui toimetaja isiku loob või seob.
    """
    if not isinstance(raw, dict) or set(raw) - _PART_KEYS:
        raise ProposalError("invalid_part")
    target = raw.get("part_id")
    if target is not None and (not isinstance(target, str) or target not in (existing_ids or set())):
        raise ProposalError("invalid_part: unknown part_id")
    raw = {k: v for k, v in raw.items() if k != "part_id"}
    creator_refs = {}
    if isinstance(raw.get("creators"), list):
        creators = []
        for ci, c in enumerate(raw["creators"]):
            if isinstance(c, dict) and "person_ref" in c:
                ref = c.get("person_ref")
                if ref not in (persons or {}) or c.get("id"):
                    raise ProposalError("invalid_part: unknown person_ref")
                creator_refs[str(ci)] = ref
                c = {**{k: v for k, v in c.items() if k != "person_ref"}, "name": c.get("name") or persons[ref]["name"]}
            creators.append(c)
        raw = {**raw, "creators": creators}
    pages = raw.get("pages")
    if not isinstance(pages, list) or not pages or any(
            not isinstance(n, int) or isinstance(n, bool) for n in pages):
        raise ProposalError("invalid_part")
    if any(not 1 <= n <= len(stems) for n in pages):
        raise ProposalError("page_out_of_range")
    part = {k: v for k, v in raw.items() if k not in ("pages", "evidence", "attached_to")}
    part["pages"] = [stems[n - 1] for n in pages]
    attached = raw.get("attached_to")
    if attached is not None:
        # Viide sama ettepaneku teisele osale (indeks) või olemasolevale osale (id).
        if isinstance(attached, int) and not isinstance(attached, bool):
            if not 0 <= attached < count or attached == index:
                raise ProposalError("invalid_part")
        elif not isinstance(attached, str):
            raise ProposalError("invalid_part")
    evidence = raw.get("evidence") or []
    if not _evidence_ok(evidence):
        raise ProposalError("invalid_part")
    try:
        # Lisa valideeritakse ilma viiteta: sihtosa ei pruugi veel olemas olla.
        normalized = wp.validate_parts([{**part, "id": "tmp"}], set(stems))[0]
    except wp.PartError as e:
        raise ProposalError(f"invalid_part: {e}")
    normalized.pop("id"); normalized.pop("needs_review", None); normalized.pop("attached_to", None)
    item = {"part": normalized, "attached_to": attached, "evidence": evidence, "status": "pending"}
    if target:
        item["target_part_id"] = target
        item["explicit_target"] = True
    if creator_refs:
        item["creator_refs"] = creator_refs
    return item


def _current_parts(work_dir: str) -> list[dict]:
    try:
        with open(os.path.join(work_dir, "_metadata.json"), encoding="utf-8") as f:
            return (json.load(f) or {}).get("parts") or []
    except (OSError, ValueError):
        return []


def _target(item: dict, parts: list[dict]) -> Optional[str]:
    """Osa, mida ettepanek parandab: agendi `part_id` või sama liigi ja SAMADE lehtedega osa
    (agent pakkus olemasoleva kirja parandatud kujul ilma id-ta)."""
    ids = {p.get("id") for p in parts}
    if item.get("target_part_id") in ids:
        return item["target_part_id"]
    pages, kind = set(item["part"].get("pages") or []), item["part"].get("kind")
    same = [p["id"] for p in parts if p.get("kind") == kind and set(p.get("pages") or []) == pages]
    return same[0] if len(same) == 1 else None


def _same_person(a: dict, b: dict) -> bool:
    if a.get("role") != b.get("role"):
        return False
    if a.get("id") and b.get("id"):
        return a["id"] == b["id"]
    return (a.get("name") or "").strip().casefold() == (b.get("name") or "").strip().casefold() != ""


def _precision(dating) -> int:
    return len(((dating or {}).get("start") or "").strip())


def merge_part(existing: dict, proposed: dict, explicit: bool = False) -> dict:
    """Olemasolev osa + agendi parandus (ilma id ja needs_review'ta, update_part'ile).

    `explicit` = agent ütles `part_id`: parandus võidab ka täidetud väljal. Muidu
    (automaatselt tuvastatud sama osa) on liitmine konservatiivne. Dateering ei muutu
    kunagi ebatäpsemaks; koht ei vahetu ainult keele pärast („Paris" / „Pariis").
    """
    out = {k: v for k, v in existing.items() if k not in ("id", "needs_review")}
    for key in _KEEP_EXISTING_TEXT:
        if not out.get(key) and proposed.get(key):
            out[key] = proposed[key]
    if proposed.get("kind") and explicit:
        out["kind"] = proposed["kind"]
    new_d, old_d = proposed.get("dating"), out.get("dating")
    if new_d and (not old_d or _precision(new_d) > _precision(old_d)
                  or (explicit and _precision(new_d) == _precision(old_d))):
        out["dating"] = new_d
    for key in ("place", "place_to"):
        new_p, old_p = proposed.get(key), out.get(key)
        if new_p and (not old_p or explicit or (new_p.get("id") and not old_p.get("id"))):
            out[key] = new_p
    if proposed.get("languages"):
        out["languages"] = list(dict.fromkeys((out.get("languages") or []) + proposed["languages"]))
    if proposed.get("pages"):
        out["pages"] = proposed["pages"]
    # Isikud: ettepanek on osa täisvaade. Rollis, mida ettepanek nimetab, asendub
    # vastena leidmata ID-ta nimi (parandatud kirjapilt „Flüter" → „Slüter" ei jää
    # vana kõrvale). ID-ga isikut ei eemaldata kunagi; nimetamata rolli ei puututa.
    proposed_creators = proposed.get("creators") or []
    named_roles = {c.get("role") for c in proposed_creators}
    creators = [dict(c) for c in existing.get("creators") or []
                if c.get("id") or c.get("role") not in named_roles
                or any(_same_person(c, p) for p in proposed_creators)]
    for c in proposed_creators:
        match = next((e for e in creators if _same_person(e, c)), None)
        if match is None:
            creators.append(dict(c))
        elif c.get("id") and not match.get("id"):
            match.update({"id": c["id"], **({"source": c["source"]} if c.get("source") else {})})
    out["creators"] = creators
    return out


def _load(payload: str) -> tuple[list, list]:
    """Talletatud ettepanek: {items, persons}; vanem kuju (enne isikuid) oli paljas list."""
    data = json.loads(payload)
    if isinstance(data, list):
        return data, []
    return data.get("items") or [], data.get("persons") or []


def _dump(items: list, persons: list) -> str:
    return json.dumps({"items": items, "persons": persons}, ensure_ascii=False)


def _with_resolved(part: dict, refs: dict, persons: list) -> dict:
    """Osa isikud: lahendatud viited saavad isiku ID (VUTT-i register)."""
    by_ref = {p["ref"]: p for p in persons}
    creators = [dict(c) for c in part.get("creators") or []]
    for ci, ref in (refs or {}).items():
        person = by_ref.get(ref)
        i = int(ci)
        if person and person.get("person_id") and i < len(creators):
            creators[i]["id"] = person["person_id"]
            creators[i]["source"] = "local"
    return {**part, "creators": creators}


def submit(code: str, work_id: str, work_dir: str, version: str, parts: list,
           persons: Optional[list] = None) -> dict:
    """Talletab ainult ootel ettepaneku; teost ei muudeta."""
    if not isinstance(code, str) or len(code) > 100 or not isinstance(version, str):
        raise ProposalError("invalid_handoff")
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        raise ProposalError("invalid_parts")
    stems = wp.page_stems(work_dir)
    if version != pages_version(work_dir):
        raise ProposalError("stale_pages")
    people = _clean_persons(persons)
    by_ref = {p["ref"]: p for p in people}
    existing_ids = {p.get("id") for p in _current_parts(work_dir)}
    items = [_clean_part(p, i, len(parts), stems, by_ref, existing_ids) for i, p in enumerate(parts)]
    payload = _dump(items, people)
    if len(payload.encode()) > MAX_BODY_BYTES:
        raise ProposalError("proposal_too_large")
    now = int(time.time())
    digest = hashlib.sha256(code.encode()).hexdigest()
    proposal_id = secrets.token_urlsafe(16)
    with _db() as db:
        _clean(db, now)
        row = db.execute("SELECT * FROM handoff WHERE code_hash=?", (digest,)).fetchone()
        if row is None or row["expires_at"] <= now or row["work_id"] != work_id:
            raise ProposalError("invalid_or_expired_handoff")
        if db.execute("UPDATE handoff SET uses = uses + 1 WHERE code_hash=? AND uses < max_uses",
                      (digest,)).rowcount != 1:
            raise ProposalError("handoff_used_up")
        db.execute("INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?, ?)",
                   (proposal_id, work_id, row["username"], version, now, now + PROPOSAL_TTL, payload))
    return {"proposal_id": proposal_id, "work_id": work_id, "status": "pending",
            "parts": len(items), "persons": len(people), "expires_at": now + PROPOSAL_TTL}


def list_pending(work_id: str, work_dir: str, username: str) -> list[dict]:
    """Kasutaja otsustamata ettepanekud; leheküljenumbrid praeguse järjekorra järgi."""
    now = int(time.time())
    stems = wp.page_stems(work_dir)
    number = {s: i for i, s in enumerate(stems, start=1)}
    current = pages_version(work_dir)
    out = []
    with _db() as db:
        _clean(db, now)
        rows = db.execute("SELECT * FROM proposal WHERE work_id=? AND username=? ORDER BY created_at DESC",
                          (work_id, username)).fetchall()
    parts_now = _current_parts(work_dir)
    for row in rows:
        items, persons = _load(row["payload"])
        if all(it["status"] != "pending" for it in items):
            continue
        for it in items:
            it["part"] = _with_resolved(it["part"], it.get("creator_refs"), persons)
            if it["status"] == "pending":
                it["target_part_id"] = _target(it, parts_now)
                if it["target_part_id"]:
                    # Sama liitmine, mida vastuvõtt teeb — „Muuda" vorm alustab sellest.
                    existing = next(x for x in parts_now if x.get("id") == it["target_part_id"])
                    it["merged"] = merge_part(existing, it["part"], explicit=bool(it.get("explicit_target")))
            it["page_numbers"] = [number[s] for s in it["part"]["pages"] if s in number]
            it["missing_pages"] = [s for s in it["part"]["pages"] if s not in number]
        out.append({"proposal_id": row["id"], "created_at": row["created_at"],
                    "expires_at": row["expires_at"], "pages_changed": row["pages_version"] != current,
                    "items": items, "persons": persons})
    return out


def decide(proposal_id: str, work_id: str, work_dir: str, username: str, index: int,
           action: str, override: Optional[dict] = None, mode: Optional[str] = None,
           background_tasks=None) -> Optional[dict]:
    """Toimetaja otsus ühe osa kohta. Vastuvõtt: kui ettepanek parandab olemasolevat osa
    (`part_id` või samad lehed), siis update_part liidetud kujuga; muidu create_part.
    `mode="create"` sunnib uue osa (toimetaja otsus: tegemist on eri tekstiga)."""
    if mode not in (None, "create"):
        raise ProposalError("invalid_decision")
    if action not in ("accept", "reject") or not isinstance(index, int) or isinstance(index, bool):
        raise ProposalError("invalid_decision")
    with _db() as db:
        row = db.execute("SELECT * FROM proposal WHERE id=? AND work_id=? AND username=? AND expires_at>?",
                         (proposal_id, work_id, username, int(time.time()))).fetchone()
        if row is None:
            raise ProposalError("proposal_not_found")
        items, persons = _load(row["payload"])
        if not 0 <= index < len(items) or items[index]["status"] != "pending":
            raise ProposalError("invalid_decision")
        item = items[index]
        created = None
        if action == "accept":
            data = dict(override) if isinstance(override, dict) else \
                _with_resolved(item["part"], item.get("creator_refs"), persons)
            data.pop("id", None); data.pop("needs_review", None)
            target = item.get("attached_to")
            if isinstance(target, int):
                ref = items[target]
                if ref["status"] != "accepted":
                    raise ProposalError("attach_target_not_accepted")
                data["attached_to"] = ref["created_part_id"]
            elif isinstance(target, str):
                data["attached_to"] = target
            target = None if mode == "create" else _target(item, _current_parts(work_dir))
            try:
                if target:
                    existing = next(p for p in _current_parts(work_dir) if p.get("id") == target)
                    data = dict(override) if isinstance(override, dict) else \
                        merge_part(existing, data, explicit=bool(item.get("explicit_target")))
                    data.pop("id", None); data.pop("needs_review", None)
                    created = wp.update_part(work_dir, target, data, username, background_tasks)
                else:
                    created = wp.create_part(work_dir, data, username, background_tasks)
            except wp.PartError as e:
                raise ProposalError(f"invalid_part: {e}")
            item["status"], item["created_part_id"] = "accepted", created["id"]
        else:
            item["status"] = "rejected"
        db.execute("UPDATE proposal SET payload=? WHERE id=?", (_dump(items, persons), proposal_id))
    return created


MAX_BATCH = 500


def decide_many(work_id: str, work_dir: str, username: str, picks: list,
                background_tasks=None) -> list[dict]:
    """„Lisa kõik": valitud read (`[(proposal_id, index)]`) vastu ÜHE kirjutusega.

    Varem tegi klient iga rea kohta eraldi päringu: commit + kogu teose Meili sünk
    rea kohta, 16 osa = 18 s (mõõdetud 2026-10-05, jlctu4). Klient saadab need read,
    mida kasutaja nägi — vahepeal saabunud ettepanekut ei võeta nägemata vastu.
    Atomaarne: üks vigane rida → midagi ei kirjutata, read jäävad ootele.
    """
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
    picked = set(keys)
    with _db() as db:
        rows: dict = {}
        for pid, index in keys:
            if pid not in rows:
                row = db.execute("SELECT * FROM proposal WHERE id=? AND work_id=? AND username=? AND expires_at>?",
                                 (pid, work_id, username, int(time.time()))).fetchone()
                if row is None:
                    raise ProposalError("proposal_not_found")
                rows[pid] = _load(row["payload"])
            items = rows[pid][0]
            if not 0 <= index < len(items) or items[index]["status"] != "pending":
                raise ProposalError("invalid_decision")
        current = _current_parts(work_dir)
        # Lisa viitab oma kirjale, mis peab olema enne loodud → lisad viimasena.
        order = sorted(keys, key=lambda k: rows[k[0]][0][k[1]]["part"].get("kind") == "attachment")
        ops = []
        for pid, index in order:
            items, persons = rows[pid]
            item = items[index]
            data = _with_resolved(item["part"], item.get("creator_refs"), persons)
            data.pop("id", None); data.pop("needs_review", None)
            op = {"key": (pid, index), "label": f"items[{index}]"}
            target = item.get("attached_to")
            if isinstance(target, int):
                ref = items[target] if 0 <= target < len(items) else None
                if ref is not None and ref["status"] == "accepted":
                    data["attached_to"] = ref["created_part_id"]
                elif (pid, target) in picked:
                    op["attach_key"] = (pid, target)
                else:
                    raise ProposalError("attach_target_not_accepted")
            elif isinstance(target, str):
                data["attached_to"] = target
            existing_id = _target(item, current)
            if existing_id:
                existing = next(p for p in current if p.get("id") == existing_id)
                data = merge_part(existing, data, explicit=bool(item.get("explicit_target")))
                data.pop("id", None); data.pop("needs_review", None)
                op.update(op="update", part_id=existing_id)
            else:
                op["op"] = "create"
            op["data"] = data
            ops.append(op)
        try:
            created = wp.apply_parts(work_dir, ops, username, f"Osa: {len(ops)} ettepanekut vastu võetud",
                                     background_tasks)
        except wp.PartError as e:
            raise ProposalError(f"invalid_part: {e}")
        for (pid, index), part in zip(order, created):
            item = rows[pid][0][index]
            item["status"], item["created_part_id"] = "accepted", part["id"]
        for pid, (items, persons) in rows.items():
            db.execute("UPDATE proposal SET payload=? WHERE id=?", (_dump(items, persons), pid))
    return created


def resolve_person(proposal_id: str, work_id: str, work_dir: str, username: str, ref: str,
                   action: str, person_id: Optional[str] = None) -> dict:
    """Pakutud isik: `create` (create_person_checked, ADR 0048), `link` olemasolevaga
    või `name` (jääb nimeks). Olemasolev väline ID → `person_exists:<id>`."""
    from .prosopography import person_crud
    if action not in ("create", "link", "name"):
        raise ProposalError("invalid_decision")
    with _db() as db:
        row = db.execute("SELECT * FROM proposal WHERE id=? AND work_id=? AND username=? AND expires_at>?",
                         (proposal_id, work_id, username, int(time.time()))).fetchone()
        if row is None:
            raise ProposalError("proposal_not_found")
        items, persons = _load(row["payload"])
        person = next((p for p in persons if p["ref"] == ref), None)
        if person is None or person["status"] != "pending":
            raise ProposalError("invalid_decision")
        if action == "create":
            role = next((it["part"]["creators"][int(ci)]["role"] for it in items
                         for ci, r in (it.get("creator_refs") or {}).items() if r == ref), None)
            try:
                card = person_crud.create_person_checked(
                    username=username, created_via="agent", name=person["name"],
                    identifiers=person.get("identifiers") or [], aliases=person.get("aliases") or [],
                    note=person.get("note"), context={"work_id": work_id, **({"role": role} if role else {})})
            except person_crud.IdentifierConflict as e:
                raise ProposalError(f"person_exists:{','.join(e.person_ids)}")
            except ValueError as e:
                raise ProposalError(f"invalid_person: {e}")
            person["status"], person["person_id"] = "created", card["id"]
        elif action == "link":
            if not isinstance(person_id, str) or person_crud.get_person(person_id) is None:
                raise ProposalError("person_not_found")
            person["status"], person["person_id"] = "linked", person_id
        else:
            person["status"] = "name"
        db.execute("UPDATE proposal SET payload=? WHERE id=?", (_dump(items, persons), proposal_id))
    return {"ref": ref, "status": person["status"], "person_id": person.get("person_id")}
