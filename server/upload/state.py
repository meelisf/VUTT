"""Uploadi staging-state ja progressi helperid.

Siin on state.json lugemine/kirjutamine, per-upload lukud, mälupõhine
üleslaadimise progress ning OCR stall-indikaatori puhas loogika.
"""
import json
import os
import threading
from datetime import datetime
from typing import Optional

from ..config import UPLOADS_DIR, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)

# Lock per upload_id — kaitseb samaaegset state.json lugemist/kirjutamist
_upload_locks: dict = {}
_locks_lock = threading.Lock()

# Mälupõhine SFTP progress. Kettale kirjutatakse alles pärast edastuse lõppu.
upload_progress: dict = {}  # {upload_id: {"bytes_sent": 0, "bytes_total": 0, "error": None}}

# Stall-indikaator: mitu sekundit ilma uue valmis leheta enne kui töö märgitakse
# UI-s "kinni jäänuks" (NÕUANDEV — staatust ei muudeta, töid ei katkestata).
UPLOAD_STALL_THRESHOLD = int(os.getenv("UPLOAD_STALL_THRESHOLD", "1800"))  # 30 min


def get_upload_lock(upload_id: str) -> threading.Lock:
    """Tagastab konkreetsele upload_id-le vastava luku."""
    with _locks_lock:
        if upload_id not in _upload_locks:
            _upload_locks[upload_id] = threading.Lock()
        return _upload_locks[upload_id]


def remove_upload_lock(upload_id: str):
    """Eemaldab uploadi luku pärast staging-kausta kustutamist."""
    with _locks_lock:
        _upload_locks.pop(upload_id, None)


def upload_dir(upload_id: str) -> str:
    """Tagastab upload staging kausta tee."""
    return os.path.join(UPLOADS_DIR, upload_id)


def state_path(upload_id: str) -> str:
    """Tagastab state.json faili tee."""
    return os.path.join(upload_dir(upload_id), "state.json")


