"""OCR-jooksude kaugkataloogide hiline eemaldamine (#225).

Katkestamine kustutab kaugkataloogi failid kohe — see peatab GPU-töö, sest
`process_batch` väljub enne mudeli kutsumist, kui ükski pilt ei avane. Kataloogi
ennast EI TOHI kohe eemaldada: lennusolev batch kirjutab sinna oma .txt-i
`open(path, "w")`-ga ilma veakäsitluseta ja kadunud kataloog kukutaks kogu
OCR-teenuse (mõõdetud tootmises 2026-08-08 16:26:29).

Siin hoitakse nimekirja katalooge, mis tuleb eemaldada, kui armuaeg on täis.
Nimekiri on ühtlasi märgend taastereaperile (`reocr_recovery`): ajastatud
kataloogi .txt kuulub KATKESTATUD tööle, mitte orvule.
"""
import json
import os
import threading
import time
from typing import Callable, Optional

from .config import OCR_RUN_REAPS_FILE, RUN_DIR_REAP_GRACE, get_logger
from .utils import atomic_write_json

logger = get_logger(__name__)

_lock = threading.Lock()


def _load() -> dict:
    try:
        with open(OCR_RUN_REAPS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(OCR_RUN_REAPS_FILE), exist_ok=True)
        atomic_write_json(OCR_RUN_REAPS_FILE, data)
    except Exception as e:
        logger.warning("Reaper-nimekirja kirjutamine ebaõnnestus: {}".format(e))


def schedule_reap(remote_path: str, now: Optional[float] = None) -> None:
    """Märgib kaugkataloogi hilisemaks eemaldamiseks."""
    if not remote_path:
        return
    ts = now if now is not None else time.time()
    with _lock:
        data = _load()
        if remote_path in data:
            return            # esimene ajatempel jääb kehtima
        data[remote_path] = ts
        _save(data)


def is_scheduled(remote_path: str) -> bool:
    """Kas kataloog ootab eemaldamist? Taastereaper peab sellised vahele jätma."""
    with _lock:
        return remote_path in _load()


def reap_due(rm_rf_func: Callable[[str], None], now: Optional[float] = None) -> int:
    """Eemaldab kataloogid, mille armuaeg on täis. Tagastab eemaldatute arvu.

    Tõrkuv kirje JÄÄB nimekirja — kaugserver võib olla ajutiselt maas.
    """
    ts = now if now is not None else time.time()
    with _lock:
        data = _load()
    due = [p for p, at in data.items() if ts - at >= RUN_DIR_REAP_GRACE]
    if not due:
        return 0

    eemaldatud = []
    for path in due:
        try:
            rm_rf_func(path)
            eemaldatud.append(path)
            logger.info("Reaper: eemaldatud OCR-jooksu kataloog {}".format(path))
        except Exception as e:
            logger.warning("Reaper: {} eemaldamine ebaõnnestus: {}".format(path, e))

    if eemaldatud:
        with _lock:
            data = _load()
            for path in eemaldatud:
                data.pop(path, None)
            _save(data)
    return len(eemaldatud)
