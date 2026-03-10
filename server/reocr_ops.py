"""
Re-OCR operatsioonid — olemasoleva lehekülje uuesti transkribeerimine OCR serveri kaudu.
"""
import io
import os
import threading
from datetime import datetime

from .config import BASE_DIR, OCR_SERVER_PATH, get_logger
from .utils import generate_nanoid
from .upload_ops import _sftp_open, close_ssh

logger = get_logger(__name__)

_reocr_jobs: dict = {}  # {job_id: {status, text, error, remote_staging, remote_work, remote_img, remote_txt}}
_reocr_jobs_lock = threading.Lock()

REOCR_MAX_CONCURRENT = 5    # Max korraga aktiivseid re-OCR töid
REOCR_JOB_TTL = 86400       # Valmis/vigased tööd kustutatakse 24h pärast
REOCR_PROCESSING_TIMEOUT = 1800  # 30 minutit — pärast seda märgitakse error


def _reocr_cleanup_loop():
    """Daemon-thread: eemaldab vanad done/error re-OCR tööd mälust."""
    import time
    while True:
        time.sleep(600)  # kontrolli iga 10 minuti järel
        cutoff = datetime.now().timestamp() - REOCR_JOB_TTL
        with _reocr_jobs_lock:
            stale = [jid for jid, j in _reocr_jobs.items()
                     if j["status"] in ("done", "error") and j.get("finished_at", 0) < cutoff]
            for jid in stale:
                del _reocr_jobs[jid]
        if stale:
            logger.info(f"Re-OCR cleanup: eemaldati {len(stale)} vana tööd")


threading.Thread(target=_reocr_cleanup_loop, daemon=True, name="reocr-cleanup").start()


def _reocr_poll_loop():
    """Daemon-thread: kontrollib proaktiivselt 'processing' töid iga 10s tagant.
    Nii ei pea kasutaja olema Workspace lehel, et tulemus kätte saada.
    Tööd mis on olnud processing-s üle 30 min märgitakse error-iks."""
    import time
    while True:
        time.sleep(10)
        now = datetime.now().timestamp()
        with _reocr_jobs_lock:
            processing = [(jid, j) for jid, j in _reocr_jobs.items() if j["status"] == "processing"]
        for jid, job in processing:
            # Timeout: liiga kaua processing-s olnud töö märgitakse veaks
            if now - job.get("started_at", now) > REOCR_PROCESSING_TIMEOUT:
                with _reocr_jobs_lock:
                    if _reocr_jobs.get(jid, {}).get("status") == "processing":
                        _reocr_jobs[jid]["status"] = "error"
                        _reocr_jobs[jid]["error"] = "Aegumine: OCR server ei vastanud 30 minuti jooksul."
                        _reocr_jobs[jid]["finished_at"] = now
                        logger.warning(f"Re-OCR {jid}: timeout, märgitud error-iks")
                continue
            try:
                poll_reocr_job(jid)
            except Exception as e:
                logger.warning(f"Re-OCR background poll viga ({jid}): {e}")


threading.Thread(target=_reocr_poll_loop, daemon=True, name="reocr-poll").start()


def get_active_reocr_count() -> int:
    """Tagastab parajasti aktiivsete (uploading/processing) re-OCR tööde arvu."""
    return sum(1 for j in _reocr_jobs.values() if j["status"] in ("uploading", "processing"))


def list_reocr_jobs() -> list:
    """Tagastab kõigi re-OCR tööde loendi (admin ülevaate jaoks)."""
    with _reocr_jobs_lock:
        return [
            {
                "job_id": jid,
                "work_id": j["work_id"],
                "slug": j["slug"],
                "page_filename": j.get("page_filename", ""),
                "page_number": j.get("page_number"),
                "username": j.get("username", ""),
                "status": j["status"],
                "error": j.get("error"),
                "started_at": j.get("started_at"),
                "finished_at": j.get("finished_at"),
            }
            for jid, j in _reocr_jobs.items()
        ]


