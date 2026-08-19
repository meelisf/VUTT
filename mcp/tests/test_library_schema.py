import sqlite3

import pytest

from vutt_mcp.library.schema import connect, create_schema


def test_skeem_luuakse(tmp_path):
    conn = connect(tmp_path / "l.db")
    create_schema(conn)
    tabelid = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    assert {"documents", "pages", "pages_fts", "meta"} <= tabelid


def test_fts_otsib_ja_kustutab(tmp_path):
    conn = connect(tmp_path / "l.db")
    create_schema(conn)
    conn.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                 "VALUES ('A', 1, 'Ludenius disputatio')")
    conn.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                 "VALUES ('B', 1, 'muu tekst')")
    leid = conn.execute(
        "SELECT doc_id FROM pages_fts WHERE pages_fts MATCH 'Ludenius'").fetchall()
    assert [r[0] for r in leid] == ["A"]
    conn.execute("DELETE FROM pages_fts WHERE doc_id = 'A'")
    assert conn.execute(
        "SELECT COUNT(*) FROM pages_fts WHERE pages_fts MATCH 'Ludenius'"
    ).fetchone()[0] == 0


def test_read_only_ei_luba_kirjutada(tmp_path):
    db = tmp_path / "l.db"
    create_schema(connect(db))
    ro = connect(db, read_only=True)
    with pytest.raises(sqlite3.OperationalError):
        ro.execute("INSERT INTO meta (voti, vaartus) VALUES ('x','y')")


def test_printed_page_on_tekst(tmp_path):
    conn = connect(tmp_path / "l.db")
    create_schema(conn)
    conn.execute("INSERT INTO documents (doc_id, parent_key, title) "
                 "VALUES ('A','P','T')")
    conn.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                 "VALUES ('A', 3, 'xviii', 'tekst')")
    assert conn.execute(
        "SELECT printed_page FROM pages WHERE doc_id='A'").fetchone()[0] == "xviii"
