# tests/test_person_network.py
"""build_person_network (#461): servad, invariandid, pereseosed, kogu, restricted."""
import json
from unittest import mock

import pytest

from server.prosopography import ops
from server.prosopography import work_relations_ops as wro

F, P, R, G, S, T = ("vutt:Pfocus", "vutt:Ppraes", "vutt:Presp", "vutt:Pgrat", "vutt:Psubj", "vutt:Pprint")
COLLECTIONS = {"agc": {"visibility": "public"}, "agc-sub": {"parent": "agc", "visibility": "public"},
               "salajane": {"visibility": "restricted"}}


@pytest.fixture
def net(tmp_path, monkeypatch, prosopo_env):
    """ptw + teoste faktid + kogud + indeks tmp-is; kaardid prosopo_env-is."""
    ptw = {
        F: [{"work_id": "w1", "role": "respondens"}, {"work_id": "w2", "role": "subject"},
            {"work_id": "w3", "role": "mentioned", "pages": [2]}, {"work_id": "w4", "role": "gratulator"},
            {"work_id": "w4", "role": "aui"}, {"work_id": "gone", "role": "auctor"}],
        P: [{"work_id": "w1", "role": "praeses"}, {"work_id": "w3", "role": "praeses"}],
        G: [{"work_id": "w2", "role": "auctor"}, {"work_id": "w4", "role": "gratulator"}],
        T: [{"work_id": "w1", "role": "publisher"}],
    }
    facts = {
        "w1": {"title": "Disputatio", "year": 1658, "creators": [], "location": {"id": "Q435295", "label": "Altdorf"}, "genres": ["disputatsioon"]},
        "w2": {"title": "Programma", "year": 1659, "creators": [], "location": None, "genres": []},
        "w3": {"title": "Salajane", "year": None, "creators": [], "location": {"id": "Q13972", "label": "Tartu"}, "genres": []},
        "w4": {"title": "Oratio", "year": 1660, "creators": [], "location": None, "genres": []},
    }
    wc = {"w1": ["agc-sub"], "w3": ["salajane"], "w4": ["agc"]}
    idx = {"entries": [
        {"id": F, "label": "Fookus", "birth_year": 1636, "death_year": 1705, "origin_place": "Lübeck",
         "origin_place_id": "Q2843", "origin_coordinates": {"lat": 53.87, "lon": 10.69}},
        {"id": P, "label": "Praeses"}, {"id": G, "label": "Gratulant"}, {"id": T, "label": "Trükkal"},
    ]}
    for name, data in (("ptw.json", ptw), ("wci.json", facts), ("wc.json", wc), ("idx.json", idx)):
        (tmp_path / name).write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json"))
    monkeypatch.setattr(ops, "WORK_COLLECTIONS_INDEX_FILE", str(tmp_path / "wc.json"))
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_INDEX_FILE", str(tmp_path / "idx.json"))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    prosopo_env.write("focus")
    prosopo_env.write("praes")
    prosopo_env.write("grat")
    prosopo_env.write("print")
    with mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS), \
         mock.patch("server.access_ops.get_cached_collections", return_value=COLLECTIONS):
        yield prosopo_env


def _build(*a, **kw):
    from server.prosopography.network import build_person_network
    return build_person_network(*a, **kw)


def _edges(res, other):
    return [e for e in res["edges"] if other in (e["from"], e["to"])]


def test_tundmatu_isik_annab_none(net):
    assert _build("vutt:Pmissing") is None


def test_seosteta_isik_annab_tuhjad_loendid(net):
    net.write("lonely")
    res = _build("vutt:Plonely")
    assert res["persons"] == [] and res["edges"] == [] and res["works"] == []


def test_invariandid(net):
    res = _build(F)
    ids = {p["id"] for p in res["persons"]}
    works = {w["work_id"] for w in res["works"]}
    assert F not in ids
    for e in res["edges"]:
        assert F in (e["from"], e["to"])
        assert ({e["from"], e["to"]} - {F}) <= ids
        if e["evidence"]:
            assert e["evidence"]["work_id"] in works
    assert "gone" not in works          # ptw-s, aga faktid puuduvad → vahele


