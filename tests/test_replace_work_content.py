"""replace_work_content regressioonid."""
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from git import Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import upload_ops
from server.upload import state as upload_state


class _FakeGit:
    def __init__(self):
        self.checkout_calls = []

    def rm(self, _path):
        raise RuntimeError("index.lock")

    def checkout(self, *args):
        self.checkout_calls.append(args)


class _FakeRepo:
    def __init__(self):
        self.git = _FakeGit()
        self.head = type("Head", (), {
            "commit": type("Commit", (), {"hexsha": "abcdef1234567890"})()
        })()


def _setup_replace_files(tmp_path, monkeypatch):
    """Loob replace-testide upload state'i ja olemasoleva teose."""
    import server.utils as utils

    uploads_dir = tmp_path / "uploads"
    data_dir = tmp_path / "data"
    upload_id = "upl123"
    slug = "vana-teos"
    work_id = "wid123"
    upload_dir = uploads_dir / upload_id
    work_dir = data_dir / slug
    upload_dir.mkdir(parents=True)
    work_dir.mkdir(parents=True)
    (upload_dir / "state.json").write_text(json.dumps({
        "id": upload_id,
        "status": "reviewing",
        "remote_work_path": "AUTO-OCR/print/upl123/uus-teos",
        "remote_staging_path": "AUTO-OCR/print/upl123",
        "files": [{"page": 1, "has_ocr": True, "deleted": False}],
        "meta": {"title": "Uus", "year": "1700", "slug": "uus-teos"},
    }), encoding="utf-8")
    (work_dir / "_metadata.json").write_text(json.dumps({"id": work_id, "title": "Vana"}), encoding="utf-8")
    (work_dir / "vana-teos_pg_001.jpg").write_bytes(b"vana jpg")
    (work_dir / "vana-teos_pg_001.txt").write_text("vana tekst", encoding="utf-8")
    (work_dir / "vana-teos_pg_001.json").write_text("{}", encoding="utf-8")

    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(uploads_dir))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads_dir))
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(utils, "find_directory_by_id", lambda wid: str(work_dir) if wid == work_id else None)
    return upload_id, work_id, slug, work_dir, data_dir


class _ListSftp:
    def __init__(self, items):
        self.items = items
        self.closed = False
        self.get_calls = []

    def listdir(self, _path):
        return self.items

    def get(self, remote, local):
        self.get_calls.append((remote, local))

    def close(self):
        self.closed = True


def test_replace_incomplete_preflight_does_not_touch_existing_work(tmp_path, monkeypatch):
    """Tavapärane puuduv remote fail avastatakse enne git rm-i ja JPG arhiveerimist."""
    import server.git_ops as git_ops

    upload_id, work_id, _slug, work_dir, data_dir = _setup_replace_files(tmp_path, monkeypatch)
    sftp = _ListSftp(["uus-teos_pg_001.jpg"])
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _upload_id: sftp)
    monkeypatch.setattr(
        git_ops, "get_or_init_repo",
        lambda: (_ for _ in ()).throw(AssertionError("Gitini ei tohi jõuda")),
    )

    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)

    assert exc.value.status_code == 400
    assert "TXT puudub lehtedel 1" in exc.value.detail
    assert sftp.closed is True
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"
    assert not (data_dir / "._trash").exists()


def test_replace_remote_change_after_preflight_rolls_back_existing_work(tmp_path, monkeypatch):
    """Kui fail kaob pärast preflight'i, taastab destruktiivse sammu rollback vana teose."""
    import server.git_ops as git_ops

    upload_id, work_id, slug, work_dir, data_dir = _setup_replace_files(tmp_path, monkeypatch)
    repo = Repo.init(str(data_dir))
    with repo.config_writer() as config:
        config.set_value("user", "name", "test").set_value("user", "email", "test@example.test")
    repo.index.add([
        f"{slug}/_metadata.json",
        f"{slug}/vana-teos_pg_001.txt",
        f"{slug}/vana-teos_pg_001.json",
    ])
    repo.index.commit("Algseis")

    sftps = [
        _ListSftp(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]),
        _ListSftp(["uus-teos_pg_001.jpg"]),
    ]
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _upload_id: sftps.pop(0))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)

    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)

    assert exc.value.status_code == 500
    assert "TXT puudub lehtedel 1" in exc.value.detail
    assert sftps == []
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert (work_dir / "vana-teos_pg_001.txt").read_text(encoding="utf-8") == "vana tekst"
    assert (work_dir / "vana-teos_pg_001.json").read_text(encoding="utf-8") == "{}"
    trash_root = data_dir / "._trash" / work_id / "replaced_content"
    assert not list(trash_root.glob("*/*.jpg"))


def test_replace_work_content_git_rm_viga_katkestab_ja_taastab_jpg(tmp_path, monkeypatch):
    """Kui git rm ebaõnnestub, ei tohi allalaadimisega jätkata ega JPG-sid prügikasti jätta."""
    import server.git_ops as git_ops
    import server.utils as utils

    uploads_dir = tmp_path / "uploads"
    data_dir = tmp_path / "data"
    upload_id = "upl123"
    slug = "vana-teos"
    work_id = "wid123"
    upload_dir = uploads_dir / upload_id
    work_dir = data_dir / slug
    upload_dir.mkdir(parents=True)
    work_dir.mkdir(parents=True)

    (upload_dir / "state.json").write_text(json.dumps({
        "id": upload_id,
        "status": "reviewing",
        "remote_work_path": "AUTO-OCR/print/upl123/uus-teos",
        "files": [{"page": 1, "has_ocr": True, "deleted": False}],
        "meta": {"title": "Uus", "year": "1700", "slug": "uus-teos"},
    }), encoding="utf-8")
    (work_dir / "_metadata.json").write_text(json.dumps({"id": work_id, "title": "Vana"}), encoding="utf-8")
    (work_dir / "vana-teos_pg_001.jpg").write_bytes(b"jpg")
    (work_dir / "vana-teos_pg_001.txt").write_text("vana tekst", encoding="utf-8")
    (work_dir / "vana-teos_pg_001.json").write_text("{}", encoding="utf-8")

    fake_repo = _FakeRepo()
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(uploads_dir))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads_dir))
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(utils, "find_directory_by_id", lambda wid: str(work_dir) if wid == work_id else None)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: fake_repo)

    preflight_sftp = _ListSftp(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"])
    sftp_calls = []

    def sftp_factory(_upload_id):
        sftp_calls.append(_upload_id)
        if len(sftp_calls) == 1:
            return preflight_sftp
        raise AssertionError("Teist SFTP ühendust ei tohi pärast git rm viga avada")

    monkeypatch.setattr(upload_ops, "_sftp_open", sftp_factory)

    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)

    assert exc.value.status_code == 500
    assert "Vana sisu eemaldamine ebaõnnestus" in exc.value.detail
    assert fake_repo.git.checkout_calls == [("abcdef1234567890", "--", slug)]
    assert (work_dir / "vana-teos_pg_001.jpg").exists()
    trash_root = data_dir / "._trash" / work_id / "replaced_content"
    assert not list(trash_root.glob("*/*.jpg"))
