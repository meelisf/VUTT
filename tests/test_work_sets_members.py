"""Töökollektsiooni liikmed ja otsingufiltri ID-loend (#354).

Lisamine ja eemaldamine EI ole sümmeetrilised: lisatav teos peab eksisteerima
ja olema kutsujale loetav, eemaldatav mitte (kustutatud teose viide peab olema
koristatav).
"""
import json
import os

import pytest

import server.access_ops as access_ops
import server.work_sets_access as acc
import server.work_sets_ops as ops

TEOSED = {
    "avalik-teos": {"id": "avalik-teos", "collections": ["sample"]},
    "avalik-teos-2": {"id": "avalik-teos-2", "collections": ["sample"]},
    "piiratud-teos": {"id": "piiratud-teos", "collections": ["salajane"]},
}


@pytest.fixture
def work_sets(tmp_path, monkeypatch, backend_env):
    kaust = tmp_path / "work_sets"
    monkeypatch.setattr(ops, "WORK_SETS_DIR", str(kaust))

    def fake_save(path, data, username, message=None):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return {"success": True}

    monkeypatch.setattr(ops, "save_config_with_git", fake_save)

    # Teoste metaandmed tulevad sõnastikust, mitte failisüsteemist.
    monkeypatch.setattr(acc, "load_work_metadata_by_id", lambda wid: TEOSED.get(wid))
    # Avalikkus on testis selgesõnaline: `is_work_public` loeks muidu
    # collections.json-i vahemälust, kus tundmatu kogu loetakse avalikuks.
    monkeypatch.setattr(acc, "is_work_public",
                        lambda meta: "sample" in (meta.get("collections") or []))
    monkeypatch.setattr(
        access_ops, "can_read_work",
        lambda meta, user: (
            "sample" in (meta.get("collections") or [])
            or bool(set((user or {}).get("allowed_collections") or [])
                    & set(meta.get("collections") or []))
        ))
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
def ws_id(work_sets):
    ws = ops.create_work_set({"et": "Kogu", "en": ""}, {}, "admin")
    ops.update_work_set(ws["id"], {"access": {"editor": "manager", "contrib": "viewer"}},
                        "admin", expected_revision=1)
    ops.mutate_members(ws["id"], ["avalik-teos", "piiratud-teos", "kustutatud"], [],
                       "admin", expected_revision=2)
    return ws["id"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_loend_tagastab_ainult_kutsujale_nahtavad(client, work_sets, viewer_token, ws_id):
    r = client.get(f"/work-sets/{ws_id}/works", headers=auth(viewer_token))
    assert r.status_code == 200
    # piiratud liige puudub; kustutatud teose viide samuti
    assert r.json()["work_ids"] == ["avalik-teos"]
    assert r.json()["count"] == 1


def test_ligipaasuta_loend_annab_404(client, work_sets, login, ws_id):
    voeras = login("contrib_muu", "contribpass")
    r = client.get(f"/work-sets/{ws_id}/works", headers=auth(voeras))
    assert r.status_code == 404


def test_mahupiiri_viga_ei_avalda_mitteadminile_arvu(client, work_sets, monkeypatch,
                                                     manager_token, ws_id):
    monkeypatch.setattr(ops, "WORK_SET_MAX_MEMBERS", 3)
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["avalik-teos-2"], "revision": 3},
                    headers=auth(manager_token))
    assert r.status_code == 409
    assert r.json()["detail"] == {"error": "limit"}
    assert "current" not in r.text.lower()


def test_mahupiiri_viga_avaldab_adminile_arvud(client, work_sets, monkeypatch,
                                               admin_token, ws_id):
    monkeypatch.setattr(ops, "WORK_SET_MAX_MEMBERS", 3)
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["avalik-teos-2"], "revision": 3},
                    headers=auth(admin_token))
    assert r.status_code == 409
    assert r.json()["detail"] == {"error": "limit", "current": 3, "adding": 1, "limit": 3}


def test_kustutatud_teose_viite_saab_eemaldada(client, work_sets, manager_token, ws_id):
    r = client.request("DELETE", f"/work-sets/{ws_id}/works",
                       json={"work_ids": ["kustutatud"], "revision": 3},
                       headers=auth(manager_token))
    assert r.status_code == 200
    assert "kustutatud" not in ops.load_work_set(ws_id)["works"]


def test_loetamatu_teose_lisamine_lukatakse_tervikuna_tagasi(client, work_sets,
                                                             manager_token, ws_id):
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["avalik-teos-2", "piiratud-teos"], "revision": 3},
                    headers=auth(manager_token))
    assert r.status_code == 403
    assert "avalik-teos-2" not in ops.load_work_set(ws_id)["works"], \
        "osalist lisamist ei tohi olla"


def test_tundmatu_teose_lisamine_annab_400(client, work_sets, manager_token, ws_id):
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["pole-olemas"], "revision": 3},
                    headers=auth(manager_token))
    assert r.status_code == 400


def test_vaataja_ei_lisa_liikmeid(client, work_sets, viewer_token, ws_id):
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["avalik-teos-2"], "revision": 3},
                    headers=auth(viewer_token))
    assert r.status_code == 403


def test_lisamine_tagastab_kutsujale_nahtava_loendi_ja_uue_revisiooni(
        client, work_sets, manager_token, ws_id):
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": ["avalik-teos-2"], "revision": 3},
                    headers=auth(manager_token))
    assert r.status_code == 200
    data = r.json()
    assert data["work_ids"] == ["avalik-teos", "avalik-teos-2"]
    assert data["revision"] == 4


def test_work_ids_peab_olema_loend(client, work_sets, manager_token, ws_id):
    r = client.post(f"/work-sets/{ws_id}/works",
                    json={"work_ids": "avalik-teos-2", "revision": 3},
                    headers=auth(manager_token))
    assert r.status_code == 400
