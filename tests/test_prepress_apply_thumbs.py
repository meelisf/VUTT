"""Apply kirjutab pisipildi sealsamas, kus 300 DPI pilt juba kettal on.

Null SFTP-d, null lisarenderdust — ja see teeb võimalikuks I2 (poll ei tõmba
apply ajal midagi tagasi). Vt ADR 0028.
"""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import prepress_apply, state as upload_state


class _SFTP:
    def __init__(self):
        self.avaldatud = []

    def close(self):
        pass


@pytest.fixture
def apply_env(tmp_path, monkeypatch):
    """Renderdus ja SFTP asendatud; ainus päris asi on failisüsteem."""
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    upload_state.write_state("u1", {
        "id": "u1", "status": "applying", "meta": {"slug": "1651-teos"},
        "prepress": _plaan(),
    })

    src = tmp_path / "source.pdf"
    src.write_bytes(b"%PDF-1.4 fake")
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda uid: str(src))

    class _Source:
        def page_count(self):
            return 2

        def source_file(self, n):
            return None                     # PDF — baithaaval kopeerimist ei ole

        def render_full(self, n, dst):
            from PIL import Image
            Image.new("RGB", (1200, 1600), (n * 40, 120, 160)).save(
                dst, "JPEG", quality=95)

    monkeypatch.setattr(prepress_apply.page_source, "open_page_source",
                        lambda p: _Source())
    sftp = _SFTP()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda uid: sftp)
    monkeypatch.setattr(prepress_apply.ocr_client, "ensure_remote_dirs",
                        lambda s, d: None)
    monkeypatch.setattr(prepress_apply, "publish_atomic",
                        lambda s, local, remote: sftp.avaldatud.append(remote))
    return uploads, sftp


def _plaan():
    return {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": "nosplit", "split_x": None, "excluded": False},
        {"n": 2, "mode": "nosplit", "split_x": None, "excluded": False},
    ]}


def test_apply_kirjutab_pisipildi_iga_avaldatud_lehe_kohta(apply_env):
    uploads, sftp = apply_env

    sent = prepress_apply._transfer_pages(
        "u1", "1651-teos", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan())

    assert sent == 2
    thumbs = sorted(os.listdir(uploads / "u1" / "thumbs"))
    assert thumbs == ["001.jpg", "002.jpg"]


def test_pisipildi_viga_ei_katkesta_apply_d(apply_env, monkeypatch):
    """Kaugpilt on selleks hetkeks juba avaldatud — tuletatud UI-artefakti
    pärast ei tohi OCR-i konveierit maha võtta."""
    uploads, sftp = apply_env

    def _kukub(src, dst):
        raise OSError("ketas täis")

    monkeypatch.setattr(prepress_apply.thumbs, "write_thumbnail", _kukub)

    sent = prepress_apply._transfer_pages(
        "u1", "1651-teos", ("/srv/st", "/srv/st/w"), "/srv/st/w", _plaan())

    assert sent == 2, "avaldamine peab lõpuni jooksma"
    assert len(sftp.avaldatud) == 2


def test_poolitatud_leht_annab_kaks_pisipilti(apply_env):
    """Pisipildi number käib VÄLJUND-lehe (out_index), mitte lähtelehe järgi."""
    uploads, sftp = apply_env
    plaan = {"default_split_x": 0.5, "pages": [
        {"n": 1, "mode": "default", "split_x": None, "excluded": False},
        {"n": 2, "mode": "nosplit", "split_x": None, "excluded": False},
    ]}

    sent = prepress_apply._transfer_pages(
        "u1", "1651-teos", ("/srv/st", "/srv/st/w"), "/srv/st/w", plaan)

    assert sent == 3
    assert sorted(os.listdir(uploads / "u1" / "thumbs")) == [
        "001.jpg", "002.jpg", "003.jpg"]
