"""Indeksite taaste ei kirjuta üle vahepeal tehtud muudatusi (#417).

`rebuild_indices` loeb lähteandmed, ehitab indeksid ja kirjutab need lõpuks üle.
Kui API muudab vahepeal kaarti või teost ja uuendab indeksit, ei tohi taaste
seda kirjet oma vanema hetktõmmisega asendada.

Testid peatavad taaste lähteandmete lugemise järel (esimene teos on loetud),
teevad muudatused samade kirjutusteede kaudu mis API ja lasevad taastel lõpuni
joosta.
"""
import json

import pytest

from server.prosopography import indices
from server.prosopography import work_relations_ops as wro


@pytest.fixture
def env(tmp_path, monkeypatch):
    import server.prosopography.ops as prosopo_ops

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    for name, fname in [("PERSON_TO_WORKS_FILE", "ptw.json"),
                        ("PROSOPOGRAPHY_INDEX_FILE", "index.json"),
                        ("WORK_COLLECTIONS_INDEX_FILE", "wc.json"),
                        ("PERSON_ALIASES_FILE", "aliases.json")]:
        monkeypatch.setattr(prosopo_ops, name, str(tmp_path / fname))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir))
    monkeypatch.setattr(prosopo_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(wro, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    return tmp_path, data_dir, prosopo_dir


def _kaart(prosopo_dir, pid, label):
    person = {"id": pid, "name": {"label": label, "aliases": []}}
    (prosopo_dir / f"{pid.replace('vutt:', '')}.json").write_text(json.dumps(person))
    return person


def _teos(data_dir, work_id, creator_id, collections, title="Pealkiri"):
    d = data_dir / f"teos-{work_id}"
    d.mkdir(exist_ok=True)
    meta = {"id": work_id, "title": title, "collections": collections,
            "creators": [{"id": creator_id, "name": "x", "role": "auctor"}]}
    (d / "_metadata.json").write_text(json.dumps(meta))
    return meta, d


def _loe(path):
    return json.loads(path.read_text())


def test_taaste_ajal_muudetud_kaart_ja_teos_jaavad_alles(env, monkeypatch):
    tmp_path, data_dir, prosopo_dir = env
    _kaart(prosopo_dir, "vutt:Paaa", "Vana Nimi")
    _teos(data_dir, "W1", "vutt:Paaa", ["c1"])
    indices.rebuild_indices()  # algseis kettale

    algne = indices.mention_entries
    tehtud = []

    def keset_taastet(work_id, work_dir, parts=None):
        if not tehtud:
            tehtud.append(True)
            # Uus kaart ja olemasoleva kaardi nimemuutus — nagu person_crud.
            for person in (_kaart(prosopo_dir, "vutt:Pbbb", "Uus Isik"),
                           _kaart(prosopo_dir, "vutt:Paaa", "Uus Nimi")):
                indices._update_index_entry(person)
                indices._update_aliases_entry(person)
            # Teose looja ja kogu muutus — nagu save_work_metadata.
            meta, _ = _teos(data_dir, "W1", "vutt:Pbbb", ["c2"])
            indices.update_person_to_works("W1", meta["creators"], [])
            indices.update_work_collections("W1", meta["collections"])
        return algne(work_id, work_dir, parts)

    monkeypatch.setattr(indices, "mention_entries", keset_taastet)
    indices.rebuild_indices()
    assert tehtud

    index = {e["id"]: e for e in _loe(tmp_path / "index.json")["entries"]}
    assert set(index) == {"vutt:Paaa", "vutt:Pbbb"}
    assert index["vutt:Paaa"]["label"] == "Uus Nimi"

    aliases = _loe(tmp_path / "aliases.json")
    assert aliases["vutt:Paaa"]["primary_name"] == "Uus Nimi"
    assert aliases["vutt:Pbbb"]["primary_name"] == "Uus Isik"

    ptw = _loe(tmp_path / "ptw.json")
    assert [e["work_id"] for e in ptw.get("vutt:Pbbb", [])] == ["W1"]
    assert not ptw.get("vutt:Paaa")

    assert _loe(tmp_path / "wc.json") == {"W1": ["c2"]}


def test_taaste_ajal_kustutatud_kaart_ei_tule_tagasi(env, monkeypatch):
    tmp_path, data_dir, prosopo_dir = env
    _kaart(prosopo_dir, "vutt:Paaa", "Jääb")
    _kaart(prosopo_dir, "vutt:Pccc", "Kustub")
    _teos(data_dir, "W1", "vutt:Paaa", ["c1"])
    indices.rebuild_indices()

    algne = indices.mention_entries
    tehtud = []

    def keset_taastet(work_id, work_dir, parts=None):
        if not tehtud:
            tehtud.append(True)
            # Nagu merge_ops.delete_person: fail ära, indeksikirje ja aliased ära.
            (prosopo_dir / "Pccc.json").unlink()
            from server.prosopography import state
            with state._index_lock:
                index = indices._load_index()
                index["entries"] = [e for e in index["entries"] if e["id"] != "vutt:Pccc"]
                state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, index)
            indices._remove_aliases_entry("vutt:Pccc")
        return algne(work_id, work_dir, parts)

    monkeypatch.setattr(indices, "mention_entries", keset_taastet)
    indices.rebuild_indices()

    assert {e["id"] for e in _loe(tmp_path / "index.json")["entries"]} == {"vutt:Paaa"}
    assert "vutt:Pccc" not in _loe(tmp_path / "aliases.json")


def test_teose_faktide_taaste_ei_kirjuta_vahepealset_uuendust_ule(env, monkeypatch):
    tmp_path, data_dir, prosopo_dir = env
    _teos(data_dir, "W1", "vutt:Paaa", [], title="Vana pealkiri")
    wro.build_works_creators_index()

    algne = wro._work_facts_entry
    tehtud = []

    def keset_taastet(meta, work_dir=None):
        if not tehtud:
            tehtud.append(True)
            uus, d = _teos(data_dir, "W1", "vutt:Paaa", [], title="Uus pealkiri")
            wro.update_work_facts(uus, str(d))
        return algne(meta, work_dir)

    monkeypatch.setattr(wro, "_work_facts_entry", keset_taastet)
    wro.build_works_creators_index()
    assert tehtud

    assert _loe(tmp_path / "wci.json")["W1"]["title"] == "Uus pealkiri"


def test_taaste_parandab_endiselt_vale_indeksi(env):
    """Baasseisu võrdlus ei tohi takistada taastet: ilma vahepealse
    kirjutuseta tuleb kõik taastest, ka kettal olnud vale kirje parandatakse."""
    tmp_path, data_dir, prosopo_dir = env
    _kaart(prosopo_dir, "vutt:Paaa", "Õige Nimi")
    _teos(data_dir, "W1", "vutt:Paaa", ["c1"])
    (tmp_path / "index.json").write_text(json.dumps({"entries": [
        {"id": "vutt:Pvale", "name": "Orb"}]}))
    (tmp_path / "wc.json").write_text(json.dumps({"W9": ["x"]}))
    (tmp_path / "ptw.json").write_text(json.dumps({"vutt:Pvale": [{"work_id": "W9", "role": "auctor"}]}))

    indices.rebuild_indices()

    assert [e["id"] for e in _loe(tmp_path / "index.json")["entries"]] == ["vutt:Paaa"]
    assert _loe(tmp_path / "wc.json") == {"W1": ["c1"]}
    assert set(_loe(tmp_path / "ptw.json")) == {"vutt:Paaa"}
