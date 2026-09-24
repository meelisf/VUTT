"""Väline ID ei tohi sattuda kahele kaardile ühegi kirjutustee kaudu (spekk §4.6)."""
import pytest

from server.prosopography import person_crud
from server.prosopography.person_crud import IdentifierConflict


@pytest.fixture(autouse=True)
def vorguta(monkeypatch):
    monkeypatch.setattr("server.prosopography.enrichment.fetch_and_diff",
                        lambda *a, **k: {"auto_filled": {}, "conflicts": []})


def test_add_identifier_teise_kaardi_id_ga_on_konflikt(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "123"}])
    prosopo_env.write("bbb")
    with pytest.raises(IdentifierConflict) as e:
        person_crud.add_identifier("vutt:Pbbb", "gnd", "GND:123", "u")
    assert (e.value.kind, e.value.person_ids) == ("exists", ["vutt:Paaa"])
    assert prosopo_env.read("bbb")["identifiers"] == []


def test_update_person_lisatud_id_teiselt_kaardilt_on_konflikt(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    b = prosopo_env.write("bbb")
    with pytest.raises(IdentifierConflict):
        person_crud.update_person("vutt:Pbbb", {
            "identifiers": [{"scheme": "wikidata", "id": "Q1"}],
            "updated_at": b["updated_at"]}, "u")


def test_parandduplikaat_ei_blokeeri_salvestust(prosopo_env):
    """Tootmises on ~52 AA-d kahel kaardil: muutmata ID-dega salvestus peab läbi minema."""
    prosopo_env.write("aaa", identifiers=[{"scheme": "album_academicum", "id": "AA:1"}])
    b = prosopo_env.write("bbb", identifiers=[{"scheme": "album_academicum", "id": "AA:1"}])
    uus = person_crud.update_person("vutt:Pbbb", {
        "notes": "x", "identifiers": b["identifiers"], "updated_at": b["updated_at"]}, "u")
    assert uus["notes"] == "x"


def test_liidetud_kaardi_id_omanik_on_sihtkaart(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "9"}],
                      record_status="tombstone", merged_into="vutt:Pccc")
    prosopo_env.write("ccc", identifiers=[{"scheme": "gnd", "id": "9"}])
    prosopo_env.write("bbb")
    with pytest.raises(IdentifierConflict) as e:
        person_crud.add_identifier("vutt:Pbbb", "gnd", "9", "u")
    assert e.value.person_ids == ["vutt:Pccc"]


def test_restore_ei_too_tagasi_teisele_kaardile_laeinud_id(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "5"}])
    b = prosopo_env.write("bbb")
    vana = {**b, "identifiers": [{"scheme": "gnd", "id": "5"}]}
    with pytest.raises(IdentifierConflict):
        person_crud.restore_person("vutt:Pbbb", vana, "admin")


def test_add_identifier_ei_tee_vorgupaeringut_luku_all(prosopo_env, monkeypatch):
    from server.prosopography.locks import ext_id_claim_lock, person_lock
    prosopo_env.write("aaa")
    nahtud = {}

    def fetch(*a, **k):
        nahtud["person_vaba"] = person_lock("vutt:Paaa").acquire(blocking=False)
        if nahtud["person_vaba"]:
            person_lock("vutt:Paaa").release()
        nahtud["claim_vaba"] = ext_id_claim_lock.acquire(blocking=False)
        if nahtud["claim_vaba"]:
            ext_id_claim_lock.release()
        return {"auto_filled": {}, "conflicts": []}

    monkeypatch.setattr("server.prosopography.enrichment.fetch_and_diff", fetch)
    person_crud.add_identifier("vutt:Paaa", "gnd", "7", "u")
    assert nahtud == {"person_vaba": True, "claim_vaba": True}
