from shapely.geometry import box

from server.prosopography.region_hierarchy import PARENT_MIN_CONTAINMENT, find_parents


def test_taielikult_sisalduv_laps_saab_vanema():
    # Riik (0,0)-(10,10), selle sees alamüksus (1,1)-(3,3).
    levels = [2, 3]
    geometries = [box(0, 0, 10, 10), box(1, 1, 3, 3)]
    assert find_parents(levels, geometries) == [None, 0]


def test_osaliselt_kattuv_laps_ei_saa_vanemat():
    # Alamüksusest jääb pool riigist välja (Brandenburg-Preußeni juhtum).
    levels = [2, 3]
    geometries = [box(0, 0, 10, 10), box(9, 0, 11, 10)]
    assert find_parents(levels, geometries) == [None, None]


def test_lavendi_ules_jaav_kattuvus_annab_vanema():
    # 80% lapsest on riigi sees — üle PARENT_MIN_CONTAINMENT lävendi.
    levels = [2, 3]
    geometries = [box(0, 0, 10, 10), box(8, 0, 10.5, 10)]
    ratio = geometries[1].intersection(geometries[0]).area / geometries[1].area
    assert ratio > PARENT_MIN_CONTAINMENT
    assert find_parents(levels, geometries) == [None, 0]


def test_valitakse_lahim_ulemine_tase_mitte_tipp():
    # Level 4 asub korraga level-3 ja level-2 üksuse sees; vanem peab olema level 3.
    levels = [2, 3, 4]
    geometries = [box(0, 0, 10, 10), box(0, 0, 5, 5), box(1, 1, 2, 2)]
    assert find_parents(levels, geometries) == [None, 0, 1]


def test_puuduva_vahetaseme_korral_langetakse_jargmisele_astmele():
    # Level 4 ei mahu ühessegi level-3 üksusesse, aga mahub level-2 sisse.
    levels = [2, 3, 4]
    geometries = [box(0, 0, 10, 10), box(0, 0, 2, 2), box(6, 6, 7, 7)]
    assert find_parents(levels, geometries) == [None, 0, 0]


def test_vordse_kattuvuse_korral_voidab_esimene_kandidaat():
    # Laps on täielikult mõlema kandidaadi sees (suhe 1.0 mõlemal). Reegel on
    # "rangelt suurem suhe võidab", seega jääb peale esimene kvalifitseerunu.
    levels = [2, 2, 3]
    geometries = [box(0, 0, 10, 10), box(0, 0, 20, 20), box(1, 1, 2, 2)]
    assert find_parents(levels, geometries)[2] == 0


def test_tuhi_sisend_ei_kuku_labi():
    assert find_parents([], []) == []
