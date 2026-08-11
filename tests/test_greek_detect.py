"""Kreeka keele tuvastuse ühiktestid (server/greek_detect.py)."""


def test_puhas_ladina_annab_nulli():
    from server.greek_detect import greek_ratio
    count, ratio = greek_ratio("Disputatio theologica de anima")
    assert count == 0
    assert ratio == 0.0


def test_puhas_kreeka_annab_taisosakaalu():
    from server.greek_detect import greek_ratio
    count, ratio = greek_ratio("περὶ τῆς ψυχῆς")
    assert count == 12
    assert ratio == 1.0


def test_tuhi_tekst_ei_jaga_nulliga():
    from server.greek_detect import greek_ratio
    assert greek_ratio("") == (0, 0.0)
    assert greek_ratio("1648 — 12,5 %") == (0, 0.0)


def test_segu_arvutab_osakaalu():
    from server.greek_detect import greek_ratio
    # λόγος = 5 kreeka tähte, Verbum = 6 ladina tähte, tühik ei loe
    count, ratio = greek_ratio("λόγος Verbum")
    assert count == 5
    assert abs(ratio - 5 / 11) < 1e-9


def test_kreeka_extended_plokk_loetakse():
    from server.greek_detect import greek_ratio
    # ἀ on U+1F00 (Greek Extended), mitte põhiplokis
    count, _ = greek_ratio("ἀἁἂ")
    assert count == 3


def test_markup_tagid_ei_loe_ladina_hulka_valesti():
    from server.greek_detect import greek_ratio
    # <i> sisaldab ladina tähte 'i' — see ON ladina täht ja loeb.
    # Test fikseerib teadliku valiku: märgendeid EI eemaldata,
    # sest nende maht on tekstiga võrreldes tühine ja eemaldamine
    # tooks sisse parsimisvea riski.
    count, ratio = greek_ratio("<i>λόγος</i>")
    assert count == 5
    assert ratio == 5 / 7


def test_lavend_20_protsenti_piiril():
    from server.greek_detect import page_is_greek
    # 20 kreeka + 80 ladina = täpselt 20% → LÄBIB
    assert page_is_greek("α" * 20 + "a" * 80) is True
    # 20 kreeka + 81 ladina = 19,8% → EI LÄBI
    assert page_is_greek("α" * 20 + "a" * 81) is False


def test_tahemargi_valvur_lykkab_luhikese_tagasi():
    from server.greek_detect import page_is_greek
    # 19 kreeka tähemärki 100% osakaaluga → EI LÄBI (liiga lühike)
    assert page_is_greek("α" * 19) is False
    # 20 tähemärki → LÄBIB
    assert page_is_greek("α" * 20) is True


def test_work_qualifies_uks_leht_paljude_seas():
    from server.greek_detect import work_qualifies
    pages = {f"lk-{i:03d}.txt": "Latina oratio " * 40 for i in range(200)}
    pages["lk-077.txt"] = "α" * 60 + "a" * 40
    ok, hits = work_qualifies(pages)
    assert ok is True
    assert hits == ["lk-077.txt"]


def test_work_qualifies_tagastab_lehed_sorteeritult():
    from server.greek_detect import work_qualifies
    pages = {
        "c.txt": "α" * 30,
        "a.txt": "α" * 30,
        "b.txt": "ladina tekst ilma kreekata",
    }
    ok, hits = work_qualifies(pages)
    assert ok is True
    assert hits == ["a.txt", "c.txt"]


def test_work_qualifies_ilma_kreekata():
    from server.greek_detect import work_qualifies
    ok, hits = work_qualifies({"a.txt": "Disputatio", "b.txt": ""})
    assert ok is False
    assert hits == []


def test_work_qualifies_tuhi_teos():
    from server.greek_detect import work_qualifies
    assert work_qualifies({}) == (False, [])


def test_add_language_lisab_puuduva_valja():
    from server.greek_detect import add_language
    meta = {"title": "Oratio"}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["grc"]


def test_add_language_sailitab_olemasoleva_keele():
    from server.greek_detect import add_language
    meta = {"languages": ["lat"]}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["lat", "grc"]


def test_add_language_on_idempotentne():
    from server.greek_detect import add_language
    meta = {"languages": ["lat", "grc"]}
    assert add_language(meta, "grc") is False
    assert meta["languages"] == ["lat", "grc"]


def test_add_language_tuhi_massiiv():
    from server.greek_detect import add_language
    meta = {"languages": []}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["grc"]


def test_add_language_none_vaartus():
    from server.greek_detect import add_language
    meta = {"languages": None}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["grc"]


def test_add_language_vigane_tuup_asendatakse():
    from server.greek_detect import add_language
    # Vana andmestik võib kanda stringi massiivi asemel
    meta = {"languages": "lat"}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["lat", "grc"]
