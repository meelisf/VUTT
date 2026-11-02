# tests/test_jaanson_import.py
"""Jaansoni leidumuse import: parser, hoidjad, märked, sobitus (`scripts/jaanson_plan.py`)
ja rakendus teose seisule (`scripts/jaanson_apply.py`). Kujud on päris OCR-ist."""
import pytest

from scripts import jaanson_apply as ja
from scripts import jaanson_plan as jp

PAGE = """BIBLIOGRAAFIA * BIBLIOGRAPHIE

39.   Oldenburg(ius), Heinrich [P] — Lannerus, Jonas [A & R]
Disputatio philosophica de causis externis, guam ... sub praesidio ... Heinrici Oldenburgii
discutiendam proponit Jonas Jacobi Lannerus ... — Dorpati Livonorum, 1633 : J. Pistorius. [12] p. 4°.
      Grat.: Petrus A. Schomerus (gr.), Nicolaus L. Nycop. (gr.), Benedictus Brusaeus
      Lit.: Tering 81; Sainio 41:4
Helsinki YK; Stockholm KB                                                               R Acad. Dorp. 1633:9

40. Oldenburg(ius), Heinrich [P] - Lannerus, Jonas [A & R]
Disputatio physica anniversaria. De natura ignis. ... ad diem 22. Junij ...
— Dorpati Livonorum, 1633 : J. Pistorius. [12] p. 4°.
       Lit.: Tering 81, Sainio 41:3
Helsinki YK; Stockholm KB (def.)                                                       R Acad. Dorp. 1633:10

4]. Naeniae in obitum ... Catharinae von Ackerbaum, quae 6. Septemb. 1650. ... prognata,
10. ejusdem renata ... Riga, wie auch Oberster über ein Regiment — Dorpati, 1653 : J. Vogel. [4] p. 4°.
Tartu ÜR; Helsinki YK; Karlstad StB: Riga LAB                                       R Est. A-5065(9)

42. *Savonius, Michael [P] — Aritander, Nicolaus [R]
De meteoris in genere. — Dorpati, 1633 : J. Pistorius. 4^.
      Lit.: Tering 10

183
"""


@pytest.fixture
def entries():
    return jp.parse_entries([(181, PAGE)], first=39)


def test_parser_kirjed_ja_leidumus(entries):
    assert [e["nr"] for e in entries] == [39, 40, 41, 42]      # „4]." = 41, „10. ejusdem" ei ole kirje
    a, b, c, d = entries
    assert a["shelfmark"] == "R Acad. Dorp. 1633:9" and a["year"] == 1633
    assert [h["raw"] for h in a["holdings"]] == ["Helsinki YK", "Stockholm KB"]
    assert b["holdings"][1] == {"raw": "Stockholm KB", "qualifier": "def."}
    # Pealkirjakirjel algab pealkiri päisest; „Riga, wie auch …" on pealkiri, mitte leidumus
    assert c["title"].startswith("Naeniae in obitum") and "Riga, wie auch" in c["title"]
    assert [h["raw"] for h in c["holdings"]] == ["Tartu ÜR", "Helsinki YK", "Karlstad StB", "Riga LAB"]
    assert c["shelfmark"] == "R Est. A-5065(9)"
    assert d["indirect"] and d["holdings"] == [] and d["shelfmark"] is None


@pytest.mark.parametrize("raw, parts", [
    ("Stockholm KB, RA", [("Stockholm KB", None), ("Stockholm RA", None)]),
    ("Karlstad StB, Vásterás LB", [("Karlstad StB", None), ("Vásterás LB", None)]),
    ("Uppsala UB (Kopie, def.)", [("Uppsala UB", "Kopie, def.")]),
    ("2. Aufl.: Aurich BOL; Halle UB", [("Aurich BOL", None), ("Halle UB", None)]),
])
def test_split_holdings(raw, parts):
    assert [(h["raw"], h["qualifier"]) for h in jp.split_holdings(raw)] == parts


def test_shelfmark_ocr_ilma_r_ita():
    assert jp.norm_shelfmark("Acad. Dorp. 1639:29") == "R Acad. Dorp. 1639:29"
    assert jp.norm_shelfmark("R Acad. Dorp.1694:23") == "R Acad. Dorp. 1694:23"


REG = {"Tartu TÜR": {"name": "TÜR", "aliases": ["Tartu ÜR"]}, "Helsinki KK": {"name": "KK", "aliases": ["Helsinki YK"]},
       "Stockholm KB": {"name": "KB"}, "Riga LUAB": {"name": "LUAB", "aliases": ["Riga LAB"]},
       "Växjö StB": {"name": "V", "aliases": ["Växjö LB"]}, "Tartu RA": {"name": "RA", "aliases": ["Tartu EAA"]}}


@pytest.mark.parametrize("raw, key", [
    ("Helsinki YK", "Helsinki KK"), ("Váxjó LB", "Växjö StB"), ("Vàxjó LB", "Växjö StB"),
    ("HelsinkiYK", "Helsinki KK"), ("Riga", None), ("KB", None),
])
def test_hoidja_ocr_kujud(raw, key):
    assert jp.HolderResolver(REG)(raw)[0] == key


