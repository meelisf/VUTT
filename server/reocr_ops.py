"""
Re-OCR operatsioonid — olemasoleva lehekülje uuesti transkribeerimine OCR serveri kaudu.
"""
import io
import json
import os
import shutil
import threading
from datetime import datetime
from typing import Callable, Dict, List, Optional, Tuple

from .config import (
    BASE_DIR, GEMINI_MAX_INFLIGHT_REQUESTS, OCR_SERVER_PATH, REOCR_BACKUPS_DIR,
    REOCR_LOG_FILE, UPLOAD_ENABLED, gemini_enabled, get_logger,
)
from .ocr_prompts import instruction_for
from .utils import atomic_write_json, generate_nanoid
from .upload_ops import _sftp_open, close_ssh
from .upload.ocr_client import cleanup_run_files, publish_atomic
from . import ocr_reaper
from . import reocr_state
from .heartbeat import mark_error, mark_success, register_job

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
    for _k in ("recovered", "original_status", "recovered_at", "remote_cleanup"):
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
            atomic_write_json(REOCR_LOG_FILE, log)
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
        except Exception as e:
            logger.warning(f"Re-OCR logi lugemine ebaõnnestus: {e}")
            return {"entries": [], "has_more": False, "total": 0}
    entries = list(reversed(log))  # uuemad ees
    total = len(entries)
    page = entries[offset: offset + limit]
    return {"entries": page, "has_more": offset + limit < total, "total": total}

logger = get_logger(__name__)


def _backup_dir(job_id: str) -> str:
    """Selle töö ülekirjutatud .ocr failide varukoopiad."""
    return os.path.join(REOCR_BACKUPS_DIR, job_id)


def _write_ocr_file(slug: str, page_filename: str, text: str, job_id: str) -> str:
    """Kirjutab OCR-tulemuse {BASE_DIR}/{slug}/{stem}.ocr failina (püsiv staging).

    Kui sihtkohas on juba ootel tulemus, varundatakse see ENNE ülekirjutamist.
    Katkestamine taastab varukoopia — muidu hävitaks katkestatud töö varasema
    kehtiva tulemuse, mida ta ise ei tootnud (#217).
    """
    stem = os.path.splitext(os.path.basename(page_filename))[0]
    ocr_path = os.path.join(BASE_DIR, slug, stem + ".ocr")

    if os.path.exists(ocr_path):
        bdir = _backup_dir(job_id)
        os.makedirs(bdir, exist_ok=True)
        backup_path = os.path.join(bdir, stem + ".ocr")
        # Ainult ESIMENE ülekirjutus varundatakse — muidu kirjutaks sama töö
        # kordusjooks varukoopia enda tulemusega üle.
        if not os.path.exists(backup_path):
            shutil.copy2(ocr_path, backup_path)
            reocr_state.add_backup_target(job_id, stem + ".ocr", ocr_path)

    with open(ocr_path, "w", encoding="utf-8") as f:
        f.write(text)
    return ocr_path


def _restore_backups(job_id: str) -> int:
    """Taastab selle töö ülekirjutatud .ocr failid. Tagastab taastatud arvu."""
    bdir = _backup_dir(job_id)
    if not os.path.isdir(bdir):
        return 0
    mapping = reocr_state.load_backup_targets(job_id)
    restored = 0
    for name in os.listdir(bdir):
        target = mapping.get(name)
        if not target:
            logger.warning(f"Re-OCR {job_id}: varukoopial {name} puudub sihtkoht")
            continue
        try:
            shutil.move(os.path.join(bdir, name), target)
            restored += 1
        except OSError as e:
            logger.warning(f"Re-OCR {job_id}: varukoopia taaste {name}: {e}")
    shutil.rmtree(bdir, ignore_errors=True)
    reocr_state.remove_backup_targets(job_id)
    return restored


def _record_produced(job: dict, page_filename: str) -> None:
    """Märgib, et SEE töö kirjutas selle lehe .ocr faili.

    Katkestamine kustutab ainult siit loendist tulevad lehed. Plaanitud lehtede
    nimekiri (batch mapping) EI OLE omandi tõend — töö võib olla katkestatud
    enne, kui ta plaani lõpuni jõudis (#217).
    """
    stem = os.path.splitext(os.path.basename(page_filename))[0]
    produced = job.setdefault("produced_pages", [])
    if stem not in produced:
        produced.append(stem)


def _drop_backups(job_id: str) -> None:
    """Kustutab varukoopiad (töö lõppes normaalselt / rakendati / visati ära)."""
    shutil.rmtree(_backup_dir(job_id), ignore_errors=True)
    reocr_state.remove_backup_targets(job_id)


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


# Lagi kehtib TÖÖDE ÜLESELT — üks töö on järjestikune. Protsessi-lokaalne, nagu
# RENDER_SEMAPHORE: mitme workeriga (gunicorn) ei ole see enam õige piir.
# `max(1, ...)`: seade tuleb valideerimata env-int'ist. 0 lukustaks iga Gemini-töö
# vaikselt igaveseks, negatiivne viskaks juba impordil ja võtaks backendi maha.
_GEMINI_SEMAPHORE = threading.Semaphore(max(1, GEMINI_MAX_INFLIGHT_REQUESTS))

# Kui tihti kontrollida katkestuslippu semafori järjekorras seistes.
_GEMINI_SLOT_POLL = 1.0


def _acquire_gemini_slot(should_cancel: Optional[Callable[[], bool]]) -> bool:
    """Võtab semafori KATKESTATAVALT. Tagastab False, kui töö katkestati ootel.

    `Semaphore.acquire()` ilma timeout'ita ei ole katkestatav: täis semafori taga
    ootav 5. töö ei reageeriks katkestuslipule enne, kui mõni eelnev lõpeb —
    `_quiesce_upload` 30 s join aeguks ja töö jääks igavesti `cancelling`-uks
    (ADR 0018). Seepärast lühike timeout + lipu kontroll ringi peal.
    """
    while True:
        if should_cancel is not None and should_cancel():
            return False
        if _GEMINI_SEMAPHORE.acquire(timeout=_GEMINI_SLOT_POLL):
            return True


def _gemini_transcribe_page(img_path: str, material_type: str,
                            should_cancel: Optional[Callable[[], bool]] = None
                            ) -> Optional[str]:
    """Üks Gemini kutse. Import on FUNKTSIOONI sees, et testid saaksid patchida
    `server.ocr_providers.gemini.transcribe` ja et moodul ei laeks, kui võtit pole.

    Tagastab None, kui töö katkestati SEMAFORI JÄRJEKORRAS — siis ei ole ühtki
    tulemust ega viga, on lihtsalt „tööd ei olnud". Katkestus juba lennus oleva
    päringu korduste vahel tuleb `GeminiError`-ina ja seda käsitleb kutsuja
    veaharu (mille staatuse-CAS katkestatud töö nagunii kinni püüab).
    """
    from .ocr_providers import gemini
    with open(img_path, "rb") as f:
        image_bytes = f.read()
    if not _acquire_gemini_slot(should_cancel):
        logger.info("Gemini: katkestatud semafori järjekorras")
        return None
    try:
        text, usage = gemini.transcribe(image_bytes, instruction_for(material_type),
                                        should_cancel=should_cancel)
    finally:
        _GEMINI_SEMAPHORE.release()
    logger.info("Gemini leht valmis: %d märki, usage=%s", len(text), usage)
    return text


