"""
Re-OCR operatsioonid — olemasoleva lehekülje uuesti transkribeerimine OCR serveri kaudu.
"""
import io
import json
import os
import threading
from datetime import datetime
from typing import Dict, List, Optional, Tuple

from .config import BASE_DIR, OCR_SERVER_PATH, REOCR_LOG_FILE, UPLOAD_ENABLED, get_logger
from .utils import generate_nanoid
from .upload_ops import _sftp_open, close_ssh
from . import reocr_state

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
    for _k in ("recovered", "original_status", "recovered_at"):
        if _k in job:
            entry[_k] = job[_k]
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
REOCR_PROCESSING_TIMEOUT = 1800  # 30 min — SLOW-lävi (nõuandev), EI lõpeta tööd
REOCR_ABSOLUTE_TIMEOUT = int(os.getenv("REOCR_ABSOLUTE_TIMEOUT", str(12 * 3600)))
# ^ Sanity cap kogu kliendipoolsele elueale (sh järjekorras ootamine), MITTE OCR-töötluse timeout.

REOCR_BATCH_INACTIVITY_TIMEOUT = 1800  # Batch slow, kui X s pole ühegi lehe kohta uut .txt

_reocr_batch_jobs: Dict = {}  # {job_id: batch-job dict}
_reocr_batch_jobs_lock = threading.Lock()


def _persist_active_jobs() -> None:
    """Snapshot mõlemast dict'ist ja persist reocr_active.json-i (aktiivsed jäävad)."""
    with _reocr_jobs_lock:
        single = dict(_reocr_jobs)
    with _reocr_batch_jobs_lock:
        batch = dict(_reocr_batch_jobs)
    reocr_state.persist_active_jobs({**single, **batch})


def _mark_slow_if_stale(jid: str, job: dict, now: float) -> bool:
    """Sea slow=True esimest korda kui üle slow-läve. Debounce: teisel korral False."""
    if now - job.get("started_at", now) <= REOCR_PROCESSING_TIMEOUT:
        return False
    if job.get("slow"):
        return False
    with _reocr_jobs_lock:
        j = _reocr_jobs.get(jid)
        if j and j["status"] == "processing" and not j.get("slow"):
            j["slow"] = True
            j["slow_since"] = now
            return True
    return False


def _abs_timeout_reached(job: dict, now: float) -> bool:
    return now - job.get("started_at", now) > REOCR_ABSOLUTE_TIMEOUT


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
    _persist_active_jobs()

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
            _persist_active_jobs()
            logger.info(f"Re-OCR batch {job_id}: {len(page_entries)} pilti edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR batch {job_id} upload viga: {e}")
            for entry in page_entries:
                if entry["status"] in ("uploading", "processing"):
                    entry["status"] = "error"
                    entry["error"] = str(e)
            job["status"] = "error"
            job["finished_at"] = datetime.now().timestamp()
            _persist_active_jobs()

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
            # Korista remote pilt+txt AINULT õnnestunud kirjutuse korral.
            # Vea korral jäetakse .txt alles, et järgmine poll-ring saaks uuesti proovida.
            if entry["status"] == "ready":
                for f in (txt_abs, f"{work_abs}/{entry['remote_img_name']}"):
                    try:
                        sftp.remove(f)
                    except Exception:
                        pass
        # Kui kõik lehed on lahendatud, koristame tühja remote staging-kausta
        all_resolved = all(e["status"] in ("ready", "error") for e in job["pages"])
        if all_resolved:
            staging_abs = f"{OCR_SERVER_PATH}/{job['remote_staging']}"
            for d in (work_abs, staging_abs):
                try:
                    sftp.rmdir(d)
                except Exception:
                    pass
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        close_ssh(job_id)
    _finalize_batch_if_complete(job)


