"""Testid: work_collections_index.json haldus ja kollektsioonipõhine isikute filter."""
import importlib
import json
import sys
import unittest.mock as mock
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _ops(tmp_path):
    """Laeb ops.py ja patchib indeksifailide teed tmp_path alla."""
    ops = importlib.import_module("server.prosopography.ops")
    return ops


def test_update_work_collections_writes_entry(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)):
        ops.update_work_collections("w1", ["academia-gustaviana"])
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w1": ["academia-gustaviana"]}


def test_update_work_collections_empty_removes_entry(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    wc_file.write_text(json.dumps({"w1": ["c1"], "w2": ["c2"]}), encoding="utf-8")
    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)):
        ops.update_work_collections("w1", [])
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w2": ["c2"]}


def test_rebuild_indices_builds_work_collections(tmp_path):
    ops = _ops(tmp_path)
    base_dir = tmp_path / "data"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    # Teos kahe kollektsiooniga
    work_dir = base_dir / "teos1"
    work_dir.mkdir(parents=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps({"id": "w1", "title": "T", "collections": ["c-child", "c-other"]}),
        encoding="utf-8",
    )
    wc_file = tmp_path / "work_collections_index.json"

    with mock.patch.object(ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir)), \
         mock.patch.object(ops, "BASE_DIR", str(base_dir)), \
         mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json")), \
         mock.patch.object(ops, "PROSOPOGRAPHY_INDEX_FILE", str(tmp_path / "idx.json")), \
         mock.patch.object(ops, "PERSON_ALIASES_FILE", str(tmp_path / "aliases.json")), \
         mock.patch.object(ops, "build_works_creators_index", lambda: None):
        ops.rebuild_indices()
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w1": ["c-child", "c-other"]}


COLLECTIONS = {
    "parent": {"name": {"et": "Vanem"}},
    "c-child": {"name": {"et": "Laps"}, "parent": "parent"},
    "c-other": {"name": {"et": "Muu"}},
}


def test_persons_in_collection_roles_and_inheritance(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    ptw_file = tmp_path / "ptw.json"
    # w1 kuulub alamkollektsiooni 'c-child'; w2 kuulub 'c-other'
    wc_file.write_text(json.dumps({"w1": ["c-child"], "w2": ["c-other"]}), encoding="utf-8")
    ptw_file.write_text(json.dumps({
        "vutt:Pauthor":    [{"work_id": "w1", "role": "creator"}],
        "vutt:Pmention":   [{"work_id": "w1", "role": "mentioned"}],
        "vutt:Ppublisher": [{"work_id": "w1", "role": "publisher"}],
        "vutt:Pother":     [{"work_id": "w2", "role": "creator"}],
        "vutt:Pnowork":    [],
    }), encoding="utf-8")

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(ptw_file)), \
         mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS):
        # Valitud vanemkollektsioon → hõlmab alamkollektsiooni w1 isikuid
        result = ops._persons_in_collection("parent")

    assert result == {"vutt:Pauthor", "vutt:Pmention", "vutt:Ppublisher"}
    assert "vutt:Pother" not in result   # teine kollektsioon
    assert "vutt:Pnowork" not in result  # teosteta isik


def test_list_persons_collection_filters(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    ptw_file = tmp_path / "ptw.json"
    idx_file = tmp_path / "idx.json"
    wc_file.write_text(json.dumps({"w1": ["c-child"], "w2": ["c-other"]}), encoding="utf-8")
    ptw_file.write_text(json.dumps({
        "vutt:Pin":  [{"work_id": "w1", "role": "creator"}],
        "vutt:Pout": [{"work_id": "w2", "role": "creator"}],
    }), encoding="utf-8")
    idx_file.write_text(json.dumps({"entries": [
        {"id": "vutt:Pin", "label": "Sees", "sort_name": "sees", "record_status": "published"},
        {"id": "vutt:Pout", "label": "Väljas", "sort_name": "valjas", "record_status": "published"},
    ]}), encoding="utf-8")

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(ptw_file)), \
         mock.patch.object(ops, "PROSOPOGRAPHY_INDEX_FILE", str(idx_file)), \
         mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS):
        res = ops.list_persons(collection="parent")

    ids = {e["id"] for e in res["results"]}
    assert ids == {"vutt:Pin"}
    assert res["total"] == 1


