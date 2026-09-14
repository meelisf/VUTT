"""Kollektsiooniõiguste delta (ADR 0043 p2).

Delta muudab AINULT nimetatud määranguid. Vana täisasendus
(`update_user_allowed_collections`) kirjutas terve loendi üle ja võis
avalikuks muutunud kogu ID sanitiseerimisel vaikselt maha võtta.
"""
import pytest


@pytest.fixture
def kollektsioonid(backend_env, monkeypatch):
    """`get_cached_collections` loeb PÄRIS config-teed — testis patchitakse
    see otse `auth`-is, nagu teevad olemasolevad kollektsioonitestid
    (`tests/test_user_collections_api.py::_patch_restricted`)."""
    auth = backend_env["auth"]
    kaardid = {
        "avalik": {"name": {"et": "Avalik", "en": "Public"}, "visibility": "public"},
        "kinnine": {"name": {"et": "Kinnine", "en": "Closed"}, "visibility": "restricted"},
        "teine": {"name": {"et": "Teine", "en": "Other"}, "visibility": "restricted"},
        "ruhm": {"name": {"et": "Rühm", "en": "Group"}, "type": "virtual_group"},
    }
    monkeypatch.setattr(auth, "get_cached_collections", lambda: kaardid)
    return kaardid


ADMIN = {"username": "admin", "role": "admin"}


def test_lisab_lugemisoiguse_piiratud_kogule(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"}],
        ADMIN)
    assert ok, sonum
    assert olek["contrib"]["allowed_collections"] == ["kinnine"]
    assert auth.reload_users_cache()["contrib"]["allowed_collections"] == ["kinnine"]


def test_keelab_lugemisoiguse_avalikule_kogule(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik", "field": "allowed", "action": "add"}],
        ADMIN)
    assert not ok
    assert "avalik" in sonum


def test_avaliku_kogu_vana_maarangu_eemaldamine_on_lubatud(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["allowed_collections"] = ["avalik", "kinnine"]
    auth.save_users(kasutajad)

    ok, sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik", "field": "allowed", "action": "remove"}],
        ADMIN)
    assert ok, sonum
    assert olek["contrib"]["allowed_collections"] == ["kinnine"]


def test_teise_kogu_muutmine_ei_kustuta_jaanukit(backend_env, kollektsioonid):
    """Vana täisasendus oleks „avalik" ID restricted-sanitiseerimisel maha võtnud."""
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["allowed_collections"] = ["avalik", "kinnine"]
    auth.save_users(kasutajad)

    ok, _sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "teine", "field": "allowed", "action": "add"}],
        ADMIN)
    assert ok
    assert "avalik" in olek["contrib"]["allowed_collections"]


def test_kustutatud_kogu_jaanuki_tohib_eemaldada_mitte_lisada(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["edit_collections"] = ["kadunud"]
    auth.save_users(kasutajad)

    ok, _s, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kadunud", "field": "edit", "action": "remove"}],
        ADMIN)
    assert ok
    assert olek["contrib"]["edit_collections"] == []

    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kadunud", "field": "edit", "action": "add"}],
        ADMIN)
    assert not ok
    assert "kadunud" in sonum


def test_keelab_virtuaalse_ruhma_kirjutamisulatuse(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, _sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "ruhm", "field": "edit", "action": "add"}],
        ADMIN)
    assert not ok


def test_kirjutamisulatus_avalikul_kogul_on_lubatud(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["edit_collections"] = []
    auth.save_users(kasutajad)

    ok, sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik", "field": "edit", "action": "add"}],
        ADMIN)
    assert ok, sonum
    assert olek["contrib"]["edit_collections"] == ["avalik"]


def test_vigane_pakett_ei_rakendu_osaliselt(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, _sonum, _ = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
        {"username": "superadmin", "collection_id": "kinnine", "field": "allowed", "action": "add"},
    ], ADMIN)
    assert not ok
    assert auth.reload_users_cache()["contrib"].get("allowed_collections", []) == []


def test_vastuoluline_kordus_lukatakse_tagasi(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, _ = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "remove"},
    ], ADMIN)
    assert not ok
    assert "vastuoluline" in sonum.lower()


