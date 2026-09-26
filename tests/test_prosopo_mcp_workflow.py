"""MCP → ootel ettepanek → isikuvormi kinnitamis-API terviklik töövoog."""
import json
from pathlib import Path

import pytest

from server.prosopography import enrichment_proposals as proposals


@pytest.fixture(autouse=True)
def proposal_db(tmp_path, monkeypatch):
    monkeypatch.setattr(proposals, "DB_PATH", str(tmp_path / "proposals.sqlite3"))


@pytest.mark.asyncio
async def test_mcp_ettepanekust_toimetaja_kinnitamiseni(
        client, login, prosopo_env, tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "mcp"))
    from vutt_mcp.server import build_server

    registry = tmp_path / "config"
    registry.mkdir(exist_ok=True)
    (registry / "occupations.json").write_text(json.dumps({
        "professor": {"labels": {"et": "professor"}},
    }))
    (registry / "institutions.json").write_text(json.dumps({
        "agc": {"labels": {"et": "Academia Gustaviana"}},
    }))
    monkeypatch.setattr(proposals, "DATA_CONFIG_DIR", str(registry))

    card = prosopo_env.write("abc", occupations=[], education=[])
    token = login("editor", "editorpass")
    other_token = login("editor", "editorpass")

    class TestApiAdapter:
        def api_get(self, path, params=None):
            response = client.get(path, params=params)
            assert response.status_code == 200, response.text
            return response.json()

        def api_post_once(self, path, json_body):
            response = client.post(path, json=json_body)
            assert response.status_code == 200, response.text
            return response.json()

    mcp = build_server(client=TestApiAdapter(), base_url="http://testserver")
    context = await mcp.call_tool("get_person_enrichment_context", {"person_id": card["id"]})
    version = json.loads(context.content[0].text)["updated_at"]
    assert version == card["updated_at"]

    handoff = client.post(f'/prosopography/enrichment-handoff/{card["id"]}',
                          headers={"Authorization": f"Bearer {token}"})
    assert handoff.status_code == 200
    items = [
        {"kind": "occupation", "match_status": "matched", "raw_occupation": "Prof. theol.",
         "raw_institution": "AGC", "occupation_key": "professor", "institution_key": "agc",
         "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 12}]},
        {"kind": "education", "match_status": "matched", "raw_institution": "AGC",
         "institution_key": "agc", "edu_type": "immatriculation",
         "evidence": [{"source_kind": "literature", "source_id": "book1", "locator": "lk 4"}]},
    ]
    submitted = await mcp.call_tool("submit_person_enrichment_proposal", {
        "handoff_code": handoff.json()["code"], "person_id": card["id"],
        "base_updated_at": version, "items": items,
    })
    assert "Ettepanek talletatud" in submitted.content[0].text
    assert prosopo_env.read("abc") == card

    url = f'/prosopography/enrichment-proposals/{card["id"]}'
    assert client.get(url, headers={"Authorization": f"Bearer {other_token}"}).json() == []
    own = client.get(url, headers={"Authorization": f"Bearer {token}"})
    assert own.status_code == 200
    assert len(own.json()[0]["items"]) == 2
    assert own.json()[0]["items"][0]["registry_labels"]["occupation_key"] == "professor"

    applied = client.post(f"{url}/apply", headers={"Authorization": f"Bearer {token}"},
                          json={"proposal_id": own.json()[0]["proposal_id"], "selected": [0, 1]})
    assert applied.status_code == 200, applied.text
    saved = prosopo_env.read("abc")
    assert saved["occupations"][0]["label"] == "Prof. theol."
    assert saved["occupations"][0]["occupation_key"] == "professor"
    assert saved["education"][0]["institution"] == "AGC"
    assert saved["education"][0]["evidence"][0]["locator"] == "lk 4"
    assert client.get(url, headers={"Authorization": f"Bearer {token}"}).json() == []
