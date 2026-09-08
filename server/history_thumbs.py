"""Pisipildid prügikasti, originaalide ja praeguse lehe kaustast (#325).

Prügikasti ja originaalide failid ei ole avalikud, seega pildiserver (port 8001)
neid ei serveeri — tee käib admin-endpointist. Originaal on ~2 MB ja kirjeid on
teoses kuni sadu, seega saadetakse alati vähendatud koopia.
"""
import os
import re
import uuid
from typing import Optional

from PIL import Image

from .config import BASE_DIR, get_logger
from .image_server import _is_safe_image_path
from .utils import find_directory_by_id

logger = get_logger(__name__)

THUMB_MAX_PX = 400
# work_id on nanoid; teda liidetakse teesse, seega ta valideeritakse enne kasutamist.
_WORK_ID = re.compile(r'^[A-Za-z0-9_-]{1,32}$')
LIIGID = ("trash", "original", "current")


def _lahte_kaust(work_id: str, kind: str) -> Optional[str]:
    """Lubatud lähtekaust liigi kohta, või None kui teost ei ole."""
    if kind not in LIIGID:
        raise ValueError(f"Tundmatu liik: {kind}")
    if not _WORK_ID.match(work_id or ""):
        raise ValueError("Vigane work_id")
    if kind == "trash":
        return os.path.join(BASE_DIR, "._trash", work_id, "pages")
    if kind == "original":
        return os.path.join(BASE_DIR, "._originals", work_id)
    return find_directory_by_id(work_id)  # "current" — teose enda kaust


def ajaloo_pisipilt(work_id: str, kind: str, filename: str) -> Optional[str]:
    """Tagastab pisipildi tee, luues selle vajadusel. None = lähtefaili ei ole.

    Valideerimine elab SIIN, mitte ainult route'is: route'i `os.path.basename`
    peidaks vigase sisendi selle funktsiooni eest ära ja kaitse jääks
    kontrollimata. `_is_safe_image_path` katab ka sümbollingi, mis näitab
    lubatud kaustast välja.
    """
    if os.path.basename(filename) != filename or filename.startswith('.') or not filename:
        raise ValueError("Vigane failinimi")
    kaust = _lahte_kaust(work_id, kind)
    if not kaust:
        return None
    allikas = os.path.join(kaust, filename)
    if not _is_safe_image_path(allikas, kaust):
        raise ValueError("Tee viib lubatud kaustast välja")
    if not os.path.isfile(allikas):
        return None

    # Versioon = lähtefaili mtime_ns. Failinimi ei muutu (replace-image säilitab
    # selle ja clear_original_backup kustutab vana originaali), seega ainult
    # sisu muutus eristab variante.
    versioon = os.stat(allikas).st_mtime_ns
    base = os.path.splitext(filename)[0]
    # Cache elab lähtekausta KÕRVAL (`._trash/{wid}/.thumbs`), mitte sees — muidu
    # ilmuks pisipilt prügikasti loendisse omaette kirjena.
    cache_juur = os.path.dirname(kaust) if kind == "trash" else kaust
    cache_kaust = os.path.join(cache_juur, ".thumbs")
    os.makedirs(cache_kaust, exist_ok=True)
    siht = os.path.join(cache_kaust, f"{base}_{versioon}.jpg")
    if os.path.isfile(siht):
        return siht

    # Kirjuta ajutisse faili ja alles siis kohale: kaks samaaegset päringut
    # leiaksid poolikult kirjutatud lõppfaili olemasolevana ja serveeriksid
    # katkise JPEG-i. `os.replace` on samas failisüsteemis atomaarne.
    tmp = os.path.join(cache_kaust, f".{base}_{uuid.uuid4().hex}.tmp")
    try:
        with Image.open(allikas) as raw:
            img = raw.convert("RGB")
            img.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX))
            img.save(tmp, "JPEG", quality=80)
        os.replace(tmp, siht)
    except Exception as e:
        logger.warning(f"AJALUGU: pisipildi loomine ebaõnnestus {allikas}: {e}")
        try:
            os.remove(tmp)
        except OSError:
            pass
        return None

    # Vanad variandid ära — ALLES pärast uue kohalejõudmist ja mitte kunagi
    # praegust. Paralleelne päring võib sama faili juba kustutanud olla.
    for vana in os.listdir(cache_kaust):
        if vana.startswith(f"{base}_") and vana.endswith(".jpg") \
                and vana != os.path.basename(siht):
            try:
                os.remove(os.path.join(cache_kaust, vana))
            except OSError:
                pass
    return siht
