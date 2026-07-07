"""Uploadi failide ja nimede puhtad helperid.

Moodul sisaldab loogikat, mis ei sõltu uploadi state'ist ega SFTP ühendustest:
slug'id, failitüübi tuvastus, pildi sanity-kontroll, PDF lehekülgede arv ja
failinimede valideerimine.
"""
import os
import re
import subprocess
import unicodedata
import warnings
from typing import Any

from ..config import get_logger

logger = get_logger(__name__)

# Pildi-uploadi sanity piirid. Väga kõrged, et tavalised suured skannid töötaksid,
# aga patoloogilised/decompression-bomb sisendid ei jõuaks OCR-serverisse.
UPLOAD_IMAGE_MAX_PIXELS = int(os.getenv("UPLOAD_IMAGE_MAX_PIXELS", "150000000"))
UPLOAD_IMAGE_MAX_DIMENSION = int(os.getenv("UPLOAD_IMAGE_MAX_DIMENSION", "30000"))
try:
    from PIL import Image as _PILImage

    _PILImage.MAX_IMAGE_PIXELS = UPLOAD_IMAGE_MAX_PIXELS
    warnings.simplefilter("error", _PILImage.DecompressionBombWarning)
except Exception:
    pass

SLUG_MAX_LEN = 80


def valid_upload_id(upload_id: str) -> bool:
    """Valideerib upload_id formaadi (ainult a-z0-9, max 20 märki)."""
    return bool(re.match(r"^[a-z0-9]{1,20}$", upload_id))


def valid_filename(filename: str) -> bool:
    """Valideerib failinime (ainult a-z0-9._-, keelatud .. ja /)."""
    return bool(re.match(r"^[a-z0-9._-]+$", filename)) and ".." not in filename


def extract_page_num(base: str) -> int:
    """
    Eraldab leheküljenumbri OCR failinimest.
    '{year}-{slug}_pg_001' → 1
    """
    parts = base.rsplit("_pg_", 1)
    if len(parts) == 2:
        try:
            return int(parts[1])
        except ValueError:
            pass
    return 0


def sanitize_slug(text: str) -> str:
    """Puhastab teksti, et see sobiks slug-iks (ainult a-z, 0-9, sidekriips, max 80 tähemärki)."""
    normalized = unicodedata.normalize("NFD", text)
    ascii_text = "".join(c for c in normalized if unicodedata.category(c) != "Mn")
    slug = ascii_text.lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = slug[:SLUG_MAX_LEN].rstrip("-")
    return slug or "teos"


def page_base_name(slug: str, work_id: str, pn: int) -> str:
    """Lehekülje failinime tüvi (ilma laiendita).

    Uus konventsioon: kaust = {slug}, kus slug juba sisaldab work_id'd → {slug}-{pn}.
    Vana konventsioon: kaust = {slug} ilma work_id'ta → {slug}-{work_id}-{pn}.
    """
    if slug.endswith(f"-{work_id}"):
        return f"{slug}-{pn:03d}"
    return f"{slug}-{work_id}-{pn:03d}"


def detect_file_type(path: str) -> str:
    """Tuvastab faili tüübi magic bytes alusel. Tagastab 'pdf', 'jpeg', 'png', 'tiff' või 'unknown'."""
    with open(path, "rb") as f:
        header = f.read(1024)
    if b"%PDF" in header[:1024]:
        return "pdf"
    if header[:2] == b"\xff\xd8":
        return "jpeg"
    if header[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if header[:4] in (b"II\x2a\x00", b"MM\x00\x2a"):  # little-endian ja big-endian TIFF
        return "tiff"
    return "unknown"


def validate_upload_image(path: str) -> tuple[int, int]:
    """Kontrollib pildi mõõtmeid enne OCR-serverisse saatmist.

    See ei sea väikest praktilist skannipiiri, vaid lõikab ära patoloogilised
    sisendid: liiga suur pikselite koguarv, absurdne üksik mõõde või vigane pilt.
    Tagastab (width, height).
    """
    try:
        from PIL import Image, UnidentifiedImageError
    except ImportError as e:
        raise ValueError("Pildi töötlemise tugi puudub (Pillow pole paigaldatud)") from e

    try:
        with Image.open(path) as img:
            width, height = img.size
            if width <= 0 or height <= 0:
                raise ValueError("Pildi mõõtmeid ei õnnestunud tuvastada")
            if width > UPLOAD_IMAGE_MAX_DIMENSION or height > UPLOAD_IMAGE_MAX_DIMENSION:
                raise ValueError(
                    f"Pilt on liiga suur: {width}×{height} px. "
                    f"Maksimaalne lubatud külg on {UPLOAD_IMAGE_MAX_DIMENSION} px."
                )
            pixels = width * height
            if pixels > UPLOAD_IMAGE_MAX_PIXELS:
                raise ValueError(
                    f"Pilt on liiga suur: {width}×{height} px ({pixels} pikslit). "
                    f"Maksimaalne lubatud kogus on {UPLOAD_IMAGE_MAX_PIXELS} pikslit."
                )
            img.verify()
            return width, height
    except ValueError:
        raise
    except UnidentifiedImageError as e:
        raise ValueError("Vigane pildifail — pilti ei õnnestunud avada") from e
    except Exception as e:
        raise ValueError(f"Vigane pildifail — {e}") from e


def safe_unlink(path: str):
    """Kustutab faili, ignoreerides vigu (ajutised failid, juba kustutatud)."""
    try:
        os.unlink(path)
    except Exception:
        pass


def count_pdf_pages(tmp_path: str, log: Any = logger) -> int:
    """Loeb PDF-i lehekülgede arvu pdfinfo abil.

    Tõstab ValueError kui:
      - PDF on vigane (pdfinfo viga) — tmp_path kustutatakse;
      - lehekülgede arvu ei leidu pdfinfo väljundist;
      - pdfinfo pole paigaldatud (FileNotFoundError);
      - pdfinfo aegub (TimeoutExpired).
    """
    try:
        result = subprocess.run(
            ["pdfinfo", tmp_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            log.error(f"pdfinfo viga: {result.stderr}")
            safe_unlink(tmp_path)
            raise ValueError(
                f"Vigane PDF — fail ei ole korrektne PDF-dokument (pdfinfo viga). "
                f"Kontrolli, et laadid üles õige faili."
            )

        pages = None
        for line in result.stdout.splitlines():
            if line.startswith("Pages:"):
                pages = int(line.split(":", 1)[1].strip())
                break
        if pages is None:
            log.error(f"pdfinfo väljundis puudus 'Pages:': {result.stdout}")
            raise ValueError("PDF lehekülgede arvu ei õnnestunud tuvastada")
        return pages

    except FileNotFoundError:
        raise ValueError("pdfinfo pole paigaldatud (apt install poppler-utils)")
    except subprocess.TimeoutExpired:
        raise ValueError("PDF analüüs võttis liiga kaua — fail on liiga suur või kahjustatud")
