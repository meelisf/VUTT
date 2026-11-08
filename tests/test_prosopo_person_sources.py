"""Isikukaardi `sources[]`: vabatekst või VUTT-i teose/osa viide (ADR 0078)."""
import json

import pytest

from server.prosopography import person_crud, person_sources


@pytest.fixture
def teos(tmp_path, monkeypatch):
    folder = tmp_path / "matus-w1"
    folder.mkdir()
    (folder / "_metadata.json").write_text(json.dumps(
        {"id": "w1", "title": "Leichpredigt", "parts": [{"id": "k1", "kind": "prose"}]}),
        encoding="utf-8")
    monkeypatch.setattr(person_sources, "find_directory_by_id",
                        lambda wid: str(folder) if wid == "w1" else None)
    return folder


def _norm(sources):
    return person_sources.normalize_sources({"sources": sources})["sources"]


def test_vabatekst_ja_vana_string_kehtivad(teos):
    assert _norm([{"text": " Recke-Napiersky ", "note": ""}, "Album Academicum"]) == [
        {"text": "Recke-Napiersky"}, {"text": "Album Academicum"}]


def test_tuhi_rida_visatakse_vaikselt(teos):
    assert _norm([{"text": "  ", "note": "x"}]) == []


def test_teose_ja_osa_viide(teos):
    assert _norm([{"work_id": "w1", "part_id": "k1", "page": 7,
                   "printed_page": "14–16", "text": "personaalia", "note": ""}]) == [
        {"text": "personaalia", "printed_page": "14–16", "work_id": "w1",
         "part_id": "k1", "page": 7}]


@pytest.mark.parametrize("kirje, viga", [
    ({"work_id": "puudub"}, "teost puudub"),
    ({"work_id": "w1", "part_id": "k9"}, "osa k9"),
    ({"work_id": "w1", "page": 0}, "page"),
    ({"work_id": "w1", "page": True}, "page"),
    ({"work_id": "w1", "page": "7"}, "page"),
    ({"part_id": "k1", "text": "x"}, "vajavad teost"),
    ({"text": "x", "title": "y"}, "tundmatu väli"),
    ({"text": 5}, "text"),
])
def test_vigane_kirje_lukatakse_tagasi(teos, kirje, viga):
    with pytest.raises(ValueError, match=viga):
        _norm([kirje])


def test_puuduv_voti_ei_puutu_kaarti():
    assert person_sources.normalize_sources({"notes": "x"}) == {"notes": "x"}


def test_update_person_salvestab_viite(prosopo_env, teos):
    k = prosopo_env.write("aaa", sources=[{"text": "vana"}])
    person_crud.update_person("vutt:Paaa", {
        "sources": [{"text": "vana"}, {"work_id": "w1", "part_id": "k1"}],
        "updated_at": k["updated_at"]}, "toimetaja")
    assert prosopo_env.read("aaa")["sources"] == [
        {"text": "vana"}, {"work_id": "w1", "part_id": "k1"}]


def test_update_person_kehtetu_viide_ei_salvesta(prosopo_env, teos):
    k = prosopo_env.write("aaa", sources=[{"text": "vana"}])
    with pytest.raises(ValueError, match="invalid_sources"):
        person_crud.update_person("vutt:Paaa", {
            "sources": [{"work_id": "puudub"}], "updated_at": k["updated_at"]}, "toimetaja")
    assert prosopo_env.read("aaa")["sources"] == [{"text": "vana"}]
