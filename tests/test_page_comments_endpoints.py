"""Endpoint-testid: /page-comments/history ja /page-comments/restore."""
import json
import os

import pytest
from git import Repo


def test_history_rejects_non_basename_filename(client, login, backend_env):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/history",
        json={"original_path": "1690-w1", "file_name": "../escape.txt"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


def test_history_requires_editor(client, login, backend_env):
    r = client.post(
        "/page-comments/history",
        json={"original_path": "1690-w1", "file_name": "pg1.txt"},
    )
    assert r.status_code == 401


@pytest.fixture
def page_repo(backend_env, tmp_path, monkeypatch):
    """Git-repo lehe pg1.json-iga: c1 muudeti, c2 kustutati."""
    import server.git_ops as git_ops
    import server.routers.editing as editing

    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")

    txt = folder / "pg1.txt"
    jp = folder / "pg1.json"
    txt.write_text("lehe tekst", encoding="utf-8")
    (folder / "_metadata.json").write_text(
        json.dumps({"id": "work1", "collections": []}), encoding="utf-8"
    )

    def commit(comments, msg):
        jp.write_text(json.dumps({"comments": comments}, ensure_ascii=False, indent=2),
                      encoding="utf-8")
        r.index.add([os.path.relpath(str(txt), str(data_dir)),
                     os.path.relpath(str(jp), str(data_dir))])
        r.index.commit(msg)

    c1 = {"id": "c1", "text": "vana", "author": "u", "created_at": "2026-01-01T00:00:00", "replies": []}
    c2 = {"id": "c2", "text": "kustutatav", "author": "u", "created_at": "2026-01-01T00:00:00", "replies": []}
    commit([c1, c2], "v1")
    commit([{**c1, "text": "uus"}], "v2 (c2 kustutatud, c1 muudetud)")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)

    v1_hash = list(r.iter_commits())[-1].hexsha
    return {"repo": r, "folder": folder, "v1_hash": v1_hash, "jp": jp}


def test_restore_version_overwrites_text(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "version", "comment_id": "c1", "commit_hash": page_repo["v1_hash"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    comments = r.json()["comments"]
    assert next(c for c in comments if c["id"] == "c1")["text"] == "vana"
    on_disk = json.loads(page_repo["jp"].read_text(encoding="utf-8"))["comments"]
    assert next(c for c in on_disk if c["id"] == "c1")["text"] == "vana"


def test_restore_deleted_appends(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "deleted", "comment_id": "c2", "commit_hash": page_repo["v1_hash"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200, r.text
    assert any(c["id"] == "c2" for c in r.json()["comments"])


def test_restore_rejects_commit_outside_history(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "version", "comment_id": "c1", "commit_hash": "0" * 40},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400, r.text


def test_restore_version_missing_comment_in_commit(client, login, page_repo):
    token = login("editor", "editorpass")
    v2_hash = list(page_repo["repo"].iter_commits())[0].hexsha
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "version", "comment_id": "c2", "commit_hash": v2_hash},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404, r.text


def test_restore_deleted_conflict_when_id_exists(client, login, page_repo):
    token = login("editor", "editorpass")
    r = client.post(
        "/page-comments/restore",
        json={"original_path": "1690-w1", "file_name": "pg1.txt",
              "mode": "deleted", "comment_id": "c1", "commit_hash": page_repo["v1_hash"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 409, r.text
