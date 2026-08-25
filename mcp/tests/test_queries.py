"""Päringukehade koostamise testid — puhtad funktsioonid, võrku ei puututa."""
from vutt_mcp import queries


def test_matchingstrategy_on_vaikimisi_all():
    body = queries.build_search_body("Daniel Sennert")
    assert body["matchingStrategy"] == "all"


def test_relax_matching_lulitab_last_peale():
    body = queries.build_search_body("Daniel Sennert", relax_matching=True)
    assert body["matchingStrategy"] == "last"


def test_eszett_normaliseeritakse_paringus():
    assert queries.normalize_query("Schluß") == "Schluss"
    body = queries.build_search_body("daß")
    assert body["q"] == "dass"


def test_distinct_ainult_teoseotsingul():
    assert "distinct" not in queries.build_search_body("x")
    assert queries.build_search_body("x", distinct_works=True)["distinct"] == "work_id"


def test_kollektsioonifilter():
    body = queries.build_search_body("x", collection="Disputatsioonid")
    assert 'collections_hierarchy = "Disputatsioonid"' in body["filter"]


def test_aastavahemik_kasutab_year_valja():
    body = queries.build_search_body("x", year_from=1630, year_to=1650)
    assert "year >= 1630" in body["filter"]
    assert "year <= 1650" in body["filter"]


def test_filtrid_kombineeruvad_AND_iga():
    body = queries.build_search_body("x", collection="K", language="lat")
    assert " AND " in body["filter"]


def test_ilma_filtriteta_pole_filter_valja():
    assert "filter" not in queries.build_search_body("x")


def test_jutumargid_filtris_escapetakse():
    body = queries.build_search_body("x", collection='Nimi "jutumärkidega"')
    assert '\\"jutumärkidega\\"' in body["filter"]


def test_katke_seadistus():
    body = queries.build_search_body("x")
    assert body["attributesToCrop"] == ["lehekylje_tekst", "marginaalia_tekst"]
    assert body["cropLength"] > 0


def test_limit_piiratakse_viiekumnega():
    assert queries.build_search_body("x", limit=500)["hitsPerPage"] == 50


def test_offset_teisendub_leheks():
    assert queries.build_search_body("x", limit=10, offset=0)["page"] == 1
    assert queries.build_search_body("x", limit=10, offset=20)["page"] == 3


def test_lehekulgede_paring_sorteerib_jarjestuse_jargi():
    body = queries.build_work_pages_body("abc123", from_page=12, to_page=18)
    assert body["sort"] == ["lehekylje_number:asc"]
    assert 'work_id = "abc123"' in body["filter"]
    assert "lehekylje_number >= 12" in body["filter"]
    assert "lehekylje_number <= 18" in body["filter"]


def test_lehekulgede_paring_ilma_vahemikuta_annab_koik():
    body = queries.build_work_pages_body("abc123")
    assert body["filter"] == 'work_id = "abc123"'


def test_ulevaate_paring_kysib_metaandmed_ilma_tekstita():
    """get_work vajab pealkirja/autorit/aastat, aga MITTE lehekülgede teksti.

    Live-kontroll näitas tühja päist: page-päring ei sisalda metaandmevälju,
    ja 43 lehekülje täistekst oli asjatu koormus.
    """
    body = queries.build_work_overview_body("abc123")
    retrieve = body["attributesToRetrieve"]
    for field in ("title", "autor", "aasta", "location", "genre", "languages"):
        assert field in retrieve, f"{field} puudub ülevaate päringust"
    assert "lehekylje_tekst" not in retrieve
    assert "marginaalia_tekst" not in retrieve
    assert body["sort"] == ["lehekylje_number:asc"]
    assert 'work_id = "abc123"' in body["filter"]


def test_ulevaate_paring_sisaldab_lehekulje_numbrit_ja_seisundit():
    retrieve = queries.build_work_overview_body("abc")["attributesToRetrieve"]
    assert "lehekylje_number" in retrieve
    assert "status" in retrieve


def test_facets_paring_ei_kysi_hitte():
    body = queries.build_facets_body("collections_hierarchy")
    assert body["limit"] == 0
    assert body["facets"] == ["collections_hierarchy"]


# ── vastete laotamine teoste peale ────────────────────────────────────────

def _h(work_id, page):
    return {"work_id": work_id, "lehekylje_number": page}


def test_cap_pages_per_work_piirab_teose_osakaalu():
    """Ilma kapita täitis üks teos kogu akna: 10 vastet → 1 teos."""
    hits = [_h("aaa", n) for n in range(1, 11)] + [_h("bbb", 1), _h("ccc", 1)]
    valitud = queries.cap_pages_per_work(hits, 3)
    assert [h["work_id"] for h in valitud] == ["aaa", "aaa", "aaa", "bbb", "ccc"]


def test_cap_pages_per_work_sailitab_relevantsuse_jarjekorra():
    hits = [_h("aaa", 1), _h("bbb", 1), _h("aaa", 2)]
    assert [h["work_id"] for h in queries.cap_pages_per_work(hits, 3)] == \
        ["aaa", "bbb", "aaa"]


def test_cap_pages_per_work_kapp_null_ei_kärbi():
    hits = [_h("aaa", n) for n in range(1, 5)]
    assert queries.cap_pages_per_work(hits, 0) == hits


def test_search_pages_otsib_ainult_lehetekstist():
    """Teose metaandmed on dubleeritud igale lehe-dokumendile: pealkirjavaste
    andis KÕIK teose leheküljed „vasteks" (Buchdrucker: 469 → 89 tegelikku)."""
    body = queries.build_search_body("x", search_fields=queries.PAGE_SEARCH_FIELDS)
    assert body["attributesToSearchOn"] == ["lehekylje_tekst", "marginaalia_tekst"]
    assert "title" not in body["attributesToSearchOn"]


def test_search_body_ilma_valjadeta_ei_pane_atribuuti():
    assert "attributesToSearchOn" not in queries.build_search_body("x")
