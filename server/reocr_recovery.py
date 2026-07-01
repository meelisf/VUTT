"""Reconciliation-reaper: leiab OCR-serveri staging'usse orvuks jäänud VALMIS üksik-lehe
re-OCR tulemused ja taastab need (kirjutab .ocr faili, lisab reocr_log-i recovery-sündmuse,
koristab staging'u).

Skoop: AINULT üksik-lehe orvud (AUTO-OCR/{print,hand}/{job_id}/{slug}/{slug}_pg_001.txt).
Batch restardi-jätkamine käib load_active_jobs → resume polling kaudu, MITTE siit.

Mapping-allikad (järjekorras): (1) reocr_log — orbude PÕHI-allikas (error-kirjed);
(2) reocr_active.json — restardi-jätkamise varu.
"""
import io
import os
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional

from .config import OCR_SERVER_PATH, get_logger
from . import reocr_ops
from . import reocr_state

logger = get_logger(__name__)

REOCR_REAPER_INTERVAL = int(os.getenv("REOCR_REAPER_INTERVAL", "300"))
_MATERIAL_TYPES = ("print", "hand")

# Claim-set: kaitseb tavalise polleri ja reaperi võistluse eest (sama .txt topelt-töötlus).
# Kaitstud reocr_ops._reocr_jobs_lock-iga (jagatud lukk, ei loo uut).
_recovering = set()


def _resolve_job_meta(job_id: str) -> Optional[dict]:
    """Leia {page_filename, work_id} logist (põhi) või active.json-ist (varu)."""
    log = reocr_ops.get_reocr_log(0, reocr_ops.REOCR_LOG_MAX).get("entries", [])
    for e in log:
        if e.get("job_id") == job_id and e.get("page_filename"):
            return {"page_filename": e["page_filename"], "work_id": e.get("work_id")}
    active = reocr_state.load_active_jobs()
    j = active.get(job_id)
    if j and j.get("page_filename"):
        return {"page_filename": j["page_filename"], "work_id": j.get("work_id")}
    return None


def _is_actively_tracked(job_id: str) -> bool:
    with reocr_ops._reocr_jobs_lock:
        j = reocr_ops._reocr_jobs.get(job_id)
        return bool(j and j.get("status") in ("uploading", "processing"))


def _claim(job_id: str) -> bool:
    """Proovi claimida job. Tagastab False kui juba claimitud või aktiivne."""
    with reocr_ops._reocr_jobs_lock:
        if job_id in _recovering:
            return False
        j = reocr_ops._reocr_jobs.get(job_id)
        if j and j.get("status") in ("uploading", "processing"):
            return False
        _recovering.add(job_id)
        return True


def _release(job_id: str) -> None:
    with reocr_ops._reocr_jobs_lock:
        _recovering.discard(job_id)


def _cleanup_staging(sftp, job_dir: str, slug: str) -> None:
    """Koristab OCR-serveri staging'u pärast taastamist (best-effort)."""
    work = f"{job_dir}/{slug}"
    for name in (f"{work}/{slug}_pg_001.txt", f"{work}/{slug}_pg_001.jpg"):
        try:
            sftp.remove(name)
        except Exception:
            pass
    for d in (work, job_dir):
        try:
            sftp.rmdir(d)
        except Exception:
            pass


def _recover_one(sftp, base: str, job_id: str, recovered: List[str], skipped: List[str]) -> None:
    if _is_actively_tracked(job_id):
        return
    job_dir = f"{base}/{job_id}"
    try:
        slugs = sftp.listdir(job_dir)
    except FileNotFoundError:
        return
    for slug in slugs:
        txt_abs = f"{job_dir}/{slug}/{slug}_pg_001.txt"
        try:
            sftp.stat(txt_abs)
        except FileNotFoundError:
            continue
        if not _claim(job_id):
            return
        try:
            meta = _resolve_job_meta(job_id)
            if not meta:
                skipped.append(job_id)
                logger.warning(f"Reaper: {job_id} .txt olemas, aga page_filename teadmata → skip")
                return
            buf = io.BytesIO()
            sftp.getfo(txt_abs, buf)
            text = buf.getvalue().decode("utf-8", errors="replace")
            reocr_ops._write_ocr_file(slug, meta["page_filename"], text)
            now = datetime.now().timestamp()
            reocr_ops._append_to_log(
                {"work_id": meta.get("work_id"), "slug": slug,
                 "page_filename": meta["page_filename"], "status": "done",
                 "error": None, "started_at": None,
                 "finished_at": now,
                 "recovered": True, "original_status": "error",
                 "recovered_at": now},
                job_id)
            _cleanup_staging(sftp, job_dir, slug)
            recovered.append(job_id)
            logger.info(f"Reaper taastas {job_id} ({slug}/{meta['page_filename']})")
        finally:
            _release(job_id)
        return


def scan_and_recover() -> Dict[str, list]:
    """Skanni print/hand staging, taasta orvuks jäänud üksik-lehe tulemused."""
    recovered: List[str] = []
    skipped: List[str] = []
    for mt in _MATERIAL_TYPES:
        base = f"{OCR_SERVER_PATH}/AUTO-OCR/{mt}"
        cid = f"reaper-{mt}"
        try:
            sftp = reocr_ops._sftp_open(cid)
        except Exception as e:
            logger.warning(f"Reaper: SFTP avamine ebaõnnestus ({mt}): {e}")
            continue
        try:
            try:
                job_ids = sftp.listdir(base)
            except FileNotFoundError:
                continue
            for job_id in job_ids:
                try:
                    _recover_one(sftp, base, job_id, recovered, skipped)
                except Exception as e:
                    logger.warning(f"Reaper: {job_id} taaste viga: {e}")
        finally:
            try:
                sftp.close()
            except Exception:
                pass
            reocr_ops.close_ssh(cid)
    return {"recovered": recovered, "skipped": skipped}


def _reaper_loop():
    while True:
        time.sleep(REOCR_REAPER_INTERVAL)
        try:
            scan_and_recover()
        except Exception as e:
            logger.warning(f"Reaper loop viga: {e}")


def start_reaper_loop() -> None:
    threading.Thread(target=_reaper_loop, daemon=True, name="reocr-reaper").start()
    logger.info(f"Re-OCR reaper käivitatud (intervall {REOCR_REAPER_INTERVAL}s)")
