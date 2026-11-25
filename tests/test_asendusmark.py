"""Asendusmärk ja kirjutuskaitse (ADR 0089 p 2).

`work_lock` kaob koos protsessiga; katkestuse järel võisid `/save` ja lehetoimingud
jätkata poolikul lehestikul. Püsiv märk `state/work_replacing/{slug}.json` paneb
`page_lock`-i ja `work_lock`-i võõrad kirjutused tagasi lükkama.
"""
import os

import pytest

from server import replace_marker as rm
from server.admin_page_ops import work_lock
from server.page_locks import page_lock


@pytest.fixture
def kaustad(tmp_path, monkeypatch):
    data = tmp_path / "data"
    (data / "slug1").mkdir(parents=True)
    (data / "slug2").mkdir(parents=True)
    monkeypatch.setattr(rm, "BASE_DIR", str(data))
    monkeypatch.setattr(rm, "MARKER_DIR", str(tmp_path / "state" / "work_replacing"))
    return data


def test_mark_blokeerib_page_lock_voorale(kaustad):
    rm.write_marker("slug1", "u1")
    with pytest.raises(rm.WorkReplacingError):
        with page_lock(str(kaustad / "slug1" / "x.txt")):
            pass


def test_omanik_paaseb(kaustad):
    rm.write_marker("slug1", "u1")
    with rm.marker_owner("u1"):
        with page_lock(str(kaustad / "slug1" / "x.txt")):
            pass


def test_teine_omanik_ei_paase(kaustad):
    rm.write_marker("slug1", "u1")
    with rm.marker_owner("u2"):
        with pytest.raises(rm.WorkReplacingError):
            with page_lock(str(kaustad / "slug1" / "x.txt")):
                pass


def test_teise_teose_leht_ei_ole_blokeeritud(kaustad):
    rm.write_marker("slug1", "u1")
    with page_lock(str(kaustad / "slug2" / "x.txt")):
        pass


def test_work_lock_blokeeritud(kaustad):
    rm.write_marker("slug1", "u1")
    with pytest.raises(rm.WorkReplacingError):
        with work_lock("slug1", str(kaustad / "slug1")):
            pass
    with rm.marker_owner("u1"):
        with work_lock("slug1", str(kaustad / "slug1")):
            pass


def test_remove_marker_idempotentne(kaustad):
    rm.write_marker("slug1", "u1")
    assert rm.read_marker("slug1")["upload_id"] == "u1"
    rm.remove_marker("slug1")
    rm.remove_marker("slug1")
    assert rm.read_marker("slug1") is None
    with page_lock(str(kaustad / "slug1" / "x.txt")):
        pass


def test_list_markers(kaustad):
    rm.write_marker("slug1", "u1")
    rm.write_marker("slug2", "u2")
    assert sorted((s, m["upload_id"]) for s, m in rm.list_markers()) == [("slug1", "u1"), ("slug2", "u2")]


def test_save_marki_ajal_409(kaustad, monkeypatch):
    """Rakenduse tasemel: WorkReplacingError → 409 kahekeelse teatega."""
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.main import app

    rm.write_marker("slug1", "u1")

    @app.get("/__test_replacing")
    def _ep():
        with page_lock(str(kaustad / "slug1" / "x.txt")):
            return {"ok": True}

    try:
        r = TestClient(app).get("/__test_replacing")
    finally:
        app.router.routes = [rt for rt in app.router.routes if getattr(rt, "path", "") != "/__test_replacing"]
    assert r.status_code == 409
    assert "asendamisel" in r.json()["detail"] and "replaced" in r.json()["detail"]