def _gemini_commit_page(jobs: dict, lock, job_id: str, slug: str,
                        page_filename: str, text: str) -> bool:
    """Kirjutab .ocr JA registreerib omandi ÜHE kriitilise sektsioonina.

    Miks üks sektsioon: `_write_ocr_file` VARUNDAB olemasoleva .ocr faili enne
    ülekirjutamist, seega „kirjuta, siis vajadusel kustuta" EI OLE tagasipööramine —
    see jätaks sihtkoha tühjaks ja lehe produced_pages-ist välja. Ühe sektsiooniga
    on leht kas omatud (ADR 0018 koristus taastab varukoopia) või puutumata.

    OHUTU: `_write_ocr_file` ei võta kumbagi job-lukku (tema ainus lukk on
    reocr_state._file_lock), seega deadlock'i ei teki. Kirjutus on mõne KB suurune.
    """
    with lock:
        töö = jobs.get(job_id)
        if not töö or töö.get("status") != "processing":
            return False
        _write_ocr_file(slug, page_filename, text, job_id)
        _record_produced(töö, page_filename)
        return True


_reocr_jobs: dict = {}  # {job_id: {status, text, error, remote_staging, remote_work, remote_img, remote_txt}}
_reocr_jobs_lock = threading.Lock()

REOCR_MAX_CONCURRENT = 20   # Max korraga aktiivseid re-OCR töid
REOCR_JOB_TTL = 86400       # Valmis/vigased tööd kustutatakse 24h pärast
REOCR_PROCESSING_TIMEOUT = 1800  # 30 min — SLOW-lävi (nõuandev), EI lõpeta tööd
REOCR_ABSOLUTE_TIMEOUT = int(os.getenv("REOCR_ABSOLUTE_TIMEOUT", str(12 * 3600)))
# ^ Sanity cap kogu kliendipoolsele elueale (sh järjekorras ootamine), MITTE OCR-töötluse timeout.

REOCR_BATCH_INACTIVITY_TIMEOUT = 1800  # Batch slow, kui X s pole ühegi lehe kohta uut .txt
register_job("reocr_batch_poll", interval_seconds=10, description="Batch re-OCR tööde taustapoll")
register_job("reocr_cleanup", interval_seconds=600, description="Vanade re-OCR tööde mälust puhastus")
register_job("reocr_poll", interval_seconds=10, description="Üksiklehe re-OCR tööde taustapoll")
register_job("reocr_startup_recovery", description="Käivitusaegne OCR-staging'u orbude taaste (taustal, ei blokeeri API-t)")

_reocr_batch_jobs: Dict = {}  # {job_id: batch-job dict}
_reocr_batch_jobs_lock = threading.Lock()


def _persist_active_jobs() -> None:
    """Snapshot mõlemast dict'ist ja persist reocr_active.json-i (aktiivsed jäävad)."""
    with _reocr_jobs_lock:
        single = dict(_reocr_jobs)
    with _reocr_batch_jobs_lock:
        batch = dict(_reocr_batch_jobs)
    reocr_state.persist_active_jobs({**single, **batch})


# `slow` on LIPP, mitte staatus — aeglase töö staatus jääb `processing`
# (vt _mark_slow_if_stale), seega ta on siin juba kaetud.
CANCELLABLE_STATUSES = ("uploading", "processing")


def _try_begin_cancel(job_id: str) -> Optional[str]:
    """CAS: aktiivne → cancelling. Tagastab "single"/"batch" või None.

    See on ainus koht, kus katkestamine algab. `cancelling` on vaheolek, mis
    vastab küsimusele „kes võitis": poller ei tohi pärast seda enam ühtki
    tulemust kirjutada ega tööd `done`-ks märkida (#217).
    """
    in_single = job_id in _reocr_jobs
    in_batch = job_id in _reocr_batch_jobs
    if in_single and in_batch:
        # job_id nimeruum on registrite vahel globaalne — sama generate_nanoid().
        # Kokkulangevus on invariandi rikkumine; ära arva, kumb oli mõeldud.
        raise RuntimeError("job_id {} esineb mõlemas registris".format(job_id))

    if in_single:
        with _reocr_jobs_lock:
            job = _reocr_jobs.get(job_id)
            if not job or job.get("status") not in CANCELLABLE_STATUSES:
                return None
            job["status"] = "cancelling"
        _persist_active_jobs()
        return "single"

    if in_batch:
        with _reocr_batch_jobs_lock:
            job = _reocr_batch_jobs.get(job_id)
            if not job or job.get("status") not in CANCELLABLE_STATUSES:
                return None
            job["status"] = "cancelling"
        _persist_active_jobs()
        return "batch"

    return None


# Töö-põhised katkestuslipud ja üleslaadimislõimed. Poll-lõimi siin EI OLE —
# need on jagatud singletonid ja neid vaigistab CAS (vt _try_begin_cancel).
_cancel_events: Dict[str, threading.Event] = {}
_upload_threads: Dict[str, threading.Thread] = {}


def _cancel_event(job_id: str) -> threading.Event:
    """Töö katkestuslipp (loob vajadusel)."""
    ev = _cancel_events.get(job_id)
    if ev is None:
        ev = threading.Event()
        _cancel_events[job_id] = ev
    return ev


def _quiesce_upload(job_id: str, timeout: float = 30.0) -> bool:
    """Seab katkestuslipu ja OOTAB üleslaadimislõime lõpetamist.

    Tagastab False, kui lõim ei peatunud. Sel juhul EI TOHI kaugkoristust teha:
    pooleliolev sftp.put() kirjutaks pildid tagasi kataloogi, mille kustutasime.
    Jääk kaugserveris on parem kui võistlus (#217).
    """
    _cancel_event(job_id).set()
    t = _upload_threads.get(job_id)
    if t is None or not t.is_alive():
        return True
    t.join(timeout)
    return not t.is_alive()


def _forget_cancel_state(job_id: str) -> None:
    """Koristab katkestamise abistruktuurid."""
    _cancel_events.pop(job_id, None)
    _upload_threads.pop(job_id, None)


