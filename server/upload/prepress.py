"""Prepress: eelvaade ja 300 DPI läbikäik.

Plaani puhas loogika on prepress_plan.py-s, pikslite hankimine
page_source.py-s. Siin on I/O, taustalõimed ja oleku uuendamine.

CPU-kaitse: RENDER_SEMAPHORE lubab ühe rasteriseerimistöö korraga.
NB — see kaitse on PROTSESSI-LOKAALNE. Praeguse single-worker uvicorni juures
piisav; mitme workeri peale minnes ei ole threading.Semaphore enam globaalne
piirang.
"""
import os
import threading
from typing import Optional

from ..config import get_logger
from . import page_source, prepress_plan
from . import state as upload_state

logger = get_logger(__name__)

RENDER_SEMAPHORE = threading.Semaphore(1)


def preview_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "preview")


def preview_path(upload_id: str, n: int) -> str:
    return os.path.join(preview_dir(upload_id), "pg_{:04d}.jpg".format(n))


def source_path(upload_id: str) -> Optional[str]:
    """Salvestatud lähteallikas: source.pdf (fail) või source/ (pildikaust)."""
    base = upload_state.upload_dir(upload_id)
    pdf = os.path.join(base, "source.pdf")
    if os.path.isfile(pdf):
        return pdf
    images = os.path.join(base, "source")
    if os.path.isdir(images):
        return images
    return None


# --- Eelvaate renderdus ---

def _render_previews(upload_id: str) -> None:
    """Taustalõime siht: renderdab kõik eelvaated."""
    src_path = source_path(upload_id)
    if not src_path:
        upload_state.mutate_prepress(
            upload_id, lambda p: p.update(preview_status="error")
        )
        return

    with RENDER_SEMAPHORE:
        try:
            source = page_source.open_page_source(src_path)
            count = source.page_count()
            os.makedirs(preview_dir(upload_id), exist_ok=True)

            upload_state.mutate_prepress(
                upload_id,
                lambda p: p.update(preview_status="rendering", preview_done=0),
            )

            for n in range(1, count + 1):
                dst = preview_path(upload_id, n)
                if not os.path.isfile(dst):
                    source.render_preview(n, dst)

                def _bump(plan, n=n):
                    plan["preview_done"] = n

                upload_state.mutate_prepress(upload_id, _bump)

            upload_state.mutate_prepress(
                upload_id, lambda p: p.update(preview_status="ready")
            )
            upload_state.set_upload_state(upload_id, status="awaiting_split")
            logger.info("Prepress eelvaade valmis: {} ({} lk)".format(upload_id, count))

        except Exception as e:
            logger.error("Prepress eelvaade {}: {}".format(upload_id, e))
            upload_state.mutate_prepress(
                upload_id, lambda p: p.update(preview_status="error")
            )
            upload_state.set_upload_state(upload_id, status="awaiting_split")


def start_preview(upload_id: str) -> None:
    """Käivitab eelvaate taustalõimes. Idempotentne: juba käiv töö jäetakse rahule."""
    lock = upload_state.get_upload_lock(upload_id)
    with lock:
        s = upload_state.read_state(upload_id)
        if not s:
            return
        plan = s.get("prepress") or {}
        if plan.get("preview_status") == "rendering":
            return
        s["status"] = "prepping"
        plan["preview_status"] = "rendering"
        s["prepress"] = plan
        upload_state.write_state(upload_id, s)

    threading.Thread(
        target=_render_previews, args=(upload_id,),
        daemon=True, name="prepress-preview-{}".format(upload_id),
    ).start()


def cleanup_prepress_artifacts(upload_id: str) -> None:
    """Kustutab prepress-artefaktid pärast importi.

    thumbs/ EI kuulu siia — see on OCR-järgse ülevaatuse (samm 4) oma.
    cancel_upload teeb rmtree kogu kaustale, nii et seda teed siin ei kata.
    """
    import shutil

    base = upload_state.upload_dir(upload_id)
    for name in ("preview", "apply_tmp", "source"):
        shutil.rmtree(os.path.join(base, name), ignore_errors=True)
    try:
        os.unlink(os.path.join(base, "source.pdf"))
    except OSError:
        pass