def read_state(upload_id: str):
    """Loeb state.json (ei lukusta ise — kasuta get_upload_lock)."""
    path = state_path(upload_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_state(upload_id: str, state: dict):
    """Kirjutab state.json atomaarse asendusega (ei lukusta ise — kasuta get_upload_lock)."""
    path = state_path(upload_id)
    atomic_write_json(path, state)


def set_upload_state(upload_id: str, *, status: Optional[str] = None, **extra):
    """Uuendab state.json välju upload-i luku all (thread-turvaline)."""
    state_lock = get_upload_lock(upload_id)
    with state_lock:
        s = read_state(upload_id)
        if not s:
            return
        if status is not None:
            s["status"] = status
        for key, value in extra.items():
            s[key] = value
        write_state(upload_id, s)


def init_upload_progress(upload_id: str, tmp_path: str) -> int:
    """Lähtestab mälupõhise SFTP progressi ja tagastab faili suuruse baitides."""
    file_size = os.path.getsize(tmp_path)
    upload_progress[upload_id] = {"bytes_sent": 0, "bytes_total": file_size, "error": None}
    return file_size


def sftp_progress_cb(upload_id: str):
    """Loob SFTP put() callback'i, mis uuendab upload_progress mäludikti."""
    def _progress(transferred, total):
        upload_progress[upload_id]["bytes_sent"] = transferred
        upload_progress[upload_id]["bytes_total"] = total
    return _progress


def is_stalled(ready_count: int, expected_pages, last_progress_at, now_ts: float) -> bool:
    """Kas OCR-töö paistab kinni jäänud."""
    if not expected_pages:
        return False
    if ready_count >= expected_pages:
        return False
    if not last_progress_at:
        return False
    return (now_ts - last_progress_at) > UPLOAD_STALL_THRESHOLD


def uploads_needing_sync(states: list[dict]) -> list[str]:
    """Tagastab aktiivsete uploadide id-d, mille OCR-progressi tuleb taustal sünkida."""
    need = []
    for state in states:
        if state.get("status") in {"processing", "reviewing"}:
            upload_id = state.get("id")
            if upload_id:
                need.append(upload_id)
    return need


def list_upload_states() -> list:
    """Tagastab kõik aktiivsed state.json-id ilma domeeni-koordinaatori sõltuvusteta."""
    if not os.path.isdir(UPLOADS_DIR):
        return []

    result = []
    for entry in os.scandir(UPLOADS_DIR):
        if not entry.is_dir():
            continue
        state_file = os.path.join(entry.path, "state.json")
        if not os.path.exists(state_file):
            continue
        try:
            with open(state_file, "r", encoding="utf-8") as f:
                state = json.load(f)
            if state.get("status") != "imported":
                # Lahendatud = valmis VÕI lõplikult ebaõnnestunud (#250). Ainult
                # `has_ocr` lugemine jättis vigadega töö igaveseks „OCR seisab"
                # märgi alla — kõrvuti teatega „Valmis", mis on vastuoluline.
                resolved = sum(1 for fl in state.get("files", [])
                               if fl.get("has_ocr") or fl.get("ocr_error"))
                state["stalled"] = is_stalled(
                    resolved, state.get("expected_pages"),
                    state.get("last_progress_at"), datetime.now().timestamp(),
                )
                result.append(state)
        except Exception as e:
            logger.warning(f"list_uploads: ei saa lugeda {state_file}: {e}")

    result.sort(key=lambda s: s.get("created_at", ""), reverse=True)
    return result


# Staatused, mille korral OCR-serveri SFTP-pollimist ei ole vaja: fail on
# VUTT-i poolel ja OCR pole veel alanud.
PREPRESS_IDLE_STATUSES = ("awaiting_split", "prepping", "applying")


def init_prepress(upload_id: str, page_count: int) -> Optional[dict]:
    """Loob prepress-plaani, kui seda veel pole. Idempotentne: olemasolevat
    plaani EI lähtestata (admin võib olla juba jõudnud jooni seada)."""
    from . import prepress_plan

    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s:
            return None
        if s.get("prepress") is None:
            s["prepress"] = prepress_plan.default_plan(page_count)
            write_state(upload_id, s)
        return s["prepress"]


def mutate_prepress(upload_id: str, fn) -> Optional[dict]:
    """AINUS lubatud viis prepress-alamvälju muuta.

    fn saab praeguse prepress-dikti ja muudab seda KOHAPEAL; lugemine,
    muutmine ja kirjutamine käivad sama luku sees.

    Miks mitte set_upload_state(prepress=...): see seab terve ülemise taseme
    võtme. Kui eelvaate lõim kirjutaks eelarvutatud prepress-dikti tervikuna,
    pühiks see admini äsja salvestatud custom joone maha (lost update).
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s:
            return None
        prepress = s.get("prepress")
        if prepress is None:
            return None
        fn(prepress)
        s["prepress"] = prepress
        write_state(upload_id, s)
        return prepress


# Staatused, millest tohib alustada (uut) edastust OCR-serverisse.
# "error" on kaasas tahtlikult: lähtefail on endiselt VUTT-i poolel (koristus
# käib alles impordil), seega ebaõnnestunud partiid peab saama uuesti proovida.
# Ilma selleta jääks upload igaveseks error-olekusse lukku.
# "prepping" on kaasas, sest ülevaatus on nüüd ALATI nähtav ja eelvaade jookseb
# iga upload'i puhul — ilma selleta oleks „Edasi" 500-lehelisel tööl ~5 minutit
# surnud. Apply katkestab eelvaate (preview_cancel), ei oota seda (ADR 0026).
APPLY_START_STATUSES = ("awaiting_split", "prepping", "error")


def try_begin_applying(upload_id: str) -> bool:
    """CAS: awaiting_split | prepping | error → applying. False, kui töö juba käib.

    Tagab, et topeltklikk, retry või brauseri refresh ei käivita teist
    paralleelset 300 DPI renderdust ega SFTP-d.

    Seab ka preview_cancel lipu — SAMA luku sees ja OTSE dikti, mitte
    mutate_prepress kaudu: get_upload_lock on tavaline threading.Lock, mitte
    RLock, seega pesastatud kutse annaks ummikseisu.
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") not in APPLY_START_STATUSES:
            return False
        s["status"] = "applying"
        if isinstance(s.get("prepress"), dict):
            s["prepress"]["preview_cancel"] = True
        write_state(upload_id, s)
        return True


# Mudelit tohib muuta seni, kuni ükski OCR-input fail ei ole kaugserverisse
# saadetud. Eelvaade elab ainult VUTT-i poolel, seega "prepping" on lubatud.
MODEL_CHANGE_STATUSES = ("awaiting_split", "prepping", "error")
OCR_MODELS = ("print", "hand")


def try_set_ocr_model(upload_id: str, model: str) -> bool:
    """CAS: staatusekontroll + ocr_model + MÕLEMAD kaugteed ÜHE luku all.

    Kaks eraldi luku-akent („kontrolli, siis kirjuta") laseks apply vahele:
    kontroll näeks awaiting_split'i, apply asuks tööle ja kaugteed
    kirjutataks ümber juba lennus oleva saatmise alt.
    """
    from ..upload_ops import remote_paths

    if model not in OCR_MODELS:
        return False
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") not in MODEL_CHANGE_STATUSES:
            return False
        slug = (s.get("meta") or {}).get("slug", "")
        staging, work = remote_paths(model, upload_id, slug)
        s["ocr_model"] = model
        s["remote_staging_path"] = staging
        s["remote_work_path"] = work
        write_state(upload_id, s)
        return True
