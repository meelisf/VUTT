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
