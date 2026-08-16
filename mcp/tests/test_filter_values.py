"""list_filter_values testid — facet-allikas ja maxValuesPerFacet leping."""
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from vutt_mcp import queries
from vutt_mcp.server import build_server

BASE = "https://vutt.utlib.ut.ee"


class FakeClient:
    def __init__(self, response):
        self.response = response
        self.bodies = []

    def meili_search(self, body):
        self.bodies.append(body)
        return self.response

    def api_get(self, path, params=None):
        raise AssertionError("list_filter_values ei tohi FastAPI-t kutsuda")


async def _call(server, args):
    result = await server.call_tool("list_filter_values", args)
    return result.content[0].text


async def test_kollektsioonid_tulevad_facet_jaotusest():
    client = FakeClient({"facetDistribution": {
        "collections_hierarchy": {"Disputatsioonid": 412, "Oratsioonid": 88}
    }})
    server = build_server(client=client, base_url=BASE)
    out = await _call(server, {"field": "collections"})
    assert "Disputatsioonid" in out and "412" in out
    assert client.bodies[0]["facets"] == ["collections_hierarchy"]
    assert client.bodies[0]["limit"] == 0


async def test_tulemused_on_sagedusjarjestuses():
    client = FakeClient({"facetDistribution": {
        "languages": {"grc": 113, "lat": 900, "deu": 400}
    }})
    server = build_server(client=client, base_url=BASE)
    out = await _call(server, {"field": "languages"})
    assert out.index("lat") < out.index("deu") < out.index("grc")


async def test_tundmatu_valja_nimi_loetleb_lubatud():
    server = build_server(client=FakeClient({}), base_url=BASE)
    with pytest.raises(ToolError) as exc:
        await _call(server, {"field": "värvid"})
    assert "collections" in str(exc.value)


async def test_tuhi_facet_jaotus():
    server = build_server(client=FakeClient({"facetDistribution": {}}), base_url=BASE)
    assert "ühtki väärtust" in await _call(server, {"field": "types"})


async def test_lae_saavutamisel_hoiatatakse():
    """maxValuesPerFacet piirab tagastust — loend võib olla poolik."""
    cap = queries.FACET_VALUE_CAP
    client = FakeClient({"facetDistribution": {
        "languages": {f"l{i}": 1 for i in range(cap)}
    }})
    server = build_server(client=client, base_url=BASE)
    out = await _call(server, {"field": "languages"})
    assert "mittetäielik" in out.lower()