def test_person_collections_returns_works_own_collections(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    ptw_file = tmp_path / "ptw.json"
    # w1 → c-child, w2 → c-other; tagastatakse teose ENDA kollektsioonid (ilma hierarhia laienduseta)
    wc_file.write_text(json.dumps({"w1": ["c-child"], "w2": ["c-other"]}), encoding="utf-8")
    ptw_file.write_text(json.dumps({
        "vutt:Pmulti":  [{"work_id": "w1", "role": "creator"}, {"work_id": "w2", "role": "mentioned"}],
        "vutt:Pnowork": [],
    }), encoding="utf-8")

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(ptw_file)):
        assert ops._person_collections("vutt:Pmulti") == ["c-child", "c-other"]
        assert ops._person_collections("vutt:Pnowork") == []
        assert ops._person_collections("vutt:Punknown") == []


def test_map_markers_includes_focus_for_related_to(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    ptw_file = tmp_path / "ptw.json"
    idx_file = tmp_path / "idx.json"
    # Fookus-isik kuulub 'c-other'-isse, kuid valitud on 'parent' (c-other pole järglane)
    wc_file.write_text(json.dumps({"w1": ["c-other"]}), encoding="utf-8")
    ptw_file.write_text(json.dumps({"vutt:Pfocus": [{"work_id": "w1", "role": "creator"}]}), encoding="utf-8")
    idx_file.write_text(json.dumps({"entries": [
        {"id": "vutt:Pfocus", "label": "Focus Inimene", "sort_name": "focus", "record_status": "published"},
    ]}), encoding="utf-8")

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(ptw_file)), \
         mock.patch.object(ops, "PROSOPOGRAPHY_INDEX_FILE", str(idx_file)), \
         mock.patch.object(ops, "get_person_relation_network_ids", return_value=["vutt:Pfocus"]), \
         mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS):
        res = ops.get_person_map_markers(related_to="vutt:Pfocus", collection="parent")

    assert res["focus"]["id"] == "vutt:Pfocus"
    assert res["focus"]["label"] == "Focus Inimene"
    assert res["focus"]["collections"] == ["c-other"]
    # 'parent' ei hõlma 'c-other'-it → kõik filtreeritakse välja
    assert res["markers"] == []


def test_map_markers_no_focus_without_related_to(tmp_path):
    ops = _ops(tmp_path)
    idx_file = tmp_path / "idx.json"
    idx_file.write_text(json.dumps({"entries": []}), encoding="utf-8")
    with mock.patch.object(ops, "PROSOPOGRAPHY_INDEX_FILE", str(idx_file)):
        res = ops.get_person_map_markers()
    assert "focus" not in res


def test_save_work_metadata_updates_collections_even_when_call_ptw_false(tmp_path):
    metadata_ops = importlib.import_module("server.metadata_ops")
    ops = importlib.import_module("server.prosopography.ops")
    work_dir = tmp_path / "teos1"
    work_dir.mkdir()
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(json.dumps({"id": "w1", "title": "T", "collections": ["c-old"]}), encoding="utf-8")
    wc_file = tmp_path / "work_collections_index.json"

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(metadata_ops, "save_with_git", lambda *a, **k: None), \
         mock.patch.object(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None):
        metadata_ops.save_work_metadata(
            str(meta_path),
            {"collections": ["c-new"]},
            username="tester",
            git_message="bulk",
            call_ptw=False,
            sync_meili=False,
        )
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w1": ["c-new"]}
