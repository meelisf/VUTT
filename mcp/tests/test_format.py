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
    assert "48 lk" in out       # teose maht teose real
    assert "lk 12 ·" in out     # vaste lehekülg omal real
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


def test_seisundi_legend_ei_kordu_vastustes():
    """Legend elab serveri juhendis (üks kord seansis), mitte igas vastuses.

    Kümne päringu jooks kordas seda ~100 tokenit korraga — vt
    test_instructions.py, mis valvab, et juhend seisundid ikka nimetab.
    """
    hits = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    pages = fmt.format_pages(
        [{"lehekylje_number": 12, "status": "Toores", "lehekylje_tekst": "x"}],
        base_url=BASE, work_id="abc",
    )
    for out in (hits, pages):
        assert "usaldusväärsus" not in out
        assert "puutumata masinlugemine" not in out
    # seisund ise jääb vastusesse alles
    assert "seisund=Toores" in pages


def test_pikk_pealkiri_kärbitakse_otsingutulemuses():
    """Täisbibliograafiline kirje võib olla 500+ märki — otsingutulemuses
    sööks see konteksti ära. get_work näitab täispikkuses."""
    pikk = "Disputatio " + "verbosa " * 80
    out = fmt.format_search_hits(
        [dict(HIT, title=pikk)], total=1, base_url=BASE
    )
    title_line = next(l for l in out.splitlines() if l.startswith("[1] "))
    assert len(title_line) < 300
    assert "…" in title_line


def test_luhike_pealkiri_jaab_puutumata():
    out = fmt.format_search_hits([HIT], total=1, base_url=BASE)
    title_line = next(l for l in out.splitlines() if l.startswith("[1] "))
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
    title_line = next(l for l in out.splitlines() if l.startswith("[1] "))
    assert "]  · " not in title_line
    assert title_line.startswith('[1] "Disputatio')


def test_rollilegend_ainult_kui_on_muid_rolle_kui_auctor():
    """Ainult autoriga teosel ei seleta legend midagi — 92 tokenit tühja."""
    assert not fmt.needs_role_legend([{"name": "X", "role": "auctor"}])
    assert not fmt.needs_role_legend([])
    assert fmt.needs_role_legend([
        {"name": "X", "role": "auctor"}, {"name": "Y", "role": "aui"},
    ])
    # rollita kirje ei tohi legendi välja kutsuda ega ka krahhi teha
    assert not fmt.needs_role_legend([{"name": "X"}])


# ── lehekülgede ülevaade (vahemikena, mitte rida lehe kohta) ──────────────

def _lehed(paarid):
    return [{"lehekylje_number": n, "status": s} for n, s in paarid]


def test_page_index_uhtlane_teos_on_uks_rida():
    """89 % teostest on kõigil lehtedel sama seisund — 48 rida = 47 kordust."""
    out = fmt.format_page_index(
        _lehed([(n, "Toores") for n in range(1, 49)]), base_url=BASE, work_id="v7Kq2mXp"
    )
    assert "Leheküljed: 1–48" in out
    assert "kõik seisund=Toores" in out
    assert f"{BASE}/work/v7Kq2mXp/{{lk}}" in out
    assert "lk 7" not in out  # üksikuid lehti ei loetleta
    assert len(out.splitlines()) == 2


def test_page_index_seisundi_muutused_jooksudena():
    out = fmt.format_page_index(
        _lehed([(n, "Toores") for n in range(1, 5)]
               + [(n, "Parandatud") for n in range(5, 7)]
               + [(7, "Valmis")]),
        base_url=BASE, work_id="abc",
    )
    assert "lk 1–4 Toores" in out
    assert "lk 5–6 Parandatud" in out
    assert "lk 7 Valmis" in out          # üksik leht ilma vahemikuta
    assert "kõik seisund" not in out
    assert out.index("Toores") < out.index("Parandatud") < out.index("Valmis")


def test_page_index_auk_numbrites_jaab_nahtavaks():
    """Kodeering käib tegelike numbrite peale — auk ei tohi vaikselt kaduda."""
    out = fmt.format_page_index(
        _lehed([(1, "Toores"), (2, "Toores"), (9, "Toores")]),
        base_url=BASE, work_id="abc",
    )
    assert "Leheküljed: 1–2 · 9" in out


def test_page_index_jarjestab_ise():
    out = fmt.format_page_index(
        _lehed([(3, "Toores"), (1, "Toores"), (2, "Toores")]),
        base_url=BASE, work_id="abc",
    )
    assert "Leheküljed: 1–3" in out


def test_page_index_puuduv_seisund_ei_kao():
    out = fmt.format_page_index(
        [{"lehekylje_number": 1}], base_url=BASE, work_id="abc"
    )
    assert "seisund=?" in out


# ── otsingutulemuse rühmitamine teose kaupa ───────────────────────────────

def _vaste(work_id, page, title="Disputatio politica", **extra):
    return dict(HIT, work_id=work_id, lehekylje_number=page, title=title, **extra)


def test_search_hits_paise_ei_kordu_sama_teose_lehtedel():
    """Mõõdetud: 26 % vastuse mahust oli märk-märgilt korduv päis."""
    out = fmt.format_search_hits(
        [_vaste("zhdry4", n) for n in (1, 2, 3)], total=3, base_url=BASE
    )
    assert out.count("Disputatio politica") == 1
    assert out.count("work_id=zhdry4") == 1
    for n in (1, 2, 3):
        assert f"lk {n} ·" in out


