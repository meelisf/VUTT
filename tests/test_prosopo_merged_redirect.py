"""Liidendatud (tombstone) kaardi URL peab viima päris kirjele (#240).

Backend vastas 301-ga, aga `Location: /prosopography/{id}` on absoluutne tee
serveri juurest. Nginx proksib backendi `/api/files/` alt, nii et brauser
lahendas selle vastu **saidi juurt** ja maandus SPA marsruudil
`https://vutt.utlib.ut.ee/prosopography/vutt:P...` → `text/html`. `fetch`
järgis redirecti vaikselt, `resp.ok` oli true ja `resp.json()` kukkus —
kasutaja nägi „Isikute laadimine ebaõnnestus".

Suhteline `./{id}` lahendub õigesti mõlemal juhul: nii otse backendi vastu kui
`/api/files/` prefiksi tagant.
"""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def tombstone_dir(tmp_path, monkeypatch):
    from server.prosopography import person_crud, relations

    d = tmp_path / "prosopography"
    d.mkdir()
    (d / "dead01.json").write_text(json.dumps({
        "id": "vutt:Pdead01",
        "name": {"label": "Jacobus Skytte"},
        "record_status": "tombstone",
        "merged_into": "vutt:Plive02",
    }, ensure_ascii=False), encoding="utf-8")
    (d / "live02.json").write_text(json.dumps({
        "id": "vutt:Plive02",
        "name": {"label": "Jacobus Skytte"},
        "merged_into": None,
    }, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setattr(person_crud.state, "PROSOPOGRAPHY_DIR", str(d))
    monkeypatch.setattr(person_crud, "sync_from_facade", lambda: None)
    monkeypatch.setattr(relations, "sync_from_facade", lambda: None)
    return d


def test_liidendatud_kaart_vastab_301ga(client, tombstone_dir):
    resp = client.get("/prosopography/vutt:Pdead01", follow_redirects=False)
    assert resp.status_code == 301


def test_location_on_suhteline_et_lahenduks_ka_api_files_prefiksi_all(client, tombstone_dir):
    """Absoluutne `/prosopography/...` maandus nginxi taga SPA-s."""
    resp = client.get("/prosopography/vutt:Pdead01", follow_redirects=False)
    loc = resp.headers["location"]

    assert not loc.startswith("/"), f"absoluutne tee ei lahendu nginxi taga: {loc}"
    assert loc.startswith("./"), f"skeemiks tõlgendatav suhteline tee: {loc}"
    assert "Plive02" in loc


def test_location_lahendub_moelmas_paigalduses():
    """`./{id}` viimase segmendi asendus — kontrollime päris URL-lahendajaga."""
    from urllib.parse import urljoin
    loc = "./vutt%3APlive02"
    assert urljoin("https://x/prosopography/vutt%3APdead01", loc) == \
        "https://x/prosopography/vutt%3APlive02"
    assert urljoin("https://x/api/files/prosopography/vutt%3APdead01", loc) == \
        "https://x/api/files/prosopography/vutt%3APlive02"


def test_keha_ytleb_ikka_kuhu_liideti(client, tombstone_dir):
    resp = client.get("/prosopography/vutt:Pdead01", follow_redirects=False)
    assert "vutt:Plive02" in resp.json()["detail"]


def test_elav_kaart_ei_suunata(client, tombstone_dir):
    resp = client.get("/prosopography/vutt:Plive02", follow_redirects=False)
    assert resp.status_code == 200
    assert resp.json()["id"] == "vutt:Plive02"
