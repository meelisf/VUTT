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
    # Kirjanduskogu tööriistad on väravatud (vt conftest fixture'it).
    assert names == EXPECTED_TOOLS


async def test_build_server_ilma_kliendita_nouab_votit(monkeypatch):
    """Ilma võtmeta ei tohi server vaikselt käivituda."""
    import pytest

    from vutt_mcp.errors import VuttConfigError

    monkeypatch.delenv("VUTT_MEILI_SEARCH_KEY", raising=False)
    with pytest.raises(VuttConfigError):
        build_server()


LIBRARY_TOOLS = {"list_literature", "search_literature", "get_literature_pages"}


async def test_kirjanduskogu_tooriistu_ei_ole_ilma_indeksita():
    """Vaikimisi ei tohi kogu tööriistu olla — indeksifaili pole."""
    server = build_server(client=_FakeClient(), base_url="https://x.test")
    names = {t.name for t in await server.list_tools()}
    assert names & LIBRARY_TOOLS == set()


async def test_kirjanduskogu_tooriistad_tekivad_indeksiga(monkeypatch, tmp_path):
    from vutt_mcp.library.schema import connect, create_schema

    db = tmp_path / "library.db"
    create_schema(connect(db))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(db))

    server = build_server(client=_FakeClient(), base_url="https://x.test")
    names = {t.name for t in await server.list_tools()}
    assert LIBRARY_TOOLS <= names
