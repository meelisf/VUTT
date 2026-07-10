"""Regressioonitestid issues #157 ja #158: teose endpointid on fail-closed."""
import json

import pytest


@pytest.fixture
def restricted_work_env(backend_env, monkeypatch, tmp_path):
    import server.access_ops as access_ops
    import server.routers.editing as editing
    import server.routers.public as public
    import server.utils as utils
    import server.work_meta as work_meta

    data_dir = tmp_path / "data"
    work_dir = data_dir / "secret-work"
    work_dir.mkdir(parents=True)
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(json.dumps({
        "id": "secret1",
        "slug": "secret-work",
        "title": "Piiratud teos",
        "collections": ["restricted"],
    }), encoding="utf-8")
    (work_dir / "page1.txt").write_text("salajane tekst", encoding="utf-8")
    (work_dir / "page1.json").write_text(json.dumps({"comments": []}), encoding="utf-8")

    monkeypatch.setattr(access_ops, "get_cached_collections", lambda: {
        "restricted": {"visibility": "restricted"},
    })
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(public, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(work_meta, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(utils, "BASE_DIR", str(data_dir))
    utils.WORK_ID_CACHE.clear()
    utils.WORK_ID_CACHE["secret1"] = str(work_dir)

    yield {
        "work_dir": work_dir,
        "meta_path": meta_path,
    }

    utils.WORK_ID_CACHE.clear()


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize(("path", "body"), [
    ("/get-work-metadata", {"work_id": "secret1"}),
    ("/git-history", {"original_path": "secret-work", "file_name": "page1.txt"}),
    ("/commit-diff", {"commit_hash": "deadbeef", "filepath": "secret-work/page1.txt"}),
    ("/page-comments/history", {"original_path": "secret-work", "file_name": "page1.txt"}),
    ("/page-comments/restore", {
        "original_path": "secret-work", "file_name": "page1.txt",
        "mode": "version", "comment_id": "c1", "commit_hash": "deadbeef",
    }),
    ("/git-restore", {
        "original_path": "secret-work", "file_name": "page1.txt", "commit_hash": "deadbeef",
    }),
])
def test_editor_cannot_read_or_restore_restricted_work(
    client, login, restricted_work_env, path, body
):
    token = login("editor", "editorpass")
    response = client.post(path, json=body, headers=_auth(token))
    assert response.status_code == 403, response.text


def test_editor_cannot_save_restricted_work(client, login, restricted_work_env):
    token = login("editor", "editorpass")
    response = client.post("/save", json={
        "original_path": "secret-work",
        "file_name": "page1.txt",
        "text_content": "ülekirjutus",
    }, headers=_auth(token))
    assert response.status_code == 403, response.text
    assert (restricted_work_env["work_dir"] / "page1.txt").read_text(encoding="utf-8") == "salajane tekst"


def test_anonymous_cannot_download_restricted_work(client, restricted_work_env):
    response = client.get("/download/secret1?content=text")
    assert response.status_code == 403, response.text


def test_editor_cannot_toggle_restricted_work(client, login, restricted_work_env):
    token = login("editor", "editorpass")
    response = client.post(
        "/work/secret1/shareable", json={"shareable": True}, headers=_auth(token)
    )
    assert response.status_code == 403, response.text


@pytest.mark.parametrize("operation", ["download", "save", "shareable"])
def test_malformed_metadata_is_fail_closed(
    client, login, restricted_work_env, operation
):
    restricted_work_env["meta_path"].write_text('{"collections": [', encoding="utf-8")

    if operation == "download":
        response = client.get("/download/secret1?content=text")
    else:
        token = login("editor", "editorpass")
        if operation == "save":
            response = client.post("/save", json={
                "original_path": "secret-work",
                "file_name": "page1.txt",
                "text_content": "ülekirjutus",
            }, headers=_auth(token))
        else:
            response = client.post(
                "/work/secret1/shareable", json={"shareable": True}, headers=_auth(token)
            )

    assert response.status_code == 503, response.text
    assert (restricted_work_env["work_dir"] / "page1.txt").read_text(encoding="utf-8") == "salajane tekst"
