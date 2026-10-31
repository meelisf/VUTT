"""Seoste otspunktid (#701, ADR 0075) ja üldise salvestuse keeld."""
import json
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import metadata_ops, work_relations, work_sets_access  # noqa: E402
from server.auth import is_at_least  # noqa: E402

V = "isVersionOf"


@pytest.fixture
def env(tmp_path, monkeypatch):
    dirs = {}
    for wid in ("w1", "w2", "w3"):
        d = tmp_path / f"teos-{wid}"
        d.mkdir()
        (d / "_metadata.json").write_text(json.dumps({"id": wid, "title": f"T {wid}"}), encoding="utf-8")
        dirs[wid] = str(d)

    def find(wid):
        return dirs.get(wid)

    def fake_save(path, content, *a, additional_files=None, **k):
        for p, c in [(path, content), *(additional_files or [])]:
            Path(p).write_text(c, encoding="utf-8")
        return {"success": True}

    from server.routers import work_relations as r
    for mod in (r, work_relations, work_sets_access):
        monkeypatch.setattr(mod, "find_directory_by_id", find)
    monkeypatch.setattr(metadata_ops, "save_with_git", fake_save)
    for name in ("sync_work_to_meilisearch", "sync_work_to_meilisearch_async",
                 "update_person_to_works", "update_work_collections", "update_work_facts"):
        monkeypatch.setattr(metadata_ops, name, lambda *a, **k: None)
    return {"dirs": dirs, "router": r}


@pytest.fixture
def client(env, monkeypatch):
    from server import deps
    r = env["router"]
    app = FastAPI()
    app.include_router(r.router)
    state = {"user": {"username": "adm", "role": "admin"}, "restricted": set()}

    async def fake_get_user(request, min_role="contributor"):
        user = state["user"]
        if user is None:
            raise HTTPException(status_code=401)
        if not is_at_least(user["role"], min_role):
            raise HTTPException(status_code=403)
        return user

    monkeypatch.setattr(deps, "get_user", fake_get_user)
    app.dependency_overrides[deps.optional_user] = lambda: state["user"]
    readable = lambda meta, user: user is not None or meta.get("id") not in state["restricted"]  # noqa: E731
    monkeypatch.setattr(r, "can_read_work", readable)
    monkeypatch.setattr(work_relations, "can_read_work", readable)
    c = TestClient(app)
    c.state = state
    return c


def _put(client, wid, add=(), remove=()):
    return client.put(f"/works/{wid}/relations", json={"add": list(add), "remove": list(remove)})


def test_put_ja_get(client):
    r = _put(client, "w1", add=[{"id": "w2", "rel_type": V}])
    assert r.status_code == 200
    body = r.json()
    assert list(body) == ["relations"] and body["relations"][0]["id"] == "w2"
    assert body["relations"][0]["title"] == "T w2"
    assert client.get("/works/w2/relations").json()[0]["id"] == "w1"


def test_put_editorile_403(client):
    client.state["user"] = {"username": "ed", "role": "editor"}
    assert _put(client, "w1", add=[{"id": "w2", "rel_type": V}]).status_code == 403


def test_put_vigane_liik_400(client):
    assert _put(client, "w1", add=[{"id": "w2", "rel_type": "isPartOf"}]).status_code == 400


def test_put_tundmatu_lahe_404(client):
    assert _put(client, "puudub", add=[{"id": "w2", "rel_type": V}]).status_code == 404


def test_get_piiratud_lahteteos_anonuumselt_404(client):
    client.state["user"] = None
    client.state["restricted"] = {"w1"}
    assert client.get("/works/w1/relations").status_code == 404


def test_put_salvestuse_viga_500(client, monkeypatch):
    monkeypatch.setattr(metadata_ops, "save_with_git",
                        lambda *a, **k: {"success": False, "error": "x", "rolled_back": True})
    r = _put(client, "w1", add=[{"id": "w2", "rel_type": V}])
    assert r.status_code == 500 and r.json()["detail"] == "Seost ei salvestatud"


def test_update_work_metadata_lukkab_relations_tagasi(monkeypatch):
    from server import deps
    from server.routers import editing

    async def fake_get_user(request, min_role="contributor"):
        return {"username": "adm", "role": "admin"}

    monkeypatch.setattr(deps, "get_user", fake_get_user)
    app = FastAPI()
    app.include_router(editing.router)
    r = TestClient(app).post("/update-work-metadata",
                             json={"work_id": "w1", "metadata": {"relations": []}})
    assert r.status_code == 400
    assert r.json()["detail"] == "Seoseid muudetakse /works/{id}/relations kaudu"
