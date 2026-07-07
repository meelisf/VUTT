"""replace_work_content regressioonid."""
import json
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

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

    def fail_sftp(_upload_id):
        raise AssertionError("SFTP-d ei tohi pärast git rm viga avada")

    monkeypatch.setattr(upload_ops, "_sftp_open", fail_sftp)

    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)

    assert exc.value.status_code == 500
    assert "Vana sisu eemaldamine ebaõnnestus" in exc.value.detail
    assert fake_repo.git.checkout_calls == [("abcdef1234567890", "--", slug)]
    assert (work_dir / "vana-teos_pg_001.jpg").exists()
    trash_root = data_dir / "._trash" / work_id / "replaced_content"
    assert not list(trash_root.glob("*/*.jpg"))
