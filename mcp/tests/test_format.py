"""Väljundivormingu testid — puhtad funktsioonid."""
from vutt_mcp import format as fmt

BASE = "https://vutt.utlib.ut.ee"

HIT = {
    "work_id": "v7Kq2mXp",
    "title": "Disputatio politica de republica",
    "autor": "Ludenius, Laurentius",
    "aasta": 1642,
    "location": "Tartu",
    "lehekylje_number": 12,
    "teose_lehekylgede_arv": 48,
    "status": "Valmis",
    "collections": ["Disputatsioonid"],
    "_formatted": {"lehekylje_tekst": "…quod respublica Suecorum…"},
}


def test_hit_sisaldab_koiki_votmeandmeid():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    assert "v7Kq2mXp" in out
    assert "lk 12/48" in out
    assert "seisund=Valmis" in out
    assert "Disputatio politica" in out
    assert "quod respublica Suecorum" in out


def test_hit_annab_toolaua_lingi_mitte_pildi_lingi():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    assert f"{BASE}/work/v7Kq2mXp/12" in out
    assert "/api/images/" not in out


def test_tulemuste_koguarv_naidatakse():
    out = fmt.format_search_hits([HIT], total=622, base_url=BASE)
    assert "622" in out


def test_tuhi_tulemus_soovitab_relax_matchingut():
    out = fmt.format_search_hits([], total=0, base_url=BASE)
    assert "relax_matching" in out


def test_marginaalia_katse_margistatakse():
    hit = dict(HIT, _formatted={
        "lehekylje_tekst": "",
        "marginaalia_tekst": "vide Aristotelem",
    })
    out = fmt.format_search_hits([hit], total=1, base_url=BASE)
    assert "marginaalia: vide Aristotelem" in out


def test_work_url_ilma_leheta():
    assert fmt.work_url("abc", base_url=BASE) == f"{BASE}/work/abc"


def test_person_url_sailitab_prefiksi():
    assert fmt.person_url("vutt:Pfxxxsc", base_url=BASE) == f"{BASE}/persons/vutt:Pfxxxsc"


def test_format_fields_jatab_tuhjad_valja():
    out = fmt.format_fields([("aasta", 1642), ("koht", None), ("žanr", "")])
    assert "aasta: 1642" in out
    assert "koht" not in out
    assert "žanr" not in out


def test_format_fields_uhendab_massiivi():
    out = fmt.format_fields([("keeled", ["lat", "grc"])])
    assert "keeled: lat, grc" in out


def test_format_pages_naitab_marginaaliat_eraldi():
    pages = [{
        "lehekylje_number": 12,
        "lehekylje_tekst": "põhitekst siin",
        "marginaalia_tekst": "ääremärkus siin",
        "status": "Toores",
    }]
    out = fmt.format_pages(pages, base_url=BASE, work_id="abc")
    assert "põhitekst siin" in out
    assert "marginaalia" in out.lower()
    assert "ääremärkus siin" in out


def test_format_pages_jatab_tuhja_marginaalia_valja():
    pages = [{
        "lehekylje_number": 12,
        "lehekylje_tekst": "põhitekst",
        "marginaalia_tekst": "",
        "status": "Valmis",
    }]
    assert "marginaalia" not in fmt.format_pages(
        pages, base_url=BASE, work_id="abc"
    ).lower()


def test_format_pages_tuhi_vahemik():
    assert "ei ole" in fmt.format_pages([], base_url=BASE, work_id="abc")


def test_seisundi_legend_selgitab_koiki_kolme():
    for status in ("Toores", "Töös", "Valmis"):
        assert status in fmt.STATUS_LEGEND
