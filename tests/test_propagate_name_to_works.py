"""
Testid: _propagate_name_to_works uuendab creators JA tags välju.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.ops import _propagate_name_to_works

PERSON_ID = "vutt:Ptest01"
OTHER_ID = "vutt:Pother"


def _write_meta(work_dir: Path, meta: dict) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return meta_path


def _read_meta(meta_path: Path) -> dict:
    return json.loads(meta_path.read_text(encoding="utf-8"))


def _fake_save(path, content, *args, **kwargs):
    """save_with_git mock — kirjutab sisu kettale nagu päris."""
    Path(path).write_text(content, encoding="utf-8")
    for extra_path, extra_content in (kwargs.get("additional_files") or []):
        Path(extra_path).write_text(extra_content, encoding="utf-8")


def _run(data_dir: Path, new_label: str = "Karl XII"):
    """Käivitab _propagate_name_to_works koos mocktidega (git + meili)."""
    with (
        patch("server.config.BASE_DIR", str(data_dir)),
        patch("server.git_ops.save_with_git", side_effect=_fake_save) as mock_git,
        patch("server.meilisearch_ops.sync_work_to_meilisearch_async", return_value=None) as mock_meili,
    ):
        _propagate_name_to_works(PERSON_ID, new_label, "testuser")
        return mock_git, mock_meili


# -- creators --

def test_creator_label_updated(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [{"id": PERSON_ID, "label": "Schweden Karl XII", "name": "Schweden Karl XII"}],
        "tags": [],
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["creators"][0]["label"] == "Karl XII"
    assert meta["creators"][0]["name"] == "Karl XII"


def test_creator_other_person_not_changed(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [{"id": OTHER_ID, "label": "Keegi teine", "name": "Keegi teine"}],
        "tags": [],
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["creators"][0]["label"] == "Keegi teine"


# -- tags --

def test_tag_label_updated(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [],
        "tags": [{"id": PERSON_ID, "label": "Schweden Karl XII"}],
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["tags"][0]["label"] == "Karl XII"


def test_tag_other_person_not_changed(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [],
        "tags": [{"id": OTHER_ID, "label": "Keegi teine"}],
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["tags"][0]["label"] == "Keegi teine"


def test_tag_already_correct_label_no_git_call(tmp_path):
    _write_meta(tmp_path / "teos1", {
        "creators": [],
        "tags": [{"id": PERSON_ID, "label": "Karl XII"}],
    })
    mock_git, _ = _run(tmp_path)
    mock_git.assert_not_called()


# -- mõlemad korraga --

def test_both_creator_and_tag_updated(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [{"id": PERSON_ID, "label": "Vana Nimi", "name": "Vana Nimi"}],
        "tags": [{"id": PERSON_ID, "label": "Vana Nimi"}],
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["creators"][0]["label"] == "Karl XII"
    assert meta["tags"][0]["label"] == "Karl XII"


# -- mitu teost --

def test_multiple_works_all_updated(tmp_path):
    paths = [
        _write_meta(tmp_path / slug, {
            "creators": [],
            "tags": [{"id": PERSON_ID, "label": "Vana"}],
        })
        for slug in ["teos1", "teos2", "teos3"]
    ]
    _run(tmp_path)
    for p in paths:
        assert _read_meta(p)["tags"][0]["label"] == "Karl XII"


def test_no_changes_means_no_git_call(tmp_path):
    _write_meta(tmp_path / "teos1", {
        "creators": [],
        "tags": [{"id": OTHER_ID, "label": "Keegi teine"}],
    })
    mock_git, _ = _run(tmp_path)
    mock_git.assert_not_called()


# -- publisher --

def test_publisher_label_updated(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [],
        "tags": [],
        "publisher": {"id": PERSON_ID, "label": "Vana Trükkal", "source": "local"},
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["publisher"]["label"] == "Karl XII"


def test_publisher_other_person_not_changed(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [],
        "tags": [],
        "publisher": {"id": OTHER_ID, "label": "Keegi teine", "source": "local"},
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["publisher"]["label"] == "Keegi teine"


def test_publisher_and_creator_both_updated(tmp_path):
    meta_path = _write_meta(tmp_path / "teos1", {
        "creators": [{"id": PERSON_ID, "label": "Vana Nimi", "name": "Vana Nimi"}],
        "tags": [],
        "publisher": {"id": PERSON_ID, "label": "Vana Nimi", "source": "local"},
    })
    _run(tmp_path)
    meta = _read_meta(meta_path)
    assert meta["creators"][0]["label"] == "Karl XII"
    assert meta["publisher"]["label"] == "Karl XII"
