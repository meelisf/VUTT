"""Handle'i normaliseerimine ja ADA REST lookup. Võrku ei puudutata."""
import json
from pathlib import Path

import pytest

from server.ada import client

FIXTURES = Path(__file__).parent / "fixtures" / "ada"


# --- handle'i normaliseerimine ---

@pytest.mark.parametrize("sisend", [
    "10062/7822",
    "hdl:10062/7822",
    "http://hdl.handle.net/10062/7822",
    "https://hdl.handle.net/10062/7822",
    "https://dspace.ut.ee/handle/10062/7822",
    "  10062/7822  ",
])
def test_normaliseeri_handle_koik_kujud(sisend):
    assert client.normaliseeri_handle(sisend) == "10062/7822"


def test_normaliseeri_handle_viskab_selge_vea():
    with pytest.raises(client.AdaViga) as exc:
        client.normaliseeri_handle("mingi jama")
    assert "handle" in exc.value.kasutaja_sonum.lower()


def test_items_url_ei_ole_handle():
    """/items/{uuid} on UUID-kuju — lubatud, aga eraldi teena."""
    assert client.on_item_uuid("https://dspace.ut.ee/items/5a495195-44c1-463b-a425-643dc4dcf13f")


def test_lookup_parsimatu_sisend_ei_tee_vorku_ainult_annab_vea(monkeypatch):
    """lookup() normaliseerib handle'it ise — tundmatu sisend PEAB kukkuma
    enne ühtki võrgupäringut, mitte alles ADA vastuse peale."""
    def kukkuv_get(url, **kwargs):
        raise AssertionError("requests.get ei tohiks parsimatu sisendi puhul üldse kutsutud saada: {}".format(url))

    monkeypatch.setattr(client.requests, "get", kukkuv_get)
    with pytest.raises(client.AdaViga) as exc:
        client.lookup("mingi jama")
    assert "handle" in exc.value.kasutaja_sonum.lower()


# --- lookup ---

class FakeVastus:
    def __init__(self, data, status=200):
        self._data = data
        self.status_code = status

    def json(self):
        return self._data

    @property
    def ok(self):
        return self.status_code == 200


@pytest.fixture
def fake_ada(monkeypatch):
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))
    bitstreams = json.loads((FIXTURES / "bitstreams.json").read_text(encoding="utf-8"))

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/core/items/" in url and "/bundles" not in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        if "/bitstreams" in url:
            return FakeVastus(bitstreams)
        raise AssertionError("ootamatu URL: {}".format(url))

    monkeypatch.setattr(client.requests, "get", fake_get)


def test_lookup_tagastab_65_faili(fake_ada):
    tulemus = client.lookup("10062/7822")
    assert len(tulemus["failid"]) == 65
    assert tulemus["kogu_baite"] > 300_000_000


def test_lookup_failid_on_kronoloogilises_jarjekorras(fake_ada):
    nimed = [f["name"] for f in client.lookup("10062/7822")["failid"]]
    assert nimed.index("28.12.1816.pdf") < nimed.index("09.01.1823.pdf")


def test_lookup_kannab_metaandmed_kaasa(fake_ada):
    meta = client.lookup("10062/7822")["meta"]
    assert meta["year"] == "1812"
    assert meta["ester_id"] == "b1812728"


@pytest.mark.parametrize("sisend", [
    "5a495195-44c1-463b-a425-643dc4dcf13f",
    "https://dspace.ut.ee/items/5a495195-44c1-463b-a425-643dc4dcf13f",
    "hdl:10062/7822",
])
def test_lookup_handle_on_alati_kanooniline_paljas_kuju(fake_ada, sisend):
    """"handle" väljundis tuleb ADA item'i enda kanoonilisest väljast, mitte
    kutsuja toorest sisendist — muidu saaks sama kirje neli erinevat
    talletatud kuju (ADR 0022)."""
    assert client.lookup(sisend)["handle"] == "10062/7822"


def test_lookup_margib_ebatapse_kuupaevaga_failid(fake_ada):
    failid = client.lookup("10062/7822")["failid"]
    ebatapsed = {f["name"] for f in failid if f["tapsus"] > 0}
    assert ebatapsed == {"1813.pdf", "11.1815.pdf", "9997.pdf", "9998.pdf", "9999.pdf"}


def test_lookup_votab_ainult_original_kimbu(fake_ada, monkeypatch):
    """LICENSE / TEXT / THUMBNAIL ei tohi kunagi lehtedeks saada."""
    kutsutud = []
    paris_get = client.requests.get

    def spioon(url, **kwargs):
        kutsutud.append(url)
        return paris_get(url, **kwargs)

    monkeypatch.setattr(client.requests, "get", spioon)
    client.lookup("10062/7822")
    # ORIGINAL kimbu uuid näitekirjest; ühtki teist bundle-bitstreams päringut ei tehta
    bitstream_paringud = [u for u in kutsutud if "/bitstreams" in u]
    assert len(bitstream_paringud) == 1
    assert "acd9a484-d0a6-43a2-b19f-d8cd2dbde692" in bitstream_paringud[0]


