"""Isikufiltrid on ÜKS loend (#670): loend, `/query` ja kaart rakendavad samu filtreid.

Kaardi haru kaotas `origin_place`-i kõigis kolmes kihis, sest filtrid olid
igas endpointis ja funktsioonis käsitsi välja kirjutatud.
"""
import dataclasses
import importlib
import inspect
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _entry(pid, place, lat):
    return {
        "id": pid, "label": pid, "sort_name": pid, "record_status": "draft",
        "origin_place": place, "origin_place_id": None, "origin_place_labels": None,
        "origin_coordinates": {"lat": lat, "lon": 24.0},
    }


FAKE_INDEX = {"entries": [
    _entry("p1", "Tartu", 58.0),
    _entry("p2", "Tartu", 58.0),
    _entry("p3", "Riga", 56.9),
]}


@pytest.fixture
def ops():
    return importlib.import_module("server.prosopography.ops")


@pytest.fixture
def http(client, ops, monkeypatch):
    monkeypatch.setattr(ops, "_load_index", lambda: FAKE_INDEX)
    monkeypatch.setattr(ops, "_load_person_to_works", lambda: {})
    monkeypatch.setattr(ops, "_entry_occupations", lambda e: [])
    monkeypatch.setattr(ops, "_load_person_aliases", lambda: {})
    monkeypatch.setattr(ops, "_load_origin_groups", lambda: {})
    return client


def test_loend_filtreerib_paritolukoha_jargi(http):
    resp = http.get("/prosopography", params={"origin_place": "Tartu"})
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()["results"]] == ["p1", "p2"]


def test_query_filtreerib_paritolukoha_jargi(http):
    resp = http.post("/prosopography/query", json={"origin_place": "Tartu", "ids": ["p1", "p2", "p3"]})
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()["results"]] == ["p1", "p2"]


def test_kaart_filtreerib_paritolukoha_jargi(http):
    resp = http.get("/prosopography/map", params={"origin_place": "Tartu"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_persons"] == 2
    assert [m["place_key"] for m in data["markers"]] == ["Tartu"]


def test_endpointi_soltuvus_katab_koik_filtrid():
    """Router loeb filtrid ühest sõltuvusest, mille parameetrid vastavad
    `PersonFilters` väljadele (`tags` tuleb URL-is nimega `tag`)."""
    from server.prosopography.person_search import PersonFilters
    from server.prosopography.router import person_filters

    params = set(inspect.signature(person_filters).parameters)
    fields = {f.name for f in dataclasses.fields(PersonFilters)}
    assert params == (fields - {"tags"}) | {"tag"}