def test_search_hits_iga_teos_oma_numbri_all():
    out = fmt.format_search_hits(
        [_vaste("aaa", 1), _vaste("bbb", 5, title="Oratio"), _vaste("aaa", 2)],
        total=3, base_url=BASE,
    )
    assert "[1]" in out and "[2]" in out and "[3]" not in out
    # sama teose lehed koonduvad ühte rühma, ka kui Meili järjestus vaheldub
    assert out.index("work_id=aaa") < out.index("work_id=bbb")
    assert out.count("work_id=aaa") == 1


def test_search_hits_loendur_nimetab_teoste_arvu():
    out = fmt.format_search_hits(
        [_vaste("aaa", 1), _vaste("bbb", 2)], total=99, base_url=BASE
    )
    assert "99" in out and "2 teosest" in out


# ── korduste kokkusurumine (mudeli silmus OCR-is) ─────────────────────────

def test_collapse_kokku_surub_korduva_ploki():
    """„S. S. S. …" × 679 — mudel läks sõlme, 1366-sõnalisest lehest on
    unikaalset teksti 8 sõna. Kärbe peab olema NÄHTAV, mitte vaikne."""
    tekst = "Algus siin. " + "S. " * 400 + "Lõpp siin."
    out = fmt.collapse_repeats(tekst)
    assert "Algus siin." in out and "Lõpp siin." in out
    assert out.count("S.") < 10
    assert "kordub" in out and "välja jäetud" in out


def test_collapse_sailitab_korduse_algupära():
    """Agent peab nägema, MIS kordus — muidu ei saa ta otsustada, kas see oli
    tabeli tühjad lahtrid või mudeli silmus."""
    out = fmt.collapse_repeats("irae 371 " * 200)
    assert "irae 371" in out
    assert "199" in out or "200" in out


def test_collapse_ei_puutu_tavalist_teksti():
    tekst = ("Disputatio politica de republica, quam consentiente amplissima "
             "facultate philosophica publice ventilandam sistit auctor.")
    assert fmt.collapse_repeats(tekst) == tekst


def test_collapse_ei_puutu_luhikest_kordust():
    """Kolm korda „non est" on ehtne retoorika, mitte silmus."""
    tekst = "Non est non est non est vera causa rerum naturalium."
    assert fmt.collapse_repeats(tekst) == tekst


def test_format_pages_surub_kordused_kokku():
    lehed = [{"lehekylje_number": 42, "status": "Toores",
              "lehekylje_tekst": "Algus. " + "S. " * 400}]
    out = fmt.format_pages(lehed, base_url=BASE, work_id="mhs5bw")
    assert len(out) < 400
    assert "kordub" in out


# ── compact-režiim ja next_offset ─────────────────────────────────────────

def test_compact_jätab_katked_välja():
    # Tootmises on katke ~300 märki (CROP_LENGTH = 40 sõna) — fixture peab
    # seda peegeldama, muidu mõõdab test valet suhet.
    pikk = {"_formatted": {"lehekylje_tekst": "…quod respublica Suecorum… " * 12}}
    hits = [dict(_vaste("aaa", n), **pikk) for n in (1, 2, 3)]
    taielik = fmt.format_search_hits(hits, total=3, base_url=BASE)
    lyhike = fmt.format_search_hits(hits, total=3, base_url=BASE, compact=True)
    assert "quod respublica Suecorum" in taielik
    assert "quod respublica Suecorum" not in lyhike
    # teose ja lehe tuvastus peab alles jääma
    assert "work_id=aaa" in lyhike
    for n in (1, 2, 3):
        assert f"lk {n}" in lyhike
    assert f"{BASE}/work/aaa/{{lk}}" in lyhike   # link mustrina, mitte lehe kaupa
    assert len(lyhike) < len(taielik) / 3


def test_next_offset_naitab_kuidas_edasi():
    out = fmt.format_search_hits([_vaste("aaa", 1)], total=519, base_url=BASE,
                                 next_offset=10)
    assert "offset=10" in out


def test_next_offset_puudub_kui_rohkem_ei_ole():
    out = fmt.format_search_hits([_vaste("aaa", 1)], total=1, base_url=BASE)
    assert "offset=" not in out


# ── loenduri sõnastus: teosed vs leheküljed ───────────────────────────────

def test_lehepohine_loendur_ytleb_leheküljed():
    """„Vasteid kokku" üksi on topelttähendusega — agent luges teoste arvu
    lehekülgedeks ja vastupidi."""
    out = fmt.format_search_hits([_vaste("aaa", 1)], total=347, base_url=BASE)
    assert "347 lehekülge" in out
    assert "1 teosest" in out


def test_teosepohine_loendur_ytleb_teosed():
    out = fmt.format_search_hits([_vaste("aaa", 1)], total=571, base_url=BASE,
                                 unit="works")
    assert "Teoseid kokku: 571" in out
    assert "lehekülge" not in out
    # „kuvatud N lk M teosest" on teosepõhises loendis eksitav
    assert "teosest" not in out
