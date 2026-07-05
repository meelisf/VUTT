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


def test_reocr_log_write_is_atomic_json(tmp_path, monkeypatch):
    import server.reocr_ops as ops
    target = tmp_path / "reocr_log.json"
    monkeypatch.setattr(ops, "REOCR_LOG_FILE", str(target))

    ops._append_to_log({
        "work_id": "wid",
        "slug": "slug",
        "page_filename": "slug_pg_001.txt",
        "status": "done",
        "finished_at": "2026-01-01T00:00:00",
    }, "job1")

    data = json.loads(target.read_text(encoding="utf-8"))
    assert data[0]["job_id"] == "job1"
    assert data[0]["status"] == "done"
    assert not list(tmp_path.glob(".tmp_*.json"))


def test_reocr_log_corrupt_file_logs_warning(tmp_path, monkeypatch, caplog):
    import logging
    import server.reocr_ops as ops
    target = tmp_path / "reocr_log.json"
    target.write_text("{ vigane json", encoding="utf-8")
    monkeypatch.setattr(ops, "REOCR_LOG_FILE", str(target))

    with caplog.at_level(logging.WARNING):
        result = ops.get_reocr_log()

    assert result == {"entries": [], "has_more": False, "total": 0}
    assert "Re-OCR logi lugemine ebaõnnestus" in caplog.text


def test_batch_mapping_roundtrip(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    pages = {
        "w1_pg_001.txt": {"page_filename": "w1-lk-005.jpg", "page_number": 5},
        "w1_pg_002.txt": {"page_filename": "w1-lk-006.jpg", "page_number": 6},
    }
    st.persist_batch_mapping("b1", "wid", "w1", pages)
    loaded = st.load_batch_mapping("b1")
    assert loaded["work_id"] == "wid"
    assert loaded["slug"] == "w1"
    assert loaded["pages"]["w1_pg_002.txt"]["page_filename"] == "w1-lk-006.jpg"
    assert loaded["pages"]["w1_pg_002.txt"]["page_number"] == 6


def test_batch_mapping_missing_returns_none(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    assert st.load_batch_mapping("puudub") is None


def test_batch_mapping_corrupt_returns_none(tmp_path, monkeypatch):
    import server.reocr_state as st
    d = tmp_path / "reocr_batch_maps"
    d.mkdir()
    (d / "b1.json").write_text("{ vigane", encoding="utf-8")
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(d))
    assert st.load_batch_mapping("b1") is None


def test_batch_mapping_remove(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    st.persist_batch_mapping("b1", "wid", "w1", {})
    assert st.load_batch_mapping("b1") is not None
    st.remove_batch_mapping("b1")
    assert st.load_batch_mapping("b1") is None
    st.remove_batch_mapping("b1")  # teist korda — ei crash'i