def test_liigid_ja_suunad(net):
    res = _build(F)
    (disp,) = [e for e in _edges(res, P) if e["evidence"]["work_id"] == "w1"]
    assert (disp["kind"], disp["from"], disp["to"], disp["directed"]) == ("academic", P, F, True)
    (ded,) = [e for e in _edges(res, G) if e["evidence"]["work_id"] == "w2"]
    assert (ded["kind"], ded["from"], ded["to"]) == ("dedicated", G, F)
    (men,) = [e for e in _edges(res, P) if e["evidence"]["work_id"] == "w3"]
    assert men["kind"] == "mention" and men["evidence"]["pages"] == [2]
    (prn,) = _edges(res, T)
    assert prn["kind"] == "printer"


def test_mitu_rolli_samas_teoses_uks_serv(net):
    res = _build(F)
    w4 = [e for e in _edges(res, G) if e["evidence"]["work_id"] == "w4"]
    assert len(w4) == 1
    assert sorted(w4[0]["roles"][F]) == ["aui", "gratulator"]
    assert w4[0]["kind"] == "cotext"


def test_teose_faktid_ja_restricted(net):
    res = _build(F)
    w = {x["work_id"]: x for x in res["works"]}
    assert w["w3"]["restricted"] is True and w["w3"]["title"] == "Salajane"
    assert w["w1"]["restricted"] is False
    assert w["w1"]["place"]["label"] == "Altdorf"
    disp = [e for e in _edges(res, P) if e["evidence"]["work_id"] == "w1"][0]
    assert disp["place"] == {"id": "Q435295", "kind": "print"} and disp["year"] == 1658


def test_kogu_filter_alamkogudega(net):
    res = _build(F, collection="agc")
    got = {e["evidence"]["work_id"] for e in res["edges"] if e["evidence"]}
    assert got == {"w1", "w4"}          # w1 on alamkogus agc-sub; w2/w3 välja


def test_pereseosed_mõlemast_suunast_uks_serv(net):
    net.write("focus", relations=[{"target_id": "vutt:Pfam", "type": "isa"}])
    net.write("fam", relations=[{"target_id": F, "type": "poeg"}])
    net.write("other", relations=[{"target_id": F, "type": "vend"}])
    net.write("dead", record_status="tombstone", relations=[{"target_id": F, "type": "x"}])
    res = _build(F)
    fam = [e for e in res["edges"] if e["kind"] == "family"]
    by_other = {({e["from"], e["to"]} - {F}).pop(): e for e in fam}
    assert set(by_other) == {"vutt:Pfam", "vutt:Pother"}
    recs = by_other["vutt:Pfam"]["records"]
    assert {(r["source_id"], r["type"]) for r in recs} == {(F, "isa"), ("vutt:Pfam", "poeg")}
    assert by_other["vutt:Pfam"]["directed"] is False and by_other["vutt:Pfam"]["evidence"] is None


def test_pereserv_summeetriline(net):
    net.write("focus", relations=[{"target_id": "vutt:Pfam", "type": "isa"}])
    net.write("fam", relations=[{"target_id": F, "type": "poeg"}])
    a = [e for e in _build(F)["edges"] if e["kind"] == "family"][0]
    b = [e for e in _build("vutt:Pfam")["edges"] if e["kind"] == "family"][0]
    assert (a["from"], a["to"], sorted(map(str, a["records"]))) == (b["from"], b["to"], sorted(map(str, b["records"])))


def test_fookus_ise_ei_tule_persons_isse(net):
    """Fookus mitmes rollis samas teoses (w4: aui + gratulator) ei tee iseendaga serva."""
    res = _build(F)
    assert all(F != p["id"] for p in res["persons"])
    assert all(not (e["from"] == F and e["to"] == F) for e in res["edges"])


# ── Endpoint ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(net):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.prosopography import router as prosopography
    app = FastAPI()
    app.include_router(prosopography.router, prefix="/prosopography")
    return TestClient(app)


def test_endpoint_on_sync():
    import asyncio
    from server.prosopography import router as prosopography
    assert not asyncio.iscoroutinefunction(prosopography.prosopography_network)


def test_endpoint_vastus_ja_404(client):
    r = client.get(f"/prosopography/{F}/network")
    assert r.status_code == 200
    body = r.json()
    assert body["focus"]["id"] == F and {"persons", "works", "edges"} <= body.keys()
    assert client.get("/prosopography/vutt:Pmissing/network").status_code == 404


def test_endpoint_kogu_parameeter(client):
    body = client.get(f"/prosopography/{F}/network", params={"collection": "agc"}).json()
    assert {e["evidence"]["work_id"] for e in body["edges"] if e["evidence"]} == {"w1", "w4"}


