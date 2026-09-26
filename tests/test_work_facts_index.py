# tests/test_work_facts_index.py
"""Teose faktide read-model (#461): üks kirje-ehitaja, kirje igale teosele."""
import json
from pathlib import Path
from unittest.mock import patch

from server.prosopography import work_relations_ops as wro

A = "vutt:Paaaaa"


def _meta(**kw):
    base = {"id": "w1", "title": "Disputatio", "year": 1658, "creators": [],
            "location": {"id": "Q435295", "label": "Altdorf bei Nürnberg", "source": "wikidata"},
            "genre": [{"id": "Q1123131", "label": "disputatsioon"}]}
    base.update(kw)
    return base


def _patches(tmp_path):
    return (patch.object(wro, "BASE_DIR", str(tmp_path / "data")),
            patch.object(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json")))


def _read(tmp_path):
    return json.loads((tmp_path / "wci.json").read_text(encoding="utf-8"))


def test_kirje_kannab_kohta_ja_zanreid():
    e = wro._work_facts_entry(_meta(creators=[{"id": A, "role": "praeses"}]))
    assert e == {"title": "Disputatio", "year": 1658,
                 "creators": [{"person_id": A, "roles": ["praeses"]}],
                 "location": {"id": "Q435295", "label": "Altdorf bei Nürnberg"},
                 "genres": ["disputatsioon"]}


def test_tuhi_voi_stringkoht():
    assert wro._work_facts_entry(_meta(location=""))["location"] is None
    assert wro._work_facts_entry(_meta(location=None))["location"] is None
    assert wro._work_facts_entry(_meta(location="Riga"))["location"] == {"id": None, "label": "Riga"}


def test_zanr_objekt_voi_puudub():
    assert wro._work_facts_entry(_meta(genre={"label": "kõne"}))["genres"] == ["kõne"]
    assert wro._work_facts_entry(_meta(genre=None))["genres"] == []


def test_loojateta_teos_saab_kirje(tmp_path):
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.update_work_facts(_meta(creators=[]))
    assert _read(tmp_path)["w1"]["creators"] == []


def test_update_asendab_ja_remove_eemaldab(tmp_path):
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.update_work_facts(_meta())
        wro.update_work_facts(_meta(title="Uus"))
        assert _read(tmp_path)["w1"]["title"] == "Uus"
        wro.remove_work_facts("w1")
        assert "w1" not in _read(tmp_path)


def test_rebuild_ja_update_annavad_sama_kirje(tmp_path):
    """ADR 0007: sama kirje-ehitaja mõlemas teel."""
    d = tmp_path / "data" / "slug-w1"
    d.mkdir(parents=True)
    meta = _meta(creators=[{"id": A, "role": "auctor"}])
    (d / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.build_works_creators_index()
        rebuilt = _read(tmp_path)["w1"]
        (tmp_path / "wci.json").unlink()
        wro.update_work_facts(meta)
        assert _read(tmp_path)["w1"] == rebuilt
