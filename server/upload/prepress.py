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
from typing import List, Optional, Tuple

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


def ink_profile(preview_path_: str, x_frac: float,
                half_px: int = 2) -> Tuple[float, float]:
    """Tagastab (tindiosakaal, pidevus) veerus x_frac (±half_px).

    **ink** — kui suur osa riba pikslitest on alla lehe enda tinditaseme.
    **pidevus** — pikim JÄRJESTIKUSTE tumedate ridade jada / riba kõrgus.

    Miks kaks arvu: ainult ink ei erista köitemurret tekstist. Mõõdetuna päris
    kirikuraamatul (EAA-tüüp) andis õige poolituskoht — täpselt murdejoonel —
    ink = 0,45, samal ajal kui 2% kõrvale (hele köitevahe) andis 0,09 ja
    tekstiveerud 0,36. Ainult ink'i vaadates käivitunuks hoiatus just siis, kui
    joon on ÕIGES kohas.

    Pidevus eraldab need: köitemurre on katkematu tume joon ülalt alla
    (pidevus → 1), tekstiread on katkendlikud (pidevus ≈ ühe rea kõrgus /
    lehe kõrgus, tüüpiliselt < 0,05). Kõik skännid ei ole murdejoonega —
    hele köitevahe annab madala ink'i ja pidevus ei loe.
    """
    from PIL import Image

    with Image.open(preview_path_) as im:
        gray = im.convert("L")
        width, height = gray.size
        y0, y1 = int(height * 0.06), int(height * 0.94)
        if y1 <= y0 or width == 0:
            return 0.0, 0.0

        core = gray.crop((0, y0, width, y1))
        threshold = percentile_from_hist(core.histogram(), INK_PERCENTILE)

        x = int(round(width * x_frac))
        bx0 = max(0, x - half_px)
        bx1 = min(width, x + half_px + 1)
        band = core.crop((bx0, 0, bx1, y1 - y0))
        band_w, band_h = band.size
        if band_w == 0 or band_h == 0:
            return 0.0, 0.0

        # Histogramm, mitte getdata() — sama tulemus (piksleid alla läve), aga
        # ilma pikslikaupa listi materialiseerimata (getdata on ka aegumas).
        band_hist = band.histogram()
        total = sum(band_hist)
        ink = sum(band_hist[:threshold]) / float(total) if total else 0.0

        # Rea kaupa: rida on "tume", kui vähemalt pool selle piksleist on all
        # läve. tobytes() annab mode "L" korral täpselt band_w * band_h baiti.
        data = band.tobytes()
        need = max(1, band_w // 2)
        longest = 0
        run = 0
        for row in range(band_h):
            start = row * band_w
            dark_px = sum(
                1 for value in data[start:start + band_w] if value < threshold
            )
            if dark_px >= need:
                run += 1
                if run > longest:
                    longest = run
            else:
                run = 0

        return ink, longest / float(band_h)


def ink_score(preview_path_: str, x_frac: float, half_px: int = 2) -> float:
    """Ainult tindiosakaal. Ühilduvuskest ink_profile ümber."""
    return ink_profile(preview_path_, x_frac, half_px)[0]


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
                ink, cont = ink_profile(dst, default_x)
                score = round(ink, 3)
                continuity = round(cont, 3)

                def _bump(plan, n=n, score=score, continuity=continuity):
                    for entry in plan.get("pages", []):
                        if entry.get("n") == n:
                            entry["ink"] = score
                            entry["ink_cont"] = continuity
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


# --- Köitevahe-riba ---

def quantize_x(x_frac: float, full_width: int) -> int:
    """x → tegelik FULL_DPI pikslikoordinaat.

    See on AINUS koht, kus x normaliseeritakse, ja sama väärtus on nii
    renderduse argument kui vahemälu võti. Ilma selleta tekitaks joone
    lohistamine (0.5001, 0.5002, …) sadu peaaegu identseid ribafaile.
    """
    x_px = int(round(full_width * x_frac))
    return max(1, min(full_width - 1, x_px))


def strip_cache_path(upload_id: str, n: int, x_px: int) -> str:
    return os.path.join(strips_dir(upload_id), "{:04d}_{}.jpg".format(n, x_px))


def prune_strip_cache(upload_id: str, n: int, keep: int = STRIP_CACHE_PER_PAGE) -> None:
    """LRU: hoiab lehe kohta ainult `keep` uusimat riba.

    Ilma selleta koguneksid strips/ failid uploads/ alla märkamatult, eriti
    kui admin joont pikalt nihutab.
    """
    prefix = "{:04d}_".format(n)
    directory = strips_dir(upload_id)
    try:
        entries = [f for f in os.listdir(directory) if f.startswith(prefix)]
    except FileNotFoundError:
        return
    if len(entries) <= keep:
        return
    entries.sort(key=lambda f: os.path.getmtime(os.path.join(directory, f)))
    for name in entries[:-keep]:
        try:
            os.unlink(os.path.join(directory, name))
        except OSError:
            pass


def get_gutter_strip(upload_id: str, n: int, x_frac: float) -> str:
    """Tagastab natiivse FULL_DPI riba tee, renderdades ainult vajadusel.

    Riba on ±STRIP_FRAC joonest. Renderdatakse AINULT see piirkond
    (pdftoppm -x -y -W -H), mitte terve leht — mõõdetuna 0,09 s/lk vs 0,47.
    """
    src = source_path(upload_id)
    if not src:
        raise FileNotFoundError("Uploadi lähteallikat ei leitud: {}".format(upload_id))

    source = page_source.open_page_source(src)
    full_width = source.full_width(n)
    x_px = quantize_x(x_frac, full_width)

    dst = strip_cache_path(upload_id, n, x_px)
    if os.path.isfile(dst):
        return dst

    os.makedirs(strips_dir(upload_id), exist_ok=True)
    half = max(1, int(round(full_width * STRIP_FRAC)))
    region_x = max(0, x_px - half)
    region_w = min(full_width - region_x, 2 * half)

    tmp = dst + ".tmp"
    with RENDER_SEMAPHORE:
        source.render_region(n, region_x, region_w, tmp)
    os.replace(tmp, dst)

    prune_strip_cache(upload_id, n)
    return dst


def cleanup_prepress_artifacts(upload_id: str) -> None:
    """Kustutab prepress-artefaktid pärast importi.

    thumbs/ EI kuulu siia — see on OCR-järgse ülevaatuse (samm 4) oma.
    cancel_upload teeb rmtree kogu kaustale, nii et seda teed siin ei kata.
    """
    import shutil

    base = upload_state.upload_dir(upload_id)
    for name in ("preview", "strips", "apply_tmp", "source"):
        shutil.rmtree(os.path.join(base, name), ignore_errors=True)
    try:
        os.unlink(os.path.join(base, "source.pdf"))
    except OSError:
        pass
