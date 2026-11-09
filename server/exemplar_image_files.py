# server/exemplar_image_files.py
"""Eksemplari pildi lähtefail ja vaatamiskuju (ADR 0079 p 1).

Pööramata JPEG, mille pikim külg on ≤ `VIEW_MAX_SIDE`, salvestatakse muutmata
baitidega ja on ise vaatamiskuju (sama reegel mis `can_copy_source_bytes`,
ADR 0028). Muu säilitatakse `{id}.orig.{ext}`-ina ja `{id}.jpg` tehakse sellest:
vesimärgi ja paberistruktuuri detail ei tohi kaduda kadudega teisenduses.
"""
from __future__ import annotations

import io
import os

from PIL import Image, ImageOps

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
MAX_SIDE = 12000
VIEW_MAX_SIDE = 4000
VIEW_QUALITY = 92

_EXT = {"jpeg": "jpg", "png": "png", "tiff": "tif"}
_ORIENTATION = 0x0112


class ImageFileError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def detect_kind(content: bytes) -> str:
    """Failitüüp magic byte'idest (mitte laiendist)."""
    if content[:3] == b"\xff\xd8\xff":
        return "jpeg"
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if content[:4] in (b"II*\x00", b"MM\x00*"):
        return "tiff"
    raise ImageFileError("Toetamata failitüüp (lubatud JPEG, PNG, TIFF)")


def _write_atomic(path: str, data: bytes) -> None:
    tmp = f"{path}.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def _view_image(img: Image.Image) -> Image.Image:
    """Vaatamiskuju: EXIF-i pööre, režiim RGB või L, pikim külg ≤ VIEW_MAX_SIDE."""
    img = ImageOps.exif_transpose(img)
    mode = img.mode
    if mode in ("I;16", "I;16B", "I;16L", "I;16N", "I"):
        # 16-bit halltoon → 8-bit: lineaarne skaala, mitte kärpimine.
        img = img.convert("I").point(lambda v: v * (1 / 256)).convert("L")
    elif mode == "F":
        img = img.convert("L")
    elif mode in ("RGBA", "LA", "PA") or (mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, (255, 255, 255))
        bg.paste(rgba, mask=rgba.getchannel("A"))
        img = bg
    elif mode == "1":
        img = img.convert("L")
    elif mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if max(img.size) > VIEW_MAX_SIDE:
        img.thumbnail((VIEW_MAX_SIDE, VIEW_MAX_SIDE), Image.LANCZOS)
    return img


def store_image(content: bytes, dest_dir: str, image_id: str) -> str | None:
    """Kirjutab `{id}.jpg` ja vajadusel `{id}.orig.{ext}`. Tagastab lähtefaili nime
    või `None`, kui `{id}.jpg` on ise lähtefail. Viga → midagi ei kirjutata."""
    if len(content) > MAX_UPLOAD_BYTES:
        raise ImageFileError("Fail on liiga suur (üle 100 MB)", 413)
    kind = detect_kind(content)
    try:
        img = Image.open(io.BytesIO(content))
        # Mõõt tuleb päisest; dekodeerimine alles pärast kontrolli (pildipommi kaitse).
        if max(img.size) > MAX_SIDE:
            raise ImageFileError(f"Pilt on liiga suur (pikim külg üle {MAX_SIDE} px)")
        orientation = img.getexif().get(_ORIENTATION, 1) if kind == "jpeg" else 1
        if kind == "jpeg" and orientation in (1, None) and max(img.size) <= VIEW_MAX_SIDE:
            img.close()
            os.makedirs(dest_dir, exist_ok=True)
            _write_atomic(os.path.join(dest_dir, f"{image_id}.jpg"), content)
            return None
        img.load()
        view = _view_image(img)
        buf = io.BytesIO()
        view.save(buf, "JPEG", quality=VIEW_QUALITY)
    except ImageFileError:
        raise
    except Exception as e:  # katkine või loetamatu pilt
        raise ImageFileError(f"Pilti ei saa lugeda: {e}")

    original = f"{image_id}.orig.{_EXT[kind]}"
    os.makedirs(dest_dir, exist_ok=True)
    _write_atomic(os.path.join(dest_dir, original), content)
    _write_atomic(os.path.join(dest_dir, f"{image_id}.jpg"), buf.getvalue())
    return original
