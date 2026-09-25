"""Töökollektsioonide CRUD-API (#354).

Ligipääsu väravad kontrollitakse IGAL päringul: kogu `revision` ei ole
kehtivuse tõend, sest ligipääs muutub sellest sõltumatult.
"""
import json
import os

import pytest

import server.work_sets_ops as ops


@pytest.fixture
def work_sets(tmp_path, monkeypatch, backend_env):
    """Isoleeritud kogude kaust; git-kirjutis asendatud, aga fail tekib päriselt."""
    kaust = tmp_path / "work_sets"
    monkeypatch.setattr(ops, "WORK_SETS_DIR", str(kaust))

    def fake_save(path, data, username, message=None):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return {"success": True}

    monkeypatch.setattr(ops, "save_config_with_git", fake_save)
    return kaust


@pytest.fixture
def admin_token(login):
    return login("admin", "adminpass")


@pytest.fixture
def manager_token(login):
    return login("editor", "editorpass")


@pytest.fixture
def viewer_token(login):
    return login("contrib", "contribpass")


@pytest.fixture
def voeras_token(login):
    return login("contrib_muu", "contribpass")


@pytest.fixture
def ws_id(work_sets):
    ws = ops.create_work_set({"et": "Fischeri konverents", "en": ""}, {}, "admin")
    ops.update_work_set(ws["id"], {"access": {"editor": "manager", "contrib": "viewer"}},
                        "admin", expected_revision=1)
    return ws["id"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_loomine_nouab_admini(client, work_sets, viewer_token):
    r = client.post("/work-sets", json={"name": {"et": "F"}}, headers=auth(viewer_token))
    # `deps.get_user` tõstab rollipuuduse peal 401 (mitte 403) — koodibaasi
    # ühtne muster, vt tests/test_admin_role_endpoints.py.
    assert r.status_code in (401, 403)


def test_admin_loob_ja_saab_halduriks(client, work_sets, admin_token):
    r = client.post("/work-sets", json={"name": {"et": "Uus"}}, headers=auth(admin_token))
    assert r.status_code == 200
    ws = r.json()["work_set"]
    assert ws["id"].startswith("ws_") and ws["can_manage"] is True


def test_nimeta_kogu_ei_teki(client, work_sets, admin_token):
    r = client.post("/work-sets", json={"name": {"et": "", "en": ""}}, headers=auth(admin_token))
    assert r.status_code == 400


def test_vaataja_naeb_kogu_aga_ei_muuda(client, work_sets, viewer_token, ws_id):
    r = client.get(f"/work-sets/{ws_id}", headers=auth(viewer_token))
    assert r.status_code == 200
    assert r.json()["work_set"]["can_manage"] is False
    r = client.patch(f"/work-sets/{ws_id}", json={"name": {"et": "X"}, "revision": 2},
                     headers=auth(viewer_token))
    assert r.status_code == 403


def test_haldur_muudab_nime(client, work_sets, manager_token, ws_id):
    r = client.patch(f"/work-sets/{ws_id}", json={"name": {"et": "Uus nimi"}, "revision": 2},
                     headers=auth(manager_token))
    assert r.status_code == 200
    assert r.json()["work_set"]["name"]["et"] == "Uus nimi"


def test_haldur_ei_saa_nime_tuhjaks_teha(client, work_sets, manager_token, ws_id):
    r = client.patch(f"/work-sets/{ws_id}", json={"name": {"et": "", "en": ""}, "revision": 2},
                     headers=auth(manager_token))
    assert r.status_code == 400


def test_nimi_on_kakskeelne(client, work_sets, manager_token, ws_id):
    r = client.patch(f"/work-sets/{ws_id}",
                     json={"name": {"et": "Fischeri konverents", "en": "Fischer conference"},
                           "revision": 2},
                     headers=auth(manager_token))
    assert r.status_code == 200
    assert r.json()["work_set"]["name"] == {"et": "Fischeri konverents",
                                            "en": "Fischer conference"}


def test_vananenud_revision_annab_409(client, work_sets, manager_token, ws_id):
    r = client.patch(f"/work-sets/{ws_id}", json={"name": {"et": "A"}, "revision": 1},
                     headers=auth(manager_token))
    assert r.status_code == 409


def test_haldur_ei_muuda_nahtavust(client, work_sets, manager_token, ws_id):
    r = client.patch(f"/work-sets/{ws_id}", json={"visibility": "public", "revision": 2},
                     headers=auth(manager_token))
    assert r.status_code == 403


def test_tundmatu_kogu_ei_avalda_nime(client, work_sets, viewer_token):
    r = client.get("/work-sets/ws_puudub", headers=auth(viewer_token))
    assert r.status_code == 404
    assert "nimi" not in r.text.lower()


def test_voeras_saab_sama_vastuse_nagu_puuduva_kogu_korral(client, work_sets, voeras_token, ws_id):
    olemas = client.get(f"/work-sets/{ws_id}", headers=auth(voeras_token))
    puudub = client.get("/work-sets/ws_puudub", headers=auth(voeras_token))
    assert olemas.status_code == puudub.status_code == 404
    assert "Fischeri" not in olemas.text


def test_loend_ei_naita_voorast_kogu(client, work_sets, voeras_token, ws_id):
    r = client.get("/work-sets", headers=auth(voeras_token))
    assert r.status_code == 200
    assert r.json()["work_sets"] == []


def test_loend_ei_avalda_vaatajale_ligipaasu_loendit(client, work_sets, viewer_token, ws_id):
    r = client.get("/work-sets", headers=auth(viewer_token))
    kogud = r.json()["work_sets"]
    assert len(kogud) == 1
    assert "access" not in kogud[0]


def test_arhiveeritud_kogu_on_loendist_vaikimisi_valjas(client, work_sets, admin_token, ws_id):
    client.patch(f"/work-sets/{ws_id}", json={"status": "archived", "revision": 2},
                 headers=auth(admin_token))
    assert client.get("/work-sets", headers=auth(admin_token)).json()["work_sets"] == []
    r = client.get("/work-sets?include_archived=true", headers=auth(admin_token))
    assert len(r.json()["work_sets"]) == 1


def test_avaldatud_kogu_arhiveeritakse_mitte_ei_kustutata(client, work_sets, admin_token, ws_id):
    client.patch(f"/work-sets/{ws_id}", json={"visibility": "public", "revision": 2},
                 headers=auth(admin_token))
    r = client.delete(f"/work-sets/{ws_id}", headers=auth(admin_token))
    assert r.status_code == 409
    assert ops.load_work_set(ws_id) is not None


def test_avaldamata_kogu_kustub(client, work_sets, admin_token, ws_id):
    r = client.delete(f"/work-sets/{ws_id}", headers=auth(admin_token))
    assert r.status_code == 200
    assert ops.load_work_set(ws_id) is None


def test_access_vastu_voetakse_ainult_teadaolevad_rollid(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"contrib": "admin"}, "revision": 2},
                   headers=auth(admin_token))
    # Rollikontroll elab nüüd kirjepõhises diffi-valvuris (ADR 0043 p7) → 403
    assert r.status_code == 403
    assert "viewer" in str(r.json()["detail"])


