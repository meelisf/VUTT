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


def test_seisundi_legend_selgitab_koiki_viit():
    """Lehekülje staatuseid on VIIS — kolmene komplekt on teose koondstaatus."""
    for status in ("Toores", "Töös", "Parandatud", "Annoteeritud", "Valmis"):
        assert status in fmt.STATUS_LEGEND


def test_pikk_pealkiri_kärbitakse_otsingutulemuses():
    """Täisbibliograafiline kirje võib olla 500+ märki — otsingutulemuses
    sööks see konteksti ära. get_work näitab täispikkuses."""
    pikk = "Disputatio " + "verbosa " * 80
    out = fmt.format_search_hits(
        [dict(HIT, title=pikk)], total=1, base_url=BASE
    )
    title_line = out.splitlines()[3]
    assert len(title_line) < 300
    assert "…" in title_line


def test_luhike_pealkiri_jaab_puutumata():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    title_line = out.splitlines()[3]
    assert '"Disputatio politica de republica"' in title_line
    assert "…" not in title_line  # kärpe-ellips ei tohi lühikest pealkirja puudutada


# ── loojad ja rollid ──────────────────────────────────────────────────────

CREATORS = [
    {"name": "Andreas Virginius", "role": "praeses", "id": "vutt:Pky0a04"},
    {"name": "Peter Götschen", "role": "respondens", "id": "vutt:P6e42i9"},
    {"name": "Georg Mancelius", "role": "gratulator", "id": "vutt:P3emhpf"},
    {"name": "Fridericus Menius", "role": "gratulator", "id": "vutt:P6yllay"},
    {"name": "Johannes Weideling", "role": "aui", "id": "vutt:Pi874ih"},
]


def test_creators_grupeeritakse_rolli_kaupa():
    out = fmt.format_creators(CREATORS)
    assert "praeses: Andreas Virginius" in out
    assert "respondens: Peter Götschen" in out
    # sama rolli isikud ühel real (nime järel käib person_id)
    gratulator_line = next(l for l in out.splitlines() if l.strip().startswith("gratulator:"))
    assert "Georg Mancelius" in gratulator_line
    assert "Fridericus Menius" in gratulator_line


def test_creators_sisaldab_person_id_d():
    """Agent peab saama isikult get_person'i juurde edasi minna."""
    out = fmt.format_creators(CREATORS)
    assert "vutt:Pky0a04" in out


def test_creators_kanooniline_rollijarjestus():
    out = fmt.format_creators(CREATORS)
    assert out.index("praeses") < out.index("respondens") < out.index("gratulator")


def test_aui_roll_on_selgitatud():
    """`aui` on läbipaistmatu kood — eessõna/järelsõna autor."""
    out = fmt.format_creators(CREATORS)
    assert "aui" in out
    assert "eessõna" in fmt.CREATOR_ROLE_LEGEND.lower()


def test_legend_katab_koik_rollid():
    for role in ("praeses", "respondens", "auctor", "gratulator",
                 "dedicator", "editor", "aui"):
        assert role in fmt.CREATOR_ROLE_LEGEND


def test_tundmatu_roll_ei_kao_ara():
    out = fmt.format_creators([{"name": "X", "role": "uus_roll", "id": "vutt:P1"}])
    assert "uus_roll: X" in out


def test_creators_tuhi():
    assert fmt.format_creators([]) == ""


def test_otsingutulemus_naitab_peamise_looja_rolli():
    hit = dict(HIT, creators=CREATORS)
    out = fmt.format_search_hits([hit], total=1, base_url=BASE)
    assert "Andreas Virginius (praeses)" in out
    assert "Peter Götschen (respondens)" in out


def test_otsingutulemus_ilma_creatorsita_kasutab_autori_valja():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    assert "Ludenius, Laurentius" in out


def test_ilma_loojata_teosel_pole_rippuvat_eraldajat():
    hit = {k: v for k, v in HIT.items() if k != "autor"}
    out = fmt.format_search_hits([hit], total=1, base_url=BASE)
    title_line = out.splitlines()[3]
    assert "]  · " not in title_line
    assert title_line.startswith('[1] "Disputatio')