def _cleanup_remote_job(job_id: str, job: dict) -> bool:
    """Kustutab OCR-serverist selle töö pildid ja .txt-d. True = õnnestus.

    Piltide kustutamine ON peatamismehhanism: valvuri process_batch väljub enne
    mudeli kutsumist, kui ükski pilt ei avane. Kuni üks lennusolev batch
    (BATCH_SIZE = 4) jõuab siiski lõpuni — teadlik piir, vt spekki (#217).

    Kataloogid jäävad alles ja lähevad ocr_reaper nimekirja (#225): lennusolev
    batch peab saama oma .txt kuhugi kirjutada, muidu sureb kogu OCR-teenus.
    """
    remote_work = job.get("remote_work")
    if not remote_work:
        return True
    try:
        sftp = _sftp_open(job_id)
    except Exception as e:
        logger.warning(f"Re-OCR {job_id} koristuse SFTP viga: {e}")
        return False

    work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
    ok = True
    try:
        # Failid kohe (see peatab GPU), kataloog hiljem reaperiga (#225): rmdir
        # lennusoleva batchi alt kukutab OCR-teenuse.
        ok = cleanup_run_files(sftp, work_abs)
        ocr_reaper.schedule_reap(work_abs)
        remote_staging = job.get("remote_staging") or ""
        if remote_staging:
            ocr_reaper.schedule_reap(f"{OCR_SERVER_PATH}/{remote_staging}")
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        close_ssh(job_id)
    return ok


def cancel_reocr_job(job_id: str) -> dict:
    """Katkestab re-OCR töö. „Tööd ei olnud" — vt spekki (#217).

    Järjekord ei ole vaba: koristus tohib alata alles siis, kui ühtki kirjutajat
    enam ei ole. Vastasel juhul kirjutab pooleliolev üleslaadimine failid tagasi
    kataloogi, mille just eemaldasime.
    """
    registry = _try_begin_cancel(job_id)
    if registry is None:
        if job_id in _reocr_jobs or job_id in _reocr_batch_jobs:
            raise ValueError("Töö ei ole katkestatav")
        raise KeyError(job_id)

    jobs = _reocr_jobs if registry == "single" else _reocr_batch_jobs
    lock = _reocr_jobs_lock if registry == "single" else _reocr_batch_jobs_lock
    with lock:
        job = dict(jobs.get(job_id) or {})

    if not _quiesce_upload(job_id):
        # Kirjutaja on veel elus — jäta töö `cancelling` olekusse, stardi-taaste
        # korjab üles. Jääk kaugserveris on parem kui võistlus koristusega.
        #
        # Sõnum jõuab kasutajani muutmata kujul (routers/reocr.py 503 `detail`) —
        # peab ütlema TÕTT: kordamine EI AITA. Teine DELETE ei võta seda tööd
        # enam vastu (`cancelling` ei ole `CANCELLABLE_STATUSES`-is → 409), nii
        # et töö laheneb alles backendi taaskäivitusel.
        logger.error(
            f"Re-OCR {job_id}: üleslaadimislõim ei peatunud, koristus edasi lükatud"
        )
        raise RuntimeError(
            "Katkestamine ei jõudnud lõpule. Töö jääb katkestamise olekusse ja "
            "laheneb alles serveri taaskäivitusel — kordamine ei aita."
        )

    remote_ok = _cleanup_remote_job(job_id, job)

    slug = job.get("slug") or ""
    deleted = 0
    for stem in job.get("produced_pages", []):
        path = os.path.join(BASE_DIR, slug, stem + ".ocr")
        try:
            os.unlink(path)
            deleted += 1
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning(f"Re-OCR {job_id} {stem}.ocr kustutus: {e}")
    restored = _restore_backups(job_id)

    with lock:
        current = jobs.pop(job_id, None)
    if current is not None:
        current["status"] = "cancelled"
        current["finished_at"] = datetime.now().timestamp()
        current["remote_cleanup"] = "ok" if remote_ok else "failed"
        _append_to_log(current, job_id)

    reocr_state.remove_batch_mapping(job_id)
    _forget_cancel_state(job_id)
    _persist_active_jobs()

    logger.info(
        f"Re-OCR {job_id} katkestatud: {deleted} .ocr kustutatud, "
        f"{restored} taastatud, kaugkoristus={'ok' if remote_ok else 'failed'}"
    )
    return {
        "status": "cancelled",
        "remote_cleanup": "ok" if remote_ok else "failed",
        "deleted_ocr": deleted,
        "restored_ocr": restored,
    }


