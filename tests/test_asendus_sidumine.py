"""Asendus on seotud üleslaadimisse salvestatud teosega (ADR 0089 p 1).

`replace-work/{work_id}` võttis sihtteose ID URL-ist ega võrrelnud seda state'i
`replace_work_id`-ga: vale ID-ga päring oleks asendanud teise teose lehestiku.
"""
import json

import pytest
from fastapi import HTTPException

from server import upload_ops
from test_replace_work_content import _setup_replace_files


def _sea_replace_work_id(tmp_path, upload_id, value):
    path = tmp_path / "uploads" / upload_id / "state.json"
    state = json.loads(path.read_text(encoding="utf-8"))
    state["replace_work_id"] = value
    path.write_text(json.dumps(state), encoding="utf-8")


def test_url_ja_replace_work_id_erinevad_409(tmp_path, monkeypatch):
    upload_id, work_id, _slug, work_dir, data_dir = _setup_replace_files(tmp_path, monkeypatch)
    _sea_replace_work_id(tmp_path, upload_id, "muuteos9")
    monkeypatch.setattr(upload_ops, "_sftp_open",
                        lambda _u: (_ for _ in ()).throw(AssertionError("SFTP-ni ei tohi jõuda")))

    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)

    assert exc.value.status_code == 409
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert not (data_dir / "._trash").exists()


def test_sobiv_work_id_laheb_edasi(tmp_path, monkeypatch):
    """Sama ID → sidumiskontroll laseb läbi (järgmine samm on SFTP preflight)."""
    upload_id, work_id, _slug, _work_dir, _data_dir = _setup_replace_files(tmp_path, monkeypatch)
    _sea_replace_work_id(tmp_path, upload_id, work_id)

    class Jouti(Exception):
        pass

    monkeypatch.setattr(upload_ops, "_sftp_open", lambda _u: (_ for _ in ()).throw(Jouti()))
    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert exc.value.status_code == 500   # preflight'i viga, mitte 409
