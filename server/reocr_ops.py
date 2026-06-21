"""
Re-OCR operatsioonid — olemasoleva lehekülje uuesti transkribeerimine OCR serveri kaudu.
"""
import io
import json
import os
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .config import BASE_DIR, OCR_SERVER_PATH, REOCR_LOG_FILE, get_logger
from .utils import generate_nanoid
from .upload_ops import _sftp_open, close_ssh

REOCR_LOG_MAX = 500   # Maksimaalne kirjete arv logifailis
_log_lock = threading.Lock()


def _append_to_log(job: dict, job_id: str):
    """Lisab lõppenud (done/error) töö püsivasse logifaili."""
    entry = {
        "job_id": job_id,
        "work_id": job.get("work_id"),
        "slug": job.get("slug"),
        "page_filename": job.get("page_filename"),
        "page_number": job.get("page_number"),
        "username": job.get("username"),
        "status": job.get("status"),
        "error": job.get("error"),
        "started_at": job.get("started_at"),
        "finished_at": job.get("finished_at"),
    }
    with _log_lock:
        try:
            if os.path.exists(REOCR_LOG_FILE):
                with open(REOCR_LOG_FILE, "r", encoding="utf-8") as f:
                    log = json.load(f)
            else:
                log = []
            log.append(entry)
            if len(log) > REOCR_LOG_MAX:
                log = log[-REOCR_LOG_MAX:]
            with open(REOCR_LOG_FILE, "w", encoding="utf-8") as f:
                json.dump(log, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"Re-OCR logi kirjutamine ebaõnnestus: {e}")


def get_reocr_log(offset: int = 0, limit: int = 50) -> dict:
    """Tagastab re-OCR logi kirjed (uuemad ees)."""
    with _log_lock:
        try:
            if not os.path.exists(REOCR_LOG_FILE):
                return {"entries": [], "has_more": False, "total": 0}
            with open(REOCR_LOG_FILE, "r", encoding="utf-8") as f:
                log = json.load(f)
        except Exception:
            return {"entries": [], "has_more": False, "total": 0}
    entries = list(reversed(log))  # uuemad ees
    total = len(entries)
    page = entries[offset: offset + limit]
    return {"entries": page, "has_more": offset + limit < total, "total": total}

logger = get_logger(__name__)


def _write_ocr_file(slug: str, page_filename: str, text: str) -> str:
    """Kirjutab OCR-tulemuse {BASE_DIR}/{slug}/{stem}.ocr failina (püsiv staging). Tagastab tee."""
    stem = os.path.splitext(os.path.basename(page_filename))[0]
    ocr_path = os.path.join(BASE_DIR, slug, stem + ".ocr")
    with open(ocr_path, "w", encoding="utf-8") as f:
        f.write(text)
    return ocr_path


def _build_batch_pages(slug: str, pages: List[Tuple[str, Optional[int]]]) -> List[Dict]:
    """Ehitab batch-jobi per-lehe kirjed AUTORITEETSE mapping'uga.

    remote_img_name/_txt_name on ainult OCR-serveri nimekonventsioon; tulemuse
    sihtleht loetakse ALATI kirje page_filename väljast, MITTE indeksi järgi.
    """
    result: List[Dict] = []
    for i, (page_filename, page_number) in enumerate(pages):
        ext = os.path.splitext(page_filename)[1] or ".jpg"
        base = f"{slug}_pg_{i + 1:03d}"
        result.append({
            "page_filename": page_filename,
            "page_number": page_number,
            "stem": os.path.splitext(os.path.basename(page_filename))[0],
            "remote_img_name": f"{base}{ext}",
            "remote_txt_name": f"{base}.txt",
            "status": "uploading",
            "error": None,
        })
    return result


_reocr_jobs: dict = {}  # {job_id: {status, text, error, remote_staging, remote_work, remote_img, remote_txt}}
_reocr_jobs_lock = threading.Lock()

REOCR_MAX_CONCURRENT = 20   # Max korraga aktiivseid re-OCR töid
REOCR_JOB_TTL = 86400       # Valmis/vigased tööd kustutatakse 24h pärast
REOCR_PROCESSING_TIMEOUT = 1800  # 30 minutit — pärast seda märgitakse error

