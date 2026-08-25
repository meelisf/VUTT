"""Tekstitööriistade testid — klient asendatud võltsiga, võrku ei puututa.

NB veakäsitluse kohta: `MCPServer.call_tool()` mähib tööriistas tõstetud
erindi `ToolError`-isse (is_error=True teisendus toimub protokollikihis).
Originaalsõnum jääb ToolError-i teksti sisse, nii et sisu saab kontrollida.
"""
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from vutt_mcp.errors import VuttTemporaryError

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

    #: Q-kood → sildid; `None` matkib endpointi tõrget.
    entity_labels = {
        "Q1123131": {"et": "disputatsioon", "en": "disputation", "de": "Disputation"},
        "Q60797": {"en": "sermon", "de": "Predigt"},
    }

    def api_get(self, path, params=None):
        # Sildiregister on AINUS FastAPI-tee, mida tekstitööriistad tohivad
        # kasutada — muu peab endiselt kukkuma.
        if path == "/entity-labels":
            if self.entity_labels is None:
                raise VuttTemporaryError("VUTT ei vasta.")
            return self.entity_labels
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
    assert "v7Kq2mXp" in out and "48 lk" in out and "lk 12 ·" in out
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
    assert "48 lk" in out and "lk 7 ·" in out


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


async def test_get_work_lehekuljed_vahemikena(server_with):
    """Rida lehe kohta oli 706-leheküljelisel teosel ~18 000 tokenit."""
    pages = [_hit(page=n) for n in (1, 2, 3)]
    server, client = server_with([{"hits": pages, "totalHits": 3}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert client.bodies[0]["sort"] == ["lehekylje_number:asc"]
    assert "Leheküljed: 1–3" in out
    assert "/work/v7Kq2mXp/{lk}" in out
    assert "lk 2" not in out  # üksikuid lehti ei loetleta


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


async def test_get_work_ei_korda_seisundi_legendi(server_with):
    """Seisundite seletus tuleb serveri juhendist, mitte igast vastusest."""
    server, _ = server_with([{"hits": [_hit(page=1)], "totalHits": 1}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert "usaldusväärsus" not in out
    assert "seisund=" in out


async def test_get_work_jatab_rollilegendi_ara_kui_ainult_autor(server_with):
    creators = [{"name": "Johannes Gezelius", "role": "auctor", "id": "vutt:P1"}]
    server, _ = server_with([{"hits": [_hit(page=1, creators=creators)], "totalHits": 1}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert "auctor: Johannes Gezelius" in out
    assert "eessõna" not in out.lower()  # legendi ei ole


async def test_search_pages_laotab_vasted_teoste_peale(server_with):
    """Enne: 10 vastet tulid ühest teosest (lk 1–10) — vaikne vale pilt."""
    hits = [_hit(page=n, work_id="aaa") for n in range(1, 11)] + [
        _hit(page=1, work_id="bbb"), _hit(page=1, work_id="ccc")]
    server, client = server_with([{"hits": hits, "totalHits": 99}])
    out = await _call(server, "search_pages", {"query": "x", "limit": 5})
    # Meilist tõmmatakse rohkem, kui kuvatakse
    assert client.bodies[0]["hitsPerPage"] > 5
    assert "work_id=aaa" in out and "work_id=bbb" in out and "work_id=ccc" in out
    assert out.count("lk ") <= 6  # 3 lehte aaa-st + 1 + 1


async def test_search_pages_teosesiseselt_ei_kärbita(server_with):
    """work_id-ga piiratud otsing on „kus selles teoses" — kapp oleks vale."""
    hits = [_hit(page=n, work_id="aaa") for n in range(1, 11)]
    server, client = server_with([{"hits": hits, "totalHits": 10}])
    out = await _call(server, "search_pages", {"query": "x", "work_id": "aaa", "limit": 10})
    assert client.bodies[0]["hitsPerPage"] == 10
    for n in range(1, 11):
        assert f"lk {n} ·" in out


async def test_search_pages_ei_otsi_teose_metaandmetest(server_with):
    """„KUS mainitakse" = lehekülje tekstis, mitte teose pealkirjas."""
    server, client = server_with([{"hits": [], "totalHits": 0}])
    await _call(server, "search_pages", {"query": "Dorpat"})
    assert client.bodies[0]["attributesToSearchOn"] == [
        "lehekylje_tekst", "marginaalia_tekst"]


async def test_search_works_otsib_ka_pealkirjast(server_with):
    """„MILLISED teosed" = ka pealkiri ja autorid."""
    server, client = server_with([{"hits": [], "totalHits": 0}])
    await _call(server, "search_works", {"query": "Dorpat"})
    valjad = client.bodies[0]["attributesToSearchOn"]
    assert "title" in valjad and "authors_text" in valjad


async def test_search_pages_compact_joudb_vormistusse(server_with):
    hits = [_hit(page=n, work_id="aaa") for n in (1, 2)]
    server, _ = server_with([{"hits": hits, "totalHits": 2}])
    out = await _call(server, "search_pages", {"query": "x", "compact": True})
    assert "/work/aaa/{lk}" in out
    assert "respublica" not in out


async def test_search_pages_next_offset_kui_aken_sai_taide(server_with):
    hits = [_hit(page=n, work_id=f"w{n}") for n in range(1, 6)]
    server, _ = server_with([{"hits": hits, "totalHits": 519}])
    out = await _call(server, "search_pages", {"query": "x", "limit": 5})
    assert "offset=5" in out


async def test_search_pages_ei_luba_tuhja_jarelparingut(server_with):
    """Aken sai täis, aga rohkem vasteid ei ole — vihje eksitaks."""
    hits = [_hit(page=n, work_id=f"w{n}") for n in range(1, 6)]
    server, _ = server_with([{"hits": hits, "totalHits": 5}])
    out = await _call(server, "search_pages", {"query": "x", "limit": 5})
    assert "offset=" not in out


async def test_list_filter_values_lisab_q_koodile_sildi(server_with):
    """Paljas Q-kood paneb mudeli oletama („Q609697? Actually…")."""
    server, _ = server_with([
        {"facetDistribution": {"genre_ids": {"Q1123131": 7454, "Q60797": 367}}}
    ])
    out = await _call(server, "list_filter_values", {"field": "genres"})
    assert "Q1123131" in out                    # kood jääb, seda vajab filter
    assert "disputatsioon" in out               # et-silt
    assert "disputation" in out                 # en-silt
    assert "sermon" in out                      # et puudub → langeb en peale


async def test_list_filter_values_tundmatu_kood_jaab_paljaks(server_with):
    server, _ = server_with([
        {"facetDistribution": {"genre_ids": {"Q999999": 5}}}
    ])
    out = await _call(server, "list_filter_values", {"field": "genres"})
    assert "Q999999 — 5 lk" in out


async def test_list_filter_values_tootab_ka_sildita(server_with):
    """Sildiregistri tõrge EI TOHI filtriväärtusi kättesaamatuks teha."""
    server, client = server_with([
        {"facetDistribution": {"genre_ids": {"Q1123131": 7454}}}
    ])
    client.entity_labels = None
    out = await _call(server, "list_filter_values", {"field": "genres"})
    assert "Q1123131" in out and "7454" in out


async def test_list_filter_values_ei_kysi_silte_keeltele(server_with):
    """ISO-koodid ei ole Q-koodid — asjatut päringut ei tehta."""
    server, client = server_with([
        {"facetDistribution": {"languages": {"lat": 15579, "deu": 4528}}}
    ])
    client.entity_labels = None   # kui küsitaks, kukuks vastus sildita režiimi
    out = await _call(server, "list_filter_values", {"field": "languages"})
    assert "lat — 15579 lk" in out


async def test_get_work_naitab_zanri_q_koodi(server_with):
    """Sild → kood on ainus tee filtrini; ilma selleta peab mudel loendit
    skannima ja oletama („Oratsioon — likely Q609697?")."""
    hit = _hit(page=1, genre="Oratsioon", genre_ids=["Q861911"])
    server, client = server_with([{"hits": [hit], "totalHits": 1}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert "žanr: Oratsioon (Q861911)" in out
    assert "genre_ids" in client.bodies[0]["attributesToRetrieve"]


async def test_get_work_zanr_ilma_koodita_ei_saa_rippuvat_sulgu(server_with):
    server, _ = server_with([{"hits": [_hit(page=1, genre="Oratsioon")], "totalHits": 1}])
    out = await _call(server, "get_work", {"work_id": "v7Kq2mXp"})
    assert "žanr: Oratsioon" in out and "(" not in out.split("žanr:")[1].split("\n")[0]
