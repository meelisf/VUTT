"""Prepress: eelvaade, tindiskoor, köitevahe-riba ja 300 DPI läbikäik.

Plaani puhas loogika on prepress_plan.py-s, pikslite hankimine
page_source.py-s. Siin on I/O, taustalõimed ja oleku uuendamine.

CPU-kaitse: RENDER_SEMAPHORE lubab ühe rasteriseerimistöö korraga.
NB — see kaitse on PROTSESSI-LOKAALNE. Praeguse single-worker uvicorni juures
piisav; mitme workeri peale minnes ei ole threading.Semaphore enam globaalne
piirang.
"""
import os
import threading
from typing import List, Optional

from ..config import get_logger
from . import page_source, prepress_plan
from . import state as upload_state

logger = get_logger(__name__)

RENDER_SEMAPHORE = threading.Semaphore(1)

# Kui suur osa lehe laiusest köitevahe-ribal näidatakse (±5% joonest).
STRIP_FRAC = 0.05

# Mitu ribakaadrit lehe kohta vahemälus hoitakse (LRU).
STRIP_CACHE_PER_PAGE = 6

# Tindiskoori lävi: mis on "tint" selle lehe enda tonaalsuses.
INK_PERCENTILE = 0.35


def preview_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "preview")


def strips_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "strips")


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


# --- Tindiskoor ---

def percentile_from_hist(hist: List[int], q: float) -> int:
    """q-kvantiil 256-lahtrilisest halltooni histogrammist. Puhas funktsioon.

    Kasutame histogrammi, mitte numpy'd — numpy ei ole requirements.txt-is.
    """
    total = sum(hist)
    if total == 0:
        return 0
    target = total * q
    running = 0
    for value, count in enumerate(hist):
        running += count
        if running >= target:
            return value
    return 255


def ink_score(preview_path_: str, x_frac: float, half_px: int = 2) -> float:
    """Tindi osakaal veerus x_frac (±half_px), lehe keskmises 88% kõrguses.

    Usaldusväärne AINULT kõrge väärtuse suunas: kõrge skoor = joon lõikab
    kindlasti midagi; madal skoor EI tähenda õiget kohta (tühi veeris skoorib
    samuti 0). Vt spetsi mõõtmisi.
    """
    from PIL import Image

    with Image.open(preview_path_) as im:
        gray = im.convert("L")
        width, height = gray.size
        y0, y1 = int(height * 0.06), int(height * 0.94)
        if y1 <= y0 or width == 0:
            return 0.0

        core = gray.crop((0, y0, width, y1))
        threshold = percentile_from_hist(core.histogram(), INK_PERCENTILE)

        x = int(round(width * x_frac))
        bx0 = max(0, x - half_px)
        bx1 = min(width, x + half_px + 1)
        band = core.crop((bx0, 0, bx1, y1 - y0))
        # Histogramm, mitte getdata() — sama tulemus (piksleid alla läve), aga
        # ilma pikslikaupa listi materialiseerimata (getdata on ka aegumas).
        band_hist = band.histogram()
        total = sum(band_hist)
        if total == 0:
            return 0.0
        return sum(band_hist[:threshold]) / float(total)


# --- Eelvaate renderdus ---

def _render_previews(upload_id: str) -> None:
    """Taustalõime siht: renderdab kõik eelvaated ja arvutab tindiskoorid."""
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

                default_x = 0.5
                score = round(ink_score(dst, default_x), 3)

                def _bump(plan, n=n, score=score):
                    for entry in plan.get("pages", []):
                        if entry.get("n") == n:
                            entry["ink"] = score
                            break
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
