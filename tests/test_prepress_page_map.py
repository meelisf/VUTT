"""page_map: lähteleht → kõik temast tekkinud väljundlehed (ADR 0030)."""
import json
import os

import pytest
from PIL import Image

from server.upload import prepress_apply, state as upload_state


class FakeSftp:
    """Minimaalne SFTP-topis: mkdir nõuab vanemat, nagu päris paramiko."""

    def __init__(self):
        self.dirs = set()

    def put(self, local, remote, callback=None):
        parent = remote.rsplit("/", 1)[0]
        if parent not in self.dirs:
            raise FileNotFoundError(2, "No such file", remote)

    def rename(self, src, dst):
        pass

    def stat(self, path):
        if path not in self.dirs:
            raise FileNotFoundError(path)
        return object()

    def mkdir(self, path):
        self.dirs.add(path)

    def close(self):
        pass


@pytest.fixture
def upload(tmp_path, monkeypatch):
    """Kolme-leheline pildikaust upload'ina; tagastab upload_id."""
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(prepress_apply.upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    uid = "testupl1"
    src = tmp_path / uid / "source"
    src.mkdir(parents=True)
    for i in range(1, 4):
        Image.new("RGB", (200, 100), (120, 120, 120)).save(src / f"{i:03d}.jpg", "JPEG")
    state = {
        "id": uid, "status": "awaiting_split", "meta": {"slug": "test-abc"},
        "files": [], "remote_staging_path": "st", "remote_work_path": "st/wk",
    }
    (tmp_path / uid / "state.json").write_text(json.dumps(state), encoding="utf-8")
    upload_state.init_prepress(uid, 3)
    return uid


def _read_map(tmp_path, uid):
    s = json.loads((tmp_path / uid / "state.json").read_text(encoding="utf-8"))
    return s["prepress"].get("page_map")


def test_page_map_ilma_teisendusteta_on_uks_uhele(upload, tmp_path, monkeypatch):
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: FakeSftp())
    monkeypatch.setattr(prepress_apply, "publish_atomic", lambda *a, **k: None)
    prepress_apply._transfer_pages(
        upload, "test-abc", ("st", "st/wk"), "st/wk",
        upload_state.read_state(upload)["prepress"],
    )
    assert _read_map(tmp_path, upload) == {"1": [1], "2": [2], "3": [3]}


def test_poolitatud_leht_annab_kaks_valjundit(upload, tmp_path, monkeypatch):
    """src 2 poolitatakse → out 2 ja 3; src 3 nihkub 4-ks."""
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: FakeSftp())
    monkeypatch.setattr(prepress_apply, "publish_atomic", lambda *a, **k: None)
    plan = upload_state.read_state(upload)["prepress"]
    plan["pages"][1]["mode"] = "custom"
    plan["pages"][1]["split_x"] = 0.5
    prepress_apply._transfer_pages(upload, "test-abc", ("st", "st/wk"), "st/wk", plan)
    assert _read_map(tmp_path, upload) == {"1": [1], "2": [2, 3], "3": [4]}


def test_valjajaetud_leht_puudub_kaardist(upload, tmp_path, monkeypatch):
    """excluded leht EI ole kaardis — mitte tühja listiga, vaid puudub."""
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: FakeSftp())
    monkeypatch.setattr(prepress_apply, "publish_atomic", lambda *a, **k: None)
    plan = upload_state.read_state(upload)["prepress"]
    plan["pages"][1]["excluded"] = True
    prepress_apply._transfer_pages(upload, "test-abc", ("st", "st/wk"), "st/wk", plan)
    kaart = _read_map(tmp_path, upload)
    assert "2" not in kaart
    assert kaart == {"1": [1], "3": [2]}


def test_apply_algus_nullib_vana_kaardi(upload, tmp_path):
    """try_begin_applying lubab error → applying; vana katse kaart ei tohi jääda."""
    upload_state.mutate_prepress(upload, lambda p: p.update(page_map={"1": [1], "2": [2]}))
    upload_state.set_upload_state(upload, status="error")
    assert upload_state.try_begin_applying(upload) is True
    assert _read_map(tmp_path, upload) == {}