def _finish_interrupted_cancellations(jobs: dict) -> int:
    """Lõpetab `cancelling` olekusse jäänud tööd (protsess suri koristuse ajal).

    `cancelling` töö EI OLE aktiivne töö — ilma selleta jääks pooleli katkestatud
    töö restardi järel teost lukustama, mis on täpselt see probleem, mille vastu
    kogu see feature tehakse (#217).
    """
    lopetatud = 0
    for job_id in [k for k, v in jobs.items() if v.get("status") == "cancelling"]:
        job = jobs[job_id]
        remote_ok = _cleanup_remote_job(job_id, job)
        slug = job.get("slug") or ""
        for stem in job.get("produced_pages", []):
            try:
                os.unlink(os.path.join(BASE_DIR, slug, stem + ".ocr"))
            except OSError:
                pass
        _restore_backups(job_id)
        job["status"] = "cancelled"
        job["finished_at"] = datetime.now().timestamp()
        job["remote_cleanup"] = "ok" if remote_ok else "failed"
        _append_to_log(job, job_id)
        jobs.pop(job_id, None)
        reocr_state.remove_batch_mapping(job_id)
        _forget_cancel_state(job_id)
        lopetatud += 1
        logger.info(f"Re-OCR {job_id}: pooleli jäänud katkestamine lõpetatud")
    return lopetatud


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
                      material_type: str = "print", username: str = "",
                      provider: str = "loss") -> str:
    """Alustab mitme lehe batch re-OCR tööd: laeb KÕIK pildid ühte staging-kausta.
    Loeb pildid otse work_path-ist (EI kustuta originaale). Tagastab job_id.

    `provider="gemini"` marsruudib töö Gemini API-le: kaugartefakte ei teki,
    `remote_*` välju ega batch-mappingut ei ole (mapping on AINULT SFTP-orbude
    taastamise tarvis, vt reocr_recovery) ja lehed on kohe `processing`."""
    if material_type not in ("print", "hand"):
        material_type = "print"
    job_id = generate_nanoid()
    remote_staging = f"AUTO-OCR/{material_type}/{job_id}"
    remote_work = f"AUTO-OCR/{material_type}/{job_id}/{slug}"
    page_entries = _build_batch_pages(slug, pages)
    now = datetime.now().timestamp()
    on_gemini = provider == "gemini"
    _batch_map_pages = {
        e["remote_txt_name"]: {"page_filename": e["page_filename"], "page_number": e["page_number"]}
        for e in page_entries
    }

    job = {
        "kind": "batch",
        "work_id": work_id,
        "slug": slug,
        "username": username,
        "material_type": material_type,
        "provider": provider,
        "status": "processing" if on_gemini else "uploading",
        "started_at": now,
        "finished_at": None,
        "last_progress_at": now,
        "pages": page_entries,
    }
    if on_gemini:
        for entry in page_entries:
            entry["status"] = "processing"
    else:
        job["remote_staging"] = remote_staging
        job["remote_work"] = remote_work
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs[job_id] = job
    _persist_active_jobs()
    if not on_gemini:
        reocr_state.persist_batch_mapping(job_id, work_id, slug, _batch_map_pages)

    def _gemini_batch():
        for entry in page_entries:
            if _cancel_event(job_id).is_set():
                logger.info("Gemini batch %s: katkestatud", job_id)
                return
            with _reocr_batch_jobs_lock:
                praegune = _reocr_batch_jobs.get(job_id)
                if not praegune or praegune.get("status") != "processing":
                    return
            src = os.path.join(work_path, entry["page_filename"])
            try:
                text = _gemini_transcribe_page(
                    src, material_type, lambda: _cancel_event(job_id).is_set())
            except Exception as e:
                # Vigane leht ON edenemine (ADR 0025): ta on LAHENDATUD, mitte ootel.
                # Ilma last_progress_at uuenduseta lööks seisaku-tuvastus valehäire.
                logger.warning("Gemini batch %s %s: %s", job_id, entry["page_filename"], e)
                logitav = False
                with _reocr_batch_jobs_lock:
                    praegune = _reocr_batch_jobs.get(job_id)
                    if not praegune or praegune.get("status") != "processing":
                        return
                    for kirje in praegune.get("pages", []):
                        if (kirje.get("page_filename") == entry["page_filename"]
                                and kirje.get("status") == "processing"):
                            kirje["status"] = "error"
                            kirje["error"] = str(e)
                            praegune["last_progress_at"] = datetime.now().timestamp()
                            logitav = True
                            break
                if logitav:
                    _log_batch_page_error(job, job_id, entry, str(e))
                continue
            if text is None or _cancel_event(job_id).is_set():
                return
            # Kirjutusviga (nt OSError) EI TOHI lõime tappa: muidu jääks batch
            # `processing`-usse kuni 12 h absoluutlaeni, nagu LOSS-tee enne #227.
            try:
                omatud = _gemini_commit_page(_reocr_batch_jobs, _reocr_batch_jobs_lock,
                                             job_id, slug, entry["page_filename"], text)
            except Exception as e:
                logger.warning("Gemini batch %s %s kirjutusviga: %s",
                               job_id, entry["page_filename"], e)
                logitav = False
                with _reocr_batch_jobs_lock:
                    praegune = _reocr_batch_jobs.get(job_id)
                    if not praegune or praegune.get("status") != "processing":
                        return
                    for kirje in praegune.get("pages", []):
                        if (kirje.get("page_filename") == entry["page_filename"]
                                and kirje.get("status") == "processing"):
                            kirje["status"] = "error"
                            kirje["error"] = str(e)
                            praegune["last_progress_at"] = datetime.now().timestamp()
                            logitav = True
                            break
                if logitav:
                    _log_batch_page_error(job, job_id, entry, str(e))
                continue
            if omatud:
                with _reocr_batch_jobs_lock:
                    praegune = _reocr_batch_jobs.get(job_id)
                    if praegune:
                        for kirje in praegune.get("pages", []):
                            if (kirje.get("page_filename") == entry["page_filename"]
                                    and kirje.get("status") == "processing"):
                                kirje["status"] = "ready"
                                praegune["last_progress_at"] = datetime.now().timestamp()
                                break
            _persist_active_jobs()
        with _reocr_batch_jobs_lock:
            praegune = _reocr_batch_jobs.get(job_id)
            # Valve `processing` peale (I3): kui katkestamine jõudis vahele PÄRAST
            # viimase lehe commit'i, aga ENNE seda plokki, on staatus juba
            # `cancelling`. Ilma valveta viiks see plokk töö siiski `done`-ks ja
            # kutsuks `_drop_backups`-i — `cancel_reocr_job` ei leiaks enam
            # varukoopiaid, mida taastada, ja kaotaks nii uue kui vana tulemuse.
            if praegune and praegune.get("status") == "processing":
                _finalize_batch_if_complete(praegune, job_id)
        _persist_active_jobs()

    def _upload():
        try:
            # Katkestamine võis jõuda enne, kui lõim käivitus (#217).
            if _cancel_event(job_id).is_set():
                logger.info(f"Re-OCR {job_id}: üleslaadimine katkestatud")
                return
            sftp = _sftp_open(job_id)
            staging_abs = f"{OCR_SERVER_PATH}/{remote_staging}"
            work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
            for d in (staging_abs, work_abs):
                try:
                    sftp.stat(d)
                except FileNotFoundError:
                    sftp.mkdir(d)
            for entry in page_entries:
                if _cancel_event(job_id).is_set():
                    logger.info(f"Re-OCR batch {job_id}: üleslaadimine katkestatud")
                    return
                src = os.path.join(work_path, entry["page_filename"])
                # .tmp+rename: valvur ei kontrolli piltide stabiilsust (#220)
                publish_atomic(sftp, src, f"{work_abs}/{entry['remote_img_name']}")
                with _reocr_batch_jobs_lock:
                    current = _reocr_batch_jobs.get(job_id)
                    if current and current.get("status") == "uploading":
                        entry["status"] = "processing"
            sftp.close()
            with _reocr_batch_jobs_lock:
                current = _reocr_batch_jobs.get(job_id)
                if current and current.get("status") == "uploading":
                    current["status"] = "processing"
            _persist_active_jobs()
            logger.info(f"Re-OCR batch {job_id}: {len(page_entries)} pilti edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR batch {job_id} upload viga: {e}")
            with _reocr_batch_jobs_lock:
                current = _reocr_batch_jobs.get(job_id)
                if current:
                    for entry in current.get("pages", []):
                        if entry["status"] in ("uploading", "processing"):
                            entry["status"] = "error"
                            entry["error"] = str(e)
                    current["status"] = "error"
                    current["finished_at"] = datetime.now().timestamp()
            _persist_active_jobs()

    _t = threading.Thread(target=_gemini_batch if on_gemini else _upload,
                          daemon=True, name=f"reocr-batch-{job_id}")
    _upload_threads[job_id] = _t
    _t.start()
    return job_id


def _err_path(txt_abs: str) -> str:
    """Vea-märgendi tee .txt tee järgi — OCR-server kirjutab `{tüvi}.err` (#250)."""
    return os.path.splitext(txt_abs)[0] + ".err"


def _read_err_marker(sftp, txt_abs: str) -> Optional[str]:
    """Tagastab .err märgendi sisu, kui OCR-server selle lehe kohta vea kirjutas.

    None = märgendit ei ole (leht on endiselt järjekorras). Märgend on LÕPLIK:
    OCR-server ei võta .err-iga lehte enam ette. Ilma selle lugemiseta ootaks
    tellija 12 h absoluuttaimerini (#250).
    """
    err_abs = _err_path(txt_abs)
    try:
        sftp.stat(err_abs)
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning(f"Re-OCR .err kontroll ebaõnnestus {err_abs}: {e}")
        return None
    try:
        buf = io.BytesIO()
        sftp.getfo(err_abs, buf)
        msg = buf.getvalue().decode("utf-8", errors="replace").strip()
    except Exception as e:
        logger.warning(f"Re-OCR .err lugemine ebaõnnestus {err_abs}: {e}")
        msg = ""
    return msg or "OCR ebaõnnestus (põhjus teadmata)"


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


