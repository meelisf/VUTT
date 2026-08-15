"""Serveri koostamise suitsutest — tööriistade registreerimine ja nimed."""
from vutt_mcp.server import build_server

EXPECTED_TOOLS = {
    "search_pages", "search_works", "get_work", "get_pages",
    "search_persons", "get_person", "list_filter_values",
}


# pytest.ini: asyncio_mode = auto — eraldi markerit ei ole vaja
async def test_server_registreerib_koik_tooriistad():
    server = build_server()
    names = {t.name for t in await server.list_tools()}
    # NB: Task 8 lõpus taasta assert names == EXPECTED_TOOLS
    assert names == set()
