"""Metaandmete salvestuse/impordi stub'id saavad märke ja rikastuse (spekk §4.4)."""
import pytest

from server.prosopography import person_crud


@pytest.fixture
def ajastatud():
    j = []
    person_crud.set_enrichment_scheduler(j.append)
    yield j
    person_crud.set_enrichment_scheduler(lambda pid: None)


@pytest.fixture(autouse=True)
def sarnasusteta(monkeypatch):
    monkeypatch.setattr(person_crud, "_has_similar_name", lambda label, exclude=None: False)


def test_stub_saab_margi_konteksti_ja_ei_tee_voorku(prosopo_env, ajastatud, monkeypatch):
    monkeypatch.setattr("server.prosopography.enrichment.fetch_remote",
                        lambda *a: pytest.fail("stub-tee ei tohi sünkroonselt võrku minna"))
    out = person_crud.ensure_prosopo_stubs(
        {"creators": [{"id": "Q1870103", "label": "Lorenz Luden", "source": "wikidata", "role": "praeses"}]},
        "u", work_id="w1")
    pid = out["creators"][0]["id"]
    kaart = prosopo_env.read(pid.removeprefix("vutt:P"))
    assert kaart["review"]["created_via"] == "server_stub"
    assert kaart["review"]["context"] == {"work_id": "w1", "role": "praeses"}
    assert ajastatud == [pid]


def test_olemasolev_id_seotakse_ilma_uue_kaardita(prosopo_env, ajastatud):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "5"}])
    out = person_crud.ensure_prosopo_for_entity({"id": "GND:5", "label": "X", "source": "gnd"}, "u")
    assert out["id"] == "vutt:Paaa" and ajastatud == []