def _log_batch_page_error(job: Dict, job_id: str, entry: Dict, error: str) -> None:
    """Kirjutab batch-lehe VEA püsivasse logisse (#227 järelleid).

    Batch-tee ei logi õnnestumisi: `REOCR_LOG_MAX` on 500 ja üks 100-leheline
    batch pühiks terve ajaloo. Vead on väike maht ja kogu väärtus — ilma nendeta
    kaob põhjus („periood 1 sõna, 21 kordust") koos tööga mälust ja Review-vaade
    ei näita batch-lehtedest midagi, vastuolus ADR 0018-ga.
    """
    try:
        _append_to_log({
            "work_id": job.get("work_id"),
            "slug": job.get("slug"),
            "page_filename": entry.get("page_filename"),
            "page_number": entry.get("page_number"),
            "username": job.get("username"),
            "status": "error",
            "error": error,
            "started_at": job.get("started_at"),
            "finished_at": datetime.now().timestamp(),
        }, job_id)
    except Exception as e:
        logger.warning(f"Re-OCR batch {job_id} vealogi kirjutamine ebaõnnestus: {e}")


def _finalize_batch_if_complete(job: Dict, job_id: Optional[str] = None) -> None:
    """Kui kõik lehed ready/error → märgi job done.

    Normaalne lõpp kustutab varukoopiad: valminud töö tulemus ON nüüd kehtiv
    ootel tulemus ja ülekirjutatud vanem versioon on lõplikult asendatud (#217).
    """
    if all(e["status"] in ("ready", "error") for e in job["pages"]):
        if job["status"] != "done":
            job["status"] = "done"
            job["finished_at"] = datetime.now().timestamp()
            if job_id:
                _drop_backups(job_id)


def _poll_batch_job(job_id: str) -> None:
    """Laeb iga ootel-lehe valmis .txt alla → .ocr fail (AUTORITEETNE mapping kirjest)."""
    with _reocr_batch_jobs_lock:
        job = _reocr_batch_jobs.get(job_id)
        if not job or job["status"] != "processing":
            return
        if job.get("provider") == "gemini":
            # Kaugfaile ei ole — lehed kirjutab töölõim ise. Poll ainult vaatab,
            # kas kõik on lahendatud (lõim võis surra enne finaliseerimist).
            _finalize_batch_if_complete(job, job_id)
            return
        pending = [dict(e) for e in job["pages"] if e["status"] == "processing"]
        slug = job["slug"]
        remote_work = job["remote_work"]
        remote_staging = job.get("remote_staging", os.path.dirname(remote_work))
        if not pending:
            _finalize_batch_if_complete(job, job_id)
            return
    try:
        sftp = _sftp_open(job_id)
    except Exception as e:
        logger.warning(f"Re-OCR batch {job_id} poll sftp viga: {e}")
        return
    work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
    try:
        for entry in pending:
            txt_abs = f"{work_abs}/{entry['remote_txt_name']}"
            try:
                text = _download_txt_if_ready(sftp, txt_abs)
            except Exception as e:
                logger.warning(f"Re-OCR batch {job_id} {entry['page_filename']} laadimisviga: {e}")
                continue
            if text is None:
                err_msg = _read_err_marker(sftp, txt_abs)
                if err_msg is None:
                    continue
                # Leht on OCR-serveris lõplikult ebaõnnestunud (#250). Vigane leht
                # ON edenemine — muidu lööb stall-indikaator valehäire.
                with _reocr_batch_jobs_lock:
                    current = _reocr_batch_jobs.get(job_id)
                    if not current or current.get("status") != "processing":
                        return
                    for cur_entry in current.get("pages", []):
                        if (cur_entry.get("remote_txt_name") == entry["remote_txt_name"]
                                and cur_entry.get("status") == "processing"):
                            cur_entry["status"] = "error"
                            cur_entry["error"] = err_msg
                            current["last_progress_at"] = datetime.now().timestamp()
                            break
                logger.warning(f"Re-OCR batch {job_id} {entry['page_filename']}: {err_msg}")
                _log_batch_page_error(job, job_id, entry, err_msg)
                for f in (_err_path(txt_abs), f"{work_abs}/{entry['remote_img_name']}"):
                    try:
                        sftp.remove(f)
                    except Exception:
                        pass
                continue
            # Olek võis allalaadimise ajal muutuda (DELETE käib teises lõimes).
            # Poll on JAGATUD singleton-lõim — teda ei saa peatada, seega on see
            # kontroll ainus, mis hoiab ära ghost-tulemuse pärast koristust (#217).
            with _reocr_batch_jobs_lock:
                cur = _reocr_batch_jobs.get(job_id)
                if not cur or cur.get("status") != "processing":
                    return
            ready = False
            try:
                # AUTORITEETNE: kirje page_filename määrab sihtkoha
                _write_ocr_file(slug, entry["page_filename"], text, job_id)
                with _reocr_batch_jobs_lock:
                    current = _reocr_batch_jobs.get(job_id)
                    if current and current.get("status") == "processing":
                        for cur_entry in current.get("pages", []):
                            if cur_entry.get("remote_txt_name") == entry["remote_txt_name"] and cur_entry.get("status") == "processing":
                                cur_entry["status"] = "ready"
                                current["last_progress_at"] = datetime.now().timestamp()
                                # Omand: see töö kirjutas selle lehe .ocr faili (#217)
                                _record_produced(current, entry["page_filename"])
                                ready = True
                                break
            except Exception as e:
                logitav = False
                with _reocr_batch_jobs_lock:
                    current = _reocr_batch_jobs.get(job_id)
                    if current and current.get("status") == "processing":
                        for cur_entry in current.get("pages", []):
                            if cur_entry.get("remote_txt_name") == entry["remote_txt_name"] and cur_entry.get("status") == "processing":
                                cur_entry["status"] = "error"
                                cur_entry["error"] = str(e)
                                logitav = True
                                break
                if logitav:
                    _log_batch_page_error(job, job_id, entry, str(e))
            # Korista remote pilt+txt AINULT õnnestunud kirjutuse ja endiselt kehtiva
            # processing→ready ülemineku korral. Vea korral jäetakse .txt alles.
            if ready:
                for f in (txt_abs, f"{work_abs}/{entry['remote_img_name']}"):
                    try:
                        sftp.remove(f)
                    except Exception:
                        pass
        # Kui kõik lehed on lahendatud, koristame tühja remote staging-kausta
        with _reocr_batch_jobs_lock:
            current = _reocr_batch_jobs.get(job_id)
            all_resolved = bool(current) and all(
                e["status"] in ("ready", "error") for e in current.get("pages", [])
            )
        if all_resolved:
            staging_abs = f"{OCR_SERVER_PATH}/{remote_staging}"
            for d in (work_abs, staging_abs):
                try:
                    sftp.rmdir(d)
                except Exception:
                    pass
            reocr_state.remove_batch_mapping(job_id)
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        close_ssh(job_id)
    with _reocr_batch_jobs_lock:
        current = _reocr_batch_jobs.get(job_id)
        if current:
            _finalize_batch_if_complete(current, job_id)


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
            aegunud = []
            with _reocr_batch_jobs_lock:
                j = _reocr_batch_jobs.get(jid)
                if j and j["status"] == "processing":
                    for e in j["pages"]:
                        if e["status"] in ("uploading", "processing"):
                            e["status"] = "error"
                            e["error"] = "Aegumine: OCR-tulemust ei saabunud absoluutse aja jooksul."
                            aegunud.append(dict(e))
                    j["status"] = "done"
                    j["finished_at"] = now
                    changed = True
            for e in aegunud:      # logi väljaspool lukku (#227)
                _log_batch_page_error(j, jid, e, e["error"])
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
            mark_success("reocr_batch_poll")
        except Exception as e:
            mark_error("reocr_batch_poll", e)
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
        mark_success("reocr_cleanup", detail={"removed": len(stale)})
        if stale:
            logger.info(f"Re-OCR cleanup: eemaldati {len(stale)} vana tööd")


