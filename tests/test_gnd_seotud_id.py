"""GND `sameAs` → seotud Wikidata/VIAF ID + taustatöö lisaring (2026-09-24).

Wilhelm Friedrich Hezel (GND 116796197) loodi valijast GND kaudu. Nii lobid kui
d-nb teavad tema Wikidata ID-d (Q16405824) ja VIAF ID-d (34486358) `sameAs` all,
aga parser neid ei lugenud — kaardile jõudis ainult GND ID ning Wikidata kohad
Q-koodidega jäid tulemata.
"""
from server.prosopography import auto_enrich_runner as runner
from server.prosopography.auto_enrich import aggregate, new_review
from server.prosopography.enrichment import _parse_dnb_jsonld, _parse_lobid

OWL = "http://www.w3.org/2002/07/owl#sameAs"
SAME_AS = [
    "http://catalogue.bnf.fr/ark:/12148/cb121012890",
    "http://viaf.org/viaf/34486358",
    "http://www.wikidata.org/entity/Q16405824",
    "https://de.wikipedia.org/wiki/Wilhelm_Friedrich_Hezel",
]


def test_lobid_same_as_annab_seotud_id_d():
    r = _parse_lobid({"preferredName": "Hezel, Wilhelm Friedrich",
                      "sameAs": [{"id": u} for u in SAME_AS]})
    assert r["_linked_wikidata"] == "Q16405824"
    assert r["_linked_viaf"] == "34486358"


def test_dnb_same_as_annab_seotud_id_d():
    nodes = [{"@id": "https://d-nb.info/gnd/116796197",
              OWL: [{"@id": u} for u in SAME_AS]}]
    r = _parse_dnb_jsonld(nodes, "116796197")
    assert r["_linked_wikidata"] == "Q16405824"
    assert r["_linked_viaf"] == "34486358"


def test_ilma_same_as_ita_seotud_id_d_ei_ole():
    assert "_linked_wikidata" not in _parse_lobid({"preferredName": "X"})


def test_aggregate_tunneb_viaf_seotud_id():
    agg = aggregate([{"scheme": "gnd", "id": "1", "remote": {"_linked_viaf": "34486358"}}])
    assert agg["linked"] == {"viaf": "34486358"}


PENDING = new_review(created_via="picker", context=None, has_enrichable_ids=True,
                     possible_duplicate=False)


def test_taustatoo_kusib_seotud_allika_ja_rakendab_selle(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "116796197"}],
                      gender=None, birth={"date": None}, review=PENDING)
    vastused = {
        ("gnd", "116796197"): {"gender": "M", "_linked_wikidata": "Q16405824"},
        ("wikidata", "Q16405824"): {"birth.date": "1754-05-16", "birth.precision": "day",
                                   "birth.place": {"id": "Q1", "label": "Königsberg"}},
    }
    paringud = []

    def fetch(s, i):
        paringud.append((s, i))
        return vastused.get((s, i))

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert ("wikidata", "Q16405824") in paringud
    assert {(i["scheme"], i["id"]) for i in k["identifiers"]} == {
        ("gnd", "116796197"), ("wikidata", "Q16405824")}
    assert k["birth"]["place"]["id"] == "Q1" and k["birth"]["date"] == "1754-05-16"
    assert k["review"]["reasons"] == ["auto_enriched"]
    assert {"identifiers", "birth.place", "gender"} <= set(k["review"]["auto_filled"])


def test_teisel_kaardil_oleva_seotud_id_andmeid_ei_rakendata(prosopo_env, monkeypatch):
    prosopo_env.write("bbb", identifiers=[{"scheme": "wikidata", "id": "Q16405824"}])
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "116796197"}],
                      birth={"date": None}, review=PENDING)
    vastused = {
        ("gnd", "116796197"): {"_linked_wikidata": "Q16405824"},
        ("wikidata", "Q16405824"): {"birth.date": "1754-05-16", "birth.precision": "day"},
    }
    monkeypatch.setattr(runner, "fetch_remote", lambda s, i: vastused.get((s, i)))
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["birth"]["date"] is None
    assert [(i["scheme"], i["id"]) for i in k["identifiers"]] == [("gnd", "116796197")]
    assert "possible_duplicate" in k["review"]["reasons"]


def test_seotud_allika_tork_ei_takista_id_lisamist(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "116796197"}],
                      gender=None, review=PENDING)
    vastused = {("gnd", "116796197"): {"gender": "M", "_linked_wikidata": "Q16405824"}}
    monkeypatch.setattr(runner, "fetch_remote", lambda s, i: vastused.get((s, i)))
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert ("wikidata", "Q16405824") in {(i["scheme"], i["id"]) for i in k["identifiers"]}
    assert k["review"]["reasons"] == ["auto_enriched", "enrich_failed"]
    assert k["review"]["failed_sources"] == ["wikidata"]
