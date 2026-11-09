# tests/test_exemplar_image_files.py
"""Eksemplari pildi lähtefail ja vaatamiskuju (ADR 0079 p 1)."""
import io

import pytest
from PIL import Image, ImageFile

from server import exemplar_image_files as eif


def _bytes(img: Image.Image, fmt: str, **kw) -> bytes:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def _jpeg(w, h, orientation=None) -> bytes:
    img = Image.new("RGB", (w, h), (120, 80, 40))
    if orientation is None:
        return _bytes(img, "JPEG")
    exif = Image.Exif()
    exif[0x0112] = orientation
    return _bytes(img, "JPEG", exif=exif.tobytes())


def test_poorata_vaike_jpeg_on_baitkoopia(tmp_path):
    src = _jpeg(800, 600)
    assert eif.store_image(src, str(tmp_path), "x") is None
    assert (tmp_path / "x.jpg").read_bytes() == src
    assert not list(tmp_path.glob("*.orig.*"))


def test_eksif_poordega_jpeg_saab_originaali(tmp_path):
    src = _jpeg(800, 600, orientation=6)
    assert eif.store_image(src, str(tmp_path), "x") == "x.orig.jpg"
    assert (tmp_path / "x.orig.jpg").read_bytes() == src
    with Image.open(tmp_path / "x.jpg") as im:
        assert im.size == (600, 800)


def test_suur_jpeg_saab_originaali_ja_vahendatud_vaate(tmp_path):
    assert eif.store_image(_jpeg(5000, 3000), str(tmp_path), "x") == "x.orig.jpg"
    with Image.open(tmp_path / "x.jpg") as im:
        assert max(im.size) == eif.VIEW_MAX_SIDE


def test_png_saab_originaali(tmp_path):
    src = _bytes(Image.new("RGBA", (40, 30), (1, 2, 3, 0)), "PNG")
    assert eif.store_image(src, str(tmp_path), "x") == "x.orig.png"
    with Image.open(tmp_path / "x.jpg") as im:
        assert im.mode == "RGB" and im.getpixel((0, 0)) == (255, 255, 255)


def test_16bit_tiff_teisendatakse(tmp_path):
    img = Image.new("I;16", (300, 200))
    img.putpixel((0, 0), 65535)
    assert eif.store_image(_bytes(img, "TIFF"), str(tmp_path), "x") == "x.orig.tif"
    with Image.open(tmp_path / "x.jpg") as im:
        assert im.mode == "L"
        assert im.getpixel((0, 0)) > 200


def test_cmyk_tiff_rgb_ks(tmp_path):
    src = _bytes(Image.new("CMYK", (50, 40), (0, 255, 255, 0)), "TIFF")
    assert eif.store_image(src, str(tmp_path), "x") == "x.orig.tif"
    with Image.open(tmp_path / "x.jpg") as im:
        assert im.mode == "RGB"


def test_detect_kind():
    assert eif.detect_kind(_jpeg(4, 4)) == "jpeg"
    assert eif.detect_kind(_bytes(Image.new("L", (4, 4)), "PNG")) == "png"
    assert eif.detect_kind(b"II*\x00rest") == "tiff"
    assert eif.detect_kind(b"MM\x00*rest") == "tiff"


def test_tundmatu_formaat_keeldutakse(tmp_path):
    with pytest.raises(eif.ImageFileError) as e:
        eif.store_image(b"%PDF-1.4 ...", str(tmp_path), "x")
    assert e.value.status == 400
    assert not list(tmp_path.iterdir())


def test_katkine_pilt_keeldutakse(tmp_path):
    with pytest.raises(eif.ImageFileError):
        eif.store_image(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20, str(tmp_path), "x")
    assert not list(tmp_path.iterdir())


def test_liiga_suur_fail_413(tmp_path, monkeypatch):
    monkeypatch.setattr(eif, "MAX_UPLOAD_BYTES", 10)
    with pytest.raises(eif.ImageFileError) as e:
        eif.store_image(_jpeg(8, 8), str(tmp_path), "x")
    assert e.value.status == 413


def test_liiga_suur_moode_keeldutakse_enne_dekodeerimist(tmp_path, monkeypatch):
    src = _bytes(Image.new("L", (13000, 10)), "PNG")
    loaded = []
    # PNG/TIFF/JPEG dekodeerivad `ImageFile.load`-is (Image.Image.load on ülekirjutatud).
    orig_load = ImageFile.ImageFile.load
    monkeypatch.setattr(ImageFile.ImageFile, "load", lambda self: (loaded.append(1), orig_load(self))[1])
    with pytest.raises(eif.ImageFileError):
        eif.store_image(src, str(tmp_path), "x")
    assert loaded == []
    assert not list(tmp_path.iterdir())
