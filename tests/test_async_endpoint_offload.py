"""Regressioon: async endpointid ei tohi blokeerivat OCR/upload I/O-d event-loopis jooksutada."""
import asyncio
import threading

from fastapi import BackgroundTasks
from starlette.requests import Request

from server.prosopography import router as prosopography
from server.routers import (
    admin,
    auth,
    collections,
    editing,
    notifications,
    ocr_jobs,
    pages,
    public,
    public_registries,
    reocr,
    upload,
    user_settings,
)


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


def test_save_git_jookseb_threadpoolis(monkeypatch):
    seen = {}

    monkeypatch.setattr(editing, "_require_catalog_access", lambda *_a, **_k: {})

    def fake_save(*_args, **_kwargs):
        seen["thread"] = _worker_thread_name()
        return {"success": True, "commit_hash": "abc12345"}

    monkeypatch.setattr(editing, "save_with_git", fake_save)
    result = asyncio.run(editing.save(
        _json_request(b'{"original_path":"work","file_name":"page.txt","text_content":"x"}'),
        BackgroundTasks(),
        user={"username": "editor", "role": "editor"},
    ))

    assert result["status"] == "success"
    assert seen["thread"] != MAIN_THREAD


def test_metadata_save_jookseb_threadpoolis(monkeypatch):
    seen = {}
    monkeypatch.setattr(editing, "find_directory_by_id", lambda _wid: "/tmp/work")

    def fake_save(*_args, **kwargs):
        seen["thread"] = _worker_thread_name()
        seen["sync_meili"] = kwargs.get("sync_meili")
        seen["background_tasks"] = kwargs.get("background_tasks")
        return {"id": "w1"}, True

    monkeypatch.setattr(editing, "save_work_metadata", fake_save)
    monkeypatch.setattr(editing, "process_person_fields_metadata", lambda *_a: None)
    monkeypatch.setattr(editing, "enrich_entity_labels_async", lambda *_a: None)
    monkeypatch.setattr(editing, "_invalidate_all_caches", lambda: None)

    result = asyncio.run(editing.update_work_metadata(
        _json_request(b'{"work_id":"w1","metadata":{"title":"T"}}'),
        BackgroundTasks(),
        user={"username": "admin", "role": "admin"},
    ))

    assert result == {"status": "success", "changed": True}
    assert seen["thread"] != MAIN_THREAD
    assert seen["sync_meili"] is False
    assert isinstance(seen["background_tasks"], BackgroundTasks)


def test_prosopography_create_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_create(data, username):
        seen["args"] = (data, username)
        seen["thread"] = _worker_thread_name()
        return {"id": "vutt:P1"}

    monkeypatch.setattr(prosopography, "create_person", fake_create)
    monkeypatch.setattr(prosopography, "enrich_entity_labels_from_person_async", lambda *_a: None)
    result = asyncio.run(prosopography.prosopography_create(
        _json_request(b'{"name":"Test"}'), user={"username": "editor"}
    ))

    assert result == {"id": "vutt:P1"}
    assert seen["args"] == ({"name": "Test"}, "editor")
    assert seen["thread"] != MAIN_THREAD


def test_prosopography_rebuild_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_rebuild():
        seen["thread"] = _worker_thread_name()

    monkeypatch.setattr(prosopography, "rebuild_indices", fake_rebuild)
    result = asyncio.run(prosopography.prosopography_rebuild(user={"username": "admin"}))

    assert result["status"] == "ok"
    assert seen["thread"] != MAIN_THREAD


