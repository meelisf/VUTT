# tests/test_work_exemplars_api_pages.py
"""GET /works/{id}/exemplars kannab täielikku leheloendit kettalt (eksemplari leht)."""
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image


@pytest.fixture
def client(exemplar_work, monkeypatch):
    from server.routers import work_exemplars as r
    from server import deps
    env = exemplar_work

    def meta():
        with open(env["meta_path"], encoding="utf-8") as f:
            return json.load(f)

    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: env["work_dir"] if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id", lambda wid: meta() if wid == "w1" else None)
    monkeypatch.setattr(r, "can_read_work", lambda m, u: True)
    monkeypatch.setattr(r.we, "resolve_convolutes", lambda *a, **k: [])
    app = FastAPI()
    app.include_router(r.router)
    app.dependency_overrides[deps.optional_user] = lambda: None
    c = TestClient(app)
    c.env = env
    return c


def test_page_numbers_katab_koik_lehed(client):
    # kinnitusel on üks leht 1640-test-w1-001 ja eksemplaril a1b2c3 EI OLE `pages`-i
    r = client.get("/works/w1/exemplars").json()
    assert r["page_numbers"] == {"1640-test-w1-001": 1}
    assert r["page_files"] == ["1640-test-w1-001.jpg"]
    assert r["page_count"] == 1


def test_page_files_teose_jarjekorras(client):
    # teine leht järjestusväljaga ENNE esimest → järjekord tuleb lehe JSON-ist, mitte nimest
    import os
    wd = client.env["work_dir"]
    Image.new("RGB", (8, 8)).save(os.path.join(wd, "1640-test-w1-000.jpg"), "JPEG")
    with open(os.path.join(wd, "1640-test-w1-000.json"), "w", encoding="utf-8") as f:
        json.dump({"sequence": 5}, f)
    with open(os.path.join(wd, "1640-test-w1-001.json"), "w", encoding="utf-8") as f:
        json.dump({"sequence": 1}, f)
    r = client.get("/works/w1/exemplars").json()
    assert r["page_files"] == ["1640-test-w1-001.jpg", "1640-test-w1-000.jpg"]
    assert r["page_numbers"] == {"1640-test-w1-001": 1, "1640-test-w1-000": 2}
