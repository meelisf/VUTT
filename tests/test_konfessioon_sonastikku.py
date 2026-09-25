"""Wikidata konfessioon/seisus → suletud sõnastik (2026-09-25).

Kristiina (Q52937) sai kaardile P140 esimese väärtuse Q9592 (katoliku kirik —
institutsioon), mitte sõnastiku Q1841 (katoliiklane). Vorm pakub ainult
sõnastiku väärtusi, nii et Q9592 jäi nähtamatuks ja eemaldamatuks ning
salvestusel sai tema sildiks „Q9592".
"""
import json
from pathlib import Path

import pytest

from server.prosopography import enrichment

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wikidata" / "Q1698324_entity.json")
    .read_text(encoding="utf-8"))

VOCAB = {
    "konfessioonid": [
        {"id": "Q1841", "label": {"et": "Katoliiklane", "en": "Catholic"}},
        {"id": "Q75809", "label": {"et": "Luterlane", "en": "Lutheran"}},
    ],
    "seisused": [{"id": "Q134737", "label": {"et": "Aadel", "en": "Nobility"}}],
}


def _item(q):
    return {"mainsnak": {"snaktype": "value", "datavalue": {"value": {"id": q}}}, "rank": "normal"}


@pytest.fixture
def wd(monkeypatch):
    olek = {"vocab": VOCAB}
    monkeypatch.setattr(enrichment, "_wd_labels", lambda ids: {})
    monkeypatch.setattr(enrichment, "get_cached_vocabularies", lambda: olek["vocab"])

    def run(p140=(), p3716=()):
        ent = json.loads(json.dumps(FIXTURE))
        ent["claims"]["P140"] = [_item(q) for q in p140]
        ent["claims"]["P3716"] = [_item(q) for q in p3716]
        monkeypatch.setattr(enrichment, "_wd_entity", lambda qid: ent)
        return enrichment._fetch_wikidata("Q1698324")
    run.olek = olek
    return run


def test_kristiina_koik_vaartused_sonastikku(wd):
    """Q9592 → Q1841; luterlus jääb; duplikaat (Q1841 kaks korda) üheks; järjekord säilib."""
    r = wd(p140=["Q9592", "Q75809", "Q1841"])
    assert r["confessions"] == [
        {"id": "Q1841", "label": "Katoliiklane", "labels": {"et": "Katoliiklane", "en": "Catholic"}},
        {"id": "Q75809", "label": "Luterlane", "labels": {"et": "Luterlane", "en": "Lutheran"}},
    ]


def test_sonastikuvaline_jaab_valja(wd):
    r = wd(p140=["Q97738262"], p3716=["Q12345"])  # Unity of the Brethren; tundmatu seisus
    assert "confessions" not in r and "status" not in r


def test_seisus_sonastikust(wd):
    r = wd(p3716=["Q134737"])
    assert r["status"] == {"id": "Q134737", "label": "Aadel",
                           "labels": {"et": "Aadel", "en": "Nobility"}}


def test_laadimata_sonastik_ei_taida(wd):
    wd.olek["vocab"] = None
    assert "confessions" not in wd(p140=["Q1841"])


def test_automaatrikastus_votab_loendi():
    from server.prosopography import auto_enrich as ae
    agg = ae.aggregate([{"scheme": "wikidata", "id": "x", "remote": {"confessions": [
        {"id": "Q1841", "label": "Katoliiklane"}, {"id": "Q75809", "label": "Luterlane"}]}}])
    assert [c["id"] for c in agg["fields"]["confessions"]] == ["Q1841", "Q75809"]
