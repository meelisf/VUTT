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
_PART_KEYS = {"kind", "title", "incipit", "notes", "pages", "creators", "dating", "place",
              "place_to", "languages", "attached_to", "evidence"}
_EVIDENCE_KEYS = {"page", "quote"}


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


def _clean_part(raw: dict, index: int, count: int, stems: list[str]) -> dict:
    """Agendi osa → work_parts kuju (tüvedega); valideerib nagu käsitsi lisamine."""
    if not isinstance(raw, dict) or set(raw) - _PART_KEYS:
        raise ProposalError("invalid_part")
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
    if not isinstance(evidence, list) or len(evidence) > 5 or any(
            not isinstance(e, dict) or set(e) - _EVIDENCE_KEYS
            or not isinstance(e.get("page"), int) or not isinstance(e.get("quote", ""), str)
            or len(e.get("quote", "")) > 1000 for e in evidence):
        raise ProposalError("invalid_part")
    try:
        # Lisa valideeritakse ilma viiteta: sihtosa ei pruugi veel olemas olla.
        normalized = wp.validate_parts([{**part, "id": "tmp"}], set(stems))[0]
    except wp.PartError as e:
        raise ProposalError(f"invalid_part: {e}")
    normalized.pop("id"); normalized.pop("needs_review", None); normalized.pop("attached_to", None)
    return {"part": normalized, "attached_to": attached, "evidence": evidence, "status": "pending"}


def submit(code: str, work_id: str, work_dir: str, version: str, parts: list) -> dict:
    """Talletab ainult ootel ettepaneku; teost ei muudeta."""
    if not isinstance(code, str) or len(code) > 100 or not isinstance(version, str):
        raise ProposalError("invalid_handoff")
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        raise ProposalError("invalid_parts")
    stems = wp.page_stems(work_dir)
    if version != pages_version(work_dir):
        raise ProposalError("stale_pages")
    items = [_clean_part(p, i, len(parts), stems) for i, p in enumerate(parts)]
    payload = json.dumps(items, ensure_ascii=False)
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
            "parts": len(items), "expires_at": now + PROPOSAL_TTL}


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
    for row in rows:
        items = json.loads(row["payload"])
        if all(it["status"] != "pending" for it in items):
            continue
        for it in items:
            it["page_numbers"] = [number[s] for s in it["part"]["pages"] if s in number]
            it["missing_pages"] = [s for s in it["part"]["pages"] if s not in number]
        out.append({"proposal_id": row["id"], "created_at": row["created_at"],
                    "expires_at": row["expires_at"], "pages_changed": row["pages_version"] != current,
                    "items": items})
    return out


def decide(proposal_id: str, work_id: str, work_dir: str, username: str, index: int,
           action: str, override: Optional[dict] = None) -> Optional[dict]:
    """Toimetaja otsus ühe osa kohta. Vastuvõtt = create_part (tagastab loodud osa)."""
    if action not in ("accept", "reject") or not isinstance(index, int) or isinstance(index, bool):
        raise ProposalError("invalid_decision")
    with _db() as db:
        row = db.execute("SELECT * FROM proposal WHERE id=? AND work_id=? AND username=? AND expires_at>?",
                         (proposal_id, work_id, username, int(time.time()))).fetchone()
        if row is None:
            raise ProposalError("proposal_not_found")
        items = json.loads(row["payload"])
        if not 0 <= index < len(items) or items[index]["status"] != "pending":
            raise ProposalError("invalid_decision")
        item = items[index]
        created = None
        if action == "accept":
            data = dict(override) if isinstance(override, dict) else dict(item["part"])
            data.pop("id", None); data.pop("needs_review", None)
            target = item.get("attached_to")
            if isinstance(target, int):
                ref = items[target]
                if ref["status"] != "accepted":
                    raise ProposalError("attach_target_not_accepted")
                data["attached_to"] = ref["created_part_id"]
            elif isinstance(target, str):
                data["attached_to"] = target
            try:
                created = wp.create_part(work_dir, data, username)
            except wp.PartError as e:
                raise ProposalError(f"invalid_part: {e}")
            item["status"], item["created_part_id"] = "accepted", created["id"]
        else:
            item["status"] = "rejected"
        db.execute("UPDATE proposal SET payload=? WHERE id=?", (json.dumps(items, ensure_ascii=False), proposal_id))
    return created
