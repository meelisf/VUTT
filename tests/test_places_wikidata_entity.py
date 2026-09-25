"""Koha Wikidata-päring loeb entity API-t, mitte SPARQL-i (#427).

`fetch_place_wikidata` tegi ühe päringu avalikku SPARQL-teenusesse (WDQS) —
sama tee, mis andis isikute rikastusel 499 (#415). Automaatne kohalisamine
sünnikohast (#427) kutsub seda taustatöös, seega peab päring olema kiire.

Väljundi kuju peab jääma samaks — `AddPlaceModal` ja `refresh_all_place_labels`
sõltuvad sellest. Oodatud väärtused on vana SPARQL-tee päris väljund Tartu
(Q13972) kohta 2026-09-25.
"""
import json
from pathlib import Path

import pytest
from fastapi import HTTPException

from server.prosopography import places_ops, router

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wikidata" / "Q13972_place_entity.json")
    .read_text(encoding="utf-8"))

SILDID = {
    "Q42307965": {"en": "Tartu City", "sv": "Tartu linn"},
}


@pytest.fixture
def wikidata(monkeypatch):
    """Asendab võrgu: entity ja sildid tulevad sõnastikest."""
    olek = {"entity": json.loads(json.dumps(FIXTURE)), "sildid": SILDID, "paringud": []}

    monkeypatch.setattr(places_ops, "_wd_entity", lambda qid: olek["entity"])

    def sildid(ids, langs):
        olek["paringud"].append((list(ids), tuple(langs)))
        if olek["sildid"] is None:
            return None
        return {i: olek["sildid"][i] for i in ids if i in olek["sildid"]}

    monkeypatch.setattr(places_ops, "_wd_labels", sildid)
    return olek


def test_valjund_vastab_vana_sparql_tee_kujule(wikidata):
    assert places_ops.fetch_place_wikidata("Q13972") == {
        "labels": {"et": "Tartu", "en": "Tartu", "de": "Tartu", "la": "Tarbatum", "sv": "Tartu"},
        "type": None,
        "coordinates": {"lat": 58.38, "lon": 26.7225,
                        "source": "wikidata", "wikidata_property": "P625"},
        # Fikstuuris on neli P131-t, üks neist `preferred` — `wdt:` andis ainult selle.
        "parents": [{"q": "Q42307965", "label_en": "Tartu City", "label_sv": "Tartu linn"}],
    }


def test_tuup_on_esimene_tuntud_p31(wikidata):
    p31 = wikidata["entity"]["claims"]["P31"]
    lisa = json.loads(json.dumps(p31[0]))
    lisa["mainsnak"]["datavalue"]["value"] = {"entity-type": "item", "id": "Q515"}
    p31.append(lisa)
    assert places_ops.fetch_place_wikidata("Q13972")["type"] == "city"


def test_deprecated_ulemuksus_jaetakse_valja(wikidata):
    p131 = wikidata["entity"]["claims"]["P131"]
    for c in p131:
        c["rank"] = "deprecated" if c["rank"] == "preferred" else "normal"
    wikidata["sildid"] = {}
    parents = places_ops.fetch_place_wikidata("Q13972")["parents"]
    assert "Q42307965" not in {p["q"] for p in parents}
    assert len(parents) == 3


def test_ulemuksuse_silt_varuvariandid(wikidata):
    """Rootsi puudub → inglise; inglise puudub → `mul`; kumbki puudub → Q-kood.

    Vana SPARQL jättis ingliskeelse sildita ülemüksuse üldse välja.
    """
    p131 = wikidata["entity"]["claims"]["P131"]
    for c in p131:
        c["rank"] = "normal"
    wikidata["sildid"] = {
        "Q634648": {"en": "Tartu County"},
        "Q42307965": {"mul": "Tartu linn"},
    }
    parents = {p["q"]: p for p in places_ops.fetch_place_wikidata("Q13972")["parents"]}
    assert parents["Q634648"] == {"q": "Q634648", "label_en": "Tartu County", "label_sv": "Tartu County"}
    assert parents["Q42307965"]["label_en"] == "Tartu linn"
    assert parents["Q130280"] == {"q": "Q130280", "label_en": "Q130280", "label_sv": "Q130280"}
    assert wikidata["paringud"][0][1] == ("en", "sv", "mul")


def test_siltide_toorge_ei_anna_sildita_ulemuksusi(wikidata):
    wikidata["sildid"] = None
    assert places_ops.fetch_place_wikidata("Q13972") is None


def test_ulemuksusteta_kohal_siltide_paringut_ei_tehta(wikidata):
    del wikidata["entity"]["claims"]["P131"]
    wikidata["sildid"] = None
    assert places_ops.fetch_place_wikidata("Q13972")["parents"] == []
    assert wikidata["paringud"] == []


def test_entity_toorge_on_none(wikidata):
    wikidata["entity"] = None
    assert places_ops.fetch_place_wikidata("Q13972") is None


def test_muu_taevakeha_koordinaadid_jaetakse_valja(wikidata):
    v = wikidata["entity"]["claims"]["P625"][0]["mainsnak"]["datavalue"]["value"]
    v["globe"] = "http://www.wikidata.org/entity/Q405"  # Kuu
    assert places_ops.fetch_place_wikidata("Q13972")["coordinates"] is None


def test_vigane_q_kood_ei_tee_paringut(monkeypatch):
    monkeypatch.setattr(places_ops, "_wd_entity",
                        lambda qid: pytest.fail("päring vigase Q-koodiga"))
    assert places_ops.fetch_place_wikidata("P131") is None
    assert places_ops.fetch_place_wikidata("Qabc") is None


def test_endpoint_eristab_vigast_koodi_paringu_toorkest(monkeypatch):
    """Varem andis Wikidata tõrge 400 „Vigane Q-kood" — admin otsis viga koodist."""
    monkeypatch.setattr(router, "_check_wikidata_rate_limit", lambda request: None)
    monkeypatch.setattr(router, "fetch_place_wikidata", lambda qid: None)

    with pytest.raises(HTTPException) as e:
        router.places_wikidata_fetch("Tartu", request=None)
    assert e.value.status_code == 400

    with pytest.raises(HTTPException) as e:
        router.places_wikidata_fetch("Q13972", request=None)
    assert e.value.status_code == 502
