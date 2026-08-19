import pytest

from vutt_mcp.library.query import build_match, make_excerpt, search
from vutt_mcp.library.schema import connect, create_schema


@pytest.fixture()
def conn(tmp_path):
    c = connect(tmp_path / "l.db")
    create_schema(c)
    c.execute("INSERT INTO documents (doc_id, parent_key, title, year, page_count) "
              "VALUES ('A','P1','Album academicum','1984',3)")
    lehed = [
        (1, "1", "Laurentius Ludenius oli professor."),
        (2, "2", "Teine lehekulg ilma otsitavata."),
        (3, "3", "Ludenius ja disputa-\ntio samal lehel."),
    ]
    for nr, silt, tekst in lehed:
        c.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                  "VALUES ('A',?,?,?)", (nr, silt, tekst))
        from vutt_mcp.library.extract import normalize_for_search
        c.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                  "VALUES ('A',?,?)", (nr, normalize_for_search(tekst)))
    c.commit()
    return c


def test_range_sobitamine_nouab_koiki_sonu(conn):
    assert len(search(conn, "Ludenius professor")) == 1
    assert search(conn, "Ludenius puudub") == []


def test_lodvendatud_sobitamine_leiab_rohkem(conn):
    assert len(search(conn, "Ludenius puudub", relax=True)) == 2


def test_fts_erimargid_ei_tekita_syntaksiviga(conn):
    for pahur in ['"Ludenius', "Ludenius-", "Ludenius:", "(Ludenius)", "Luden*"]:
        search(conn, pahur)  # ei tohi visata


def test_poolitatud_sona_leitakse_aga_tagastatakse_algsel_kujul(conn):
    hits = search(conn, "disputatio")
    assert len(hits) == 1
    assert "disputa-" in hits[0].excerpt  # katke tuleb TOORESEST tekstist


def test_katke_umbritseb_leitud_sona():
    tekst = "a" * 300 + " Ludenius " + "b" * 300
    katke = make_excerpt(tekst, ["Ludenius"], width=60)
    assert "Ludenius" in katke
    assert len(katke) < 120


def test_build_match_tsiteerib_tokenid():
    assert build_match("Ludenius professor", relax=False) == '"Ludenius" AND "professor"'
    assert build_match("Ludenius professor", relax=True) == '"Ludenius" OR "professor"'
    assert build_match('"tema oli"', relax=False) == '"tema oli"'


def test_doc_id_piirab(conn):
    conn.execute("INSERT INTO documents (doc_id, parent_key, title) "
                 "VALUES ('B','P2','Teine')")
    conn.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                 "VALUES ('B',1,'1','Ludenius mujal')")
    conn.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                 "VALUES ('B',1,'Ludenius mujal')")
    conn.commit()
    assert len(search(conn, "Ludenius")) == 3
    assert len(search(conn, "Ludenius", doc_id="A")) == 2


def test_negatiivne_limit_ei_ava_kogu_korpust(conn):
    """`limit` tuleb mudelilt: -1 tähendaks SQLite'is „piiranguta"."""
    assert len(search(conn, "Ludenius", limit=-1)) == 2


def test_null_limit_ei_valeta_tuhja_tulemust(conn):
    """limit=0 andis varem 0 vastet → „ei leidnud" ka siis, kui vasted on."""
    assert len(search(conn, "Ludenius", limit=0)) == 2


def test_liiga_suur_limit_kaetakse(conn):
    assert len(search(conn, "Ludenius", limit=10**6)) == 2