def _batch_poll_iteration(now: float) -> None:
    """Üks batch-pollimis-pass. slow batch-tasemel; absoluutne lagi märgib allesjäänud
    pending-lehed veaks ALLES pärast viimast _poll_batch_job-i. Osaliselt valmis jäävad.
    Säilitab olemasoleva TTL-puhastuse (vanad done/error batch'id)."""
    with _reocr_batch_jobs_lock:
        active = [(jid, j) for jid, j in _reocr_batch_jobs.items() if j["status"] == "processing"]
        stale = [jid for jid, j in _reocr_batch_jobs.items()
                 if j["status"] in ("done", "error")
                 and (j.get("finished_at") or 0) < now - REOCR_JOB_TTL]
        for jid in stale:
            del _reocr_batch_jobs[jid]
    changed = bool(stale)
    for jid, job in active:
        if _abs_timeout_reached(job, now):
            try:
                _poll_batch_job(jid)
            except Exception as e:
                logger.warning(f"Re-OCR batch {jid} viimane kontroll ebaõnnestus: {e}")
            with _reocr_batch_jobs_lock:
                j = _reocr_batch_jobs.get(jid)
                if j and j["status"] == "processing":
                    for e in j["pages"]:
                        if e["status"] in ("uploading", "processing"):
                            e["status"] = "error"
                            e["error"] = "Aegumine: OCR-tulemust ei saabunud absoluutse aja jooksul."
                    j["status"] = "done"
                    j["finished_at"] = now
                    changed = True
            continue
        if _batch_inactive(job, now, REOCR_BATCH_INACTIVITY_TIMEOUT) and not job.get("slow"):
            with _reocr_batch_jobs_lock:
                j = _reocr_batch_jobs.get(jid)
                if j and j["status"] == "processing" and not j.get("slow"):
                    j["slow"] = True
                    j["slow_since"] = now
                    changed = True
        before = (job.get("status"), job.get("last_progress_at"),
                  tuple(e.get("status") for e in job.get("pages", [])))
        try:
            _poll_batch_job(jid)
            with _reocr_batch_jobs_lock:
                cur = _reocr_batch_jobs.get(jid)
                after = (cur.get("status"), cur.get("last_progress_at"),
                         tuple(e.get("status") for e in cur.get("pages", []))) if cur else None
            if after != before:
                changed = True
        except Exception as e:
            logger.warning(f"Re-OCR batch {jid} poll viga: {e}")
    if changed:
        _persist_active_jobs()


def _reocr_batch_poll_loop():
    import time
    while True:
        time.sleep(10)
        try:
            _batch_poll_iteration(datetime.now().timestamp())
        except Exception as e:
            logger.warning(f"Re-OCR batch poll iteration viga: {e}")


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


def build_reocr_status(work_id: str, work_path: str) -> Dict:
    """Koondab teose re-OCR staatuse manage-lehe jaoks. Hoiab kolm mõistet lahus:
    active (OCR töötab), ocr_ready (.ocr ootel, stem'id), errors. progress = aktiivse
    batchi kokkuvõte."""
    active: Dict[str, str] = {}
    errors: Dict[str, str] = {}
    progress: Optional[Dict] = None
    with _reocr_batch_jobs_lock:
        for j in _reocr_batch_jobs.values():
            if j["work_id"] != work_id:
                continue
            is_active = j["status"] in ("uploading", "processing")
            for e in j["pages"]:
                if e["status"] in ("uploading", "processing"):
                    active[e["page_filename"]] = e["status"]
                elif e["status"] == "error" and e.get("error"):
                    errors[e["page_filename"]] = e["error"]
            summary = {
                "total": len(j["pages"]),
                "ready": sum(1 for e in j["pages"] if e["status"] == "ready"),
                "errors": sum(1 for e in j["pages"] if e["status"] == "error"),
                "active": is_active,
            }
            # Eelista aktiivset batchi; muidu viimast nähtut
            if is_active or progress is None:
                progress = summary
    ocr_ready: List[str] = []
    try:
        for fn in os.listdir(work_path):
            if fn.endswith(".ocr"):
                ocr_ready.append(os.path.splitext(fn)[0])
    except FileNotFoundError:
        pass
    ocr_ready.sort()  # Deterministlik järjekord
    return {"active": active, "ocr_ready": ocr_ready, "errors": errors, "progress": progress}


def _poll_iteration(now: float) -> None:
    """Üks pollimis-pass üle 'processing' tööde. Testitav ilma lõputu loopita."""
    with _reocr_jobs_lock:
        processing = [(jid, j) for jid, j in _reocr_jobs.items() if j["status"] == "processing"]
    changed = False
    for jid, job in processing:
        if _abs_timeout_reached(job, now):
            try:
                poll_reocr_job(jid)
            except Exception as e:
                logger.warning(f"Re-OCR {jid} viimane kontroll ebaõnnestus: {e}")
            with _reocr_jobs_lock:
                j = _reocr_jobs.get(jid)
                if j and j["status"] == "processing":
                    j["status"] = "error"
                    j["error"] = "Aegumine: OCR-tulemust ei saabunud absoluutse aja jooksul."
                    j["finished_at"] = now
                    _append_to_log(j, jid)
                    changed = True
            continue
        if _mark_slow_if_stale(jid, job, now):
            changed = True
        try:
            poll_reocr_job(jid)
        except Exception as e:
            logger.warning(f"Re-OCR background poll viga ({jid}): {e}")
    if changed:
        _persist_active_jobs()


