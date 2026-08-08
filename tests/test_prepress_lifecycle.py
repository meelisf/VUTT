"""Prepress-artefaktide elutsükkel: mis kaob millal."""
import pytest

from server.upload import prepress
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    (base / "preview").mkdir(parents=True)
    (base / "preview" / "pg_0001.jpg").write_bytes(b"x")
    (base / "source.pdf").write_bytes(b"%PDF")
    (base / "thumbs").mkdir()
    (base / "thumbs" / "001.jpg").write_bytes(b"x")
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(prepress.upload_state, "upload_dir", lambda i: str(base))
    return uid, base


def test_koristus_kustutab_preview_ja_source(upload):
    uid, base = upload
    prepress.cleanup_prepress_artifacts(uid)
    assert not (base / "preview").exists()
    assert not (base / "source.pdf").exists()


def test_koristus_ei_puutu_thumbs_kausta(upload):
    """thumbs/ on OCR-järgse ülevaatuse oma — sellest sõltub samm 4."""
    uid, base = upload
    prepress.cleanup_prepress_artifacts(uid)
    assert (base / "thumbs" / "001.jpg").exists()


def test_koristus_on_idempotentne(upload):
    uid, _ = upload
    prepress.cleanup_prepress_artifacts(uid)
    prepress.cleanup_prepress_artifacts(uid)   # ei tohi visata
