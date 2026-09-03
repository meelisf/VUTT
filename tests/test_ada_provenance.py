"""Ankru resolutsioon: ADA tükk → lõplik leheküljenumber pärast excluded + deleted."""
from server.ada import provenance

SOURCES = [
    {"name": "a.pdf", "bitstream_uuid": "ua", "first_src_page": 1, "page_count": 2},
    {"name": "b.pdf", "bitstream_uuid": "ub", "first_src_page": 3, "page_count": 2},
]


def test_lihtne_juht_ankur_on_tuki_esimene_leht():
    page_map = {"1": [1], "2": [2], "3": [3], "4": [4]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[1, 2, 3, 4])
    assert ankrud[1]["name"] == "a.pdf"
    assert ankrud[3]["name"] == "b.pdf"


def test_excluded_esimene_leht_ankur_libiseb_jargmisele():
    """src 1 jäeti sammus 3 välja → kaardis puudub; ankur on tüki teine leht."""
    page_map = {"2": [1], "3": [2], "4": [3]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[1, 2, 3])
    assert ankrud[1]["name"] == "a.pdf"


def test_poolitatud_leht_esimene_pool_kustutatud():
    """src 1 → out 1,2. Admin kustutab sammus 4 out 1. Ankur PEAB olema out 2.

    See on täpselt see juht, mille `page_map: int` vaikselt valesti lahendaks.
    """
    page_map = {"1": [1, 2], "2": [3], "3": [4], "4": [5]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[2, 3, 4, 5])
    # out 2 on säilinute seas esimene → lõplik nr 1
    assert ankrud[1]["name"] == "a.pdf"


def test_poolitatud_lehe_molemad_pooled_kustutatud():
    """Ankur libiseb tüki JÄRGMISELE lähtelehele."""
    page_map = {"1": [1, 2], "2": [3], "3": [4], "4": [5]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[3, 4, 5])
    # out 3 (src 2) on säilinute seas esimene → lõplik nr 1
    assert ankrud[1]["name"] == "a.pdf"


def test_terve_tukk_valja_jaetud_ankrut_ei_teki():
    """Vale kohta EI panda — pigem mitte midagi."""
    page_map = {"3": [1], "4": [2]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[1, 2])
    assert all(a["name"] != "a.pdf" for a in ankrud.values())
    assert ankrud[1]["name"] == "b.pdf"


def test_lopliku_numbri_umbernummerdus():
    """sailinud_out on juba sorditud; lõplik number on POSITSIOON, mitte out_index."""
    page_map = {"1": [5], "3": [9]}
    ankrud = provenance.leia_ankrud(SOURCES, page_map, sailinud_out=[5, 7, 9])
    assert ankrud[1]["name"] == "a.pdf"
    assert ankrud[3]["name"] == "b.pdf"


def test_source_vali_kuju():
    v = provenance.ehita_source_vali("10062/7822", SOURCES[0])
    assert v == {"provider": "ada", "handle": "10062/7822",
                 "bitstream_uuid": "ua", "name": "a.pdf"}


def test_kommentaar_sisaldab_nime_ja_urli():
    k = provenance.ehita_kommentaar("10062/7822", SOURCES[0])
    assert "a.pdf" in k["text"]
    assert "ua" in k["text"]
    assert "hdl.handle.net/10062/7822" in k["text"]
    assert k["author"] == "ada-import"
