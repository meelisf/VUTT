# tests/test_exemplars_batch.py
"""Eksemplaride kogupäring `GET /exemplars/batch`: sama vaade ja õiguskontroll mis
üksikpäringul, ühe teose tõrge ei kuku kogu vastust."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import deps


@pytest.fixture
def client(exemplar_work, monkeypatch):
    from server.routers import work_exemplars as r
    env = exemplar_work

    def meta(wid):
        if wid != "w1":
            return None
        with open(env["meta_path"], encoding="utf-8") as f:
            return json.load(f)

    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: env["work_dir"] if wid in ("w1", "w2", "w3") else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id",
                        lambda wid: meta(wid) if wid == "w1" else ({"id": wid, "exemplars": []} if wid in ("w2", "w3") else None))
    # w3 on piiratud; w1/w2 loetavad.
    monkeypatch.setattr(r, "can_read_work", lambda m, u: m.get("id") != "w3")
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[deps.optional_user] = lambda: None
    return TestClient(app)


def test_kogupäring_annab_iga_teose_vaate(client):
    r = client.get("/exemplars/batch", params={"work_ids": "w1,w2"})
    assert r.status_code == 200, r.text
    res = r.json()["results"]
    assert set(res) == {"w1", "w2"}
    assert res["w1"]["exemplars"][0]["id"] == "a1b2c3"
    assert res["w2"]["exemplars"] == []
    # Sama kuju mis üksikpäringul
    single = client.get("/works/w1/exemplars").json()
    assert res["w1"] == single


def test_ühe_teose_tõrge_ei_kuku_vastust(client):
    res = client.get("/exemplars/batch", params={"work_ids": "w1,w3,nope"}).json()["results"]
    assert "exemplars" in res["w1"]
    assert res["w3"]["error"]["status"] == 403     # piiratud — sama mis üksikpäring
    assert res["nope"]["error"]["status"] == 404
    assert client.get("/works/w3/exemplars").status_code == 403


def test_dubleeritud_id_loetakse_korra(client):
    res = client.get("/exemplars/batch", params={"work_ids": "w1, w1 ,w1"}).json()["results"]
    assert list(res) == ["w1"]


def test_lagi_ja_tuhi(client):
    from server.routers.work_exemplars import BATCH_MAX_WORKS
    ids = ",".join(f"x{i}" for i in range(BATCH_MAX_WORKS + 1))
    assert client.get("/exemplars/batch", params={"work_ids": ids}).status_code == 400
    assert client.get("/exemplars/batch", params={"work_ids": " , "}).status_code == 400