REOCR_BATCH_INACTIVITY_TIMEOUT = 1800  # Batch error, kui X s pole ühegi lehe kohta uut .txt

_reocr_batch_jobs: Dict = {}  # {job_id: batch-job dict}
_reocr_batch_jobs_lock = threading.Lock()


def get_active_batch_for_work(work_id: str) -> Optional[str]:
    """Aktiivse (uploading/processing) batch-jobi job_id selle teose jaoks, muidu None."""
    with _reocr_batch_jobs_lock:
        for jid, j in _reocr_batch_jobs.items():
            if j["work_id"] == work_id and j["status"] in ("uploading", "processing"):
                return jid
    return None


def start_reocr_batch(work_id: str, slug: str, work_path: str,
                      pages: List[Tuple[str, Optional[int]]],
                      material_type: str = "print", username: str = "") -> str:
    """Alustab mitme lehe batch re-OCR tööd: laeb KÕIK pildid ühte staging-kausta.
    Loeb pildid otse work_path-ist (EI kustuta originaale). Tagastab job_id."""
    if material_type not in ("print", "hand"):
        material_type = "print"
    job_id = generate_nanoid()
    remote_staging = f"AUTO-OCR/{material_type}/{job_id}"
    remote_work = f"AUTO-OCR/{material_type}/{job_id}/{slug}"
    page_entries = _build_batch_pages(slug, pages)
    now = datetime.now().timestamp()

    job = {
        "kind": "batch",
        "work_id": work_id,
        "slug": slug,
        "username": username,
        "material_type": material_type,
        "status": "uploading",
        "started_at": now,
        "finished_at": None,
        "last_progress_at": now,
        "remote_staging": remote_staging,
        "remote_work": remote_work,
        "pages": page_entries,
    }
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs[job_id] = job

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
            for entry in page_entries:
                src = os.path.join(work_path, entry["page_filename"])
                sftp.put(src, f"{work_abs}/{entry['remote_img_name']}")
                entry["status"] = "processing"
            sftp.close()
            job["status"] = "processing"
            logger.info(f"Re-OCR batch {job_id}: {len(page_entries)} pilti edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR batch {job_id} upload viga: {e}")
            for entry in page_entries:
                if entry["status"] in ("uploading", "processing"):
                    entry["status"] = "error"
                    entry["error"] = str(e)
            job["status"] = "error"
            job["finished_at"] = datetime.now().timestamp()

    threading.Thread(target=_upload, daemon=True, name=f"reocr-batch-{job_id}").start()
    return job_id


def _download_txt_if_ready(sftp, txt_abs: str) -> Optional[str]:
    """Tagastab .txt sisu kui fail eksisteerib, muidu None."""
    try:
        sftp.stat(txt_abs)
    except FileNotFoundError:
        return None
    buf = io.BytesIO()
    sftp.getfo(txt_abs, buf)
    return buf.getvalue().decode("utf-8", errors="replace")


def _batch_inactive(job: Dict, now: float, timeout: int) -> bool:
    """Kas batch on liiga kaua ilma edenemiseta (viimasest ready-st)."""
    return (now - job.get("last_progress_at", job["started_at"])) > timeout


def _finalize_batch_if_complete(job: Dict) -> None:
    """Kui kõik lehed ready/error → märgi job done."""
    if all(e["status"] in ("ready", "error") for e in job["pages"]):
        if job["status"] != "done":
            job["status"] = "done"
            job["finished_at"] = datetime.now().timestamp()


