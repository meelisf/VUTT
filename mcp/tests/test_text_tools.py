"""Tekstitööriistade testid — klient asendatud võltsiga, võrku ei puututa.

NB veakäsitluse kohta: `MCPServer.call_tool()` mähib tööriistas tõstetud
erindi `ToolError`-isse (is_error=True teisendus toimub protokollikihis).
Originaalsõnum jääb ToolError-i teksti sisse, nii et sisu saab kontrollida.
"""
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from vutt_mcp.server import build_server

BASE = "https://vutt.utlib.ut.ee"


class FakeClient:
    """Salvestab päringukehad ja tagastab ettevalmistatud vastused."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.bodies = []

    def meili_search(self, body):
        self.bodies.append(body)
        return self.responses.pop(0)

    def api_get(self, path, params=None):
        raise AssertionError("tekstitööriistad ei tohi FastAPI-t kutsuda")


def _hit(page=12, **extra):
    base = {
        "work_id": "v7Kq2mXp",
        "title": "Disputatio politica",
        "autor": "Ludenius, Laurentius",
        "aasta": 1642,
        "lehekylje_number": page,
        "teose_lehekylgede_arv": 48,
        "status": "Valmis",
        "_formatted": {"lehekylje_tekst": "…respublica…"},
    }
    base.update(extra)
    return base


async def _call(server, name, args):
    result = await server.call_tool(name, args)
    return result.content[0].text


@pytest.fixture
def server_with():
    def _make(responses):
        client = FakeClient(responses)
        return build_server(client=client, base_url=BASE), client

    return _make


async def test_search_pages_tagastab_katked(server_with):
    server, client = server_with([{"hits": [_hit()], "totalHits": 1}])
    out = await _call(server, "search_pages", {"query": "respublica"})
    assert "v7Kq2mXp" in out and "lk 12/48" in out
    assert client.bodies[0]["matchingStrategy"] == "all"
    assert "distinct" not in client.bodies[0]


async def test_search_pages_relax_matching_jouab_paringusse(server_with):
    server, client = server_with([{"hits": [], "totalHits": 0}])
    await _call(server, "search_pages", {"query": "x", "relax_matching": True})
    assert client.bodies[0]["matchingStrategy"] == "last"


async def test_search_pages_kollektsioonifilter_jouab_paringusse(server_with):
    server, client = server_with([{"hits": [], "totalHits": 0}])
    await _call(server, "search_pages", {"query": "x", "collection": "Disputatsioonid"})
    assert "Disputatsioonid" in client.bodies[0]["filter"]


async def test_search_works_kasutab_distincti_ja_naitab_esindavat_lehte(server_with):
    server, client = server_with([{"hits": [_hit(page=7)], "totalHits": 1}])
    out = await _call(server, "search_works", {"query": "respublica"})
    assert client.bodies[0]["distinct"] == "work_id"
    # Esindav lehekülg vastab küsimusele "miks see teos vaste oli"
    assert "lk 7/48" in out


async def test_get_pages_keeldub_ule_kahekumne_lehe(server_with):
    server, _ = server_with([])
    with pytest.raises(ToolError) as exc:
        await _call(server, "get_pages", {
            "work_id": "abc", "from_page": 1, "to_page": 40,
        })
    assert "20" in str(exc.value)


async def test_get_pages_keeldub_tagurpidi_vahemikust(server_with):
    server, _ = server_with([])
    with pytest.raises(ToolError):
        await _call(server, "get_pages", {
            "work_id": "abc", "from_page": 10, "to_page": 5,
        })


async def test_get_pages_tagastab_teksti_ja_marginaalia(server_with):
    server, client = server_with([{"hits": [{
        "lehekylje_number": 12,
        "lehekylje_tekst": "põhitekst",
        "marginaalia_tekst": "ääremärkus",
        "status": "Toores",
    }]}])
    out = await _call(server, "get_pages", {
        "work_id": "abc", "from_page": 12, "to_page": 12,
    })
    assert "põhitekst" in out and "ääremärkus" in out
    assert "Toores" in out
    assert client.bodies[0]["sort"] == ["lehekylje_number:asc"]


async def test_get_work_tundmatu_id_soovitab_search_works(server_with):
    server, _ = server_with([{"hits": [], "totalHits": 0}])
    with pytest.raises(ToolError) as exc:
        await _call(server, "get_work", {"work_id": "puudub"})
    assert "search_works" in str(exc.value)


async def test_get_work_lehekuljed_on_jarjestuses(server_with):
    pages = [_hit(page=n) for n in (1, 2, 3)]
    server, client = server_with([{"hits": pages, "totalHits": 3}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert client.bodies[0]["sort"] == ["lehekylje_number:asc"]
    assert out.index("lk 1 ") < out.index("lk 2 ") < out.index("lk 3 ")


async def test_get_work_naitab_metaandmed(server_with):
    server, _ = server_with([{"hits": [_hit(page=1, location="Tartu")], "totalHits": 1}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert "pealkiri: Disputatio politica" in out
    assert "koht: Tartu" in out


async def test_get_work_kysib_metaandmevaljad_paringus(server_with):
    """Päringu tasandi kontroll — võltsandmetes on väljad olemas ka siis,
    kui päring neid ei küsi. Live-kontroll näitas tühja päist just seetõttu."""
    server, client = server_with([{"hits": [_hit(page=1)], "totalHits": 1}])
    await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    retrieve = client.bodies[0]["attributesToRetrieve"]
    assert "title" in retrieve and "autor" in retrieve and "aasta" in retrieve
    # praeses, gratulandid ja eessõna autor elavad creators-massiivis
    assert "creators" in retrieve
    # ülevaade ei vaja lehekülgede teksti
    assert "lehekylje_tekst" not in retrieve


async def test_get_work_naitab_praeses_ja_gratulandid(server_with):
    creators = [
        {"name": "Andreas Virginius", "role": "praeses", "id": "vutt:Pky0a04"},
        {"name": "Peter Götschen", "role": "respondens", "id": "vutt:P6e42i9"},
        {"name": "Georg Mancelius", "role": "gratulator", "id": "vutt:P3emhpf"},
        {"name": "Johannes Weideling", "role": "aui", "id": "vutt:Pi874ih"},
    ]
    server, _ = server_with([{"hits": [_hit(page=1, creators=creators)], "totalHits": 1}])
    out = await _call(server, "get_work", {"work_id": "d9noh9"})
    assert "praeses: Andreas Virginius" in out
    assert "gratulator: Georg Mancelius" in out
    assert "aui: Johannes Weideling" in out
    assert "eessõna" in out.lower()  # aui-koodi selgitus


async def test_search_pages_kysib_creatorsit(server_with):
    server, client = server_with([{"hits": [], "totalHits": 0}])
    await _call(server, "search_pages", {"query": "x"})
    assert "creators" in client.bodies[0]["attributesToRetrieve"]
