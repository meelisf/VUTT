"""Käsikirja lehe aadress ja osa viide (#630 spekk 2, ADR 0070)."""
import pytest

from server.page_address import (
    clean_page_numbering, needed_stems, page_addresses, page_state, parse_mark,
    part_addresses, work_scheme,
)

FOL = "foliation"
PAG = "pagination"


def fw(s):
    return f"tekst\n<fw>{s}</fw>"


def work(texts):
    """Lehed 1..N: tüvi = 3-kohaline number, tekst listist (None = tähistuseta)."""
    stems = [f"{i:03d}" for i in range(1, len(texts) + 1)]
    return stems, {s: (t if t is not None else "lihtsalt tekst") for s, t in zip(stems, texts)}


def ref(texts, pages, scheme=FOL):
    stems, by_stem = work(texts)
    out = part_addresses(stems, by_stem, [{"id": "p", "pages": [f"{n:03d}" for n in pages]}], scheme)
    return out.get("p")


def text(texts, pages, scheme=FOL):
    r = ref(texts, pages, scheme)
    return r and r["text"]


# ── Parsimine ja olekud ─────────────────────────────────────────────────────

@pytest.mark.parametrize("s,want", [
    ("10", (10, "r")), ("246v", (246, "v")), ("246 V", (246, "v")), ("7r", (7, "r")),
    ("Fol. 3a", None), ("xii", None), ("[12]", None), ("86a", None), ("0", None),
])
def test_foliatsiooni_parsimine(s, want):
    assert parse_mark(s, FOL) == want


@pytest.mark.parametrize("s,want", [("12", (12, None)), ("12v", None), ("xii", None), ("0", None)])
def test_paginatsiooni_parsimine(s, want):
    assert parse_mark(s, PAG) == want


def test_neli_olekut():
    assert page_state("a<pb/>b <fw>10</fw>", FOL) == ("spread", None)
    assert page_state(fw("Fol. 3a"), FOL) == ("unparsable", None)
    assert page_state(fw("10"), FOL) == ("visible", (10, "r"))
    assert page_state("tekst", FOL) == ("blank", None)
    assert page_state("tekst <fw></fw>", FOL) == ("blank", None)


def test_loetakse_esimene_fw():
    assert page_state("<fw>10</fw> ja <fw>99</fw>", FOL) == ("visible", (10, "r"))


# ── Päris juhtumid ──────────────────────────────────────────────────────────

def test_o17ekb_47w6yr_sihtpilt():
    # lk 19 <fw>10</fw>, lk 20 tühi, lk 21 <fw>11</fw> (osast väljas), lk 22 tühi, lk 23 <fw>12</fw>
    texts = [None] * 18 + [fw("10"), None, fw("11"), None, fw("12")]
    r = ref(texts, [19, 20, 22])
    assert r["text"] == "fol. 10r–[10v], [11v]"
    assert r["ranges"][0] == {
        "from_page": 19, "to_page": 20, "from_stem": "019", "to_stem": "020",
        "from": {"scheme": FOL, "n": 10, "side": "r", "derived": False},
        "to": {"scheme": FOL, "n": 10, "side": "v", "derived": True},
    }
    assert r["ranges"][1]["from"] == r["ranges"][1]["to"]
    assert r["ranges"][1]["from_page"] == r["ranges"][1]["to_page"] == 22


def test_t9zd42_lk_1_4():
    assert text([fw("246"), fw("246v"), fw("247"), fw("247v")], [1, 2, 3, 4]) == "fol. 246r–247v"


def test_t9zd42_auk_tagasi_ei_tuletata():
    # Sünteetiline: lk 4 tähistuseta, lk 5 kannab 261 (köites auk). Tagasi ei tuletata
    # ([260v] oleks vale); järgmise lehe kontroll näeb hüpet → `?`, mitte [247v].
    texts = [fw("246"), fw("246v"), fw("247"), None, fw("261")]
    assert text(texts, [1, 2, 3, 4]) == "fol. 246r–247r, ?"
    # Ilma järgmise leheta (osa ja teose lõpp) tuletub eelmiselt.
    assert text(texts[:4], [1, 2, 3, 4]) == "fol. 246r–[247v]"


# ── Tuletuse reeglid ────────────────────────────────────────────────────────