def test_uks_invalideerimine_inimese_kohta(backend_env, kollektsioonid, monkeypatch):
    auth = backend_env["auth"]
    kutsed = []
    monkeypatch.setattr(auth, "delete_user_sessions", lambda u: kutsed.append(u) or 0)

    ok, sonum, _ = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
        {"username": "contrib", "collection_id": "teine", "field": "edit", "action": "add"},
    ], ADMIN)
    assert ok, sonum
    assert kutsed == ["contrib"]


def test_muutusteta_pakett_ei_kirjuta_ega_invalideeri(backend_env, kollektsioonid, monkeypatch):
    auth = backend_env["auth"]
    kirjutised, kutsed = [], []
    monkeypatch.setattr(auth, "atomic_write_json",
                        lambda path, data: kirjutised.append(path))
    monkeypatch.setattr(auth, "delete_user_sessions", lambda u: kutsed.append(u) or 0)

    ok, _s, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "remove"}],
        ADMIN)
    assert ok
    assert kirjutised == []
    assert kutsed == []


def test_endpoint_noub_admini(client, login, kollektsioonid):
    token = login("contrib", "contribpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": []},
                    headers={"Authorization": f"Bearer {token}"})
    # require_role("admin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    assert r.status_code == 401


def test_endpoint_tagastab_kinnitatud_oleku(client, login, kollektsioonid):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": [
                        {"username": "contrib", "collection_id": "kinnine",
                         "field": "allowed", "action": "add"}]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    assert r.json()["users"]["contrib"]["allowed_collections"] == ["kinnine"]


def test_endpoint_annab_valideerimisveal_400(client, login, kollektsioonid):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": [
                        {"username": "contrib", "collection_id": "avalik",
                         "field": "allowed", "action": "add"}]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


# --- Kontrollid, mis kolisid siia kustutatud `test_user_collections.py`-st (#318, etapp 4a).
# Need olid vana helperi ühiktestid; delta on nüüd ainus kirjutustee, seega peavad
# samad valvurid olema kaetud siin.

def test_tundmatu_kasutajanimi_lukatakse_tagasi(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "pole-sellist", "collection_id": "kinnine",
          "field": "allowed", "action": "add"}], ADMIN)
    assert not ok
    assert "ei leitud" in sonum.lower()


def test_vordse_rolliga_kasutajat_ei_tohi_muuta(backend_env, kollektsioonid):
    # Admin ei halda teist admini: `can_manage_user` nõuab RANGELT madalamat taset.
    auth = backend_env["auth"]
    users = auth.reload_users_cache()
    users["contrib_muu"]["role"] = "admin"
    auth.save_users(users)

    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib_muu", "collection_id": "kinnine",
          "field": "allowed", "action": "add"}], ADMIN)
    assert not ok
    assert "õigust" in sonum.lower()


def test_vigane_paketi_kuju_lukatakse_tagasi(backend_env, kollektsioonid):
    # Kliendilt tulnud jama ei tohi jõuda muutmisloogikani: tüübikontroll oli
    # varem vana helperi sees (`isinstance(collection_ids, list)`).
    auth = backend_env["auth"]
    assert auth.apply_collection_rights_delta("mitte-list", ADMIN)[0] is False
    assert auth.apply_collection_rights_delta([{"username": "contrib"}], ADMIN)[0] is False
    assert auth.apply_collection_rights_delta(
        [{"username": "", "collection_id": "kinnine",
          "field": "allowed", "action": "add"}], ADMIN)[0] is False


def test_jarjekord_tuleb_konfiguratsioonist_mitte_lisamise_jarjekorrast(
        backend_env, kollektsioonid):
    # Deterministlik järjekord hoiab `users.json` diffi loetavana; vanas helperis
    # oli see sama omadus (`restricted_ordered`).
    auth = backend_env["auth"]
    ok, sonum, olek = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "teine", "field": "allowed", "action": "add"},
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
    ], ADMIN)
    assert ok, sonum
    # Konfiguratsioonis on „kinnine" enne „teist" — lisamise järjekord oli vastupidine.
    assert olek["contrib"]["allowed_collections"] == ["kinnine", "teine"]
