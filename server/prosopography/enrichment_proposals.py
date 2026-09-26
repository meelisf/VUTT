"""Agendi ootel ameti- ja haridusettepanekud; isikukaarti see moodul ei kirjuta."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager

from ..config import STATE_DIR

DB_PATH = os.path.join(STATE_DIR, "prosopo_enrichment_proposals.sqlite3")
CODE_TTL = 15 * 60
PROPOSAL_TTL = 7 * 24 * 60 * 60
MAX_ITEMS = 20
MAX_BODY_BYTES = 32_000
_PERSON_ID = re.compile(r"^vutt:P[A-Za-z0-9_-]+$")
_KINDS = {"occupation", "education"}
_MATCHES = {"already_present", "matched", "ambiguous", "new_registry_candidate"}
_ITEM_KEYS = {"kind", "raw_occupation", "raw_institution", "occupation_key",
              "institution_key", "place_key", "date_from", "date_to", "evidence",
              "match_status", "existing_index"}
_EVIDENCE_KEYS = {"source_kind", "source_id", "locator", "work_id", "page",
                  "printed_page", "part_id", "quote", "url"}


class ProposalError(ValueError):
    """Vigane või aegunud ettepanek; ei ole serveri sisemine viga."""


def valid_person_id(person_id: str) -> bool:
    return isinstance(person_id, str) and _PERSON_ID.fullmatch(person_id) is not None


@contextmanager
def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    try:
        fd = os.open(DB_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
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
                code_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL,
                username TEXT NOT NULL, session_fingerprint TEXT NOT NULL,
                base_updated_at TEXT NOT NULL,
                expires_at INTEGER NOT NULL, used_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS proposal (
                id TEXT PRIMARY KEY, person_id TEXT NOT NULL,
                username TEXT NOT NULL, session_fingerprint TEXT NOT NULL,
                base_updated_at TEXT NOT NULL,
                created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
                payload TEXT NOT NULL
            );
        """)
        with db:
            yield db
    finally:
        db.close()


def _clean(db, now: int) -> None:
    db.execute("DELETE FROM handoff WHERE expires_at < ?", (now,))
    db.execute("DELETE FROM proposal WHERE expires_at < ?", (now,))


def issue_handoff(person_id: str, username: str, session_fingerprint: str,
                  updated_at: str) -> dict:
    """Ühekordne isikupõhine kood; editori sessiooni kontrollib router."""
    if not valid_person_id(person_id) or not updated_at or not session_fingerprint:
        raise ProposalError("invalid_person_or_version")
    code = secrets.token_urlsafe(32)
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        db.execute(
            "INSERT INTO handoff VALUES (?, ?, ?, ?, ?, ?, NULL)",
            (hashlib.sha256(code.encode()).hexdigest(), person_id,
             username, session_fingerprint, updated_at, now + CODE_TTL),
        )
    return {"code": code, "expires_at": now + CODE_TTL,
            "person_id": person_id, "base_updated_at": updated_at}