def test_lookup_ilma_pdf_ideta_viskab_vea(monkeypatch):
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        return FakeVastus({"_embedded": {"bitstreams": []}, "page": {"totalElements": 0}})

    monkeypatch.setattr(client.requests, "get", fake_get)
    with pytest.raises(client.AdaViga) as exc:
        client.lookup("10062/7822")
    assert "PDF" in exc.value.kasutaja_sonum


def test_lookup_kaerdatud_leheline_loend_viskab_vea(monkeypatch):
    """DSpace 7 rakendab server-poolset `rest.max-page-size`-i — ?size=1000
    ei ole tõend, et kõik bitstreamid tagastati. Kui `page.totalElements`
    ületab tagastatud loendi pikkust, on nimekiri vaikimisi katkine ja
    peab viskama sõnastatud vea, mitte vaikimisi importima poolik loend.
    """
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))
    # Server ütleb, et kokku on 120 elementi, aga tagastab ainult 2 (nagu
    # rest.max-page-size lõikaks lehe).
    kaerdatud = {
        "_embedded": {"bitstreams": [
            {"name": "01.01.1800.pdf", "uuid": "u1", "sizeBytes": 10},
            {"name": "02.01.1800.pdf", "uuid": "u2", "sizeBytes": 10},
        ]},
        "page": {"size": 100, "totalElements": 120},
    }

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        return FakeVastus(kaerdatud)

    monkeypatch.setattr(client.requests, "get", fake_get)
    with pytest.raises(client.AdaViga) as exc:
        client.lookup("10062/7822")
    sonum = exc.value.kasutaja_sonum
    assert "120" in sonum
    assert "2" in sonum


def test_lookup_404_annab_koneka_vea(monkeypatch):
    monkeypatch.setattr(client.requests, "get", lambda url, **k: FakeVastus({}, status=404))
    with pytest.raises(client.AdaViga) as exc:
        client.lookup("10062/9999999")
    assert "ei ole" in exc.value.kasutaja_sonum.lower()


def test_lookup_jatab_mitte_pdf_id_vahele(monkeypatch):
    item = json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))
    bundles = json.loads((FIXTURES / "bundles.json").read_text(encoding="utf-8"))
    segu = {"_embedded": {"bitstreams": [
        {"name": "01.01.1800.pdf", "uuid": "u1", "sizeBytes": 10},
        {"name": "skann.tif", "uuid": "u2", "sizeBytes": 20},
    ]}, "page": {"totalElements": 2}}

    def fake_get(url, **kwargs):
        if "/pid/find" in url:
            return FakeVastus(item)
        if "/bundles" in url and "/bundles/" not in url:
            return FakeVastus(bundles)
        return FakeVastus(segu)

    monkeypatch.setattr(client.requests, "get", fake_get)
    tulemus = client.lookup("10062/7822")
    assert [f["name"] for f in tulemus["failid"]] == ["01.01.1800.pdf"]
    assert tulemus["vahele_jaetud"] == ["skann.tif"]


# --- lookup: items-URL ja paljas UUID (Correction B) ---

def test_lookup_items_url_annab_sama_tulemuse(fake_ada, monkeypatch):
    """Admin kleebib sageli aadressiriba /items/{uuid} kuju — pid/find-i EI kutsuta."""
    kutsutud = []
    paris_get = client.requests.get

    def spioon(url, **kwargs):
        kutsutud.append(url)
        return paris_get(url, **kwargs)

    monkeypatch.setattr(client.requests, "get", spioon)
    tulemus = client.lookup("https://dspace.ut.ee/items/5a495195-44c1-463b-a425-643dc4dcf13f")
    assert len(tulemus["failid"]) == 65
    assert any("/core/items/5a495195-44c1-463b-a425-643dc4dcf13f" in u for u in kutsutud)
    assert not any("/pid/find" in u for u in kutsutud)


def test_lookup_paljas_uuid_annab_sama_tulemuse(fake_ada, monkeypatch):
    kutsutud = []
    paris_get = client.requests.get

    def spioon(url, **kwargs):
        kutsutud.append(url)
        return paris_get(url, **kwargs)

    monkeypatch.setattr(client.requests, "get", spioon)
    tulemus = client.lookup("5a495195-44c1-463b-a425-643dc4dcf13f")
    assert len(tulemus["failid"]) == 65
    assert any("/core/items/5a495195-44c1-463b-a425-643dc4dcf13f" in u for u in kutsutud)
    assert not any("/pid/find" in u for u in kutsutud)
