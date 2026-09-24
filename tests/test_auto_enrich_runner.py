"""Taustarikastus (spekk §4.3): võrk lukust väljas, ID kehtivus, lõppolek, taaste."""
from server.prosopography import auto_enrich_runner as runner
from server.prosopography.auto_enrich import new_review

PENDING = new_review(created_via="picker", context=None, has_enrichable_ids=True,
                     possible_duplicate=False)


def remote(monkeypatch, vastused):
    monkeypatch.setattr(runner, "fetch_remote", lambda s, i: vastused.get((s, i)))


def test_taidab_tuhjad_ja_seab_lopu(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}],
                      gender=None, birth={"date": None}, review=PENDING)
    remote(monkeypatch, {("wikidata", "Q1"): {"gender": "M", "birth.date": "1592-01-01",
                                               "birth.precision": "year"}})
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["gender"] == "M" and k["birth"]["date"] == "1592-01-01"
    assert k["review"]["reasons"] == ["auto_enriched"]
    assert set(k["review"]["auto_filled"]) == {"gender", "birth.date"}


def test_paringu_ajal_eemaldatud_id_andmeid_ei_rakendata(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}],
                      gender=None, review=PENDING)

    def fetch(s, i):
        # Kasutaja eemaldab eksliku ID päringu ajal.
        k = prosopo_env.read("aaa")
        prosopo_env.write("aaa", **{**k, "identifiers": []})
        return {"gender": "M"}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["gender"] is None and k["review"]["reasons"] == []


def test_paringu_ajal_liidetud_kaardile_ei_kirjutata(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}], review=PENDING)

    def fetch(s, i):
        k = prosopo_env.read("aaa")
        prosopo_env.write("aaa", **{**k, "record_status": "tombstone", "merged_into": "vutt:Pzzz"})
        return {"gender": "M"}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    before = prosopo_env.read("aaa")
    runner.run_auto_enrichment("vutt:Paaa")
    assert prosopo_env.read("aaa") == {**before, "record_status": "tombstone", "merged_into": "vutt:Pzzz"}


def test_vahepealne_kasitsi_muudatus_jaab_alles(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}],
                      gender=None, notes=None, review=PENDING)

    def fetch(s, i):
        k = prosopo_env.read("aaa")
        prosopo_env.write("aaa", **{**k, "notes": "käsitsi", "gender": "F"})
        return {"gender": "M"}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert (k["notes"], k["gender"]) == ("käsitsi", "F")
    assert k["review"]["reasons"] == ["nothing_to_fill"]


def test_osaline_onnestumine(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"},
                                          {"scheme": "gnd", "id": "5"}],
                      gender=None, review=PENDING)
    remote(monkeypatch, {("wikidata", "Q1"): {"gender": "M"}})
    runner.run_auto_enrichment("vutt:Paaa")
    r = prosopo_env.read("aaa")["review"]
    assert r["reasons"] == ["auto_enriched", "enrich_failed"] and r["failed_sources"] == ["gnd"]


def test_seotud_id_teisel_kaardil_ei_lisata(prosopo_env, monkeypatch):
    prosopo_env.write("bbb", identifiers=[{"scheme": "gnd", "id": "5"}])
    prosopo_env.write("aaa", identifiers=[{"scheme": "viaf", "id": "9"}], review=PENDING)
    remote(monkeypatch, {("viaf", "9"): {"_linked_gnd": "5", "_linked_wikidata": "Q7"}})
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert {(i["scheme"], i["id"]) for i in k["identifiers"]} == {("viaf", "9"), ("wikidata", "Q7")}
    assert "possible_duplicate" in k["review"]["reasons"]
    assert "identifiers" in k["review"]["auto_filled"]


def test_voork_ei_ole_luku_all(prosopo_env, monkeypatch):
    from server.prosopography.locks import person_lock
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}], review=PENDING)
    vaba = {}

    def fetch(s, i):
        vaba["v"] = person_lock("vutt:Paaa").acquire(blocking=False)
        if vaba["v"]:
            person_lock("vutt:Paaa").release()
        return {}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    assert vaba["v"] is True


def test_taaste_ajastab_ainult_pooleli_aktiivsed(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}], review=PENDING)
    prosopo_env.write("bbb", review={**PENDING, "reasons": ["auto_enriched"]})
    prosopo_env.write("ccc", review=PENDING, record_status="tombstone", merged_into="vutt:Paaa")
    prosopo_env.write("ddd")
    ajastatud = []
    monkeypatch.setattr(runner, "schedule_auto_enrichment", ajastatud.append)
    assert runner.recover_pending() == 1 and ajastatud == ["vutt:Paaa"]