def _short_string(value, limit: int = 500) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _validate_item(item: dict) -> None:
    if not isinstance(item, dict) or not set(item) <= _ITEM_KEYS:
        raise ProposalError("invalid_item")
    if item.get("kind") not in _KINDS or item.get("match_status") not in _MATCHES:
        raise ProposalError("invalid_kind_or_match")
    if item["kind"] == "occupation" and (
            not _short_string(item.get("raw_occupation"))
            or not item["raw_occupation"].strip()):
        raise ProposalError("raw_occupation_required")
    if item["kind"] == "education" and (
            not _short_string(item.get("raw_institution"))
            or not item["raw_institution"].strip()):
        raise ProposalError("raw_institution_required")
    for key in ("raw_occupation", "raw_institution", "occupation_key",
                "institution_key", "place_key"):
        if key in item and item[key] is not None and not _short_string(item[key]):
            raise ProposalError("invalid_text_field")
    for key in ("date_from", "date_to"):
        if key in item and item[key] is not None:
            value = item[key]
            if not isinstance(value, dict) or not set(value) <= {"date", "precision", "bound", "calendar", "is_circa"}:
                raise ProposalError("invalid_date")
            if not _short_string(value.get("date"), 32) or not value["date"].strip():
                raise ProposalError("invalid_date")
            if value.get("precision") not in (None, "day", "month", "year"):
                raise ProposalError("invalid_date_precision")
            if value.get("bound") not in (None, "before", "after"):
                raise ProposalError("invalid_date_bound")
            if value.get("calendar") not in (None, "julian", "gregorian"):
                raise ProposalError("invalid_date_calendar")
            if "is_circa" in value and not isinstance(value["is_circa"], bool):
                raise ProposalError("invalid_date_circa")
    if "existing_index" in item and (not isinstance(item["existing_index"], int)
                                     or isinstance(item["existing_index"], bool)
                                     or item["existing_index"] < 0):
        raise ProposalError("invalid_existing_index")
    evidence = item.get("evidence")
    if not isinstance(evidence, list) or not 1 <= len(evidence) <= 5:
        raise ProposalError("evidence_required")
    for source in evidence:
        if not isinstance(source, dict) or not set(source) <= _EVIDENCE_KEYS:
            raise ProposalError("invalid_evidence")
        if source.get("source_kind") not in {"vutt_page", "literature", "external"}:
            raise ProposalError("invalid_evidence_kind")
        if not any(source.get(k) for k in ("source_id", "work_id", "url")):
            raise ProposalError("evidence_locator_required")
        if source["source_kind"] == "vutt_page" and (
                not source.get("work_id") or not isinstance(source.get("page"), int)):
            raise ProposalError("vutt_page_requires_work_and_page")
        if source["source_kind"] == "literature" and (
                not source.get("source_id") or not source.get("locator")):
            raise ProposalError("literature_requires_source_and_locator")
        for key, value in source.items():
            if key == "page":
                if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                    raise ProposalError("invalid_page")
            elif value is not None and not _short_string(value, 1000 if key == "quote" else 500):
                raise ProposalError("invalid_evidence_text")


def submit(code: str, person_id: str, base_updated_at: str, items: list) -> dict:
    """Kulutab koodi ja talletab ainult ajutise ettepaneku ühe transaktsiooniga."""
    if not isinstance(code, str) or len(code) > 100 or not valid_person_id(person_id):
        raise ProposalError("invalid_handoff")
    if not isinstance(base_updated_at, str) or not base_updated_at:
        raise ProposalError("invalid_version")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise ProposalError("invalid_items")
    for item in items:
        _validate_item(item)
    payload = json.dumps(items, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_BODY_BYTES:
        raise ProposalError("proposal_too_large")

    now = int(time.time())
    digest = hashlib.sha256(code.encode()).hexdigest()
    proposal_id = secrets.token_urlsafe(16)
    with _db() as db:
        _clean(db, now)
        row = db.execute("SELECT * FROM handoff WHERE code_hash=?", (digest,)).fetchone()
        if (row is None or row["used_at"] is not None or row["expires_at"] <= now
                or row["person_id"] != person_id
                or row["base_updated_at"] != base_updated_at):
            raise ProposalError("invalid_or_expired_handoff")
        # UPDATE tingimus välistab koodi korduskasutuse ka teise protsessi võidujooksus.
        changed = db.execute(
            "UPDATE handoff SET used_at=? WHERE code_hash=? AND used_at IS NULL",
            (now, digest),
        ).rowcount
        if changed != 1:
            raise ProposalError("handoff_already_used")
        db.execute(
            "INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (proposal_id, person_id, row["username"], row["session_fingerprint"], base_updated_at,
             now, now + PROPOSAL_TTL, payload),
        )
    return {"proposal_id": proposal_id, "person_id": person_id,
            "status": "pending", "expires_at": now + PROPOSAL_TTL}


def list_pending(person_id: str, username: str, session_fingerprint: str) -> list[dict]:
    """Toimetaja näeb ainult enda algatatud üleandmisi."""
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        rows = db.execute(
            "SELECT * FROM proposal WHERE person_id=? AND username=? AND session_fingerprint=? ORDER BY created_at DESC",
            (person_id, username, session_fingerprint),
        ).fetchall()
        return [{"proposal_id": row["id"], "person_id": person_id,
                 "base_updated_at": row["base_updated_at"],
                 "created_at": row["created_at"], "expires_at": row["expires_at"],
                 "items": json.loads(row["payload"])} for row in rows]
