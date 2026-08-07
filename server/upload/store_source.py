"""Lähtefaili salvestamine VUTT-i poolele.

MUUDATUS TÄNASE VOO SUHTES: fail EI lähe enam kohe OCR-serverisse. Ta jääb
uploads/{id}/source.pdf-i (või source/ kausta), kuni admin on sammu 3 läbinud.
Muidu oleks poolitamiseks hilja — OCR oleks juba alanud.

Tegelik edastus toimub prepress/apply endpointist:
  - triviaalne plaan → transfer_stored_source() (tänane PDF-tee)
  - poolitusi on   → prepress_apply.start_apply() (300 DPI JPG-d)
"""
import os
import shutil
import threading

from ..config import get_logger
from . import file_detection, ocr_client
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


def transfer_stored_source(upload_id: str) -> None:
    """Triviaalse plaani tee: saadab salvestatud originaali muutmata.

    See on TÄNANE käitumine, ainult lähtekoht on muutunud (uploads/{id}/ tmp
    faili asemel). Lähtefail jääb alles kuni impordini.
    """
    state = upload_state.read_state(upload_id)
    if not state:
        return

    pdf = source_pdf_path(upload_id)
    if os.path.isfile(pdf):
        _transfer_pdf_thread(upload_id, state, pdf)
        return

    directory = source_images_dir(upload_id)
    if os.path.isdir(directory):
        _transfer_images_thread(upload_id, state, directory)
        return

    upload_state.set_upload_state(
        upload_id, status="error", error_message="Lähteallikat ei leitud"
    )


def _transfer_pdf_thread(upload_id: str, state: dict, pdf: str) -> None:
    from ..config import OCR_SERVER_PATH

    slug = state["meta"]["slug"]
    staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_tmp = "{}/{}.pdf.tmp".format(staging, slug)
    remote_dst = "{}/{}.pdf".format(staging, slug)

    def _run():
        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (staging,))
            sftp.put(pdf, remote_tmp)
            sftp.rename(remote_tmp, remote_dst)
            upload_state.set_upload_state(upload_id, status="processing")
            logger.info("Lähte-PDF edastatud OCR-serverisse: {}".format(upload_id))
        except Exception as e:
            logger.error("PDF edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-pdf-{}".format(upload_id)
    ).start()


def _transfer_images_thread(upload_id: str, state: dict, directory: str) -> None:
    from ..config import OCR_SERVER_PATH
    from .prepress_apply import publish_atomic

    slug = state["meta"]["slug"]
    remote_work = "{}/{}".format(OCR_SERVER_PATH, state["remote_work_path"])

    def _run():
        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (remote_work,))
            for i, name in enumerate(sorted(os.listdir(directory)), start=1):
                publish_atomic(
                    sftp,
                    os.path.join(directory, name),
                    "{}/{}_pg_{:03d}.jpg".format(remote_work, slug, i),
                )
            upload_state.set_upload_state(upload_id, status="processing")
        except Exception as e:
            logger.error("Piltide edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-img-{}".format(upload_id)
    ).start()
