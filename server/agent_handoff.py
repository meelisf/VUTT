"""Agendikoodi hoidla (ADR 0058 täiendus 2026-10-29, #675).

Üks tabel kõigile ettepanekuliikidele: rida = kood × liik (`text`, `parts`,
`person`), ulatus = liik + `target_id` (`NULL` = kõik). Iga liik hoiab oma lage
(`max_uses`/`uses`), TTL on koodi oma.

Ettepanekute hoidlad (eraldi SQLite-failid) ühendavad selle faili `ATTACH`-iga
(`attach`), nii et koodi kulutus (`consume`) ja ettepaneku INSERT on ÜKS tehing.
Mitme faili tehing on atomaarne ainult rollback-journal režiimis (vaikimisi
DELETE) — WAL-i ei tohi kummalegi failile lülitada.
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Optional

from .config import STATE_DIR

DB_PATH = os.path.join(STATE_DIR, "agent_handoff.sqlite3")
CODE_TTL = 8 * 60 * 60
KINDS = ("text", "parts", "person", "exemplars")
MAX_CODE_LEN = 100

_SCHEMA = """
    CREATE TABLE IF NOT EXISTS {p}handoff (
        code_hash TEXT NOT NULL, kind TEXT NOT NULL, target_id TEXT,
        username TEXT NOT NULL, session_fingerprint TEXT NOT NULL,
        expires_at INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (code_hash, kind)
    );
"""


def digest(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


def _ensure_file() -> None:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    # 0644: varundus (`meelisf`) peab root'i loodud faili lugeda saama (#131, #619).
    # Kõrvaliste eest kaitseb `state/` ise; failis on ainult koodiräsid.
    try:
        fd = os.open(DB_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
    except FileExistsError:
        pass
    else:
        os.close(fd)


def attach(db: sqlite3.Connection) -> None:
    """Ühendab hoidla skeemina `h`; kutsutakse enne tehingu algust."""
    _ensure_file()
    db.execute("ATTACH DATABASE ? AS h", (DB_PATH,))
    db.executescript(_SCHEMA.format(p="h."))


@contextmanager
def _db():
    _ensure_file()
    db = sqlite3.connect(DB_PATH, timeout=5)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=5000")
        db.executescript(_SCHEMA.format(p=""))
        with db:
            yield db
    finally:
        db.close()


def issue(username: str, session_fingerprint: str, scopes: dict,
          code: Optional[str] = None) -> dict:
    """Registreerib koodi ühe tehinguga kõigile liikidele.

    `scopes` = {liik: (target_id | None, max_uses)}. Õiguse kontrollib kutsuja.
    """
    if not scopes or set(scopes) - set(KINDS):
        raise ValueError("invalid_scope")
    code = code or secrets.token_urlsafe(32)
    now = int(time.time())
    with _db() as db:
        db.execute("DELETE FROM handoff WHERE expires_at < ?", (now,))
        db.executemany("INSERT INTO handoff VALUES (?, ?, ?, ?, ?, ?, ?, 0)",
                       [(digest(code), kind, target, username, session_fingerprint or "",
                         now + CODE_TTL, max_uses) for kind, (target, max_uses) in scopes.items()])
    return {"code": code, "expires_at": now + CODE_TTL}


def revoke_user(username: str) -> int:
    """Kustutab kasutaja koodid (konto kustutus / rolli muutus, #619)."""
    if not os.path.exists(DB_PATH):
        return 0                 # koode pole kunagi antud — ära loo andmebaasi
    with _db() as db:
        return db.execute("DELETE FROM handoff WHERE username=?", (username,)).rowcount


def _valid(row, target_id: str, now: int) -> bool:
    return row is not None and row["expires_at"] > now \
        and (row["target_id"] is None or row["target_id"] == target_id)


def check(code, kind: str, target_id: str, error=ValueError, need_use: bool = False) -> dict:
    """Kehtiv kood, mille ulatuses on siht. Ainult lugemine — ei kuluta.

    `error` on kutsuja veaklass (masinloetav kood sõnumis); `need_use` = esitus
    peab veel mahtuma lakke (lugemine, nt lehe toortekst, ei pea).
    """
    if not isinstance(code, str) or not code or len(code) > MAX_CODE_LEN:
        raise error("invalid_or_expired_handoff")
    if not os.path.exists(DB_PATH):
        raise error("invalid_or_expired_handoff")
    with _db() as db:
        row = db.execute("SELECT * FROM handoff WHERE code_hash=? AND kind=?",
                         (digest(code), kind)).fetchone()
    if not _valid(row, target_id, int(time.time())):
        raise error("invalid_or_expired_handoff")
    if need_use and row["uses"] >= row["max_uses"]:
        raise error("handoff_used_up")
    return dict(row)


def consume(db: sqlite3.Connection, code: str, kind: str, target_id: str,
            now: int, error=ValueError) -> dict:
    """Kulutab ühe esituse kutsuja tehingus (`attach`-itud ühendus).

    Tingimuslik UPDATE hoiab lae ka samaaegsete esituste korral; kutsuja
    INSERT samas tehingus tähendab, et viga ettepanekul koodi ei kuluta.
    """
    h = digest(code)
    db.execute("DELETE FROM h.handoff WHERE expires_at < ?", (now,))
    row = db.execute("SELECT * FROM h.handoff WHERE code_hash=? AND kind=?", (h, kind)).fetchone()
    if not _valid(row, target_id, now):
        raise error("invalid_or_expired_handoff")
    if db.execute("UPDATE h.handoff SET uses = uses + 1 WHERE code_hash=? AND kind=? AND uses < max_uses",
                  (h, kind)).rowcount != 1:
        raise error("handoff_used_up")
    return dict(row)