threading.Thread(target=_reocr_cleanup_loop, daemon=True, name="reocr-cleanup").start()


def build_reocr_status(work_id: str, work_path: str) -> Dict:
    """Koondab teose re-OCR staatuse manage-lehe jaoks. Hoiab kolm mõistet lahus:
    active (OCR töötab), ocr_ready (.ocr ootel, stem'id), errors.

    `progress` on TEOSE, mitte ühe batchi tasemel (ADR 0029): aktiivse batchi ajal
    näitab seda batchi (elav edenemine + katkestamisnupp), muidu KÕIGI selle teose
    batch-tööde koondit. Varem võttis silmus esimese nähtud kirje ehk lisamis-
    järjestuses VANIMA batchi — uue partii lõppedes hüppas riba tagasi vana partii
    numbritele, samal ajal kui ootel-loendur rääkis juba uuest."""
    active: Dict[str, str] = {}
    errors: Dict[str, str] = {}
    progress: Optional[Dict] = None
    active_job_id: Optional[str] = None   # katkestamiseks Manage-vaates (#217)
    active_provider: Optional[str] = None  # kumb pakkuja parajasti töötab
    koond_total = koond_ready = koond_errors = 0
    with _reocr_batch_jobs_lock:
        for jid, j in _reocr_batch_jobs.items():
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
            koond_total += summary["total"]
            koond_ready += summary["ready"]
            koond_errors += summary["errors"]
            if is_active:
                progress = summary   # elav batch varjutab koondi
                active_job_id = jid
                # Vanemad (enne pakkuja-dimensiooni) kirjed on LOSSi omad.
                active_provider = j.get("provider", "loss")
    if progress is None and koond_total:
        progress = {"total": koond_total, "ready": koond_ready,
                    "errors": koond_errors, "active": False}
    ocr_ready: List[str] = []
    try:
        for fn in os.listdir(work_path):
            if fn.endswith(".ocr"):
                ocr_ready.append(os.path.splitext(fn)[0])
    except FileNotFoundError:
        pass
    ocr_ready.sort()  # Deterministlik järjekord

    # Hulgi-rakenduse ulatus = KÕIK selle teose ootel .ocr-tulemused (ADR 0029).
    # Varasem `batch_ready`/`batch_known` (viimase batchi lõige) on kadunud: see
    # peitis vanema partii ja üksik-re-OCR-i tulemused loendurist ära.
    return {
        "active": active,
        "ocr_ready": ocr_ready,
        "errors": errors,
        "progress": progress,
        # Aktiivse batchi id — Manage-vaate katkestamisnupu jaoks (#217)
        "active_job_id": active_job_id,
        "active_provider": active_provider,
    }


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
            mark_success("reocr_poll")
        except Exception as e:
            mark_error("reocr_poll", e)
            logger.warning(f"Re-OCR poll iteration viga: {e}")


threading.Thread(target=_reocr_poll_loop, daemon=True, name="reocr-poll").start()


def get_active_reocr_count() -> int:
    """Tagastab parajasti aktiivsete (uploading/processing) re-OCR tööde arvu."""
    with _reocr_jobs_lock:
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


def list_reocr_batch_jobs() -> list:
    """Batch re-OCR tööde summaarid (ühtse OCR-vaate jaoks)."""
    with _reocr_batch_jobs_lock:
        items = list(_reocr_batch_jobs.items())
    out = []
    for jid, j in items:
        pages = j.get("pages", [])
        out.append({
            "job_id": jid,
            "work_id": j.get("work_id"),
            "slug": j.get("slug", ""),
            "username": j.get("username", ""),
            "status": j.get("status"),
            "slow": bool(j.get("slow", False)),
            "started_at": j.get("started_at"),
            "ready": sum(1 for e in pages if e.get("status") == "ready"),
            "total": len(pages),
        })
    return out


def start_reocr_job(work_id: str, slug: str, img_path: str, page_filename: str = "", page_number: int = None, username: str = "", material_type: str = "print", provider: str = "loss") -> str:
    """
    Alustab lehekülje re-OCR tööd: laadib pildi OCR serverisse SFTP kaudu.
    Tagastab job_id, mille abil saab staatust küsida poll_reocr_job() kaudu.

    `provider="gemini"` marsruudib töö Gemini API-le: kaugartefakte ei teki,
    `remote_*` välju ei seata ja staatus on kohe `processing` (üleslaadimise
    faasi ei ole).
    """
    if material_type not in ('print', 'hand'):
        material_type = 'print'
    job_id = generate_nanoid()
    remote_staging = f"AUTO-OCR/{material_type}/{job_id}"
    remote_work = f"AUTO-OCR/{material_type}/{job_id}/{slug}"
    remote_img_name = f"{slug}_pg_001.jpg"
    on_gemini = provider == "gemini"

    job = {
        "work_id": work_id,
        "slug": slug,
        "page_filename": page_filename,
        "page_number": page_number,
        "username": username,
        "provider": provider,
        "status": "processing" if on_gemini else "uploading",
        "text": None,
        "error": None,
        "started_at": datetime.now().timestamp(),
    }
    if not on_gemini:
        job.update({
            "remote_staging": remote_staging,
            "remote_work": remote_work,
            "remote_img": f"{remote_work}/{remote_img_name}",
            "remote_txt": f"{remote_work}/{slug}_pg_001.txt",
        })
    with _reocr_jobs_lock:
        _reocr_jobs[job_id] = job
    _persist_active_jobs()

    def _gemini_single():
        try:
            if _cancel_event(job_id).is_set():
                return
            text = _gemini_transcribe_page(img_path, material_type,
                                           lambda: _cancel_event(job_id).is_set())
            if text is None or _cancel_event(job_id).is_set():
                return
            if _gemini_commit_page(_reocr_jobs, _reocr_jobs_lock, job_id, slug,
                                   page_filename, text):
                log_job = None
                with _reocr_jobs_lock:
                    töö = _reocr_jobs.get(job_id)
                    if töö and töö.get("status") == "processing":
                        töö["status"] = "done"
                        töö["text"] = text
                        töö["finished_at"] = datetime.now().timestamp()
                        log_job = dict(töö)
                        _drop_backups(job_id)
                if log_job:
                    _append_to_log(log_job, job_id)
                _persist_active_jobs()
        except Exception as e:
            logger.error("Gemini re-OCR %s viga: %s", job_id, e)
            log_job = None
            with _reocr_jobs_lock:
                töö = _reocr_jobs.get(job_id)
                if töö and töö.get("status") in ("uploading", "processing"):
                    töö["status"] = "error"
                    töö["error"] = str(e)
                    töö["finished_at"] = datetime.now().timestamp()
                    log_job = dict(töö)
            if log_job:
                _append_to_log(log_job, job_id)
            _persist_active_jobs()
        finally:
            try:
                os.unlink(img_path)
            except Exception:
                pass

    def _upload():
        try:
            # Katkestamine võis jõuda enne, kui lõim käivitus (#217).
            if _cancel_event(job_id).is_set():
                logger.info(f"Re-OCR {job_id}: üleslaadimine katkestatud")
                return
            sftp = _sftp_open(job_id)
            staging_abs = f"{OCR_SERVER_PATH}/{remote_staging}"
            work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
            for d in (staging_abs, work_abs):
                try:
                    sftp.stat(d)
                except FileNotFoundError:
                    sftp.mkdir(d)
            img_abs = f"{OCR_SERVER_PATH}/{remote_work}/{remote_img_name}"
            # .tmp+rename: valvur ei kontrolli piltide stabiilsust (#220)
            publish_atomic(sftp, img_path, img_abs)
            sftp.close()
            with _reocr_jobs_lock:
                current = _reocr_jobs.get(job_id)
                if current and current.get("status") == "uploading":
                    current["status"] = "processing"
            _persist_active_jobs()
            logger.info(f"Re-OCR {job_id}: pilt edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR {job_id} upload viga: {e}")
            log_job = None
            with _reocr_jobs_lock:
                current = _reocr_jobs.get(job_id)
                if current and current.get("status") in ("uploading", "processing"):
                    current["status"] = "error"
                    current["error"] = str(e)
                    current["finished_at"] = datetime.now().timestamp()
                    log_job = dict(current)
            if log_job:
                _append_to_log(log_job, job_id)
            _persist_active_jobs()
        finally:
            try:
                os.unlink(img_path)
            except Exception:
                pass

    # Ka Gemini-lõim läheb `_upload_threads`-i: katkestamine vaigistab kirjutaja
    # `_quiesce_upload`-iga ja see otsib teda täpselt sealt (ADR 0018).
    _t = threading.Thread(target=_gemini_single if on_gemini else _upload,
                          daemon=True, name=f"reocr-{job_id}")
    _upload_threads[job_id] = _t
    _t.start()
    return job_id


