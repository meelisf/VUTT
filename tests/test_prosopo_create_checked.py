"""Isiku loomine ühe sammuga (spekk §4.2)."""
import pytest

from server.prosopography import person_crud
from server.prosopography.person_crud import IdentifierConflict


@pytest.fixture
def ajastatud(monkeypatch):
    jarjekord = []
    person_crud.set_enrichment_scheduler(jarjekord.append)
    yield jarjekord
    person_crud.set_enrichment_scheduler(lambda pid: None)


@pytest.fixture(autouse=True)
def sarnasusteta(monkeypatch):
    monkeypatch.setattr(person_crud, "_has_similar_name", lambda label, exclude=None: False)


def test_paneeli_loomine_margiga_ja_ajastatud(prosopo_env, ajastatud):
    p = person_crud.create_person_checked(
        username="u", created_via="picker", name="Laurentius Ludenius",
        identifiers=[{"scheme": "wikidata", "id": "Q1870103"}], aliases=["Lorenz Luden"],
        context={"work_id": "w1", "role": "praeses"})
    assert p["name"]["label"] == "Laurentius Ludenius"
    assert p["name"]["aliases"] == ["Lorenz Luden"]
    assert p["review"]["reasons"] == ["enrich_pending"]
    assert p["review"]["context"] == {"work_id": "w1", "role": "praeses"}
    assert ajastatud == [p["id"]]


def test_allikata_loomine_no_source_ja_ei_ajastata(prosopo_env, ajastatud):
    p = person_crud.create_person_checked(username="u", created_via="picker",
                                          name="Andreas Malmenius", note="respondent 1645")
    assert p["review"]["reasons"] == ["no_source"] and p["notes"] == "respondent 1645"
    assert ajastatud == []


def test_vormi_card_uhe_sammuga_ja_serveriväljad_maha(prosopo_env, ajastatud):
    p = person_crud.create_person_checked(username="u", created_via="form", card={
        "name": {"label": "X", "aliases": []}, "gender": "M", "notes": "n",
        "identifiers": [{"scheme": "gnd", "id": "GND:5"}],
        "review": {"state": "done"}, "id": "vutt:Phack", "created_by": "keegi",
        "updated_at": "1999-01-01T00:00:00+00:00", "updated_by": "keegi"})
    kaart = prosopo_env.read(p["id"].removeprefix("vutt:P"))
    assert kaart["gender"] == "M" and kaart["identifiers"][0]["id"] == "5"
    assert kaart["review"]["state"] == "pending" and kaart["created_by"] == "u"
    assert p["id"] != "vutt:Phack"
    assert kaart["updated_by"] == "u"
    assert kaart["updated_at"] != "1999-01-01T00:00:00+00:00"


def test_card_vigane_kuju_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="invalid_card"):
        person_crud.create_person_checked(username="u", created_via="form", card="x")


def test_card_nimi_stringina_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="invalid_card"):
        person_crud.create_person_checked(username="u", created_via="form",
                                          card={"name": "X"})


def test_identifiers_vigane_kuju_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="invalid_identifiers"):
        person_crud.create_person_checked(username="u", created_via="picker", name="X",
                                          identifiers="Q1")


def test_aliases_vigane_kuju_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="invalid_aliases"):
        person_crud.create_person_checked(username="u", created_via="picker", name="X",
                                          aliases=[["a"]])


def test_card_identifiers_vigane_kuju_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="invalid_identifiers"):
        person_crud.create_person_checked(username="u", created_via="form", card={
            "name": {"label": "X"}, "identifiers": "Q1"})


def test_route_400_vigane_card(client, login, prosopo_env):
    token = login("editor", "editorpass")
    r = client.post("/prosopography/persons/create",
                     json={"card": {"name": "X"}, "created_via": "form"},
                     headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_card_nimi_tuhjaks_trimmitud_on_name_required(prosopo_env):
    with pytest.raises(ValueError, match="name_required"):
        person_crud.create_person_checked(username="u", created_via="form",
                                          card={"name": {"label": "   "}})


def test_card_ja_tipuvali_korraga_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="card_and_fields"):
        person_crud.create_person_checked(username="u", created_via="form",
                                          card={"name": {"label": "X"}}, name="Y")


def test_normaliseerimata_olemasolev_id_on_exists(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "123"}])
    with pytest.raises(IdentifierConflict) as e:
        person_crud.create_person_checked(username="u", created_via="picker", name="X",
                                          identifiers=[{"scheme": "gnd", "id": "GND:123"}])
    assert (e.value.kind, e.value.person_ids) == ("exists", ["vutt:Paaa"])


def test_id_ainult_card_is_kontrollitakse_samuti(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    with pytest.raises(IdentifierConflict):
        person_crud.create_person_checked(username="u", created_via="form", card={
            "name": {"label": "X"}, "identifiers": [{"scheme": "wikidata", "id": "Q1"}]})


def test_split_kui_id_d_eri_kaartidel(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    prosopo_env.write("bbb", identifiers=[{"scheme": "gnd", "id": "2"}])
    with pytest.raises(IdentifierConflict) as e:
        person_crud.create_person_checked(username="u", created_via="picker", name="X",
            identifiers=[{"scheme": "wikidata", "id": "Q1"}, {"scheme": "gnd", "id": "2"}])
    assert e.value.kind == "split" and set(e.value.person_ids) == {"vutt:Paaa", "vutt:Pbbb"}


def test_sarnane_nimi_lisab_possible_duplicate(prosopo_env, monkeypatch):
    monkeypatch.setattr(person_crud, "_has_similar_name", lambda label, exclude=None: True)
    p = person_crud.create_person_checked(username="u", created_via="picker", name="X")
    assert p["review"]["reasons"] == ["no_source", "possible_duplicate"]


def test_route_409_exists(client, login, prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "123"}])
    token = login("editor", "editorpass")
    r = client.post("/prosopography/persons/create", json={
        "name": "X", "identifiers": [{"scheme": "gnd", "id": "123"}], "created_via": "picker"},
        headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409
    assert r.json()["detail"]["existing_person_id"] == "vutt:Paaa"
