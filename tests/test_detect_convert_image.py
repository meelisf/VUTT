"""Testid pildituvastusele ja PNG→JPG teisendusele."""
import io
import sys
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
from server.admin_page_ops import detect_and_convert_image


def _png_bytes(mode, size=(10, 10), color=(255, 0, 0, 128)):
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _jpg_bytes(size=(10, 10), color=(10, 20, 30)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_jpg_passes_through_unchanged():
    data = _jpg_bytes()
    out, ext = detect_and_convert_image(data, "x.jpg")
    assert out == data            # JPG-d ei re-enkodeerita
    assert ext == ".jpg"


def test_png_rgb_converted_to_jpg():
    data = _png_bytes("RGB", color=(10, 20, 30))
    out, ext = detect_and_convert_image(data, "x.png")
    assert ext == ".jpg"
    assert out[:3] == b"\xff\xd8\xff"   # JPEG magic


def test_png_rgba_transparent_flattens_to_white():
    # Täielikult läbipaistev punane RGBA → valge taust (mitte must)
    data = _png_bytes("RGBA", color=(255, 0, 0, 0))
    out, _ = detect_and_convert_image(data, "x.png")
    px = Image.open(io.BytesIO(out)).convert("RGB").getpixel((5, 5))
    assert px == (255, 255, 255)


def test_png_la_mode_flattens_to_white():
    data = _png_bytes("LA", color=(0, 0))   # läbipaistev
    out, _ = detect_and_convert_image(data, "x.png")
    px = Image.open(io.BytesIO(out)).convert("RGB").getpixel((5, 5))
    assert px == (255, 255, 255)


def test_pdf_rejected():
    with pytest.raises(ValueError):
        detect_and_convert_image(b"%PDF-1.4 rest", "x.pdf")


def test_unknown_rejected():
    with pytest.raises(ValueError):
        detect_and_convert_image(b"not an image at all", "x.txt")


def test_oversized_dimension_rejected():
    big = _jpg_bytes(size=(10001, 10))
    with pytest.raises(ValueError):
        detect_and_convert_image(big, "big.jpg")