def poll_reocr_job(job_id: str) -> dict:
    """
    Küsib re-OCR töö staatuse.
    Kui olek on 'processing', proovib SFTP kaudu TXT faili alla laadida.
    Tagastab: {status, text?, error?}
    """
    with _reocr_jobs_lock:
        job = _reocr_jobs.get(job_id)
        if not job:
            return {"status": "not_found"}
        snapshot = dict(job)

    if snapshot.get("provider") == "gemini":
        # Kaugfaili ei ole — staatuse kirjutab töölõim ise.
        return {"status": snapshot["status"], "text": snapshot.get("text"),
                "error": snapshot.get("error")}

    current = snapshot["status"]
    if current in ("uploading", "done", "error"):
        return {"status": current, "text": snapshot.get("text"), "error": snapshot.get("error")}

    # status == 'processing' — proovi TXT alla laadida
    try:
        sftp = _sftp_open(job_id)
        txt_abs = f"{OCR_SERVER_PATH}/{snapshot['remote_txt']}"
        try:
            sftp.stat(txt_abs)
        except FileNotFoundError:
            err_msg = _read_err_marker(sftp, txt_abs)
            if err_msg is None:
                sftp.close()
                return {"status": "processing", "text": None, "error": None}
            # OCR-server märkis lehe vigaseks — see on LÕPLIK, mitte ootamine (#250)
            for f in (_err_path(txt_abs), f"{OCR_SERVER_PATH}/{snapshot['remote_img']}"):
                try:
                    sftp.remove(f)
                except Exception:
                    pass
            for d in (f"{OCR_SERVER_PATH}/{snapshot['remote_work']}",
                      f"{OCR_SERVER_PATH}/{snapshot['remote_staging']}"):
                try:
                    sftp.rmdir(d)
                except Exception:
                    pass      # mitte-tühi või puuduv kaust ei ole viga
            sftp.close()
            close_ssh(job_id)
            log_job = None
            with _reocr_jobs_lock:
                current_job = _reocr_jobs.get(job_id)
                if current_job and current_job.get("status") == "processing":
                    current_job["status"] = "error"
                    current_job["error"] = err_msg
                    current_job["finished_at"] = datetime.now().timestamp()
                    log_job = dict(current_job)
            if log_job:
                logger.warning(f"Re-OCR {job_id} ebaõnnestus OCR-serveris: {err_msg}")
                _append_to_log(log_job, job_id)
                _persist_active_jobs()
            return {"status": "error", "text": None, "error": err_msg}

        # TXT on valmis — laadi sisu alla
        buf = io.BytesIO()
        sftp.getfo(txt_abs, buf)
        text = buf.getvalue().decode("utf-8", errors="replace")
        sftp.close()

        # Puhasta OCR serveri kataloog taustal
        try:
            sftp2 = _sftp_open(job_id)
            img_abs = f"{OCR_SERVER_PATH}/{snapshot['remote_img']}"
            work_abs = f"{OCR_SERVER_PATH}/{snapshot['remote_work']}"
            staging_abs = f"{OCR_SERVER_PATH}/{snapshot['remote_staging']}"
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
        log_job = None
        with _reocr_jobs_lock:
            current_job = _reocr_jobs.get(job_id)
            if current_job and current_job.get("status") == "processing":
                current_job["status"] = "done"
                current_job["text"] = text
                current_job["finished_at"] = datetime.now().timestamp()
                log_job = dict(current_job)
                # Normaalne lõpp: ülekirjutatud vanem tulemus on lõplikult
                # asendatud, varukoopiat pole enam vaja hoida (#217).
                _drop_backups(job_id)
        if log_job:
            logger.info(f"Re-OCR {job_id} valmis ({len(text)} tähemärki)")
            _append_to_log(log_job, job_id)
            _persist_active_jobs()

            # Kirjuta tulemus .ocr failina teose kausta (püsiv backup)
            page_fn = log_job.get("page_filename", "")
            if page_fn:
                try:
                    ocr_path = _write_ocr_file(log_job["slug"], page_fn, text, job_id)
                    # Omand: see töö kirjutas selle lehe .ocr faili (#217)
                    with _reocr_jobs_lock:
                        live = _reocr_jobs.get(job_id)
                        if live is not None:
                            _record_produced(live, page_fn)
                    logger.info(f"Re-OCR {job_id}: .ocr fail kirjutatud → {ocr_path}")
                except Exception as write_err:
                    logger.warning(f"Re-OCR {job_id}: .ocr faili kirjutamine ebaõnnestus: {write_err}")
    except Exception as e:
        logger.warning(f"Re-OCR {job_id} poll viga: {e}")

    with _reocr_jobs_lock:
        final = _reocr_jobs.get(job_id)
        if not final:
            return {"status": "not_found"}
        return {"status": final["status"], "text": final.get("text"), "error": final.get("error")}


