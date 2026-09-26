"""Agendi ettepaneku üleandmine ei muuda isikukaarti ega registrit."""
import os
import pytest

from server.prosopography import enrichment_proposals as proposals


@pytest.fixture(autouse=True)
def proposal_db(tmp_path, monkeypatch):
    monkeypatch.setattr(proposals, "DB_PATH", str(tmp_path / "proposals.sqlite3"))


def _item(**extra):
    item = {
        "kind": "occupation", "match_status": "matched",
        "raw_occupation": "Prof. theol.",
        "occupation_key": "theology-professor",
        "institution_key": "academia-gustaviana",
        "evidence": [{"source_kind": "vutt_page", "work_id": "w1",
                      "page": 12, "printed_page": "24", "quote": "Prof. theol."}],
    }
    item.update(extra)
    return item


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_uleandmine_on_uhekordne_ja_isikukaart_jaab_puutumata(client, login, prosopo_env):
    before = prosopo_env.write("abc", occupations=[])
    token = login("editor", "editorpass")
    handoff = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                          headers=_headers(token))
    assert handoff.status_code == 200
    code = handoff.json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": before["updated_at"], "items": [_item()]}
    submitted = client.post("/prosopography/enrichment-proposals/submit", json=body)
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "pending"
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 400
    pending = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                         headers=_headers(token))
    assert pending.status_code == 200
    assert pending.json()[0]["items"] == [_item()]
    assert prosopo_env.read("abc") == before


def test_uleandmine_nouab_editori_ja_pakkumine_on_sessioonipohine(client, login, prosopo_env):
    prosopo_env.write("abc")
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc").status_code == 401
    contrib = login("contrib", "contribpass")
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(contrib)).status_code == 401
    token1 = login("editor", "editorpass")
    token2 = login("editor", "editorpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token1)).json()["code"]
    client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    own = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                     headers=_headers(token1))
    other_session = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                               headers=_headers(token2))
    assert len(own.json()) == 1
    assert other_session.json() == []


@pytest.mark.parametrize("change", [
    {"person_id": "vutt:Pother"},
    {"base_updated_at": "old"},
    {"items": [_item(review={"state": "done"})]},
    {"items": [_item(identifiers=[{"scheme": "gnd", "id": "1"}])]},
    {"items": [_item(evidence=[])]},
    {"items": [_item(date_from={"date": "1640", "precision": "millennium"})]},
    {"items": [_item(evidence=[{"source_kind": "vutt_page", "work_id": "w1"}])]},
])
def test_vigane_ettepanek_ei_kuluta_koodi(client, login, prosopo_env, change):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()]}
    body.update(change)
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 400
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()]}
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 200


def test_aegunud_kood_keeldub(client, login, prosopo_env, monkeypatch):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    monkeypatch.setattr(proposals.time, "time", lambda: 1000)
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    monkeypatch.setattr(proposals.time, "time", lambda: 1000 + proposals.CODE_TTL + 1)
    response = client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    assert response.status_code == 400


def test_ajutine_andmebaas_on_ainult_serveri_kasutajale(tmp_path):
    proposals.issue_handoff("vutt:Pabc", "editor", "session", "t")
    assert os.stat(proposals.DB_PATH).st_mode & 0o077 == 0


def test_vigane_isiku_id_ja_suur_sisu_keelatakse(client, login, prosopo_env):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    assert client.post("/prosopography/enrichment-handoff/%2E%2E",
                       headers=_headers(token)).status_code == 400
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()]}
    body["items"][0]["raw_occupation"] = "x" * proposals.MAX_BODY_BYTES
    assert client.post("/prosopography/enrichment-proposals/submit",
                       json=body).status_code == 413
