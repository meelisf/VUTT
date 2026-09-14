"""Isikute vaade järgib töökollektsiooni (#354).

Uut liikmesusindeksit EI tehta: kasutatakse sama kutsujale nähtavat ID-loendit
ja olemasolevaid teose–isiku seoseid (`person_to_works.json`).
"""
import json
import os

import pytest

import server.prosopography.indices as indices
import server.prosopography.person_search as person_search
import server.work_sets_access as acc
import server.work_sets_ops as ops

TEOSED = {
    "avalik-teos": {"id": "avalik-teos", "collections": ["sample"]},
    "piiratud-teos": {"id": "piiratud-teos", "collections": ["salajane"]},
}

PERSON_TO_WORKS = {
    "vutt:Pavalik": [{"work_id": "avalik-teos", "role": "author"}],
    "vutt:Ppeidetud": [{"work_id": "piiratud-teos", "role": "author"}],
}

INDEX = {"entries": [
    {"id": "vutt:Pavalik", "name": "Avalik Isik", "record_status": "active"},
    {"id": "vutt:Ppeidetud", "name": "Peidetud Isik", "record_status": "active"},
]}


@pytest.fixture
def keskkond(tmp_path, monkeypatch, backend_env):
    kaust = tmp_path / "work_sets"
    monkeypatch.setattr(ops, "WORK_SETS_DIR", str(kaust))

    def fake_save(path, data, username, message=None):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        return {"success": True}

    monkeypatch.setattr(ops, "save_config_with_git", fake_save)
    monkeypatch.setattr(acc, "load_work_metadata_by_id", lambda wid: TEOSED.get(wid))
    monkeypatch.setattr(acc, "is_work_public",
                        lambda meta: "sample" in (meta.get("collections") or []))

    monkeypatch.setattr(indices, "_load_person_to_works", lambda: PERSON_TO_WORKS)
    monkeypatch.setattr(indices, "_load_index", lambda: INDEX)
    monkeypatch.setattr(indices, "sync_from_facade", lambda: None)
    monkeypatch.setattr(person_search, "_load_index", lambda: INDEX)
    return kaust


@pytest.fixture
def ws_id(keskkond):
    ws = ops.create_work_set({"et": "Kogu", "en": ""}, {}, "admin")
    ops.update_work_set(ws["id"], {"access": {"contrib": "viewer"}}, "admin",
                        expected_revision=1)
    ops.mutate_members(ws["id"], ["avalik-teos", "piiratud-teos"], [], "admin",
                       expected_revision=2)
    return ws["id"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_isikute_filter_kasutab_kutsuja_nahtavat_loendit(client, login, ws_id):
    token = login("contrib", "contribpass")
    r = client.get(f"/prosopography?work_set={ws_id}", headers=auth(token))
    assert r.status_code == 200
    # Piiratud teosega seotud isik ei tohi vastuses olla: `contrib` ei näe seda
    # teost otsingus, seega ei tohi ta teada ka temaga seotud isikutest.
    assert "Ppeidetud" not in r.text
    assert "Pavalik" in r.text


def test_admin_naeb_ka_piiratud_teose_isikut(client, login, ws_id):
    token = login("admin", "adminpass")
    r = client.get(f"/prosopography?work_set={ws_id}", headers=auth(token))
    assert r.status_code == 200
    assert "Ppeidetud" in r.text


def test_ligipaasuta_tookollektsioon_annab_404_mitte_koik_isikud(client, login, ws_id):
    token = login("contrib_muu", "contribpass")
    r = client.get(f"/prosopography?work_set={ws_id}", headers=auth(token))
    # Filtri EIRAMINE oleks vaikne leke: kõik isikud tuleksid vastusena tagasi.
    assert r.status_code == 404


def test_tundmatu_tookollektsioon_annab_404(client, login, keskkond):
    token = login("admin", "adminpass")
    r = client.get("/prosopography?work_set=ws_puudub", headers=auth(token))
    assert r.status_code == 404


def test_ilma_parameetrita_toimib_nagu_enne(client, login, keskkond):
    token = login("admin", "adminpass")
    r = client.get("/prosopography", headers=auth(token))
    assert r.status_code == 200
