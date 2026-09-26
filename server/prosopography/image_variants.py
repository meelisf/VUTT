"""Isikupildi suurusvariandid (#424).

Väikesed vaated (portree, loendikaart, vormi eelvaade) küsivad lähtepildist
vähendatud koopiat. Variant tehakse laisalt esimesel päringul ja hoitakse
kaustas `images/variants/`; lähtepilt jääb puutumata.

Failinimi kannab lähtefaili `mtime_ns`-i: asendatud lähtepildi vana variant ei
saa kunagi vastata, ka siis kui paralleelne GET kirjutas selle pärast
üleslaadimise koristust. Sellised orvud koristab järgmine üleslaadimine või
kustutamine (`remove_variants`).

Moodul töötab ainult failiteedega ega tea isikukaartidest midagi.
"""
from __future__ import annotations

import glob
import os
import threading

from PIL import Image, ImageOps

from ..config import get_logger

logger = get_logger(__name__)

# Portree 80 px (2× = 160), vormi eelvaade ja kaart ~300 px (2× = 640).
VARIANT_WIDTHS = (160, 320, 640)
VARIANT_DIR_NAME = "variants"
JPEG_QUALITY = 85

# Sama variandi paralleelne genereerimine on raiskamine, mitte viga —
# üks protsessiülene lukk piisab, pilte on kümneid.
_render_lock = threading.Lock()


def _variant_dir(source_path: str) -> str:
    return os.path.join(os.path.dirname(source_path), VARIANT_DIR_NAME)


def _render_variant(source_path: str, target_path: str, width: int) -> bool:
    """Kirjutab vähendatud JPEG-i. False = lähtepilt on kitsam kui `width`."""
    with Image.open(source_path) as img:
        # draft() laseb JPEG-dekoodril kohe väiksemas mõõdus lugeda.
        img.draft("RGB", (width, width * 4))
        img = ImageOps.exif_transpose(img)
        if img.width <= width:
            return False
        height = max(1, round(img.height * width / img.width))
        img = img.convert("RGB").resize((width, height), Image.LANCZOS)
        tmp = f"{target_path}.{os.getpid()}.tmp"
        try:
            img.save(tmp, format="JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            os.replace(tmp, target_path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
    return True


def variant_path_for(source_path: str, width: int) -> str:
    """Tagastab `width` laiuse variandi tee, luues selle vajadusel.

    Kui lähtepilt on kitsam (või ei avane), tagastatakse lähtepilt ise —
    väikest pilti ei venitata ja katkine pilt käitub nagu enne varianti.
    """
    if width not in VARIANT_WIDTHS:
        raise ValueError(f"Lubamatu laius: {width}")
    stem = os.path.splitext(os.path.basename(source_path))[0]
    mtime_ns = os.stat(source_path).st_mtime_ns
    target = os.path.join(_variant_dir(source_path), f"{stem}-{width}-{mtime_ns:x}.jpg")
    if os.path.exists(target):
        return target
    with _render_lock:
        if os.path.exists(target):
            return target
        os.makedirs(os.path.dirname(target), exist_ok=True)
        try:
            if not _render_variant(source_path, target, width):
                return source_path
        except Exception as e:
            logger.warning("Isikupildi variant ebaõnnestus (%s, %s px): %s", source_path, width, e)
            return source_path
    return target


def remove_variants(images_dir: str, stem: str) -> None:
    """Kustutab ühe isiku kõik variandid (sh vananenud orvud)."""
    for path in glob.glob(os.path.join(images_dir, VARIANT_DIR_NAME, f"{glob.escape(stem)}-*.jpg")):
        try:
            os.remove(path)
        except FileNotFoundError:
            pass
