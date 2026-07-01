"""reocr_state.py — aktiivsete re-OCR tööde püsivus."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_persist_filters_to_active_only(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))

    st.persist_active_jobs({
        "a": {"status": "processing", "slug": "w1", "page_filename": "w1_pg_001.txt"},
        "b": {"status": "uploading", "slug": "w2"},
        "c": {"status": "done", "slug": "w3"},
        "d": {"status": "error", "slug": "w4"},
    })
    loaded = st.load_active_jobs()
    assert set(loaded.keys()) == {"a", "b"}
    assert loaded["a"]["page_filename"] == "w1_pg_001.txt"


def test_load_missing_file_returns_empty(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "puudub.json"))
    assert st.load_active_jobs() == {}


def test_load_corrupt_file_returns_empty(tmp_path, monkeypatch):
    import server.reocr_state as st
    p = tmp_path / "reocr_active.json"
    p.write_text("{ vigane json", encoding="utf-8")
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(p))
    assert st.load_active_jobs() == {}


def test_persist_is_atomic_valid_json(tmp_path, monkeypatch):
    import server.reocr_state as st
    target = tmp_path / "reocr_active.json"
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(target))
    st.persist_active_jobs({"a": {"status": "processing", "kind": "batch"}})
    assert json.loads(target.read_text(encoding="utf-8"))["a"]["kind"] == "batch"
    assert not (tmp_path / "reocr_active.json.tmp").exists()