def test_avalikku_kogu_naeb_autentimata(client, work_sets, admin_token, ws_id):
    client.patch(f"/work-sets/{ws_id}", json={"visibility": "public", "revision": 2},
                 headers=auth(admin_token))
    r = client.get(f"/work-sets/{ws_id}")
    assert r.status_code == 200
    assert r.json()["work_set"]["can_manage"] is False


def test_my_access_kannab_kutsuja_oma_rolli(client, work_sets, viewer_token,
                                            manager_token, ws_id):
    """Seaded näitavad kutsuja OMA õigust; teiste ridu see väli ei avalda."""
    vaataja = client.get(f"/work-sets/{ws_id}", headers=auth(viewer_token))
    assert vaataja.json()["work_set"]["my_access"] == "viewer"
    haldur = client.get(f"/work-sets/{ws_id}", headers=auth(manager_token))
    assert haldur.json()["work_set"]["my_access"] == "manager"
    assert "contrib" not in vaataja.text  # kogu access-loend jääb varjatuks


def test_my_access_on_null_kui_isiklikku_kirjet_ei_ole(client, work_sets, admin_token,
                                                       ws_id):
    """Admin näeb kogu rolli, mitte liikmesuse tõttu — ja avalik kogu pole liikmesus."""
    assert client.get(f"/work-sets/{ws_id}",
                      headers=auth(admin_token)).json()["work_set"]["my_access"] is None
    client.patch(f"/work-sets/{ws_id}", json={"visibility": "public", "revision": 2},
                 headers=auth(admin_token))
    assert client.get(f"/work-sets/{ws_id}").json()["work_set"]["my_access"] is None


# =========================================================
# PUT access: serveripoolne diff ja kohustuslik revision (#318, ADR 0043 p7)
# =========================================================

def test_put_access_nouab_revisionit(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"contrib": "viewer"}},
                   headers=auth(admin_token))
    assert r.status_code == 400


def test_put_access_keelab_tundmatu_kasutajanime(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"puudub": "viewer"}, "revision": 2},
                   headers=auth(admin_token))
    assert r.status_code == 403
    assert "puudub" in str(r.json()["detail"])


def test_put_access_keelab_admin_maarangu(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"superadmin": "manager"}, "revision": 2},
                   headers=auth(admin_token))
    assert r.status_code == 403


def test_lukustatud_votme_valjajatmine_lukkab_terve_salvestuse_tagasi(
        client, work_sets, admin_token, ws_id):
    ops.update_work_set(ws_id, {"access": {"editor": "manager", "superadmin": "manager"}},
                        "admin", expected_revision=2)
    # Klient „filtreeris" superadmini rea välja ja saadab ainult nähtavad read.
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"editor": "viewer"}, "revision": 3},
                   headers=auth(admin_token))
    assert r.status_code == 403
    ws = ops.load_work_set(ws_id)
    assert ws["access"]["superadmin"] == "manager"
    assert ws["revision"] == 3, "valideerimisviga ei tohi revisionit tõsta"


def test_valideerimisviga_ei_tosta_revisionit(client, work_sets, admin_token, ws_id):
    enne = ops.load_work_set(ws_id)["revision"]
    client.put(f"/work-sets/{ws_id}/access",
               json={"access": {"puudub": "viewer"}, "revision": enne},
               headers=auth(admin_token))
    assert ops.load_work_set(ws_id)["revision"] == enne


def test_muutusteta_access_on_noop(client, work_sets, admin_token, ws_id):
    ws = ops.load_work_set(ws_id)
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": dict(ws["access"]), "revision": ws["revision"]},
                   headers=auth(admin_token))
    assert r.status_code == 200
    assert ops.load_work_set(ws_id)["revision"] == ws["revision"]


def test_lubatud_muudatus_salvestub(client, work_sets, admin_token, ws_id):
    ws = ops.load_work_set(ws_id)
    uus = dict(ws["access"])
    uus["contrib"] = "manager"
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": uus, "revision": ws["revision"]},
                   headers=auth(admin_token))
    assert r.status_code == 200, r.text
    assert ops.load_work_set(ws_id)["access"]["contrib"] == "manager"