def test_rasked_sync_endpointid_on_fastapi_threadpooli_jaoks_sync_def():
    """Request-bodyta rasked endpointid peavad olema sync def, mitte event-loop coroutine."""
    assert not asyncio.iscoroutinefunction(pages.admin_delete_page)
    assert not asyncio.iscoroutinefunction(pages.admin_restore_original_page_image)
    assert not asyncio.iscoroutinefunction(public.download_work)
    assert not asyncio.iscoroutinefunction(public.sitemap_xml)
    assert not asyncio.iscoroutinefunction(prosopography.person_history)
    assert not asyncio.iscoroutinefunction(prosopography.places_wikidata_search)
    # admin: prügikast, git fsck, teose kustutus (raske fs + git)
    assert not asyncio.iscoroutinefunction(admin.admin_registrations)
    assert not asyncio.iscoroutinefunction(admin.admin_trash)
    assert not asyncio.iscoroutinefunction(admin.admin_trash_restore)
    assert not asyncio.iscoroutinefunction(admin.admin_work_metadata)
    assert not asyncio.iscoroutinefunction(admin.admin_trash_pages)
    assert not asyncio.iscoroutinefunction(admin.admin_restore_page)
    assert not asyncio.iscoroutinefunction(admin.admin_git_health)
    assert not asyncio.iscoroutinefunction(admin.admin_work_delete)
    # collections: arhiivi/kollektsiooni kustutus skannib kõiki teoseid
    assert not asyncio.iscoroutinefunction(collections.delete_archive)
    assert not asyncio.iscoroutinefunction(collections.admin_collection_users)
    assert not asyncio.iscoroutinefunction(collections.admin_delete_collection)
    # notifications: faili luge/kirjuta
    assert not asyncio.iscoroutinefunction(notifications.get_notifications)
    assert not asyncio.iscoroutinefunction(notifications.mark_notification_read)
    # user_settings: faililugemine
    assert not asyncio.iscoroutinefunction(user_settings.get_user_settings)
    assert not asyncio.iscoroutinefunction(user_settings.get_user_chars)
    # public_registries: labels.json + Wikidata refresh + kõigi lehtede skann
    assert not asyncio.iscoroutinefunction(public_registries.entity_labels)
    assert not asyncio.iscoroutinefunction(public_registries.admin_refresh_entity_labels)
    assert not asyncio.iscoroutinefunction(public_registries.admin_enrich_page_tag_labels)


def test_login_verify_user_jookseb_threadpoolis(monkeypatch):
    """bcrypt on CPU-raske — verify_user peab jooksma threadpool'is, mitte event-loopis."""
    seen = {}

    monkeypatch.setattr(auth, "check_rate_limit", lambda *_a, **_k: (True, 0))
    monkeypatch.setattr(auth, "check_account_lockout", lambda *_a, **_k: (False, 0))
    monkeypatch.setattr(auth, "clear_login_failures", lambda *_a, **_k: None)
    monkeypatch.setattr(auth, "create_session", lambda user: "tok")

    def fake_verify(username, password):
        seen["args"] = (username, password)
        seen["thread"] = _worker_thread_name()
        return {"username": username, "role": "editor"}

    monkeypatch.setattr(auth, "verify_user", fake_verify)

    result = asyncio.run(auth.login(_json_request(b'{"username":"bob","password":"pw"}')))

    assert result["status"] == "success"
    assert seen["args"] == ("bob", "pw")
    assert seen["thread"] != MAIN_THREAD


def test_notifications_reply_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_apply(catalog, filename, comment_id, reply_text, work_id, page_number, user):
        seen["args"] = (catalog, filename, comment_id, reply_text)
        seen["thread"] = _worker_thread_name()
        return {"status": "success", "comments": [], "reply": {}, "commit_hash": "abc"}

    monkeypatch.setattr(notifications, "_apply_reply_sync", fake_apply)

    result = asyncio.run(notifications.reply_to_page_comment(
        _json_request(b'{"original_path":"w","file_name":"p.txt","comment_id":"c1","text":"hi"}'),
        BackgroundTasks(),
        user={"username": "editor", "name": "Ed"},
    ))

    assert result["status"] == "success"
    assert seen["args"] == ("w", "p.txt", "c1", "hi")
    assert seen["thread"] != MAIN_THREAD


def test_prosopography_work_titles_jookseb_threadpoolis(monkeypatch):
    seen = {}

    def fake_collect(work_ids):
        seen["work_ids"] = work_ids
        seen["thread"] = _worker_thread_name()
        return {"w1": {"title": "T", "year": None, "restricted": False}}

    monkeypatch.setattr(prosopography, "_collect_work_titles", fake_collect)

    result = asyncio.run(prosopography.prosopography_work_titles(
        _json_request(b'{"work_ids":["w1"]}')
    ))

    assert result == {"titles": {"w1": {"title": "T", "year": None, "restricted": False}}}
    assert seen["work_ids"] == ["w1"]
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
