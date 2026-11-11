"""Isikuindeksi lugemisvahemälu (#759).

Vahemälust tulev struktuur on jagatud kõigi päringute vahel: kui mõni lugemistee
kirjeid muudaks, lekiks muudatus järgmistesse päringutesse (ja teistele kasutajatele).
Need testid kordavad lugemisteid kõigi sortimis- ja filtrivalikutega ning nõuavad, et
vahemälu sisu jääb bitt-bitilt samaks.
"""
import copy
import json

import pytest

from server.prosopography import indices, person_search, state


def _entry(pid, label, sort_name, **extra):
    return {
        "id": pid, "label": label, "sort_name": sort_name, "aliases": [label.upper()],
        "gender": "male", "origin_group": "livonia", "origin_place": "riga",
        "origin_place_id": "Q1773", "origin_place_labels": {"et": "Riia", "en": "Riga"},
        "origin_coordinates": {"lat": 56.95, "lon": 24.1},
        "education_institutions": ["Academia Gustaviana"],
        "tags": [{"id": "Q1", "label": "luuletaja", "labels": {"et": "luuletaja"}}],
        "status_ids": ["student"], "verification_level": "verified",
        "birth_date": "1640-01-01", "death_date": "1700-01-01", "imm_date": "1660-05-01",
        "birth_year": 1640, "death_year": 1700, "imm_year": 1660, "work_count": 2,
        "has_wikidata": True, **extra,
    }


ENTRIES = [
    _entry("vutt:P1", "Laurentius Ludenius", "Ludenius"),
    _entry("vutt:P2", "Andreas Arvidi", "Arvidi", origin_coordinates=None),
    _entry("vutt:P3", "Olaus Hermelin", "Hermelin", record_status="tombstone"),
]


@pytest.fixture
def index_files(tmp_path, monkeypatch):
    index_path = tmp_path / "prosopography_index.json"
    aliases_path = tmp_path / "person_aliases.json"
    index_path.write_text(json.dumps({"rebuilt_at": None, "entries": ENTRIES}), encoding="utf-8")
    aliases_path.write_text(json.dumps({"vutt:P1": {"aliases": ["Lorenz Luden"]}}), encoding="utf-8")
    monkeypatch.setattr(state, "PROSOPOGRAPHY_INDEX_FILE", str(index_path))
    monkeypatch.setattr(state, "PERSON_ALIASES_FILE", str(aliases_path))
    monkeypatch.setattr(indices, "_readonly_cache", {})
    monkeypatch.setattr(state, "_load_origin_groups", lambda: {})
    return index_path, aliases_path


def test_vahemalu_ei_parsi_uuesti_ja_kirjutus_invalideerib(index_files, monkeypatch):
    index_path, _ = index_files
    first = indices._load_index_readonly()
    assert indices._load_index_readonly() is first          # sama objekt, ei parsita

    # atomic_write_json (rename) → uus allkiri → järgmine lugemine näeb uut sisu
    state.atomic_write_json(str(index_path), {"rebuilt_at": "x", "entries": ENTRIES[:1]})
    fresh = indices._load_index_readonly()
    assert fresh is not first
    assert [e["id"] for e in fresh["entries"]] == ["vutt:P1"]


def test_kirjutaja_saab_muudetava_koopia(index_files):
    cached = indices._load_index_readonly()
    mutable = indices._load_index()
    assert mutable is not cached
    mutable["entries"].clear()
    assert len(indices._load_index_readonly()["entries"]) == len(ENTRIES)


def test_puuduv_fail_annab_vaikeväärtuse(index_files):
    index_path, aliases_path = index_files
    index_path.unlink()
    aliases_path.unlink()
    assert indices._load_index_readonly() == {"rebuilt_at": None, "entries": []}
    assert indices._load_person_aliases_readonly() == {}


@pytest.mark.parametrize("sort_by", [None, "relevance", "birth_year", "death_year", "imm_year"])
def test_lugemisteed_ei_muuda_vahemalu(index_files, sort_by):
    before_index = copy.deepcopy(indices._load_index_readonly())
    before_aliases = copy.deepcopy(indices._load_person_aliases_readonly())

    for q in (None, "lud", "Q1"):
        res = person_search.list_persons(q=q, sort_by=sort_by, limit=1, offset=0)
        # Lõikamine ega sortimine ei puuduta indeksit
        assert res["total"] >= 0
    person_search.list_persons(gender="male", occupation="x", origin_group="livonia",
                               institution="gustaviana", status_id="student", tags=["Q1"],
                               verification_level="verified", source="wikidata",
                               year_from=1600, year_to=1800, imm_year_from=1650,
                               imm_year_to=1670, sort_by=sort_by)
    person_search.get_person_facets(q="lud")
    person_search.get_person_map_markers()
    person_search.get_person_map_markers(q="arv")

    assert indices._load_index_readonly() == before_index
    assert indices._load_person_aliases_readonly() == before_aliases


def test_vastuse_muutmine_ei_leki_vahemallu(index_files):
    """Kutsuja (nt router) võib vastuse loendit muuta — vahemälu loend peab jääma."""
    res = person_search.list_persons(limit=10)
    res["results"].clear()
    assert person_search.list_persons(limit=10)["total"] == 2   # tombstone välja
