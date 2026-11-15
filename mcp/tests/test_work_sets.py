"""Töökollektsioonid MCP-s: loend ja otsingu piiramine kogu liikmetega.

Liikmesus ei ole Meilis (ADR 0042) — MCP küsib serverilt ID-d ja lisab filtri
`work_id IN [...]` teiste filtrite kõrvale. Tühi kogu on NULL tulemust, mitte
filtri ärajätmine.
"""
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from vutt_mcp.errors import VuttNotFound
from vutt_mcp.server import build_server

BASE = "https://vutt.utlib.ut.ee"

KOGUD = {"work_sets": [
    {"id": "ws1", "name": {"et": "Fischeri konverents", "en": ""},
     "description": None, "status": "active", "visibility": "members", "count": 2},
    {"id": "ws2", "name": {"et": "", "en": "Old project"},
     "description": None, "status": "archived", "visibility": "public", "count": 0},
]}


class FakeClient:
    def __init__(self, members=None):
        self.members = members or {}
        self.bodies = []
        self.mcp_paths = []

    def meili_search(self, body):
        self.bodies.append(body)
        return {"hits": [], "totalHits": 0}

    def api_get(self, path, params=None):
        if path == "/entity-labels":
            return {}
        raise AssertionError(f"ootamatu FastAPI tee {path}")

    def mcp_get(self, path):
        self.mcp_paths.append(path)
        if path == "/mcp/work-sets":
            return KOGUD
        set_id = path.split("/")[3]
        if set_id not in self.members:
            raise VuttNotFound(f"Ressurssi ei leitud: {path}")
        ids = self.members[set_id]
        return {"status": "success", "work_ids": ids, "count": len(ids)}


async def _call(server, name, args):
    result = await server.call_tool(name, args)
    return result.content[0].text


def _server(members=None):
    client = FakeClient(members)
    return build_server(client=client, base_url=BASE), client


async def test_list_work_sets_naitab_id_nime_arvu_ja_arhiivi():
    server, _ = _server()
    out = await _call(server, "list_work_sets", {})
    assert "ws1" in out and "Fischeri konverents" in out
    assert "2" in out
    assert "ws2" in out and "Old project" in out
    assert "arhiveeritud" in out


async def test_search_works_work_setiga_lisab_filtri():
    server, client = _server({"ws1": ["a1", "b2"]})
    await _call(server, "search_works", {"query": "x", "work_set": "ws1"})
    assert 'work_id IN ["a1", "b2"]' in client.bodies[0]["filter"]


async def test_search_pages_work_setiga_lisab_filtri_ja_laotab():
    server, client = _server({"ws1": ["a1"]})
    await _call(server, "search_pages",
                {"query": "x", "work_set": "ws1", "collection": "kogu"})
    f = client.bodies[0]["filter"]
    assert 'work_id IN ["a1"]' in f
    assert 'collections_hierarchy = "kogu"' in f
    # Laotamine (spread_search) tõmbab üle — teosesisese otsingu kapp ei kehti.
    assert client.bodies[0]["hitsPerPage"] > 10


@pytest.mark.parametrize("tool", ["search_pages", "search_works"])
async def test_tyhi_kogu_ei_tee_meili_paringut(tool):
    server, client = _server({"ws1": []})
    out = await _call(server, tool, {"query": "x", "work_set": "ws1"})
    assert client.bodies == []
    assert "0" in out and "ws1" in out


@pytest.mark.parametrize("tool", ["search_pages", "search_works"])
async def test_tundmatu_kogu_soovitab_list_work_sets(tool):
    server, client = _server({})
    with pytest.raises(ToolError) as exc:
        await _call(server, tool, {"query": "x", "work_set": "eiole"})
    assert "list_work_sets" in str(exc.value)
    assert client.bodies == []
