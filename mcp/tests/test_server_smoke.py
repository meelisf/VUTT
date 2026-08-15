"""Serveri koostamise suitsutest — tööriistade registreerimine ja nimed."""
from vutt_mcp.server import build_server

EXPECTED_TOOLS = {
    "search_pages", "search_works", "get_work", "get_pages",
    "search_persons", "get_person", "list_filter_values",
}


class _FakeClient:
    def meili_search(self, body):
        return {"hits": [], "totalHits": 0}

    def api_get(self, path, params=None):
        return {"results": [], "total": 0}

    def api_post(self, path, json_body):
        return {"titles": {}}


# pytest.ini: asyncio_mode = auto — eraldi markerit ei ole vaja
async def test_server_registreerib_koik_tooriistad():
    server = build_server(client=_FakeClient(), base_url="https://x.test")
    names = {t.name for t in await server.list_tools()}
    # NB: Task 8 lõpus taasta assert names == EXPECTED_TOOLS
    assert names == EXPECTED_TOOLS - {"search_persons", "get_person"}


async def test_build_server_ilma_kliendita_nouab_votit(monkeypatch):
    """Ilma võtmeta ei tohi server vaikselt käivituda."""
    import pytest

    from vutt_mcp.errors import VuttConfigError

    monkeypatch.delenv("VUTT_MEILI_SEARCH_KEY", raising=False)
    with pytest.raises(VuttConfigError):
        build_server()