def _split_loaded(loaded: dict):
    """Jaga laetud aktiivsed tööd üksik- ja batch-dict'ideks 'kind' järgi."""
    single, batch = {}, {}
    for jid, j in loaded.items():
        if j.get("kind") == "batch":
            batch[jid] = j
        else:
            single[jid] = j
    return single, batch


_RESTART_ERROR = "Server taaskäivitus töö ajal"


def _revive_dead_uploads(jobs: dict) -> int:
    """Restardil laetud 'uploading' tööde upload-thread on surnud → poll ei töötleks neid
    kunagi (poll ainult 'processing') ega reaper (uploading = aktiivne) → igavene zombie.
    Teisenda 'uploading' → 'processing', et absoluutne sanity-lagi (12h) neid katab: kui
    pilt jõudis serverisse, poll leiab tulemuse; kui ei, aegub error-iks. Batch-töödel
    taasta sama üleminek ka lehekülje-kirjetel, sest poll vaatab per-page staatust.
    Tagastab muudetud tööde arvu."""
    n = 0
    for j in jobs.values():
        if j.get("provider") == "gemini":
            # Gemini-töö ei ela restarti üle: kaugartefakti pole, kust tulemust
            # hiljem korjata. Krahh EI OLE kasutaja otsus — juba kirjutatud .ocr
            # failid JÄÄVAD alles ja on Manage'is ootel. See on teadlik erinevus
            # katkestamisest (ADR 0018), kus osalised tulemused kustutatakse.
            muutus = False
            if j.get("status") in ("uploading", "processing"):
                j["status"] = "error"
                j["error"] = _RESTART_ERROR
                # Terminaalne staatus vajab lõpuaega, muidu pühib TTL-koristus
                # (`finished_at` vaikeväärtus 0) kirje kohe esimesel passil ära.
                j["finished_at"] = datetime.now().timestamp()
                muutus = True
            # Ka LEHE-kirjed: `build_reocr_status` per-lehe silmus EI ole
            # `is_active` taga, seega pooleli jäänud leht näitaks Manage'is
            # „OCR töötab" kuni TTL-ini — ilma aktiivse tööta ja ilma
            # katkestamisnuputa, samal ajal kui töö-tasandi viga jääks nähtamatuks.
            for page in j.get("pages") or []:
                if page.get("status") in ("uploading", "processing"):
                    page["status"] = "error"
                    page["error"] = _RESTART_ERROR
                    muutus = True
            if muutus:
                n += 1
            continue
        changed = False
        if j.get("status") == "uploading":
            j["status"] = "processing"
            changed = True
        for page in j.get("pages") or []:
            if page.get("status") == "uploading":
                page["status"] = "processing"
                changed = True
        if changed:
            n += 1
    return n


def _startup_recovery_and_reaper() -> None:
    """Taustalõime keha: esimene reconciliation, seejärel perioodiline reaper.
    Reaper käivitub ka siis, kui esimene skann ebaõnnestus — muidu ei taastuks
    orvud ka hiljem, kui OCR-server tagasi tuleb."""
    from . import reocr_recovery
    try:
        result = reocr_recovery.scan_and_recover()
        logger.info(f"Re-OCR startup recovery: taastatud {len(result['recovered'])}, "
                    f"skip {len(result['skipped'])}")
        mark_success("reocr_startup_recovery", detail=result)
    except Exception as e:
        logger.warning(f"Re-OCR startup recovery viga: {e}")
        mark_error("reocr_startup_recovery", e)
    reocr_recovery.start_reaper_loop()


def start_reocr_background() -> Optional[threading.Thread]:
    """Käivita re-OCR restardi-jätkamine + reconciliation. Kutsu AINULT main.py lifespan'ist
    (API-protsess). JÄRJEKORD KRIITILINE: load → recovery → reaper, et aktiivseid töid
    ei peetaks orvuks.

    Load on SÜNKROONNE (kiire lokaalne faililugemine ja vajalik enne skanni), recovery +
    reaper käivad TAUSTALÕIMES: scan_and_recover teeb SFTP-d OCR-serverisse ja hoidis
    kättesaamatu serveri korral API käivitumist 20–50 s kinni (#181).

    Tagastab recovery-lõime (testides join'itav) või None, kui upload on välja lülitatud."""
    # Tööde LAADIMINE toimib ka ilma upload'ita — Gemini-tee ei kasuta SFTP-d.
    # SFTP-põhine scan_and_recover + reaper jäävad UPLOAD_ENABLED taha.
    if not UPLOAD_ENABLED and not gemini_enabled():
        return None
    single, batch = _split_loaded(reocr_state.load_active_jobs())
    if not UPLOAD_ENABLED:
        # Siia jõuab ainult Gemini lubatuna. LOSSi töid EI TOHI laadida: nende
        # ainus edasine tee on SFTP — `_finish_interrupted_cancellations` avaks
        # ühenduse SÜNKROONSELT lifespan'is (#181) ja poll-singletonid
        # koputaksid kaugserverile iga 10 s, konfiguratsioonis, kus upload on
        # teadlikult välja lülitatud.
        # Väljafiltreeritud kirjed kaovad ka KETTALT: järgmine `_persist_active_jobs()`
        # kirjutab need mälu-globaalid (millest LOSS-kirjed on juba puudu) faili
        # peale ja kustutab need seega jäädavalt (tootmises UPLOAD_ENABLED=true,
        # seega täna surnud haru, aga käitumine ise ei ole selline vaikimisi).
        single = {k: v for k, v in single.items() if v.get("provider") == "gemini"}
        batch = {k: v for k, v in batch.items() if v.get("provider") == "gemini"}
    revived = _revive_dead_uploads(single) + _revive_dead_uploads(batch)
    with _reocr_jobs_lock:
        _reocr_jobs.update(single)
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs.update(batch)
    logger.info(f"Re-OCR taastatud mällu: {len(single)} üksik + {len(batch)} batch "
                f"({revived} surnud upload-i → processing)")

    # Pooleli jäänud katkestamised ENNE reconciliation'i: `cancelling` töö ei ole
    # aktiivne töö ja teda ei tohi orvuna "taastada" (#217).
    lopetatud = (_finish_interrupted_cancellations(_reocr_jobs)
                 + _finish_interrupted_cancellations(_reocr_batch_jobs))
    if lopetatud:
        logger.info(f"Re-OCR: lõpetatud {lopetatud} pooleli jäänud katkestamist")

    if revived or lopetatud:
        _persist_active_jobs()  # kirjuta teisendatud staatus kohe tagasi
    if not UPLOAD_ENABLED:
        # Orbude taaste ja reaper on puhtalt SFTP-tööriistad — ilma upload'ita
        # ei ole neil kaugserverit, kust orbe otsida.
        return None
    thread = threading.Thread(target=_startup_recovery_and_reaper, daemon=True,
                              name="reocr-startup-recovery")
    thread.start()
    return thread
