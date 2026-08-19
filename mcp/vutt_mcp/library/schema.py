"""library.db skeem. Tuletatud read-model — nullist taastatav."""
import sqlite3
from pathlib import Path

DDL = """
CREATE TABLE IF NOT EXISTS meta (voti TEXT PRIMARY KEY, vaartus TEXT);

CREATE TABLE IF NOT EXISTS documents (
  doc_id            TEXT PRIMARY KEY,   -- Zotero MANUSE key (üks fail = üks dok)
  parent_key        TEXT NOT NULL,      -- Zotero kirje key (viite identiteet)
  collection_key    TEXT,
  title             TEXT NOT NULL,
  creators_json     TEXT,               -- [[nimi, roll], ...]
  year              TEXT,
  place             TEXT,
  publisher         TEXT,
  publication       TEXT,
  volume            TEXT,
  issue             TEXT,
  pages             TEXT,
  series            TEXT,
  edition           TEXT,
  isbn              TEXT,
  doi               TEXT,
  file_path         TEXT,
  link_mode         INTEGER,
  file_missing      INTEGER NOT NULL DEFAULT 0,
  page_count        INTEGER NOT NULL DEFAULT 0,
  page_mapping_source     TEXT,         -- pagelabels | detected | sidecar | none
  page_mapping_confidence REAL,
  page_mapping_summary    TEXT,
  fingerprint       TEXT NOT NULL DEFAULT '',
  indexed_at        TEXT
);

CREATE TABLE IF NOT EXISTS pages (
  doc_id       TEXT NOT NULL REFERENCES documents(doc_id) ON DELETE CASCADE,
  pdf_page     INTEGER NOT NULL,        -- AINUKE järjestusvõti
  printed_page TEXT,                    -- TEXT: xviii, A3, 225a; NULL = teadmata
  text         TEXT NOT NULL,           -- toores pdftotext väljund, AINUS tagastatav
  PRIMARY KEY (doc_id, pdf_page)
);
CREATE INDEX IF NOT EXISTS pages_printed ON pages(doc_id, printed_page);

-- search_text elab AINULT siin: normaliseeritud, ei ole kunagi tagastatav.
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
  doc_id UNINDEXED, pdf_page UNINDEXED, search_text
);
"""


def connect(path: Path, *, read_only: bool = False) -> sqlite3.Connection:
    """Ühendus. MCP-pool avab read-only ja TÖÖRIISTAKUTSE KOHTA — pikaajaline
    ühendus hoiaks pärast ümberehituse rename'i vana inode'i elus."""
    path = Path(path)
    if read_only:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path)
        conn.execute("PRAGMA foreign_keys = ON")
    conn.row_factory = sqlite3.Row
    return conn


def create_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(DDL)
    conn.commit()
