"""Protokolli-hügieen: stdout puhtus ja structured_output väljas.

Mõlemad on vaikse rikke allikad: üks print() rikub stdio-voo, ja SDK v2
lisab -> str tagastusele vaikimisi ka structured_content'i
(kontrollitud: @mcp.tool() annab {'result': ...}, structured_output=False
annab None).
"""
import io
import sys

from vutt_mcp.server import build_server


class FakeClient:
    def meili_search(self, body):
        return {"hits": [], "totalHits": 0, "facetDistribution": {}}

    def api_get(self, path, params=None):
        return {"results": [], "total": 0, "id": "vutt:x", "name": {"label": "T"},
                "works": []}

    def api_post(self, path, json_body):
        return {"titles": {}}


def _minimal_args(name: str) -> dict:
    return {
        "search_pages": {"query": "x"},
        "search_works": {"query": "x"},
        "get_work": {"work_id": "abc"},
        "get_pages": {"work_id": "abc", "from_page": 1, "to_page": 1},
        "search_persons": {"q": "x"},
        "get_person": {"person_id": "vutt:abc"},
        "list_filter_values": {"field": "collections"},
    }[name]


async def test_ukski_tooriist_ei_tagasta_structured_contenti():
    server = build_server(client=FakeClient(), base_url="https://x.test")
    for tool in await server.list_tools():
        try:
            result = await server.call_tool(tool.name, _minimal_args(tool.name))
        except Exception:
            # Veatee on kaetud mujal; siin huvitab ainult õnnestunud kutse kuju.
            continue
        assert getattr(result, "structured_content", None) is None, (
            f"{tool.name} tagastab structured_content — lisa "
            f"@mcp.tool(structured_output=False)"
        )


async def test_tooriista_taitmine_ei_kirjuta_stdouti():
    server = build_server(client=FakeClient(), base_url="https://x.test")
    captured = io.StringIO()
    original = sys.stdout
    sys.stdout = captured
    try:
        await server.call_tool("search_pages", {"query": "x"})
    finally:
        sys.stdout = original
    assert captured.getvalue() == "", (
        f"stdout saastatud: {captured.getvalue()!r} — stdio-režiimis rikub see voo"
    )