def _poll_batch_job(job_id: str) -> None:
    """Laeb iga ootel-lehe valmis .txt alla → .ocr fail (AUTORITEETNE mapping kirjest)."""
    job = _reocr_batch_jobs.get(job_id)
    if not job or job["status"] != "processing":
        return
    pending = [e for e in job["pages"] if e["status"] == "processing"]
    if not pending:
        _finalize_batch_if_complete(job)
        return
    try:
        sftp = _sftp_open(job_id)
    except Exception as e:
        logger.warning(f"Re-OCR batch {job_id} poll sftp viga: {e}")
        return
    work_abs = f"{OCR_SERVER_PATH}/{job['remote_work']}"
    try:
        for entry in pending:
            txt_abs = f"{work_abs}/{entry['remote_txt_name']}"
            try:
                text = _download_txt_if_ready(sftp, txt_abs)
            except Exception as e:
                logger.warning(f"Re-OCR batch {job_id} {entry['page_filename']} laadimisviga: {e}")
                continue
            if text is None:
                continue
            # AUTORITEETNE: kirje page_filename määrab sihtkoha
            try:
                _write_ocr_file(job["slug"], entry["page_filename"], text)
                entry["status"] = "ready"
                job["last_progress_at"] = datetime.now().timestamp()
            except Exception as e:
                entry["status"] = "error"
                entry["error"] = str(e)
            # Korista remote pilt+txt
            for f in (txt_abs, f"{work_abs}/{entry['remote_img_name']}"):
                try:
                    sftp.remove(f)
                except Exception:
                    pass
    finally:
        try:
            sftp.close()
        except Exception:
            pass
    close_ssh(job_id)
    _finalize_batch_if_complete(job)


def _reocr_batch_poll_loop():
    """Daemon: kontrollib batch-töid iga 10s; inactivity-timeout märgib lahendamata lehed error-iks."""
    import time
    while True:
        time.sleep(10)
        now = datetime.now().timestamp()
        with _reocr_batch_jobs_lock:
            active = [(jid, j) for jid, j in _reocr_batch_jobs.items() if j["status"] == "processing"]
            # TTL: eemalda vanad done jobid
            stale = [jid for jid, j in _reocr_batch_jobs.items()
                     if j["status"] in ("done", "error")
                     and (j.get("finished_at") or 0) < now - REOCR_JOB_TTL]
            for jid in stale:
                del _reocr_batch_jobs[jid]
        for jid, job in active:
            if _batch_inactive(job, now, REOCR_BATCH_INACTIVITY_TIMEOUT):
                with _reocr_batch_jobs_lock:
                    for e in job["pages"]:
                        if e["status"] in ("uploading", "processing"):
                            e["status"] = "error"
                            e["error"] = "Aegumine: OCR ei edenenud määratud aja jooksul."
                    job["status"] = "done"
                    job["finished_at"] = now
                logger.warning(f"Re-OCR batch {jid}: inactivity-timeout")
                continue
            try:
                _poll_batch_job(jid)
            except Exception as e:
                logger.warning(f"Re-OCR batch {jid} poll viga: {e}")


threading.Thread(target=_reocr_batch_poll_loop, daemon=True, name="reocr-batch-poll").start()


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
                        _append_to_log(_reocr_jobs[jid], jid)
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


def start_reocr_job(work_id: str, slug: str, img_path: str, page_filename: str = "", page_number: int = None, username: str = "", material_type: str = "print") -> str:
    """
    Alustab lehekülje re-OCR tööd: laadib pildi OCR serverisse SFTP kaudu.
    Tagastab job_id, mille abil saab staatust küsida poll_reocr_job() kaudu.
    """
    if material_type not in ('print', 'hand'):
        material_type = 'print'
    job_id = generate_nanoid()
    remote_staging = f"AUTO-OCR/{material_type}/{job_id}"
    remote_work = f"AUTO-OCR/{material_type}/{job_id}/{slug}"
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
            _append_to_log(_reocr_jobs[job_id], job_id)
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
        _append_to_log(job, job_id)

        # Kirjuta tulemus .ocr failina teose kausta (püsiv backup)
        page_fn = job.get("page_filename", "")
        if page_fn:
            try:
                ocr_path = _write_ocr_file(job["slug"], page_fn, text)
                logger.info(f"Re-OCR {job_id}: .ocr fail kirjutatud → {ocr_path}")
            except Exception as write_err:
                logger.warning(f"Re-OCR {job_id}: .ocr faili kirjutamine ebaõnnestus: {write_err}")
    except Exception as e:
        logger.warning(f"Re-OCR {job_id} poll viga: {e}")

    return {"status": job["status"], "text": job.get("text"), "error": job.get("error")}
