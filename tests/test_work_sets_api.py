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
    assert r.status_code == 400


def test_avalikku_kogu_naeb_autentimata(client, work_sets, admin_token, ws_id):
    client.patch(f"/work-sets/{ws_id}", json={"visibility": "public", "revision": 2},
                 headers=auth(admin_token))
    r = client.get(f"/work-sets/{ws_id}")
    assert r.status_code == 200
    assert r.json()["work_set"]["can_manage"] is False
