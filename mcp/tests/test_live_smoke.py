"""Päris API vastu. EI jookse vaikimisi (pytest.ini: addopts = -m "not live").

Käivitamine:
    VUTT_MEILI_SEARCH_KEY=<võti> .venv/bin/pytest mcp/tests/test_live_smoke.py -m live -v
"""
import os

import pytest

from vutt_mcp.client import VuttClient
from vutt_mcp.config import load_settings
from vutt_mcp.server import build_server

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(
        not os.getenv("VUTT_MEILI_SEARCH_KEY"),
        reason="VUTT_MEILI_SEARCH_KEY puudub",
    ),
]


@pytest.fixture
def server():
    settings = load_settings()
    return build_server(client=VuttClient(settings), base_url=settings.base_url)


async def _text(server, name, args):
    result = await server.call_tool(name, args)
    return result.content[0].text


async def test_search_pages_leiab_respublica(server):
    out = await _text(server, "search_pages", {"query": "respublica", "limit": 3})
    assert "work_id=" in out
    assert "/work/" in out
    assert "/api/images/" not in out  # pilte ei väljastata


async def test_search_works_annab_esindava_lehe(server):
    out = await _text(server, "search_works", {"query": "respublica", "limit": 3})
    assert "work_id=" in out
    assert "lk " in out


async def test_range_otsing_on_kitsam_kui_lodv(server):
    """matchingStrategy 'all' peab andma vähem vasteid kui 'last'."""
    strict = await _text(server, "search_pages", {
        "query": "respublica Suecorum florentissima", "limit": 1,
    })
    relaxed = await _text(server, "search_pages", {
        "query": "respublica Suecorum florentissima", "limit": 1,
        "relax_matching": True,
    })

    def _total(text: str) -> int:
        if text.startswith("Vasteid ei leitud"):
            return 0
        return int(text.split("Vasteid kokku: ")[1].split(" ")[0])

    assert _total(strict) <= _total(relaxed)


async def test_get_work_pais_ei_ole_tuhi(server):
    """Regressioonivalve: päring peab metaandmeväljad tegelikult küsima.

    Võltsandmetega testid lasid vea läbi — fixture'is olid väljad olemas ka
    siis, kui päring neid ei küsinud.
    """
    import re

    hits = await _text(server, "search_pages", {"query": "respublica", "limit": 1})
    work_id = re.search(r"work_id=(\w+)", hits).group(1)
    out = await _text(server, "get_work", {"work_id": work_id})
    assert "pealkiri: " in out
    assert "Leheküljed:" in out


async def test_search_persons_leiab_aliase_kaudu(server):
    out = await _text(server, "search_persons", {"q": "Ludenius", "limit": 3})
    assert "person_id=vutt:" in out


async def test_list_filter_values_annab_kollektsioonid(server):
    out = await _text(server, "list_filter_values", {"field": "collections"})
    assert " lk" in out
