"""Lähtefaili salvestamine VUTT-i poolele.

MUUDATUS TÄNASE VOO SUHTES: fail EI lähe enam kohe OCR-serverisse. Ta jääb
uploads/{id}/source.pdf-i (või source/ kausta), kuni admin on sammu 3 läbinud.
Muidu oleks poolitamiseks hilja — OCR oleks juba alanud.

Tegelik edastus toimub prepress/apply endpointist ja käib ALATI
`prepress_apply.start_apply()` kaudu — VUTT materialiseerib lehed ise ja avaldab
lehthaaval (ADR 0028). Varem oli siin ka PDF-tee (`transfer_stored_source`), mis
saatis triviaalse plaani originaalfailina LOSSi; see blokeeris pisipildid ja
OCR-i kuni terve faili lahtipakkimiseni ning on eemaldatud.
"""
import os
import shutil

from ..config import get_logger
from . import file_detection
from . import state as upload_state

logger = get_logger(__name__)


def source_pdf_path(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "source.pdf")


def source_images_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "source")


def store_pdf(upload_id: str, tmp_path: str) -> int:
    """Salvestab üleslaaditud PDF-i lokaalselt ja loob prepress-plaani.

    Tagastab lehtede arvu. Tõstab ValueError vigase või toetamata faili korral.
    """
    file_type = file_detection.detect_file_type(tmp_path)
    if file_type != "pdf":
        file_detection.safe_unlink(tmp_path)
        raise ValueError(
            "Toetamata failivorming. Palun laadi üles PDF, JPG, PNG või TIFF fail."
        )

    # count_pdf_pages kustutab vigase PDF-i ise — see on siin õige käitumine.
    pages = file_detection.count_pdf_pages(tmp_path)

    dst = source_pdf_path(upload_id)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(tmp_path, dst)
    os.chmod(dst, 0o644)

    upload_state.set_upload_state(
        upload_id, status="awaiting_split", expected_pages=pages
    )
    upload_state.init_prepress(upload_id, pages)
    logger.info("Lähte-PDF salvestatud: {} ({} lk)".format(upload_id, pages))
    return pages


def store_image_page(upload_id: str, tmp_path: str, page_number: int,
                     total_pages: int) -> int:
    """Salvestab ühe pildilehe source/ kausta. Rasteriseerimist ei ole."""
    try:
        file_detection.validate_upload_image(tmp_path)
    except ValueError:
        file_detection.safe_unlink(tmp_path)
        raise
    file_type = file_detection.detect_file_type(tmp_path)

    directory = source_images_dir(upload_id)
    os.makedirs(directory, exist_ok=True)
    dst = os.path.join(directory, "pg_{:03d}.jpg".format(page_number))

    if file_type in ("png", "tiff"):
        from PIL import Image
        with Image.open(tmp_path) as im:
            im.convert("RGB").save(dst, "JPEG", quality=95)
        file_detection.safe_unlink(tmp_path)
    else:
        shutil.move(tmp_path, dst)
    os.chmod(dst, 0o644)

    if page_number >= total_pages:
        upload_state.set_upload_state(
            upload_id, status="awaiting_split", expected_pages=total_pages
        )
        upload_state.init_prepress(upload_id, total_pages)
    else:
        upload_state.set_upload_state(
            upload_id, status="collecting_images", expected_pages=total_pages
        )
    return total_pages
