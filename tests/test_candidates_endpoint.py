"""POST /prosopography/candidates (spekk §4.1): osaline tõrge, eelarve, olemasolu."""
import time

import pytest

from server.prosopography import candidates


@pytest.fixture
def kokkuvotted(monkeypatch):
    vastused = {("wikidata", "Q1"): {"label": "A", "names": [], "links": {}},
                ("gnd", "2"): None}
    monkeypatch.setattr(candidates, "candidate_summary", lambda s, i: vastused.get((s, i)))
    monkeypatch.setattr(candidates, "_similar", lambda name: [])
    return vastused


def test_osaline_tork_margitakse_viitele(prosopo_env, kokkuvotted):
    r = candidates.candidates("A", [{"scheme": "wikidata", "id": "Q1"}, {"scheme": "gnd", "id": "2"}])
    ok, bad = r["results"]
    assert ok["ok"] is True and ok["summary"]["label"] == "A"
    assert bad == {"scheme": "gnd", "id": "2", "ok": False, "summary": None,
                   "error": "source_unavailable", "existing_person_id": None}


def test_olemasolev_kaart_id_jargi(prosopo_env, kokkuvotted):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    r = candidates.candidates("A", [{"scheme": "wikidata", "id": "Q1"}])
    assert r["results"][0]["existing_person_id"] == "vutt:Paaa"


def test_eelarve_uletamisel_tagastatakse_joudnu(prosopo_env, monkeypatch):
    def aeglane(s, i):
        if i == "Q2":
            time.sleep(0.5)
        return {"label": i, "names": [], "links": {}}
    monkeypatch.setattr(candidates, "candidate_summary", aeglane)
    monkeypatch.setattr(candidates, "_similar", lambda name: [])
    monkeypatch.setattr(candidates, "_BUDGET_S", 0.2)
    r = candidates.candidates("x", [{"scheme": "wikidata", "id": "Q1"},
                                    {"scheme": "wikidata", "id": "Q2"}])
    assert r["results"][0]["ok"] is True
    assert r["results"][1] == {"scheme": "wikidata", "id": "Q2", "ok": False, "summary": None,
                               "error": "timeout", "existing_person_id": None}


def test_viiteid_loigatakse_15_ni(prosopo_env, kokkuvotted):
    refs = [{"scheme": "wikidata", "id": f"Q{i}"} for i in range(20)]
    assert len(candidates.candidates("x", refs)["results"]) == 15


def test_route_kuju_ja_oigus(client, login, prosopo_env, kokkuvotted):
    token = login("editor", "editorpass")
    h = {"Authorization": f"Bearer {token}"}
    assert client.post("/prosopography/candidates", json={"name": "A", "refs": "x"},
                       headers=h).status_code == 400
    r = client.post("/prosopography/candidates",
                    json={"name": "A", "refs": [{"scheme": "wikidata", "id": "Q1"}]}, headers=h)
    assert r.status_code == 200 and r.json()["results"][0]["ok"] is True
    assert client.post("/prosopography/candidates", json={"name": "A", "refs": []}).status_code in (401, 403)
