"""person_aliases.json kaks kirjutajat ei tohi teineteise kirjeid pühkida (#347).

Faili kirjutavad kaks teed, kumbki oma võtmeruumis:

* `rebuild_indices` / `_update_aliases_entry` — `vutt:P…` võtmed isikukaartidelt,
* `people_ops.update_person_async` — `Q…`/GND võtmed Wikidatast ja GND-st.

`rebuild_indices` jookseb iga serveri stardi ajal. Kui ta kirjutab faili tervikuna
üle, kaovad väliste ID-de kirjed ja Meili `authors_text` jääb ilma nimevariantideta
(`meili_doc.get_creator_aliases` otsib looja ID järgi).
"""
import json

import pytest


def _prosopo_env(tmp_path, monkeypatch):
    """Suunab prosopograafia teed tmp_path'i ja tagastab aliaste faili tee."""
    import server.prosopography.ops as prosopo_ops

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()

    aliases_file = tmp_path / "person_aliases.json"
    monkeypatch.setattr(prosopo_ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "person_to_works.json"))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_INDEX_FILE", str(tmp_path / "prosopography_index.json"))
    monkeypatch.setattr(prosopo_ops, "WORK_COLLECTIONS_INDEX_FILE", str(tmp_path / "work_collections_index.json"))
    monkeypatch.setattr(prosopo_ops, "PERSON_ALIASES_FILE", str(aliases_file))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir))
    monkeypatch.setattr(prosopo_ops, "BASE_DIR", str(data_dir))
    return prosopo_ops, prosopo_dir, aliases_file


def _kaart(prosopo_dir, pid, label, aliases=None):
    (prosopo_dir / f"{pid.replace('vutt:', '')}.json").write_text(json.dumps({
        "id": pid,
        "name": {"label": label, "aliases": aliases or []},
    }), encoding="utf-8")


def test_rebuild_indices_sailitab_valiste_idde_kirjed(tmp_path, monkeypatch):
    """Restardi rebuild ei tohi Wikidata/GND kirjeid kustutada."""
    prosopo_ops, prosopo_dir, aliases_file = _prosopo_env(tmp_path, monkeypatch)
    _kaart(prosopo_dir, "vutt:Paaa", "Laurentius Ludenius", ["Lorenz Luden"])

    aliases_file.write_text(json.dumps({
        "Q123": {
            "primary_name": "Johann Fischer",
            "aliases": ["Johann Fischer", "Johannes Fischer"],
            "ids": {"wikidata": "Q123", "gnd": "118533495"},
        },
        "118533495": {
            "primary_name": "Johann Fischer",
            "aliases": ["Johann Fischer", "Johannes Fischer"],
            "ids": {"wikidata": "Q123", "gnd": "118533495"},
        },
        "vutt:Pvana": {"primary_name": "Kustutatud kaart", "aliases": [], "ids": {}},
    }), encoding="utf-8")

    prosopo_ops.rebuild_indices()

    data = json.loads(aliases_file.read_text(encoding="utf-8"))
    assert "Q123" in data, f"Wikidata kirje kadus: {sorted(data)}"
    assert "118533495" in data, f"GND kirje kadus: {sorted(data)}"
    assert data["Q123"]["aliases"] == ["Johann Fischer", "Johannes Fischer"]
    # Kaardipõhine pool ehitatakse endiselt nullist: olematu kaardi kirje kaob.
    assert "vutt:Pvana" not in data
    assert data["vutt:Paaa"]["primary_name"] == "Laurentius Ludenius"
    assert set(data["vutt:Paaa"]["aliases"]) == {"Laurentius Ludenius", "Lorenz Luden"}


def test_refresh_all_people_seemendab_teoste_metaandmetest(tmp_path, monkeypatch):
    """Pärast pühkimist peab taastetee seemne võtma _metadata.json failidest.

    Vana `refresh_all_people` itereeris ainult failis juba olevaid võtmeid — pärast
    pühkimist ei olnud seal ühtegi `Q…` võtit ja taaste ei teinud mitte midagi.
    """
    import server.people_ops as people_ops

    data_dir = tmp_path / "data"
    (data_dir / "teos1").mkdir(parents=True)
    (data_dir / "teos1" / "_metadata.json").write_text(json.dumps({
        "id": "w1",
        "creators": [{"id": "Q123", "name": "Fischer, Johann", "source": "wikidata"}],
        "publisher": {"id": "Q777", "label": "Brendeken"},
        "tags": [{"id": "Q9465", "label": "eetika"}],
    }), encoding="utf-8")

    aliases_file = tmp_path / "person_aliases.json"
    aliases_file.write_text(json.dumps({
        "vutt:Paaa": {"primary_name": "Keegi", "aliases": [], "ids": {}},
    }), encoding="utf-8")

    monkeypatch.setattr(people_ops, "PEOPLE_FILE", str(aliases_file))
    monkeypatch.setattr(people_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(people_ops.time, "sleep", lambda *_: None)

    kysitud = []

    def fake_wikidata(qid):
        kysitud.append(qid)
        return {"primary_name": f"Nimi {qid}", "aliases": [f"Nimi {qid}", f"Variant {qid}"], "ids": {"wikidata": qid}}

    monkeypatch.setattr(people_ops, "fetch_wikidata_aliases", fake_wikidata)
    monkeypatch.setattr(people_ops, "fetch_gnd_aliases", lambda *_: None)

    tulemus = people_ops.refresh_all_people()

    assert set(kysitud) == {"Q123", "Q777", "Q9465"}, f"Küsiti: {kysitud}"
    data = json.loads(aliases_file.read_text(encoding="utf-8"))
    assert data["Q123"]["primary_name"] == "Nimi Q123"
    # Kaardipoolne kirje ei ole selle tee asi ega tohi kaduda.
    assert data["vutt:Paaa"]["primary_name"] == "Keegi"
    assert tulemus["updated"] == 3
    assert tulemus["errors"] == 0


def test_refresh_all_people_ei_kysi_vutt_id_kohta(tmp_path, monkeypatch):
    """`vutt:P…` võtmed ei ole väline ID — nende pärast ei tohi päringut teha."""
    import server.people_ops as people_ops

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    aliases_file = tmp_path / "person_aliases.json"
    aliases_file.write_text(json.dumps({
        "vutt:Paaa": {"primary_name": "Keegi", "aliases": ["Keegi"], "ids": {}},
    }), encoding="utf-8")

    monkeypatch.setattr(people_ops, "PEOPLE_FILE", str(aliases_file))
    monkeypatch.setattr(people_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(people_ops.time, "sleep", lambda *_: None)
    monkeypatch.setattr(people_ops, "fetch_wikidata_aliases",
                        lambda *_: pytest.fail("vutt:P ID kohta ei tohi Wikidatasse minna"))
    monkeypatch.setattr(people_ops, "fetch_gnd_aliases",
                        lambda *_: pytest.fail("vutt:P ID kohta ei tohi GND-sse minna"))

    tulemus = people_ops.refresh_all_people()

    assert tulemus == {"updated": 0, "errors": 0, "total": 0}
