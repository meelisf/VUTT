"""Testid prosopography ops.py funktsioonidele — status → statuses migratsioon ja indeks."""
import importlib
import importlib.util
import json
import sys
import unittest.mock as mock
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# ---- migratsiooniskripti testid ----

def _run_migrate(tmp_path, persons: list) -> list:
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    for p in persons:
        (prosopo_dir / f"{p['id']}.json").write_text(
            json.dumps(p, ensure_ascii=False), encoding="utf-8"
        )
    spec = importlib.util.spec_from_file_location(
        "migrate_script",
        PROJECT_ROOT / "scripts" / "migrate_status_to_statuses.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.migrate(str(prosopo_dir))
    results = []
    for p in persons:
        data = json.loads((prosopo_dir / f"{p['id']}.json").read_text(encoding="utf-8"))
        results.append(data)
    return results


def test_migrate_single_status(tmp_path):
    person = {"id": "p1", "status": {"id": "Q134737", "label": "Aadel"}}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == [{"id": "Q134737", "label": "Aadel"}]
    assert "status" not in results[0]


def test_migrate_null_status(tmp_path):
    person = {"id": "p2", "status": None}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == []
    assert "status" not in results[0]


def test_migrate_already_has_statuses(tmp_path):
    person = {"id": "p3", "statuses": [{"id": "Q134737", "label": "Aadel"}]}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == [{"id": "Q134737", "label": "Aadel"}]
    assert "status" not in results[0]


def test_migrate_missing_status_key(tmp_path):
    person = {"id": "p4", "name": {"label": "Test"}}
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == []


# ---- indeksi ehitamise testid ----

def _build_entry(person: dict) -> dict:
    ops = importlib.import_module("server.prosopography.ops")
    with mock.patch.object(ops, "_resolve_origin_group", return_value=None), \
         mock.patch.object(ops, "_get_parent_place", return_value=None), \
         mock.patch.object(ops, "_get_place_labels", return_value=None), \
         mock.patch.object(ops, "_get_place_coordinates", return_value=None), \
         mock.patch.object(ops, "_load_origin_groups", return_value={}):
        return ops._index_entry_from_person(person)


def test_index_entry_statuses_to_status_ids():
    person = {
        "id": "p5",
        "name": {"label": "Test Person"},
        "statuses": [
            {"id": "Q134737", "label": "Aadel"},
            {"id": "Q2259532", "label": "Vaimulik"},
        ],
    }
    entry = _build_entry(person)
    assert entry["status_ids"] == ["Q134737", "Q2259532"]
    assert entry["status_labels"] == ["Aadel", "Vaimulik"]
    assert "status_id" not in entry


def test_index_entry_empty_statuses():
    person = {"id": "p6", "name": {"label": "Empty"}, "statuses": []}
    entry = _build_entry(person)
    assert entry["status_ids"] == []
    assert entry["status_labels"] == []


def test_index_entry_legacy_status_fallback():
    """Kui statuses puudub (vana formaat), kasuta legacy status välja."""
    person = {
        "id": "p7",
        "name": {"label": "Legacy"},
        "status": {"id": "Q134737", "label": "Aadel"},
    }
    entry = _build_entry(person)
    assert entry["status_ids"] == ["Q134737"]
    assert entry["status_labels"] == ["Aadel"]


def test_index_entry_includes_origin_coordinates():
    ops = importlib.import_module("server.prosopography.ops")
    person = {
        "id": "p8",
        "name": {"label": "Geo Person"},
        "origin": {"place": "Riga", "place_id": "Q1773"},
    }
    coords = {"lat": 56.9475, "lon": 24.1069, "source": "wikidata", "wikidata_property": "P625"}
    with mock.patch.object(ops, "_resolve_origin_group", return_value="Liivimaa"), \
         mock.patch.object(ops, "_get_parent_place", return_value=None), \
         mock.patch.object(ops, "_get_place_labels", return_value={"et": "Riia"}), \
         mock.patch.object(ops, "_get_place_coordinates", return_value=coords), \
         mock.patch.object(ops, "_load_origin_groups", return_value={"Liivimaa": {"labels": {"et": "Liivimaa"}}}):
        entry = ops._index_entry_from_person(person)
    assert entry["origin_coordinates"] == coords


# ---- list_persons filter test ----

def test_list_persons_status_id_filter(tmp_path, monkeypatch):
    """status_id filter kontrollib status_ids massiivi (contains, mitte equals)."""
    ops = importlib.import_module("server.prosopography.ops")

    fake_index = {
        "entries": [
            {"id": "p1", "status_ids": ["Q134737", "Q2259532"], "record_status": "draft", "label": "A", "sort_name": "A"},
            {"id": "p2", "status_ids": ["Q2259532"], "record_status": "draft", "label": "B", "sort_name": "B"},
            {"id": "p3", "status_ids": [], "record_status": "draft", "label": "C", "sort_name": "C"},
        ]
    }
    monkeypatch.setattr(ops, "_load_index", lambda: fake_index)
    monkeypatch.setattr(ops, "_load_person_to_works", lambda: {})
    monkeypatch.setattr(ops, "_entry_occupations", lambda e: [])

    result = ops.list_persons(status_id="Q134737")
    ids = [r["id"] for r in result["results"]]
    assert "p1" in ids
    assert "p2" not in ids
    assert "p3" not in ids


def test_migrate_has_both_status_and_statuses(tmp_path):
    """Kui mõlemad võtmed olemas — status eemaldatakse, statuses jääb puutumata."""
    person = {
        "id": "p5",
        "statuses": [{"id": "Q134737", "label": "Aadel"}],
        "status": {"id": "Q2259532", "label": "Vaimulik"},
    }
    results = _run_migrate(tmp_path, [person])
    assert results[0].get("statuses") == [{"id": "Q134737", "label": "Aadel"}]
    assert "status" not in results[0]


def test_migrate_idempotent(tmp_path):
    """Kaks järjestikust jooksu — teine ei muuda midagi."""
    person = {"id": "p6", "status": {"id": "Q134737", "label": "Aadel"}}
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    (prosopo_dir / "p6.json").write_text(json.dumps(person, ensure_ascii=False), encoding="utf-8")

    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "migrate_script2",
        PROJECT_ROOT / "scripts" / "migrate_status_to_statuses.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    first = mod.migrate(str(prosopo_dir))
    second = mod.migrate(str(prosopo_dir))
    assert first == 1
    assert second == 0


# ---- confession → confessions migratsioon ----

def _run_migrate_confession(tmp_path, persons: list) -> list:
    prosopo_dir = tmp_path / "prosopography_conf"
    prosopo_dir.mkdir()
    for p in persons:
        (prosopo_dir / f"{p['id']}.json").write_text(
            json.dumps(p, ensure_ascii=False), encoding="utf-8"
        )
    spec = importlib.util.spec_from_file_location(
        "migrate_confession_script",
        PROJECT_ROOT / "scripts" / "migrate_confession_to_confessions.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.migrate(str(prosopo_dir))
    return [
        json.loads((prosopo_dir / f"{p['id']}.json").read_text(encoding="utf-8"))
        for p in persons
    ]


def test_migrate_confession_single(tmp_path):
    person = {"id": "c1", "confession": {"id": "Q75809", "label": "Luterlane"}}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == [{"id": "Q75809", "label": "Luterlane"}]
    assert "confession" not in results[0]


def test_migrate_confession_null(tmp_path):
    person = {"id": "c2", "confession": None}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == []
    assert "confession" not in results[0]


def test_migrate_confession_already_has_confessions(tmp_path):
    person = {"id": "c3", "confessions": [{"id": "Q75809", "label": "Luterlane"}]}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == [{"id": "Q75809", "label": "Luterlane"}]
    assert "confession" not in results[0]


def test_migrate_confession_missing_key(tmp_path):
    person = {"id": "c4", "name": {"label": "Test"}}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == []


def test_migrate_confession_idempotent(tmp_path):
    person = {"id": "c5", "confession": {"id": "Q1841", "label": "Katoliiklane"}}
    prosopo_dir = tmp_path / "prosopography_idem"
    prosopo_dir.mkdir()
    (prosopo_dir / "c5.json").write_text(json.dumps(person, ensure_ascii=False), encoding="utf-8")
    spec = importlib.util.spec_from_file_location(
        "migrate_conf_idem",
        PROJECT_ROOT / "scripts" / "migrate_confession_to_confessions.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    first = mod.migrate(str(prosopo_dir))
    second = mod.migrate(str(prosopo_dir))
    assert first == 1
    assert second == 0


# ---- confession_ids indeksi testid ----

def test_index_entry_confession_ids():
    person = {
        "id": "ci1",
        "name": {"label": "Test"},
        "confessions": [
            {"id": "Q75809", "label": "Luterlane"},
            {"id": "Q1841", "label": "Katoliiklane"},
        ],
    }
    entry = _build_entry(person)
    assert entry["confession_ids"] == ["Q75809", "Q1841"]
    assert "confession_id" not in entry


def test_index_entry_empty_confessions():
    person = {"id": "ci2", "name": {"label": "Empty"}, "confessions": []}
    entry = _build_entry(person)
    assert entry["confession_ids"] == []


def test_index_entry_confession_legacy_fallback():
    """Kui confessions puudub (vana formaat), kasuta legacy confession välja."""
    person = {
        "id": "ci3",
        "name": {"label": "Legacy"},
        "confession": {"id": "Q75809", "label": "Luterlane"},
    }
    entry = _build_entry(person)
    assert entry["confession_ids"] == ["Q75809"]


# ---- confession → confessions migratsioon ----

def _run_migrate_confession(tmp_path, persons: list) -> list:
    prosopo_dir = tmp_path / "prosopography_conf"
    prosopo_dir.mkdir()
    for p in persons:
        (prosopo_dir / f"{p['id']}.json").write_text(
            json.dumps(p, ensure_ascii=False), encoding="utf-8"
        )
    spec = importlib.util.spec_from_file_location(
        "migrate_confession_script",
        PROJECT_ROOT / "scripts" / "migrate_confession_to_confessions.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.migrate(str(prosopo_dir))
    return [
        json.loads((prosopo_dir / f"{p['id']}.json").read_text(encoding="utf-8"))
        for p in persons
    ]


def test_migrate_confession_single(tmp_path):
    person = {"id": "c1", "confession": {"id": "Q75809", "label": "Luterlane"}}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == [{"id": "Q75809", "label": "Luterlane"}]
    assert "confession" not in results[0]


def test_migrate_confession_null(tmp_path):
    person = {"id": "c2", "confession": None}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == []
    assert "confession" not in results[0]


def test_migrate_confession_already_has_confessions(tmp_path):
    person = {"id": "c3", "confessions": [{"id": "Q75809", "label": "Luterlane"}]}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == [{"id": "Q75809", "label": "Luterlane"}]
    assert "confession" not in results[0]


def test_migrate_confession_missing_key(tmp_path):
    person = {"id": "c4", "name": {"label": "Test"}}
    results = _run_migrate_confession(tmp_path, [person])
    assert results[0].get("confessions") == []


def test_migrate_confession_idempotent(tmp_path):
    person = {"id": "c5", "confession": {"id": "Q1841", "label": "Katoliiklane"}}
    prosopo_dir = tmp_path / "prosopography_idem"
    prosopo_dir.mkdir()
    (prosopo_dir / "c5.json").write_text(json.dumps(person, ensure_ascii=False), encoding="utf-8")
    spec = importlib.util.spec_from_file_location(
        "migrate_conf_idem",
        PROJECT_ROOT / "scripts" / "migrate_confession_to_confessions.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    first = mod.migrate(str(prosopo_dir))
    second = mod.migrate(str(prosopo_dir))
    assert first == 1
    assert second == 0


# ---- confession_ids indeksi testid ----

def test_index_entry_confession_ids():
    person = {
        "id": "ci1",
        "name": {"label": "Test"},
        "confessions": [
            {"id": "Q75809", "label": "Luterlane"},
            {"id": "Q1841", "label": "Katoliiklane"},
        ],
    }
    entry = _build_entry(person)
    assert entry["confession_ids"] == ["Q75809", "Q1841"]
    assert "confession_id" not in entry


def test_index_entry_empty_confessions():
    person = {"id": "ci2", "name": {"label": "Empty"}, "confessions": []}
    entry = _build_entry(person)
    assert entry["confession_ids"] == []


def test_index_entry_confession_legacy_fallback():
    """Kui confessions puudub (vana formaat), kasuta legacy confession välja."""
    person = {
        "id": "ci3",
        "name": {"label": "Legacy"},
        "confession": {"id": "Q75809", "label": "Luterlane"},
    }
    entry = _build_entry(person)
    assert entry["confession_ids"] == ["Q75809"]
