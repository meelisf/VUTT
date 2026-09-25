"""Kandidaadi kokkuvõte isikupaneelile (spekk §4.1).

Kokkuvõte tuleb SAMADEST parseritest kui rikastus — paneel näitab täpselt
seda, mis kaardile hiljem kirjutatakse. Võrk asendatakse.
"""
import json
from pathlib import Path

import pytest

from server.prosopography import candidates, enrichment

WD = json.loads((Path(__file__).parent / "fixtures" / "wikidata" / "Q1698324_entity.json")
                .read_text(encoding="utf-8"))


def test_wikidata_kokkuvote_nimede_keelte_ja_linkidega(monkeypatch):
    entity = {**WD, "labels": {"et": {"value": "Johannes Schefferus"},
                               "sv": {"value": "Johannes Schefferus"}},
              "descriptions": {"en": {"value": "Swedish academic (1621–1679)"}},
              "claims": {**WD["claims"],
                         "P227": [{"rank": "normal", "mainsnak": {"snaktype": "value",
                                   "datavalue": {"value": "118607588"}}}],
                         "P214": [{"rank": "normal", "mainsnak": {"snaktype": "value",
                                   "datavalue": {"value": "32004409"}}}]}}
    monkeypatch.setattr(enrichment, "_wd_entity", lambda q: entity)
    monkeypatch.setattr(enrichment, "_wd_labels",
                        lambda ids: {i: {"et": f"silt {i}"} for i in ids})
    s = candidates.candidate_summary("wikidata", "Q1698324")
    assert s["label"] == "Johannes Schefferus"
    assert any(n["text"] == "Johannes Scheffer" and n["kind"] == "alias" for n in s["names"])
    assert s["names"][0] == {"text": "Johannes Schefferus", "lang": "et", "kind": "label"}
    assert s["description"] == "Swedish academic (1621–1679)"
    assert s["birth"]["date"] == "1621-02-02" and s["birth"]["place"]["id"] == "Q6602"
    assert s["links"] == {"gnd": "118607588", "viaf": "32004409"}
    assert s["url"] == "https://www.wikidata.org/wiki/Q1698324"


def test_gnd_kokkuvote_lobidist(monkeypatch):
    raw = {"preferredName": "Hezel, Wilhelm Friedrich",
           "variantName": ["Hezel, Guilielmus Fridericus"],
           "biographicalOrHistoricalInformation": ["Orientalist, Theologe"],
           "dateOfBirth": ["1754-05-16"], "dateOfDeath": ["1824-06-12"],
           "sameAs": [{"id": "http://www.wikidata.org/entity/Q16405824"},
                      {"id": "http://viaf.org/viaf/34486358"}]}
    monkeypatch.setattr(enrichment, "_fetch_lobid_raw", lambda g: raw)
    s = candidates.candidate_summary("gnd", "116796197")
    assert s["label"] == "Wilhelm Friedrich Hezel"
    assert {"text": "Guilielmus Fridericus Hezel", "lang": None, "kind": "alias"} in s["names"]
    assert s["description"] == "Orientalist, Theologe"
    assert s["birth"]["date"] == "1754-05-16"
    assert s["links"] == {"wikidata": "Q16405824", "viaf": "34486358"}
    assert s["url"] == "https://explore.gnd.network/gnd/116796197"


def test_gnd_varutee_kui_lobid_ei_vasta(monkeypatch):
    monkeypatch.setattr(enrichment, "_fetch_lobid_raw", lambda g: None)
    monkeypatch.setattr(enrichment, "_fetch_gnd_dnb", lambda g: {
        "name.label": "Wilhelm Friedrich Hezel", "name.aliases": ["W. F. Hezel"],
        "birth.date": "1754-05-16", "birth.precision": "day", "_linked_wikidata": "Q16405824"})
    s = candidates.candidate_summary("gnd", "116796197")
    assert s["label"] == "Wilhelm Friedrich Hezel"
    assert s["links"] == {"wikidata": "Q16405824"}


def test_viaf_kokkuvote(monkeypatch):
    monkeypatch.setattr(enrichment, "_fetch_viaf", lambda v: {
        "name.label": "Theodorus Praetorius", "name.aliases": ["Theodor Praetorius"],
        "_linked_wikidata": "Q1", "_linked_gnd": "2"})
    s = candidates.candidate_summary("viaf", "123")
    assert s["label"] == "Theodorus Praetorius"
    assert s["links"] == {"wikidata": "Q1", "gnd": "2"}
    assert s["url"] == "https://viaf.org/viaf/123"


def test_tundmatu_skeem_ja_tork_on_none(monkeypatch):
    assert candidates.candidate_summary("aa", "1") is None
    monkeypatch.setattr(enrichment, "_wd_entity", lambda q: None)
    assert candidates.candidate_summary("wikidata", "Q1") is None


def test_wikidata_inimene_on_human(monkeypatch):
    """I4: P31=Q5 (inimene) → is_human True."""
    entity = {**WD, "claims": {**WD["claims"],
              "P31": [{"rank": "normal", "mainsnak": {"snaktype": "value",
                       "datavalue": {"value": {"id": "Q5"}}}}]}}
    monkeypatch.setattr(enrichment, "_wd_entity", lambda q: entity)
    monkeypatch.setattr(enrichment, "_wd_labels", lambda ids: {i: {"et": f"silt {i}"} for i in ids})
    s = candidates.candidate_summary("wikidata", "Q1698324")
    assert s["is_human"] is True


def test_wikidata_mitteinimene_ei_ole_human(monkeypatch):
    """I4: P31 ilma Q5-ta (nt asutus) → is_human False. Wikidata täistekstiotsing
    toob ka mitte-isikuid, mida paneelis ei tohi inimesena näidata."""
    entity = {**WD, "claims": {**WD["claims"],
              "P31": [{"rank": "normal", "mainsnak": {"snaktype": "value",
                       "datavalue": {"value": {"id": "Q43229"}}}}]}}  # organisatsioon
    monkeypatch.setattr(enrichment, "_wd_entity", lambda q: entity)
    monkeypatch.setattr(enrichment, "_wd_labels", lambda ids: {i: {"et": f"silt {i}"} for i in ids})
    s = candidates.candidate_summary("wikidata", "Q1698324")
    assert s["is_human"] is False


def test_gnd_ja_viaf_on_alati_human(monkeypatch):
    """I4: GND/VIAF otsingud on isik-ainult, seega alati is_human True."""
    monkeypatch.setattr(enrichment, "_fetch_lobid_raw", lambda g: None)
    monkeypatch.setattr(enrichment, "_fetch_gnd_dnb", lambda g: {
        "name.label": "Test Person", "name.aliases": []})
    assert candidates.candidate_summary("gnd", "1")["is_human"] is True
    monkeypatch.setattr(enrichment, "_fetch_viaf", lambda v: {"name.label": "Test Person"})
    assert candidates.candidate_summary("viaf", "1")["is_human"] is True
