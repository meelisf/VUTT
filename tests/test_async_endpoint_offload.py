"""Regressioon: async endpointid ei tohi blokeerivat OCR/upload I/O-d event-loopis jooksutada."""
import asyncio
import threading

from fastapi import BackgroundTasks
from starlette.requests import Request

from server.routers import ocr_jobs, reocr, upload


MAIN_THREAD = threading.current_thread().name


def _worker_thread_name():
    return threading.current_thread().name


def test_reocr_status_poll_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_poll(job_id):
        seen["job_id"] = job_id
        seen["thread"] = _worker_thread_name()
        return {"job_status": "done"}

    monkeypatch.setattr(reocr, "poll_reocr_job", fake_poll)

    result = asyncio.run(reocr.admin_reocr_status("job-1", user={"username": "admin"}))

    assert result["status"] == "success"
    assert seen == {"job_id": "job-1", "thread": seen["thread"]}
    assert seen["thread"] != MAIN_THREAD


def test_upload_import_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_import(upload_id, username):
        seen["args"] = (upload_id, username)
        seen["thread"] = _worker_thread_name()
        return {"work_id": "w1", "slug": "slug"}

    monkeypatch.setattr(upload, "_import_upload_sync", fake_import)

    result = asyncio.run(upload.admin_upload_import("up-1", user={"username": "admin"}))

    assert result == {"status": "success", "work_id": "w1", "slug": "slug"}
    assert seen["args"] == ("up-1", "admin")
    assert seen["thread"] != MAIN_THREAD


def _json_request(body: bytes = b"{}"):
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.request", "body": b"", "more_body": False}

    return Request({"type": "http", "method": "POST", "headers": []}, receive)


def test_upload_replace_work_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_replace(upload_id, work_id, metadata_updates, username, background_tasks):
        seen["args"] = (upload_id, work_id, metadata_updates, username)
        seen["bg_type"] = type(background_tasks).__name__
        seen["thread"] = _worker_thread_name()
        return {"work_id": work_id, "slug": "slug"}

    monkeypatch.setattr(upload, "replace_work_content", fake_replace)

    result = asyncio.run(upload.admin_upload_replace_work(
        "up-1",
        "w1",
        _json_request(b'{"metadata_updates":{"title":"T"}}'),
        BackgroundTasks(),
        user={"username": "admin"},
    ))

    assert result == {"status": "success", "work_id": "w1", "slug": "slug"}
    assert seen["args"] == ("up-1", "w1", {"title": "T"}, "admin")
    assert seen["bg_type"] == "BackgroundTasks"
    assert seen["thread"] != MAIN_THREAD


def test_upload_cancel_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_cancel(upload_id):
        seen["upload_id"] = upload_id
        seen["thread"] = _worker_thread_name()
        return True

    monkeypatch.setattr(upload, "cancel_upload", fake_cancel)

    result = asyncio.run(upload.admin_upload_cancel("up-1", user={"username": "admin"}))

    assert result == {"status": "success"}
    assert seen["upload_id"] == "up-1"
    assert seen["thread"] != MAIN_THREAD


def test_admin_ocr_jobs_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_build():
        seen["thread"] = _worker_thread_name()
        return [{"id": "j1"}]

    monkeypatch.setattr(ocr_jobs, "_build_admin_ocr_jobs", fake_build)

    result = asyncio.run(ocr_jobs.admin_ocr_jobs(user={"username": "admin"}))

    assert result == {"status": "success", "jobs": [{"id": "j1"}]}
    assert seen["thread"] != MAIN_THREAD
