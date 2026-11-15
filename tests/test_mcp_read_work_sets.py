"""MCP read-only töökollektsioonide teed: otsinguvõti = admini lugemisluba.

Võti näeb Meilis niikuinii kõiki teoseid ja antakse ainult adminile (mcp/README.md),
seega ei ole kogude piiramine võtme taga turvalisus. Valvatakse, et ilma õige
võtmeta ei leki midagi ja et vastus ei kanna kasutajanimesid.
"""
import json
import os

import pytest

import server.config as config
import server.work_sets_access as acc
import server.work_sets_ops as ops

VOTI = "otsinguvoti-test"

TEOSED = {
    "w1": {"id": "w1", "collections": ["kogu"]},
    "w2": {"id": "w2", "collections": ["piiratud"]},
    # "kadunud" puudub — kustutatud teos
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
    monkeypatch.setattr(acc, "load_work_metadata_by_id", lambda wid: TEOSED.get(wid))
    monkeypatch.setattr(acc, "is_work_public", lambda meta: False)
    monkeypatch.setattr(config, "MEILI_SEARCH_KEY", VOTI)
    return kaust


@pytest.fixture
def kogud(work_sets):
    """Üks liikmetele nähtav kogu ja üks arhiveeritud kogu."""
    a = ops.create_work_set({"et": "Fischeri konverents", "en": ""}, {}, "admin")
    ops.update_work_set(a["id"], {"access": {"editor": "manager"}}, "admin", 1)
    ops.mutate_members(a["id"], ["w1", "w2", "kadunud"], [], "admin")
    b = ops.create_work_set({"et": "Vana projekt", "en": ""}, {}, "admin")
    ops.update_work_set(b["id"], {"status": "archived"}, "admin", 1)
    return a["id"], b["id"]


def key(v=VOTI):
    return {"X-Vutt-Search-Key": v}


def test_ilma_votmeta_401(client, kogud):
    a, _ = kogud
    for tee in ("/mcp/work-sets", f"/mcp/work-sets/{a}/works"):
        r = client.get(tee)
        assert r.status_code == 401
        assert "Fischeri" not in r.text


def test_vale_votmega_401(client, kogud):
    a, _ = kogud
    assert client.get("/mcp/work-sets", headers=key("vale")).status_code == 401
    assert client.get(f"/mcp/work-sets/{a}/works", headers=key("vale")).status_code == 401


def test_votme_puudumisel_serveris_503(client, kogud, monkeypatch):
    monkeypatch.setattr(config, "MEILI_SEARCH_KEY", "")
    # Tühi päis ei tohi tühja serverivõtmega kokku langeda.
    assert client.get("/mcp/work-sets", headers=key("")).status_code == 503
    assert client.get("/mcp/work-sets", headers=key("midagi")).status_code == 503


def test_loend_naitab_members_kogu_ja_arhiveeritut(client, kogud):
    a, b = kogud
    r = client.get("/mcp/work-sets", headers=key())
    assert r.status_code == 200
    sets = {ws["id"]: ws for ws in r.json()["work_sets"]}
    assert set(sets) == {a, b}
    assert sets[a]["visibility"] == "members"
    assert sets[a]["count"] == 2
    assert sets[a]["name"]["et"] == "Fischeri konverents"
    assert sets[b]["status"] == "archived"
    for ws in sets.values():
        assert "access" not in ws
        assert "created_by" not in ws
        assert "updated_at" not in ws


def test_liikmed_tagastab_idd(client, kogud):
    a, _ = kogud
    r = client.get(f"/mcp/work-sets/{a}/works", headers=key())
    assert r.status_code == 200
    assert r.json()["work_ids"] == ["w1", "w2"]
    assert r.json()["count"] == 2


def test_tundmatu_kogu_404(client, kogud):
    assert client.get("/mcp/work-sets/eiole/works", headers=key()).status_code == 404


def test_bearer_token_ei_asenda_votit(client, kogud, login):
    token = login("admin", "adminpass")
    r = client.get("/mcp/work-sets", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