def test_arhiiviviide_on_kohaviit():
    assert jp.HolderResolver(REG)("Tartu EAA, Best. 957, Verz. 2, Nr. 438") == \
        ("Tartu RA", "Best. 957, Verz. 2, Nr. 438")


@pytest.mark.parametrize("q, ok, fields", [
    (None, True, {}),
    ("def.", True, {"condition": "defektne"}),
    ("Kopie, def.", True, {"condition": "defektne", "notes": "Koopia"}),
    ("Kopie aus Skara", True, {"notes": "Koopia (Skarast)"}),
    ("nur def. Titelbl.", True, {"notes": "nur def. Titelbl."}),
    ("verschollen", False, None),
    ("früher in BGGA", False, None),
    ("Nordin 66, Nr. 75, Handschr.", False, None),
])
def test_marke_poliitika(q, ok, fields):
    got_ok, got = jp.qualifier_policy(q)
    assert got_ok is ok
    if ok:
        assert got == fields


def test_kirje_eksemplarid(entries):
    resolve = jp.HolderResolver(REG)
    planned, review = jp.entry_exemplars(entries[0], resolve)
    assert planned == [{"holder": "Helsinki KK"}, {"holder": "Stockholm KB"},
                       {"holder": "Tartu TÜR", "shelfmark": "R Acad. Dorp. 1633:9", "notes": "Paberkoopia"}]
    # Vasak „Tartu ÜR" + parem originaali kohaviit = ÜKS TÜR-i eksemplar
    planned, review = jp.entry_exemplars(entries[2], resolve)
    assert [x for x in planned if x["holder"] == "Tartu TÜR"] == [{"holder": "Tartu TÜR", "shelfmark": "R Est. A-5065(9)"}]
    assert review == ["hoidja lahendamata: 'Karlstad StB'"]


def test_sobitus_uks_uhele_ja_sari():
    t = "In octo libros Physic. Arist. sive de naturali auscultatione disputatio {} quam sub praesidio proponit"
    entries = [{"nr": 1, "year": 1642, "title": t.format("tertia")},
               {"nr": 2, "year": 1642, "title": t.format("quinta")}]
    works = [{"id": "w1", "year": 1642, "title": t.format("tertia")}]
    m = jp.match(entries, works)
    assert m[1]["work_id"] == "w1" and m[2]["work_id"] is None     # teos läheb ühele kirjele
    m = jp.match(entries[1:], works)
    assert m[2]["status"] == "mitmetähenduslik"                      # sarja naaber ei ole kindel
    assert jp.series_markers("Disputatio XII. de art. XVI, anno M. DC. XCVI [20.6.] civili") == {"xii", "xvi"}


ITEM = {"work_id": "w1", "nr": 39, "exemplars": [
    {"holder": "Helsinki KK"}, {"holder": "Stockholm KB", "condition": "defektne"},
    {"holder": "Tartu TÜR", "shelfmark": "R Acad. Dorp. 1633:9", "notes": "Paberkoopia"}]}


def test_rakendus_lisab_ja_margib():
    out, report = ja.apply_to_meta({"id": "w1", "notes": "Vana märkus"}, ITEM, "2026-11-02")
    xs = out["exemplars"]
    assert [x["holder"] for x in xs] == ["Helsinki KK", "Stockholm KB", "Tartu TÜR"]
    assert all(x["source"] == {"kind": "jaanson", "ref": "Jaanson 39", "at": "2026-11-02"} for x in xs)
    assert all(x["needs_review"] is True and "text_witness" not in x for x in xs)
    assert len({x["id"] for x in xs}) == 3
    assert out["notes"] == "Vana märkus\n\nJaanson 39"
    # Korduskäivitus: kõik olemas, märkus olemas → muutust ei ole
    out2, report2 = ja.apply_to_meta({"id": "w1", "notes": out["notes"], "exemplars": xs}, ITEM, "2026-11-03")
    assert out2 == {} and all(r.startswith("=") for r in report2)


def test_rakendus_olemasolevad_ja_kasikiri():
    meta = {"id": "w1", "exemplars": [
        {"id": "a", "holder": "Stockholm KB", "shelfmark": "F1700 1651"},
        {"id": "b", "holder": "Tartu TÜR", "shelfmark": "R Acad.Dorp. 1633:9"}]}
    out, report = ja.apply_to_meta(meta, ITEM, "2026-11-02")
    assert [x["holder"] for x in out["exemplars"][2:]] == ["Helsinki KK"]
    item = {"nr": 5, "exemplars": [{"holder": "Tartu TÜR", "shelfmark": "R Est. A-1095(5)"}]}
    out, report = ja.apply_to_meta({"id": "w", "exemplars": [
        {"id": "a", "holder": "Tartu TÜR", "shelfmark": "R Est.A-1095 (konvoluut)"}]}, item, "d")
    assert "exemplars" not in out and "teise kohaviidaga" in report[0]
    out, report = ja.apply_to_meta({"id": "w", "type": {"id": "Q87167"}}, item, "d")
    assert out == {} and "käsikiri" in report[0]
