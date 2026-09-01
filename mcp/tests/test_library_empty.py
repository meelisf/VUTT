"""Tühja tulemuse diagnostika.

Kaks nõuet korraga: vastus peab ütlema, MIKS tulemus on tühi, ja tohib maksta
vaid mõne rea mudeli konteksti — tühje vastuseid tuleb seansis kümneid.
"""
import pytest

from vutt_mcp.library.extract import normalize_for_search
from vutt_mcp.library.format import format_empty
from vutt_mcp.library.query import diagnose
from vutt_mcp.library.schema import connect, create_schema

LEHED = [
    ("A", 1, "Laurentius Ludenius oli professor Dorpati."),
    ("A", 2, "Abfchrift eines Briefes von Morgenftern."),   # Fraktur-OCR
    ("B", 1, "Abschrift des Briefes; Strasse und Wissenschaft."),
]


@pytest.fixture()
def conn(tmp_path):
    c = connect(tmp_path / "l.db")
    create_schema(c)
    for doc in ("A", "B"):
        c.execute("INSERT INTO documents (doc_id, parent_key, title) "
                  "VALUES (?,?,?)", (doc, "P" + doc, "Teos " + doc))
    for doc, nr, tekst in LEHED:
        c.execute("INSERT INTO pages (doc_id, pdf_page, printed_page, text) "
                  "VALUES (?,?,?,?)", (doc, nr, str(nr), tekst))
        c.execute("INSERT INTO pages_fts (doc_id, pdf_page, search_text) "
                  "VALUES (?,?,?)", (doc, nr, normalize_for_search(tekst)))
    c.commit()
    return c


def test_fraktuuri_variant_soovitatakse_mooedetuna(conn):
    """Ainus asi, mis mudelit edasi viib: sõna, millel ON vasteid."""
    d = {x.token: x for x in diagnose(conn, "Abschrift", doc_id="A")}
    assert d["Abschrift"].in_doc == 0
    assert d["Abschrift"].soovitus == "Abfchrift"
    assert d["Abschrift"].soovitus_vasteid == 1
    assert d["Abschrift"].soovitus_pohjus == "fraktur"


def test_kaanatud_vorm_lyheneb_tuveks(conn):
    d = diagnose(conn, "Ludeniusega")[0]
    assert d.soovitus == "Ludenius" and d.soovitus_pohjus == "lyhend"


def test_olematut_sona_ei_soovitata_poolikuna(conn):
    """„quux" → „quu" leiaks juhusliku sõna ja saadaks mudeli valele jäljele."""
    d = diagnose(conn, "quux")[0]
    assert d.in_corpus == 0 and d.soovitus is None


def test_tundmatu_sona_vastus_on_uherealine(conn):
    tulem = format_empty(diagnose(conn, "quux xyzzy"))
    assert tulem.count("\n") == 0
    assert "quux" in tulem


def test_vastus_naitab_kus_sona_esineb(conn):
    tulem = format_empty(diagnose(conn, "Abschrift", doc_id="A"), doc_id="A")
    assert "siin 0" in tulem and "kogus 1" in tulem
    assert "Abfchrift" in tulem
    assert "doc_id" in tulem  # ütleb, et mujal on vasteid


def test_vastus_ei_korda_juba_rakendatud_noannet(conn):
    """Mudel saatis relax_matching=true ja sai vastuseks „proovi relaxi"."""
    tulem = format_empty(diagnose(conn, "Ludenius Abschrift", doc_id="A"),
                         relax=True, doc_id="A")
    assert "relax_matching" not in tulem


def test_vastus_jaab_luhikeseks(conn):
    """Iga rida maksab konteksti: pealkiri + tokenid + kuni kaks saba-rida."""
    tulem = format_empty(diagnose(conn, "Abschrift Ludenius Strasse Morgenstern",
                                  doc_id="A"), doc_id="A")
    assert len(tulem.splitlines()) <= 7
    assert len(tulem) < 500


def test_diagnostika_ei_vaata_rohkem_kui_neli_sona(conn):
    d = diagnose(conn, "aa bb cc dd ee ff gg")
    assert len(d) == 4
