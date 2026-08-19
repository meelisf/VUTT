import pytest

from vutt_mcp.library.query import PageRefError, fetch_pages, resolve_page_range
from vutt_mcp.library.schema import connect, create_schema


@pytest.fixture()
def conn(tmp_path):
    c = connect(tmp_path / "l.db")
    create_schema(c)
    c.execute("INSERT INTO documents (doc_id, parent_key, title, page_count) "
              "VALUES ('A','P','Teos',6)")
    # PDF 1-2 = rooma i-ii, PDF 3 = nummerdamata, PDF 4-6 = trükitud 1-3
    sildid = ["i", "ii", None, "1", "2", "3"]
    for nr, silt in enumerate(sildid, start=1):
        c.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                  "VALUES ('A',?,?,?)", (nr, silt, f"tekst {nr} " * 50))
    c.commit()
    return c


def test_pdf_numeratsioon(conn):
    assert resolve_page_range(conn, "A", "2", "4", "pdf") == (2, 4)


def test_trukitud_numeratsioon(conn):
    assert resolve_page_range(conn, "A", "1", "3", "printed") == (4, 6)


def test_trukitud_rooma(conn):
    assert resolve_page_range(conn, "A", "i", "ii", "printed") == (1, 2)


def test_tundmatu_silt_kukub_ja_loetleb_labimad(conn):
    with pytest.raises(PageRefError) as exc:
        resolve_page_range(conn, "A", "99", "100", "printed")
    assert "99" in str(exc.value)
    assert "i" in str(exc.value) or "1" in str(exc.value)  # naabersildid näidatakse


def test_pdf_vahemik_valjaspool_kukub(conn):
    with pytest.raises(PageRefError):
        resolve_page_range(conn, "A", "1", "99", "pdf")


def test_fetch_austab_lehepiiri(conn):
    read, karbitud = fetch_pages(conn, "A", 1, 6, max_pages=2)
    assert len(read) == 2
    assert karbitud is True


def test_fetch_austab_margipiiri(conn):
    read, karbitud = fetch_pages(conn, "A", 1, 6, max_pages=20, max_chars=500)
    assert karbitud is True
    assert sum(len(r.text) for r in read) <= 500 + 500  # vähemalt üks leht mahub


def test_fetch_ilma_karpimiseta(conn):
    read, karbitud = fetch_pages(conn, "A", 1, 3, max_pages=20, max_chars=10**6)
    assert len(read) == 3 and karbitud is False
    assert read[0].printed_page == "i"


def test_tagurpidi_pdf_vahemik_kukub(conn):
    """`printed` haru kukub sellega juba; `pdf` andis vaikselt tühja tulemuse."""
    with pytest.raises(PageRefError):
        resolve_page_range(conn, "A", "4", "2", "pdf")