def start_reocr_job(work_id: str, slug: str, img_path: str, page_filename: str = "", page_number: int = None, username: str = "") -> str:
    """
    Alustab lehekülje re-OCR tööd: laadib pildi OCR serverisse SFTP kaudu.
    Tagastab job_id, mille abil saab staatust küsida poll_reocr_job() kaudu.
    """
    job_id = generate_nanoid()
    remote_staging = f"AUTO-OCR/{job_id}"
    remote_work = f"AUTO-OCR/{job_id}/{slug}"
    remote_img_name = f"{slug}_pg_001.jpg"

    _reocr_jobs[job_id] = {
        "work_id": work_id,
        "slug": slug,
        "page_filename": page_filename,
        "page_number": page_number,
        "username": username,
        "status": "uploading",
        "text": None,
        "error": None,
        "started_at": datetime.now().timestamp(),
        "remote_staging": remote_staging,
        "remote_work": remote_work,
        "remote_img": f"{remote_work}/{remote_img_name}",
        "remote_txt": f"{remote_work}/{slug}_pg_001.txt",
    }

    def _upload():
        try:
            sftp = _sftp_open(job_id)
            staging_abs = f"{OCR_SERVER_PATH}/{remote_staging}"
            work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
            for d in (staging_abs, work_abs):
                try:
                    sftp.stat(d)
                except FileNotFoundError:
                    sftp.mkdir(d)
            img_abs = f"{OCR_SERVER_PATH}/{_reocr_jobs[job_id]['remote_img']}"
            sftp.put(img_path, img_abs)
            sftp.close()
            _reocr_jobs[job_id]["status"] = "processing"
            logger.info(f"Re-OCR {job_id}: pilt edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR {job_id} upload viga: {e}")
            _reocr_jobs[job_id]["status"] = "error"
            _reocr_jobs[job_id]["error"] = str(e)
            _reocr_jobs[job_id]["finished_at"] = datetime.now().timestamp()
        finally:
            try:
                os.unlink(img_path)
            except Exception:
                pass

    threading.Thread(target=_upload, daemon=True, name=f"reocr-{job_id}").start()
    return job_id


def poll_reocr_job(job_id: str) -> dict:
    """
    Küsib re-OCR töö staatuse.
    Kui olek on 'processing', proovib SFTP kaudu TXT faili alla laadida.
    Tagastab: {status, text?, error?}
    """
    job = _reocr_jobs.get(job_id)
    if not job:
        return {"status": "not_found"}

    current = job["status"]
    if current in ("uploading", "done", "error"):
        return {"status": current, "text": job.get("text"), "error": job.get("error")}

    # status == 'processing' — proovi TXT alla laadida
    try:
        sftp = _sftp_open(job_id)
        txt_abs = f"{OCR_SERVER_PATH}/{job['remote_txt']}"
        try:
            sftp.stat(txt_abs)
        except FileNotFoundError:
            sftp.close()
            return {"status": "processing", "text": None, "error": None}

        # TXT on valmis — laadi sisu alla
        buf = io.BytesIO()
        sftp.getfo(txt_abs, buf)
        text = buf.getvalue().decode("utf-8", errors="replace")
        sftp.close()

        # Puhasta OCR serveri kataloog taustal
        try:
            sftp2 = _sftp_open(job_id)
            img_abs = f"{OCR_SERVER_PATH}/{job['remote_img']}"
            work_abs = f"{OCR_SERVER_PATH}/{job['remote_work']}"
            staging_abs = f"{OCR_SERVER_PATH}/{job['remote_staging']}"
            for f in (txt_abs, img_abs):
                try:
                    sftp2.remove(f)
                except Exception:
                    pass
            for d in (work_abs, staging_abs):
                try:
                    sftp2.rmdir(d)
                except Exception:
                    pass
            sftp2.close()
        except Exception as cleanup_err:
            logger.warning(f"Re-OCR {job_id} cleanup viga: {cleanup_err}")

        close_ssh(job_id)
        job["status"] = "done"
        job["text"] = text
        job["finished_at"] = datetime.now().timestamp()
        logger.info(f"Re-OCR {job_id} valmis ({len(text)} tähemärki)")

        # Kirjuta tulemus .ocr failina teose kausta (püsiv backup)
        page_fn = job.get("page_filename", "")
        if page_fn:
            stem = os.path.splitext(page_fn)[0]
            ocr_path = os.path.join(BASE_DIR, job["slug"], stem + ".ocr")
            try:
                with open(ocr_path, "w", encoding="utf-8") as f:
                    f.write(text)
                logger.info(f"Re-OCR {job_id}: .ocr fail kirjutatud → {ocr_path}")
            except Exception as write_err:
                logger.warning(f"Re-OCR {job_id}: .ocr faili kirjutamine ebaõnnestus: {write_err}")
    except Exception as e:
        logger.warning(f"Re-OCR {job_id} poll viga: {e}")

    return {"status": job["status"], "text": job.get("text"), "error": job.get("error")}
