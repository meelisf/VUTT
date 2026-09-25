"""Wikidata kalendrimärgend jõuab kaardi `calendar` väljale (2026-09-25).

Kristiina (Q52937) lisamisel jäi kaardile `calendar: null`, kuigi Wikidata
surmakuupäev kannab Juliuse märgendit — rikastus ei lugenud `calendarmodel`-it.
Gregoriuse märgendit EI kanta: Wikidata UI paneb selle 1582. järel vaikimisi
(Kristiina sünd 1626-12-07 on Juliuse kuupäev Gregoriuse märgendiga).
"""
import json
from pathlib import Path

import pytest

from server.prosopography import auto_enrich as ae
from server.prosopography import enrichment

JULIAN = "http://www.wikidata.org/entity/Q1985786"
GREGORIAN = "http://www.wikidata.org/entity/Q1985727"

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wikidata" / "Q1698324_entity.json")
    .read_text(encoding="utf-8"))


def _entity(birth_model, death_model):
    ent = json.loads(json.dumps(FIXTURE))
    ent["claims"]["P569"][0]["mainsnak"]["datavalue"]["value"]["calendarmodel"] = birth_model
    ent["claims"]["P570"][0]["mainsnak"]["datavalue"]["value"]["calendarmodel"] = death_model
    return ent


@pytest.fixture
def wikidata(monkeypatch):
    olek = {"entity": FIXTURE}
    monkeypatch.setattr(enrichment, "_wd_entity", lambda qid: olek["entity"])
    monkeypatch.setattr(enrichment, "_wd_labels", lambda ids: {})
    return olek


def test_juliuse_margend_kantakse_gregoriuse_oma_mitte(wikidata):
    wikidata["entity"] = _entity(GREGORIAN, JULIAN)
    r = enrichment._fetch_wikidata("Q1698324")
    assert "birth.calendar" not in r
    assert r["death.calendar"] == "julian"


def test_diff_pakub_kalendrit_koos_tuhja_kuupaevaga(wikidata):
    wikidata["entity"] = _entity(GREGORIAN, JULIAN)
    d = enrichment.fetch_and_diff("wikidata", "Q1698324", {"death": {"date": None}})
    assert d["auto_filled"]["death.calendar"] == "julian"


def test_diff_pakub_kalendrit_sama_kuupaeva_juurde(wikidata):
    wikidata["entity"] = _entity(GREGORIAN, JULIAN)
    d = enrichment.fetch_and_diff("wikidata", "Q1698324", {"death": {"date": "1679-03-26"}})
    assert d["auto_filled"]["death.calendar"] == "julian"
    assert "death.date" not in d["auto_filled"]


def test_diff_ei_seo_kalendrit_teise_kuupaevaga(wikidata):
    """Kaardil on teine kuupäev → allika kalender kinnitaks kuupäeva, mida ta ei väitnud."""
    wikidata["entity"] = _entity(GREGORIAN, JULIAN)
    d = enrichment.fetch_and_diff(
        "wikidata", "Q1698324", {"death": {"date": "1679-04-05", "calendar": "gregorian"}})
    assert "death.calendar" not in d["auto_filled"]
    assert all(c["field"] != "death.calendar" for c in d["conflicts"])
    assert any(c["field"] == "death.date" for c in d["conflicts"])


def src(scheme, **remote):
    return {"scheme": scheme, "id": "x", "remote": remote}


def test_automaatrikastus_kannab_kalendri_kaardile():
    agg = ae.aggregate([src("wikidata", **{
        "death.date": "1689-04-09", "death.precision": "day", "death.calendar": "julian"})])
    card = {"death": {"date": None, "calendar": None}}
    applied = ae.apply_to_card(card, agg)
    assert card["death"]["calendar"] == "julian"
    assert "death.calendar" in applied


def test_koondamine_ei_seo_kalendrit_teise_allika_tapsema_kuupaevaga():
    """WD aasta (Juliuse) + GND päev: päev ei ole Juliuse väide."""
    agg = ae.aggregate([
        src("wikidata", **{"birth.date": "1626", "birth.precision": "year", "birth.calendar": "julian"}),
        src("gnd", **{"birth.date": "1626-12-18", "birth.precision": "day"})])
    assert agg["fields"]["birth"] == {"date": "1626-12-18", "precision": "day"}


@pytest.mark.parametrize("wd_ees", [True, False])
def test_koondamine_hoiab_kalendri_identse_kuupaeva_korral(wd_ees):
    """Allikate järjekord ei tohi määrata, kas märgend jääb alles."""
    allikad = [
        src("gnd", **{"death.date": "1689-04-09", "death.precision": "day"}),
        src("wikidata", **{"death.date": "1689-04-09", "death.precision": "day",
                           "death.calendar": "julian"})]
    agg = ae.aggregate(allikad[::-1] if wd_ees else allikad)
    assert agg["fields"]["death"]["calendar"] == "julian"


def test_kasitsi_margitud_kalendrit_ei_kirjutata_ule():
    agg = ae.aggregate([src("wikidata", **{
        "death.date": "1689-04-09", "death.precision": "day", "death.calendar": "julian"})])
    card = {"death": {"date": None, "calendar": "gregorian"}}
    ae.apply_to_card(card, agg)
    assert card["death"]["calendar"] == "gregorian"
