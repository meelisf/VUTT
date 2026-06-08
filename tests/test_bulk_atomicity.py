import json
import os
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def meta_file(tmp_path):
    path = tmp_path / "_metadata.json"
    path.write_text(json.dumps({
        "title": "Test",
        "collections": ["col-a"],
        "tags": [{"id": "Q1", "label": "foo"}],
        "genre": [],
    }), encoding="utf-8")
    return str(path)


def test_bulk_update_field_applies_transform(meta_file):
    """bulk_update_field loeb, transformeerib ja kirjutab ühe lukutsüklina."""
    from server.metadata_ops import bulk_update_field

    def add_collection(meta):
        current = meta.get("collections", [])
        return {"collections": current + ["col-b"]}

    with patch("server.metadata_ops.save_with_git") as mock_git:
        bulk_update_field(meta_file, add_collection, "testuser", "bulk test")
        assert mock_git.called
        saved_content = mock_git.call_args[0][1]
        saved = json.loads(saved_content)
        assert saved["collections"] == ["col-a", "col-b"]


def test_bulk_update_field_transform_sees_current_state(meta_file):
    """transform näeb _metadata.json praegust seisu — ei kasuta vananenud väärtust."""
    from server.metadata_ops import bulk_update_field

    seen_collections = []

    def inspect_and_remove(meta):
        seen_collections.extend(meta.get("collections", []))
        return {"collections": []}

    with patch("server.metadata_ops.save_with_git"):
        bulk_update_field(meta_file, inspect_and_remove, "testuser", "bulk test")

    assert "col-a" in seen_collections


def test_bulk_update_field_skips_disallowed_keys(meta_file):
    """transform ei saa lisada väljakesi, mida ALLOWED_METADATA_FIELDS ei luba."""
    from server.metadata_ops import bulk_update_field

    def add_evil(meta):
        return {"collections": ["ok"], "__evil__": "injected"}

    with patch("server.metadata_ops.save_with_git") as mock_git:
        bulk_update_field(meta_file, add_evil, "testuser", "bulk test")
        saved = json.loads(mock_git.call_args[0][1])
        assert "__evil__" not in saved
        assert saved["collections"] == ["ok"]


def test_bulk_update_field_missing_file_is_noop(tmp_path):
    """Puuduva faili korral ei kutsuta save_with_git."""
    from server.metadata_ops import bulk_update_field

    missing = str(tmp_path / "nonexistent.json")
    with patch("server.metadata_ops.save_with_git") as mock_git:
        bulk_update_field(missing, lambda m: {"collections": []}, "user", "msg")
        mock_git.assert_not_called()
