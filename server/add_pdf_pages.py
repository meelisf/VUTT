"""PDF-ist lehtede lisamine teose halduses (ADR 0074).

Üks renderdaja, üks sisestuskiht:
- lehed renderdab upload'i `PdfPageSource.render_full` (ADR 0028/0073 reegel
  kehtib ka siin) `RENDER_SEMAPHORE` all — oma pdftoppm-kutset siin EI ole;
- sisestab `insert_prepared_pages` (sama sisekiht mis piltide lisamisel):
  üks commit, üks Meili sünk, ankur lahendatakse `work_lock`-i all.

Renderdus käib luku VÄLJAS ja võib kesta minuteid. Ajutine kaust on teose
kaustas (`.tmp-pdf-<hex>`), sest `/data` ja `/app/state` on eri mountid ja
valmis pildid liigutatakse `os.replace`-iga. Serveri restart keset tööd jätab
kausta maha — järgmine sama teose PDF koristab üle `STALE_TMP_S` vanad.
"""
import os
import shutil
import time
import uuid

from .admin_page_ops import AnchorMissing, get_sorted_images, insert_prepared_pages
from .config import get_logger
from .upload.file_detection import detect_file_type
from .upload.page_source import PdfPageSource
from .upload.prepress import RENDER_SEMAPHORE

logger = get_logger(__name__)

PDF_MAX_BYTES = 200 * 1024 * 1024
PDF_MAX_PAGES = 500
TMP_PREFIX = ".tmp-pdf-"
STALE_TMP_S = 24 * 3600
_COPY_CHUNK = 1024 * 1024
SOURCE_NAME = "source.pdf"


def cleanup_stale_tmp(work_dir: str) -> None:
    """Eemaldab teose kaustast mahajäänud (üle STALE_TMP_S vanad) PDF-i töökaustad."""
    piir = time.time() - STALE_TMP_S
    for name in os.listdir(work_dir):
        if not name.startswith(TMP_PREFIX):
            continue
        p = os.path.join(work_dir, name)
        try:
            if os.path.isdir(p) and os.path.getmtime(p) < piir:
                shutil.rmtree(p, ignore_errors=True)
        except OSError:
            pass


def prepare_pdf(work_dir: str, fileobj) -> tuple:
    """Salvestab PDF-i teose ajutisse kausta ja kontrollib seda.

    Tagastab (tmp_dir, page_count). Vigane/liiga suur/mitte-PDF → ValueError,
    ajutine kaust koristatud. Blokeeriv I/O — kutsuda sync route'ist (ADR 0002).
    """
    cleanup_stale_tmp(work_dir)
    tmp_dir = os.path.join(work_dir, f"{TMP_PREFIX}{uuid.uuid4().hex[:8]}")
    os.makedirs(tmp_dir)
    try:
        pdf_path = os.path.join(tmp_dir, SOURCE_NAME)
        kokku = 0
        with open(pdf_path, "wb") as out:
            while True:
                tukk = fileobj.read(_COPY_CHUNK)
                if not tukk:
                    break
                kokku += len(tukk)
                if kokku > PDF_MAX_BYTES:
                    raise ValueError(f"PDF on liiga suur (üle {PDF_MAX_BYTES // (1024 * 1024)} MB)")
                out.write(tukk)
        if detect_file_type(pdf_path) != "pdf":
            raise ValueError("Fail ei ole PDF")
        try:
            page_count = PdfPageSource(pdf_path).page_count()
        except Exception as e:
            raise ValueError("Vigane PDF — lehtede arvu ei õnnestunud lugeda") from e
        if page_count < 1:
            raise ValueError("PDF-is ei ole lehti")
        if page_count > PDF_MAX_PAGES:
            raise ValueError(f"PDF-is on liiga palju lehti ({page_count}, max {PDF_MAX_PAGES})")
        return tmp_dir, page_count
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise


def anchor_exists(work_dir: str, after: str) -> bool:
    """Kiire eelkontroll enne töö algust; lõplik kontroll on luku all."""
    return after in ("start", "end") or after in get_sorted_images(work_dir)


def run_add_pdf(work_id: str, tmp_dir: str, page_count: int, after: str, username: str, progress) -> dict:
    """Renderdab PDF-i lehed ja sisestab need. Ajutine kaust koristatakse alati."""
    try:
        src = PdfPageSource(os.path.join(tmp_dir, SOURCE_NAME))
        paths = []
        for n in range(1, page_count + 1):
            dst = os.path.join(tmp_dir, f"{n:04d}.jpg")
            with RENDER_SEMAPHORE:
                src.render_full(n, dst)
            paths.append(dst)
            progress(n, page_count)
        result = insert_prepared_pages(work_id, paths, after, username)
        logger.info(f"ADD-PDF: {work_id} +{page_count} lehte [after={after}] ({username})")
        return result
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def error_fields(e: Exception) -> dict:
    """Töö oleku lisaväljad vea korral: klient eristab kadunud ankrut."""
    return {"code": AnchorMissing.code} if isinstance(e, AnchorMissing) else {}
