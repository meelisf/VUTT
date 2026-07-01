"""Aktiivsete re-OCR tööde püsivus üle serveri restardi.

Salvestab AINULT aktiivsed (uploading/processing) tööd state/reocr_active.json-i.
Roll recovery-hierarhias: RESTARDI-JÄTKAMINE. Ei ole orbude põhi-allikas — see on
reocr_log (vt reocr_recovery.py), sest error/crash'itud tööd on siit juba eemaldatud.
"""
import json
import os
import threading
from typing import Dict

from .config import STATE_DIR, get_logger

logger = get_logger(__name__)

REOCR_ACTIVE_FILE = os.path.join(STATE_DIR, "reocr_active.json")
_ACTIVE_STATUSES = ("uploading", "processing")
_file_lock = threading.Lock()


def persist_active_jobs(jobs: Dict[str, dict]) -> None:
    """Kirjuta aktiivsed tööd atomaarselt (tmp + os.replace). done/error jäetakse välja."""
    active = {jid: j for jid, j in jobs.items() if j.get("status") in _ACTIVE_STATUSES}
    with _file_lock:
        try:
            os.makedirs(os.path.dirname(REOCR_ACTIVE_FILE), exist_ok=True)
            tmp = REOCR_ACTIVE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(active, f, ensure_ascii=False, indent=2)
            os.replace(tmp, REOCR_ACTIVE_FILE)
        except Exception as e:
            logger.warning(f"reocr_active.json kirjutamine ebaõnnestus: {e}")


def load_active_jobs() -> Dict[str, dict]:
    """Tagasta salvestatud aktiivsed tööd. Puuduv/vigane fail → tühi dict."""
    with _file_lock:
        try:
            if not os.path.exists(REOCR_ACTIVE_FILE):
                return {}
            with open(REOCR_ACTIVE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.warning(f"reocr_active.json lugemine ebaõnnestus: {e}")
            return {}