def _reocr_poll_loop():
    """Daemon-thread: kontrollib 'processing' töid iga 10s. 30 min → slow-lipp (ei loobu);
    absoluutne sanity-lagi → error ALLES pärast viimast SFTP-kontrolli."""
    import time
    while True:
        time.sleep(10)
        try:
            _poll_iteration(datetime.now().timestamp())
        except Exception as e:
            logger.warning(f"Re-OCR poll iteration viga: {e}")


threading.Thread(target=_reocr_poll_loop, daemon=True, name="reocr-poll").start()


def get_active_reocr_count() -> int:
    """Tagastab parajasti aktiivsete (uploading/processing) re-OCR tööde arvu."""
    return sum(1 for j in _reocr_jobs.values() if j["status"] in ("uploading", "processing"))


def list_reocr_jobs() -> list:
    """Tagastab kõigi re-OCR tööde loendi (admin ülevaate jaoks)."""
    with _reocr_jobs_lock:
        items = list(_reocr_jobs.items())
    active = [(jid, j) for jid, j in items if j["status"] in ("uploading", "processing")]

    def _queue_ahead(job: dict) -> int:
        if job["status"] not in ("uploading", "processing"):
            return 0
        st = job.get("started_at", 0) or 0
        # Lokaalne VUTT FIFO-lähend — OCR-serveri päris järjekorda ei teata.
        return sum(1 for _, o in active if (o.get("started_at", 0) or 0) < st)

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
            "slow": bool(j.get("slow", False)),
            "slow_since": j.get("slow_since"),
            "queue_ahead": _queue_ahead(j),
        }
        for jid, j in items
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
    _persist_active_jobs()

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
            _persist_active_jobs()
            logger.info(f"Re-OCR {job_id}: pilt edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR {job_id} upload viga: {e}")
            _reocr_jobs[job_id]["status"] = "error"
            _reocr_jobs[job_id]["error"] = str(e)
            _reocr_jobs[job_id]["finished_at"] = datetime.now().timestamp()
            _append_to_log(_reocr_jobs[job_id], job_id)
            _persist_active_jobs()
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
        _persist_active_jobs()

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


def _split_loaded(loaded: dict):
    """Jaga laetud aktiivsed tööd üksik- ja batch-dict'ideks 'kind' järgi."""
    single, batch = {}, {}
    for jid, j in loaded.items():
        if j.get("kind") == "batch":
            batch[jid] = j
        else:
            single[jid] = j
    return single, batch


def _revive_dead_uploads(jobs: dict) -> int:
    """Restardil laetud 'uploading' tööde upload-thread on surnud → poll ei töötleks neid
    kunagi (poll ainult 'processing') ega reaper (uploading = aktiivne) → igavene zombie.
    Teisenda 'uploading' → 'processing', et absoluutne sanity-lagi (12h) neid katab: kui
    pilt jõudis serverisse, poll leiab tulemuse; kui ei, aegub error-iks. Tagastab arvu."""
    n = 0
    for j in jobs.values():
        if j.get("status") == "uploading":
            j["status"] = "processing"
            n += 1
    return n


def start_reocr_background() -> None:
    """Käivita re-OCR restardi-jätkamine + reconciliation. Kutsu AINULT main.py lifespan'ist
    (API-protsess). JÄRJEKORD KRIITILINE: load → recovery → reaper, et aktiivseid töid
    ei peetaks orvuks."""
    if not UPLOAD_ENABLED:
        return
    from . import reocr_recovery
    single, batch = _split_loaded(reocr_state.load_active_jobs())
    revived = _revive_dead_uploads(single) + _revive_dead_uploads(batch)
    with _reocr_jobs_lock:
        _reocr_jobs.update(single)
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs.update(batch)
    logger.info(f"Re-OCR taastatud mällu: {len(single)} üksik + {len(batch)} batch "
                f"({revived} surnud upload-i → processing)")
    if revived:
        _persist_active_jobs()  # kirjuta teisendatud staatus kohe tagasi
    try:
        result = reocr_recovery.scan_and_recover()
        logger.info(f"Re-OCR startup recovery: taastatud {len(result['recovered'])}, "
                    f"skip {len(result['skipped'])}")
    except Exception as e:
        logger.warning(f"Re-OCR startup recovery viga: {e}")
    reocr_recovery.start_reaper_loop()
