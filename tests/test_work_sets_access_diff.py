"""`PUT access` täisasenduse serveripoolsed valvurid (ADR 0043 p7).

Klient saadab TERVE kaardi. Server ei usu, et väljajäänud võti oli tahtlik
eemaldamine ainult siis, kui kutsuja tohtis seda eemaldada — üks keelatud
muudatus lükkab terve salvestuse tagasi.
"""
import pytest

from server.work_sets_access import check_access_diff, classify_access_diff

HETKTOMMIS = {
    "admin": "admin",
    "admin2": "admin",
    "superadmin": "superadmin",
    "editor": "editor",
    "contrib": "contributor",
}
ADMIN = {"username": "admin", "role": "admin"}
SUPER = {"username": "superadmin", "role": "superadmin"}


def test_klassifitseerib_koik_neli_kategooriat():
    vana = {"editor": "manager", "contrib": "viewer", "admin2": "manager"}
    uus = {"editor": "viewer", "contrib": "viewer", "superadmin": "manager"}
    d = classify_access_diff(vana, uus)
    assert d["added"] == ["superadmin"]
    assert d["changed"] == ["editor"]
    assert d["unchanged"] == ["contrib"]
    assert d["removed"] == ["admin2"]


def test_puuduv_uus_vote_tahendab_eemaldamist():
    assert classify_access_diff({"contrib": "viewer"}, {})["removed"] == ["contrib"]


def _kontrolli(vana, uus, actor=ADMIN, hetktommis=None):
    d = classify_access_diff(vana, uus)
    return check_access_diff(d, vana, uus, hetktommis or HETKTOMMIS, actor)


def test_lubab_madalama_rolliga_kasutaja_lisamist():
    assert _kontrolli({}, {"contrib": "viewer"}) is None


def test_keelab_tundmatu_kasutajanime():
    assert _kontrolli({}, {"puudub": "viewer"}) is not None


def test_keelab_uue_admin_maarangu():
    assert _kontrolli({}, {"admin2": "manager"}) is not None
    assert _kontrolli({}, {"superadmin": "manager"}, actor=SUPER) is not None


def test_keelab_tundmatu_rolli():
    assert _kontrolli({}, {"contrib": "owner"}) is not None


def test_muutmata_parand_lubatakse_labi():
    assert _kontrolli({"admin2": "manager"}, {"admin2": "manager"}) is None


def test_keelab_vordse_admini_kirje_muutmise_ja_eemaldamise():
    assert _kontrolli({"admin2": "manager"}, {"admin2": "viewer"}) is not None
    assert _kontrolli({"admin2": "manager"}, {}) is not None


def test_admin_ei_eemalda_superadmini_kirjet():
    assert _kontrolli({"superadmin": "manager"}, {}) is not None


def test_enda_dekoratiivse_kirje_eemaldamine_on_lubatud():
    assert _kontrolli({"admin": "manager"}, {}) is None


def test_kustutatud_kasutaja_kirje_sailitamine_ja_eemaldamine():
    assert _kontrolli({"kadunud": "viewer"}, {"kadunud": "viewer"}) is None
    assert _kontrolli({"kadunud": "viewer"}, {}) is None
    # Rolli muutmine surnud kirjel EI ole lubatud
    assert _kontrolli({"kadunud": "viewer"}, {"kadunud": "manager"}) is not None


def test_uks_keelatud_muudatus_lukkab_terve_paketi_tagasi():
    vana = {"contrib": "viewer", "superadmin": "manager"}
    uus = {"contrib": "manager"}   # lubatud muudatus + keelatud eemaldamine
    assert _kontrolli(vana, uus) is not None


def test_mahupiir_keelab_uue_ule_piiri_kaardi():
    from server.config import WORK_SET_MAX_ACCESS
    hetktommis = {f"k{i}": "contributor" for i in range(WORK_SET_MAX_ACCESS + 5)}
    uus = {f"k{i}": "viewer" for i in range(WORK_SET_MAX_ACCESS + 1)}
    assert _kontrolli({}, uus, hetktommis=hetktommis) is not None


def test_ule_piiri_parandkaart_tohib_vaheneda():
    from server.config import WORK_SET_MAX_ACCESS
    hetktommis = {f"k{i}": "contributor" for i in range(WORK_SET_MAX_ACCESS + 5)}
    vana = {f"k{i}": "viewer" for i in range(WORK_SET_MAX_ACCESS + 3)}
    uus = {f"k{i}": "viewer" for i in range(WORK_SET_MAX_ACCESS + 2)}
    assert _kontrolli(vana, uus, hetktommis=hetktommis) is None
