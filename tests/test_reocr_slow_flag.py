"""Slow-lipp (nõuandev), absoluutne sanity-lagi ja queue_ahead."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server.reocr_ops as reocr_ops


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
    yield
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()


def _job(started_at, status="processing", **ov):
    j = {"status": status, "started_at": started_at, "slug": "w1", "work_id": "wid",
         "page_filename": "w1_pg_001.txt", "text": None, "error": None,
         "remote_txt": "AUTO-OCR/print/j/w1/w1_pg_001.txt"}
    j.update(ov)
    return j


def test_mark_slow_sets_flag_once():
    now = 10_000.0
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_PROCESSING_TIMEOUT - 5)
    assert reocr_ops._mark_slow_if_stale("j1", reocr_ops._reocr_jobs["j1"], now) is True
    assert reocr_ops._reocr_jobs["j1"]["slow"] is True
    assert reocr_ops._reocr_jobs["j1"]["slow_since"] == now
    assert reocr_ops._mark_slow_if_stale("j1", reocr_ops._reocr_jobs["j1"], now + 10) is False


def test_slow_does_not_change_status():
    now = 10_000.0
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_PROCESSING_TIMEOUT - 5)
    reocr_ops._mark_slow_if_stale("j1", reocr_ops._reocr_jobs["j1"], now)
    assert reocr_ops._reocr_jobs["j1"]["status"] == "processing"


def test_abs_timeout_marks_error_after_final_check(monkeypatch):
    now = 100_000.0
    monkeypatch.setattr(reocr_ops, "poll_reocr_job", lambda jid: {"status": "processing"})
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_ABSOLUTE_TIMEOUT - 5)
    reocr_ops._poll_iteration(now)
    assert reocr_ops._reocr_jobs["j1"]["status"] == "error"
    assert "absoluutse" in reocr_ops._reocr_jobs["j1"]["error"]


def test_abs_timeout_recovers_if_txt_arrives(monkeypatch):
    now = 100_000.0
    def _poll(jid):
        reocr_ops._reocr_jobs[jid]["status"] = "done"
        return {"status": "done"}
    monkeypatch.setattr(reocr_ops, "poll_reocr_job", _poll)
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_ABSOLUTE_TIMEOUT - 5)
    reocr_ops._poll_iteration(now)
    assert reocr_ops._reocr_jobs["j1"]["status"] == "done"


def test_list_reocr_jobs_queue_ahead_and_slow():
    reocr_ops._reocr_jobs["a"] = _job(1000.0)
    reocr_ops._reocr_jobs["b"] = _job(1001.0, slow=True, slow_since=2000.0)
    reocr_ops._reocr_jobs["c"] = _job(1002.0)
    by_id = {j["job_id"]: j for j in reocr_ops.list_reocr_jobs()}
    assert by_id["a"]["queue_ahead"] == 0
    assert by_id["b"]["queue_ahead"] == 1
    assert by_id["c"]["queue_ahead"] == 2
    assert by_id["b"]["slow"] is True and by_id["b"]["slow_since"] == 2000.0
    assert by_id["a"]["slow"] is False


def _batch_job(started_at, **ov):
    j = {"kind": "batch", "status": "processing", "started_at": started_at,
         "last_progress_at": started_at, "slug": "w1", "work_id": "wid",
         "pages": [{"page_filename": "w1-a.jpg", "status": "processing", "error": None}]}
    j.update(ov)
    return j


def test_batch_inactivity_sets_slow_not_error(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_poll_batch_job", lambda jid: None)
    now = 50_000.0
    reocr_ops._reocr_batch_jobs["b1"] = _batch_job(now - reocr_ops.REOCR_BATCH_INACTIVITY_TIMEOUT - 5)
    reocr_ops._batch_poll_iteration(now)
    j = reocr_ops._reocr_batch_jobs["b1"]
    assert j["status"] == "processing"
    assert j["slow"] is True


def test_batch_absolute_timeout_errors_remaining_after_final_poll(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_poll_batch_job", lambda jid: None)
    now = 200_000.0
    reocr_ops._reocr_batch_jobs["b1"] = _batch_job(now - reocr_ops.REOCR_ABSOLUTE_TIMEOUT - 5)
    reocr_ops._batch_poll_iteration(now)
    j = reocr_ops._reocr_batch_jobs["b1"]
    assert j["status"] == "done"
    assert j["pages"][0]["status"] == "error"
