"""Prosopograafia tööriistade testid.

Vastuste kujud on kontrollitud tootmise API vastu (2026-08-15):
  GET  /prosopography            → {"results": [...], "total", "offset", "limit"}
  GET  /prosopography/{id}       → kaart + "works": [{"work_id", "role"}]
  POST /prosopography/work-titles→ {"titles": {work_id: {...}}}
  GET  /prosopography/work-relations/{id} → LIST, mitte objekt:
       [{"person_id", "person_name", "shared_works_count", "shared_works": [...]}]
"""
import pytest

from vutt_mcp import persons
from vutt_mcp.errors import VuttNotFound

BASE = "https://vutt.utlib.ut.ee"

LIST_RESPONSE = {
    "results": [{
        "id": "vutt:Pfxxxsc",
        "label": "Lorenz Luden",
        "birth_year": 1592,
        "death_year": 1654,
        "gender": "M",
        "work_count": 156,
        "biography_snippet": "Lorenz Luden (ladina keele professor)",
        # Tootmises on need LinkedEntity-objektid, MITTE stringid — vt
        # test_occupations_objektidena. Võltsandmed peavad päris kuju peegeldama.
        "occupations": [
            {"id": "Q1622272", "label": "õppejõud",
             "labels": {"et": "õppejõud", "en": "university teacher"}},
        ],
        "origin_place": "Braunschweig",
    }],
    "total": 1,
    "offset": 0,
    "limit": 10,
}


class FakeClient:
    def __init__(self, get_map=None, post_map=None):
        self.get_map = get_map or {}
        self.post_map = post_map or {}
        self.posts = []
        self.gets = []

    def api_get(self, path, params=None):
        self.gets.append((path, params))
        if path not in self.get_map:
            raise VuttNotFound(f"puudub: {path}")
        return self.get_map[path]

    def api_post(self, path, json_body):
        self.posts.append((path, json_body))
        return self.post_map.get(path, {"titles": {}})


def test_search_naitab_eluaastad_ja_teoste_arvu():
    client = FakeClient({"/prosopography": LIST_RESPONSE})
    out = persons.search(client, BASE, q="Ludenius")
    assert "Lorenz Luden" in out
    assert "1592" in out and "1654" in out
    assert "156" in out
    assert f"{BASE}/persons/vutt:Pfxxxsc" in out


def test_occupations_objektidena():
    """Listingu occupations on {id, label, labels{}} — mitte string.

    Live-test püüdis selle: stringidega võltsandmed lasid vea läbi
    ("sequence item 0: expected str instance, dict found").
    """
    client = FakeClient({"/prosopography": LIST_RESPONSE})
    out = persons.search(client, BASE, q="Ludenius")
    assert "amet=õppejõud" in out


def test_search_jatab_tuhjad_filtrid_paringust_valja():
    client = FakeClient({"/prosopography": LIST_RESPONSE})
    persons.search(client, BASE, q="Luden", gender=None, occupation="")
    _, params = client.gets[0]
    assert params == {"q": "Luden"}


def test_search_tuhi_tulemus():
    client = FakeClient({"/prosopography": {"results": [], "total": 0}})
    assert "ei leitud" in persons.search(client, BASE, q="xyz")


def test_detail_piirab_seotud_teosed_viiekumnega():
    works = [{"work_id": f"w{i}", "role": "auctor"} for i in range(178)]
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "Test"},
                                   "works": works}},
        {"/prosopography/work-titles": {
            "titles": {f"w{i}": {"title": f"Teos {i}"} for i in range(178)}
        }},
    )
    out = persons.detail(client, BASE, "vutt:X", include_relations=False)
    assert "seotud_teoseid: 178" in out
    assert out.count("role=") <= persons.MAX_RELATED_WORKS
    assert "128" in out  # 178 - 50 välja jäetud
    assert "search_works" in out  # suunab ülejäänu juurde


def test_detail_kysib_pealkirju_ainult_naidatavatele():
    works = [{"work_id": f"w{i}", "role": "auctor"} for i in range(178)]
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "T"},
                                   "works": works}},
    )
    persons.detail(client, BASE, "vutt:X", include_relations=False)
    _, body = client.posts[0]
    assert len(body["work_ids"]) == persons.MAX_RELATED_WORKS


def test_detail_markib_kaitstud_kollektsiooni_ilma_lingita():
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "T"},
                                   "works": [{"work_id": "w1", "role": "auctor"}]}},
        {"/prosopography/work-titles": {
            "titles": {"w1": {"title": "Salajane", "restricted": True}}
        }},
    )
    out = persons.detail(client, BASE, "vutt:X", include_relations=False)
    assert "kaitstud kollektsioon" in out
    assert f"{BASE}/work/w1" not in out


def test_detail_ilma_relations_liputa_ei_kysi_seoseid():
    client = FakeClient(
        {"/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "T"},
                                   "works": []}},
    )
    out = persons.detail(client, BASE, "vutt:X", include_relations=False)
    assert "isikuseosed" not in out.lower()
    assert not any("work-relations" in path for path, _ in client.gets)


def test_detail_relations_kasutab_massiivi_vastust():
    """work-relations tagastab LISTI, mitte {"results": [...]}."""
    client = FakeClient({
        "/prosopography/vutt:X": {"id": "vutt:X", "name": {"label": "T"}, "works": []},
        "/prosopography/work-relations/vutt:X": [
            {"person_id": "vutt:P1", "person_name": "Petrus Schonbergius",
             "shared_works_count": 7,
             "shared_works": [{"work_id": "w1", "work_title": "väga pikk pealkiri" * 40}]},
        ],
    })
    out = persons.detail(client, BASE, "vutt:X", include_relations=True)
    assert "Petrus Schonbergius" in out
    assert "7" in out
    # shared_works pealkirju EI dumbata — token-kulu
    assert "väga pikk pealkiri" not in out


def test_detail_tundmatu_id_annab_selge_vea():
    client = FakeClient({})
    with pytest.raises(VuttNotFound) as exc:
        persons.detail(client, BASE, "vutt:puudub", include_relations=False)
    assert "search_persons" in str(exc.value)