def test_parsimatu_ei_tuletu_ega_ole_allikas():
    assert text([fw("10"), fw("Fol. 3a"), None], [1, 2, 3]) == "fol. 10r, ?"


def test_laotus_ei_ole_allikas():
    assert text([fw("10"), "a<pb/>b", None], [1, 2, 3]) == "fol. 10r, ?"


def test_verso_lt_ei_tuletata():
    assert text([fw("10v"), None], [1, 2]) == "fol. 10v, ?"


def test_tuletatust_ei_tuletata():
    assert text([fw("10"), None, None], [1, 2, 3]) == "fol. 10r–[10v], ?"


def test_jargmise_lehe_kontroll():
    assert text([fw("5"), None, fw("12")], [2], PAG) is None
    assert text([fw("10"), None, fw("12")], [2]) is None
    assert text([fw("10"), None, fw("11")], [1, 2, 3]) == "fol. 10r–11r"


def test_paginatsiooni_tuletus():
    assert text([fw("12"), None, fw("14")], [1, 2, 3], PAG) == "p. 12–14"
    assert text([fw("12"), None], [1, 2], PAG) == "p. 12–[13]"


def test_esimene_leht_ilma_eelnevata():
    assert text([None, fw("2")], [1, 2]) == "fol. ?, 2r"


# ── Osa viide ───────────────────────────────────────────────────────────────

def test_kontrollitud_vahemik_jaguneb_hypel():
    texts = [fw("10"), fw("10v"), fw("25"), None]
    assert text(texts, [1, 2, 3, 4]) == "fol. 10r–10v, 25r–[25v]"


def test_paginatsiooni_taaskaivitus():
    assert text([fw("39"), fw("40"), fw("1"), fw("2")], [1, 2, 3, 4], PAG) == "p. 39–40, 1–2"


def test_teadmata_lehed_uheks_kysimargiks():
    texts = [fw("10"), fw("10v"), fw("11"), fw("11v"), "x", "y", fw("13"), fw("13v")]
    # Lehed 5–6 (12r, 12v) on tähistuseta ja eelmine on verso → teadmata.
    assert text(texts, list(range(1, 9))) == "fol. 10r–11v, ?, 13r–13v"


def test_kysimargi_loik_struktuuris():
    r = ref([None, fw("2")], [1, 2])
    assert r["ranges"][0] == {"from_page": 1, "to_page": 1, "from_stem": "001", "to_stem": "001",
                              "from": None, "to": None}


def test_ilma_yhegi_aadressita_viidet_pole():
    assert ref([None, None, fw("x")], [1, 2, 3]) is None


def test_eraldi_vutt_loigud_ei_liitu():
    # Lõigud 1–2 ja 4: kuigi 10v → 11r oleks järglane, on VUTT-i lõigud eraldi.
    assert text([fw("10"), None, fw("x"), fw("11")], [1, 2, 4]) == "fol. 10r–[10v], 11r"


def test_topeltnumber_naidatakse_nagu_lehel():
    assert text([fw("86"), fw("86v"), fw("86")], [1, 2, 3]) == "fol. 86r–86v, 86r"


# ── Skeem ja abilised ───────────────────────────────────────────────────────

MS = {"id": "Q87167", "label": "käsikiri"}


def test_work_scheme():
    assert work_scheme({"type": MS, "page_numbering": FOL}) == FOL
    assert work_scheme({"type": MS}) is None
    assert work_scheme({"type": {"id": "Q1261026"}, "page_numbering": FOL}) is None
    assert work_scheme({"type": "Käsikiri", "page_numbering": FOL}) is None
    assert work_scheme({"type": MS, "page_numbering": "signatures"}) is None


def test_clean_page_numbering():
    assert clean_page_numbering(FOL) == FOL
    assert clean_page_numbering("") is None
    assert clean_page_numbering(None) is None
    with pytest.raises(ValueError):
        clean_page_numbering("signatures")


def test_needed_stems_naabritega():
    stems = [f"{i:03d}" for i in range(1, 11)]
    assert needed_stems(stems, [{"pages": ["005", "006"]}, {"pages": ["010", "puudu"]}]) == \
        {"004", "005", "006", "007", "009", "010"}


def test_page_addresses_lugemata_tyvi_on_teadmata():
    stems = ["a", "b"]
    assert page_addresses(stems, {"b": "x"}, FOL, [1]) == {1: None}
