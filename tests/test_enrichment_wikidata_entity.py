"""Wikidata rikastus loeb entity API-t, mitte SPARQL-i.

2026-09-24: isikukaardi „Wikidata" eelvaade ebaõnnestus (nginx 499). Põhjus:
`_fetch_wikidata` tegi kaks järjestikust päringut avalikku SPARQL-teenusesse
(WDQS), kumbki 15 s timeoutiga. Külmalt kulus 10–15 s päringu kohta, teine jäi
sageli timeouti taha → kokku ~26 s, klient loobus 15 s järel. Entity API
(`Special:EntityData` + `wbgetentities` siltideks) vastab ~1 s-ga.

Väljundi kuju peab jääma samaks — `fetch_and_diff` ja kliendi
`applyEnrichmentToDraft` sõltuvad sellest. Oodatud väärtused on võetud
vana SPARQL-tee päris väljundist sama isiku (Q1698324) kohta.
"""
import json
from pathlib import Path

import pytest

from server.prosopography import enrichment

FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "wikidata" / "Q1698324_entity.json")
    .read_text(encoding="utf-8"))

SILDID = {
    "Q6581097": {"et": "mees", "en": "male"},
    "Q6602": {"et": "Strasbourg", "en": "Strasbourg"},
    "Q10710237": {"et": "Uppsala toomkogudus", "en": "Uppsala Cathedral Parish"},
    "Q25286": {"et": "Uppsala", "en": "Uppsala"},
    "Q16267607": {"et": "klassikaline filoloog", "en": "classical philologist"},
    "Q13418253": {"et": "filoloog", "en": "philologist"},
    "Q3621491": {"et": "arheoloog", "en": "archaeologist"},
    "Q1622272": {"et": "õppejõud", "en": "university teacher"},
    "Q1028181": {"et": "maalikunstnik", "en": "painter"},
    "Q270141": {"et": "Polühistor", "en": "polymath"},
    "Q201788": {"et": "ajaloolane", "en": "historian"},
    "Q182436": {"et": "raamatukoguhoidja", "en": "librarian"},
}


@pytest.fixture
def wikidata(monkeypatch):
    """Asendab võrgu: entity ja sildid tulevad sõnastikest."""
    olek = {"entity": FIXTURE, "sildid": SILDID}

    monkeypatch.setattr(enrichment, "_wd_entity", lambda qid: olek["entity"])

    def sildid(ids):
        if olek["sildid"] is None:
            return None
        return {i: olek["sildid"][i] for i in ids if i in olek["sildid"]}

    monkeypatch.setattr(enrichment, "_wd_labels", sildid)
    return olek


def test_valjund_vastab_vana_sparql_tee_kujule(wikidata):
    r = enrichment._fetch_wikidata("Q1698324")

    assert r["gender"] == "M"
    assert (r["birth.date"], r["birth.precision"]) == ("1621-02-02", "day")
    assert (r["death.date"], r["death.precision"]) == ("1679-03-26", "day")
    assert r["birth.place"] == {"id": "Q6602", "label": "Strasbourg"}
    # Mitmest surmakohast esimene (vana tee võttis juhusliku esimese rea).
    assert r["death.place"] == {"id": "Q10710237", "label": "Uppsala toomkogudus"}
    assert [o["label"] for o in r["_occupations"]] == [
        "filoloog", "arheoloog", "õppejõud", "ajaloolane",
        "maalikunstnik", "klassikaline filoloog", "raamatukoguhoidja", "Polühistor",
    ]
    assert r["_occupations"][0] == {"id": "Q13418253", "label": "filoloog"}
    assert "Johannes Scheffer" in r["name.aliases"]
    assert len(r["name.aliases"]) == len(set(r["name.aliases"]))
    assert "confessions" not in r and "status" not in r


def test_ametid_ei_ole_kumne_peale_kaetud(wikidata):
    """Vana päring 2 oli `LIMIT 10` üle ristkorrutise — 11. amet kadus vaikselt."""
    ent = json.loads(json.dumps(FIXTURE))
    lisa = ent["claims"]["P106"][0]
    for i in range(5):
        uus = json.loads(json.dumps(lisa))
        uus["mainsnak"]["datavalue"]["value"]["id"] = f"Q900{i}"
        ent["claims"]["P106"].append(uus)
    wikidata["entity"] = ent
    wikidata["sildid"] = {**SILDID, **{f"Q900{i}": {"et": f"amet {i}"} for i in range(5)}}

    assert len(enrichment._fetch_wikidata("Q1698324")["_occupations"]) == 13


def test_aasta_tapsusega_kuupaev(wikidata):
    """Entity API annab `+1621-00-00T…`; SPARQL normaliseeris `1621-01-01`-ks."""
    ent = json.loads(json.dumps(FIXTURE))
    aeg = ent["claims"]["P569"][0]["mainsnak"]["datavalue"]["value"]
    aeg["time"], aeg["precision"] = "+1621-00-00T00:00:00Z", 9
    wikidata["entity"] = ent

    r = enrichment._fetch_wikidata("Q1698324")
    assert (r["birth.date"], r["birth.precision"]) == ("1621-01-01", "year")


def test_eelistatud_auaste_voidab_ja_aegunu_jaetakse_vahele(wikidata):
    """`wdt:` (vana tee) = parim auaste: preferred > normal, deprecated mitte kunagi."""
    ent = json.loads(json.dumps(FIXTURE))
    kohad = ent["claims"]["P20"]
    kohad[0]["rank"] = "deprecated"
    kohad[1]["rank"] = "preferred"
    wikidata["entity"] = ent

    assert enrichment._fetch_wikidata("Q1698324")["death.place"]["id"] == "Q25286"


def test_silt_langeb_inglise_keelele(wikidata):
    wikidata["sildid"] = {**SILDID, "Q6602": {"en": "Strasbourg (en)"}}
    assert enrichment._fetch_wikidata("Q1698324")["birth.place"]["label"] == "Strasbourg (en)"


def test_siltide_tork_on_ebaonnestumine_mitte_q_koodid_siltidena(wikidata):
    """Poolik vastus kirjutaks kaardile „Q6602" kohanimeks — parem aus viga."""
    wikidata["sildid"] = None
    assert enrichment._fetch_wikidata("Q1698324") is None


def test_entity_tork_on_ebaonnestumine(wikidata, monkeypatch):
    monkeypatch.setattr(enrichment, "_wd_entity", lambda qid: None)
    assert enrichment._fetch_wikidata("Q1698324") is None


def test_vigane_qid_ei_tee_paringut(wikidata, monkeypatch):
    monkeypatch.setattr(enrichment, "_wd_entity",
                        lambda qid: pytest.fail("päring vigase id-ga"))
    assert enrichment._fetch_wikidata("Q1 OR 1=1") is None
