"""Pisipilt kirjutatakse atomaarselt.

Ilma selleta näeb paralleelne HTTP GET (`/admin/upload/{id}/thumb/{n}`) või
teine poll poolikut JPEG-i. See on OLEMASOLEV latentne viga: `_create_thumbnail`
salvestas PIL-iga otse lõppteele.
"""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import thumbs as upload_thumbs


def _pilt(path, suurus=(1200, 1600)):
    from PIL import Image
    Image.new("RGB", suurus, (200, 180, 160)).save(path, "JPEG", quality=95)


def test_write_thumbnail_mahutab_400x600_kasti(tmp_path):
    src = tmp_path / "src.jpg"
    dst = tmp_path / "001.jpg"
    _pilt(src)

    upload_thumbs.write_thumbnail(str(src), str(dst))

    from PIL import Image
    with Image.open(dst) as im:
        assert im.size[0] <= 400 and im.size[1] <= 600


def test_write_thumbnail_ei_jata_tmp_faili(tmp_path):
    src = tmp_path / "src.jpg"
    dst = tmp_path / "001.jpg"
    _pilt(src)

    upload_thumbs.write_thumbnail(str(src), str(dst))

    assert set(os.listdir(tmp_path)) == {"src.jpg", "001.jpg"}


def test_write_thumbnail_ei_jata_poolikut_faili_vea_korral(tmp_path):
    """Kukkumine ei tohi jätta lõppteele poolikut pilti ega .tmp jäänukit."""
    src = tmp_path / "katki.jpg"
    src.write_bytes(b"see ei ole JPEG")
    dst = tmp_path / "001.jpg"

    with pytest.raises(Exception):
        upload_thumbs.write_thumbnail(str(src), str(dst))

    assert not dst.exists(), "lõppteele ei tohi jääda midagi"
    assert set(os.listdir(tmp_path)) == {"katki.jpg"}


def test_create_thumbnail_kasutab_write_thumbnaili(tmp_path, monkeypatch):
    """SFTP-tee ja apply-tee peavad kirjutama SAMA moodi — üks teostus."""
    src = tmp_path / "kaug.jpg"
    _pilt(src)
    dst = tmp_path / "002.jpg"
    tmp_dl = tmp_path / "002.jpg.tmp"

    class _SFTP:
        def get(self, remote, local):
            # Simuleerib allalaadimist: kopeerib lähtefaili ajutisele teele.
            Path(local).write_bytes(src.read_bytes())

    kutsutud = []
    paris = upload_thumbs.write_thumbnail
    monkeypatch.setattr(upload_thumbs, "write_thumbnail",
                        lambda a, b: kutsutud.append((a, b)) or paris(a, b))

    upload_thumbs._create_thumbnail(_SFTP(), "kaug/pg.jpg", str(tmp_dl), str(dst))

    assert kutsutud == [(str(tmp_dl), str(dst))]
    assert dst.exists()
    assert not tmp_dl.exists(), "allalaadimise ajutine fail tuleb koristada"