def test_network_tee_ei_satu_isiku_route_i(client):
    """Üldine /{person_id:path} ei tohi neelata …/network teed isiku-ID-na."""
    r = client.get(f"/prosopography/{F}/network")
    assert "edges" in r.json()


# ── Üks tõde: /persons seoste kaart ──────────────────────────────────────────

def _expected_ids(collection=None):
    res = _build(F, collection=collection)
    non_printer = {x for e in res["edges"] if e["kind"] != "printer" for x in (e["from"], e["to"])} - {F}
    return {F} | non_printer


@pytest.mark.parametrize("collection", [None, "agc", "agc-sub"])
def test_id_hulk_enne_koordinaadifiltrit(net, collection):
    from server.prosopography.relations import get_person_relation_network_ids
    ids = get_person_relation_network_ids(F, collection=collection)
    assert ids[0] == F
    assert set(ids) == _expected_ids(collection)
    assert T not in ids                      # ainult trükkal → väljas


@pytest.mark.parametrize("collection", [None, "agc"])
def test_markerid_on_koordinaadiga_osa(net, collection):
    res = ops.get_person_map_markers(related_to=F, collection=collection)
    mapped = {p["id"] for m in res["markers"] for p in m["persons"]}
    expected = _expected_ids(collection)
    if collection:
        # Fookus jääb piiratud kaardile ainult kogu liikmena (#460 vihje)
        from server.prosopography.indices import _persons_in_collection
        if F not in _persons_in_collection(collection):
            expected = expected - {F}
    with_coords = {e["id"] for e in json.loads(open(ops.PROSOPOGRAPHY_INDEX_FILE).read())["entries"]
                   if e.get("origin_coordinates")}
    assert mapped == expected & with_coords
    assert res["without_coordinates"] == len(expected - with_coords)


def test_pereliige_jaab_kogu_kaardile_ilma_teoseta_kogus(net, tmp_path):
    """Arvustuse I2: kogu filtreerib ühiseid teoseid, mitte isikuid. Pereliige, kellel
    pole ühtki teost kogus, jääb related_to + collection kaardile (vana
    _persons_in_collection oleks ta eemaldanud)."""
    net.write("focus", relations=[{"target_id": "vutt:Pfam", "type": "isa"}])
    net.write("fam")
    idx = json.loads(open(ops.PROSOPOGRAPHY_INDEX_FILE).read())
    idx["entries"].append({"id": "vutt:Pfam", "label": "Isa", "origin_place": "Riga",
                           "origin_coordinates": {"lat": 56.95, "lon": 24.1}})
    open(ops.PROSOPOGRAPHY_INDEX_FILE, "w").write(json.dumps(idx))
    res = ops.get_person_map_markers(related_to=F, collection="agc")
    mapped = {p["id"] for m in res["markers"] for p in m["persons"]}
    assert "vutt:Pfam" in mapped


def test_pereseoste_poordkaart_ei_loe_kaarte_igal_paringul(net, monkeypatch):
    """Arvustuse I3: avalik endpoint ei tohi igal päringul parsida kõiki ~2350 kaarti.
    Muutunud kaart peab aga kohe mõjuma."""
    from server.prosopography import network
    net.write("fam", relations=[{"target_id": F, "type": "poeg"}])
    loads = []
    real = network.json.load
    card_dir = str(net.dir)

    def counting_load(f, *a, **k):
        # network.json on globaalne json-moodul — loe ainult isikukaartide faile
        if str(getattr(f, "name", "")).startswith(card_dir):
            loads.append(1)
        return real(f, *a, **k)
    monkeypatch.setattr(network.json, "load", counting_load)
    _build(F)
    first = len(loads)
    assert first > 0
    _build(F)
    # Teine päring loeb ainult sihipäraselt fookuse ja indeksita pereliikme kaardi
    # (get_person), mitte kõiki kaarte uuesti.
    assert len(loads) - first == 2
    net.write("other", relations=[{"target_id": F, "type": "vend"}])
    res = _build(F)
    assert len(loads) > first                   # uus kaart → kaart ehitatakse uuesti
    fam = {({e["from"], e["to"]} - {F}).pop() for e in res["edges"] if e["kind"] == "family"}
    assert fam == {"vutt:Pfam", "vutt:Pother"}
