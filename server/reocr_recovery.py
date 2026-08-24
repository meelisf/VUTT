"""Reconciliation-reaper: leiab OCR-serveri staging'usse orvuks jäänud VALMIS re-OCR
tulemused (nii üksik-lehe kui batch) ja taastab need (kirjutab .ocr faili, lisab reocr_log-i
recovery-sündmuse, koristab staging'u).

Skoop: orvud — tööd, mis pole aktiivselt jälitatud (_reocr_jobs EGA _reocr_batch_jobs-is).
Batch restardi-jätkamine käib load_active_jobs → resume polling kaudu, MITTE siit.

Deterministlik eristaja: batch-mapping fail olemas → batch-tee; puudub → üksik-tee.

Mapping-allikad üksik-tee jaoks (järjekorras): (1) reocr_log — orbude PÕHI-allikas
(error-kirjed); (2) reocr_active.json — restardi-jätkamise varu.
Batch-tee kasutab püsivat mapping-faili (reocr_state.load_batch_mapping).
"""
import io
import os
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional

from .config import OCR_SERVER_PATH, get_logger
from . import ocr_reaper
from . import reocr_ops
from . import reocr_state
from .heartbeat import mark_error, mark_success, register_job

logger = get_logger(__name__)

REOCR_REAPER_INTERVAL = int(os.getenv("REOCR_REAPER_INTERVAL", "300"))
register_job("reocr_reaper", interval_seconds=REOCR_REAPER_INTERVAL, description="OCR staging'u orvuks jäänud valmis re-OCR tulemuste taaste")
_MATERIAL_TYPES = ("print", "hand")

# Claim-set: kaitseb tavalise polleri ja reaperi võistluse eest (sama .txt topelt-töötlus).
# Kaitstud reocr_ops._reocr_jobs_lock-iga (jagatud lukk, ei loo uut).
# Võtmeks võib olla job_id (üksik-tee) VÕI (job_id, remote_txt_name) (batch-tee).
_recovering = set()
_warned_skips = set()  # job_id-d, mille skip-hoiatust juba logitud (müra vältimine)


def _resolve_job_meta(job_id: str) -> Optional[dict]:
    """Leia {page_filename, work_id, page_number} logist (põhi) või active.json-ist (varu)."""
    log = reocr_ops.get_reocr_log(0, reocr_ops.REOCR_LOG_MAX).get("entries", [])
    for e in log:
        if e.get("job_id") == job_id and e.get("page_filename"):
            return {"page_filename": e["page_filename"], "work_id": e.get("work_id"),
                    "page_number": e.get("page_number")}
    active = reocr_state.load_active_jobs()
    j = active.get(job_id)
    if j and j.get("page_filename"):
        return {"page_filename": j["page_filename"], "work_id": j.get("work_id"),
                "page_number": j.get("page_number")}
    return None


def _is_actively_tracked(job_id: str) -> bool:
    with reocr_ops._reocr_jobs_lock:
        j = reocr_ops._reocr_jobs.get(job_id)
        if j and j.get("status") in ("uploading", "processing"):
            return True
    with reocr_ops._reocr_batch_jobs_lock:
        b = reocr_ops._reocr_batch_jobs.get(job_id)
        if b and b.get("status") in ("uploading", "processing"):
            return True
    return False


def _warn_skip_once(job_id: str, msg: str) -> None:
    if job_id not in _warned_skips:
        _warned_skips.add(job_id)
        logger.warning(f"Reaper skip {job_id}: {msg}")


def _claim(key) -> bool:
    """Claim recovery-võti (job_id VÕI (job_id, txt_name)). Tagastab False kui juba claimitud."""
    job_id = key[0] if isinstance(key, tuple) else key
    with reocr_ops._reocr_jobs_lock:
        if key in _recovering:
            return False
        j = reocr_ops._reocr_jobs.get(job_id)
        if j and j.get("status") in ("uploading", "processing"):
            return False
        _recovering.add(key)
        return True


def _release(key) -> None:
    with reocr_ops._reocr_jobs_lock:
        _recovering.discard(key)


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
    if ocr_reaper.is_scheduled(f"{base}/{job_id}"):
        # Katkestatud töö jäänuk (#225): failid on juba kustutatud ja kataloogi
        # eemaldab ocr_reaper armuaja järel. Sinna vahepeal maandunud .txt on
        # katkestamise hetkel lennus olnud batchi oma — mitte orb, keda taastada.
        return
    mapping = reocr_state.load_batch_mapping(job_id)
    if mapping is not None:
        _recover_batch(sftp, base, job_id, mapping, recovered, skipped)
    else:
        _recover_single(sftp, base, job_id, recovered, skipped)


def _remote_img_name(txt_name: str, info: Optional[dict]) -> str:
    """Remote-pildi nimi .txt-nime järgi. Laiend tuletatakse mapping'u page_filename-st
    (nagu _build_batch_pages selle algselt tegi: remote_img jagab txt-ga stem'i, ext on
    originaalfaili oma), et .png/.jpeg lehed ei jääks lõpetamise-kontrollist vahele."""
    stem = txt_name[:-4] if txt_name.endswith(".txt") else txt_name
    ext = os.path.splitext((info or {}).get("page_filename", ""))[1] or ".jpg"
    return stem + ext


def _recover_batch(sftp, base: str, job_id: str, mapping: dict, recovered: List[str], skipped: List[str]) -> None:
    slug = mapping.get("slug")
    work_id = mapping.get("work_id")
    pages = mapping.get("pages", {})
    job_dir = f"{base}/{job_id}"
    work_dir = f"{job_dir}/{slug}"
    try:
        files = sftp.listdir(work_dir)
    except FileNotFoundError:
        reocr_state.remove_batch_mapping(job_id)  # staging kadunud → mapping aegunud
        return
    for fname in files:
        if not fname.endswith(".txt"):
            continue
        info = pages.get(fname)
        if not info:
            _warn_skip_once(job_id, f"{fname} pole mapping'us")
            skipped.append(job_id)
            continue
        key = (job_id, fname)
        if not _claim(key):
            continue
        try:
            buf = io.BytesIO()
            sftp.getfo(f"{work_dir}/{fname}", buf)
            text = buf.getvalue().decode("utf-8", errors="replace")
            reocr_ops._write_ocr_file(slug, info["page_filename"], text, job_id)
            # Orb on terminalis — varukoopia ei kuulu enam ühelegi elavale tööle (#217)
            reocr_ops._drop_backups(job_id)
            now = datetime.now().timestamp()
            reocr_ops._append_to_log(
                {"work_id": work_id, "slug": slug, "page_filename": info["page_filename"],
                 "page_number": info.get("page_number"), "status": "done", "error": None,
                 "started_at": None, "finished_at": now,
                 "recovered": True, "original_status": "error", "recovered_at": now}, job_id)
            try:
                sftp.remove(f"{work_dir}/{fname}")
            except Exception:
                pass
            # Sama lehe pilt ei ole pärast .txt taastamist enam vajalik. Selle eemaldamine
            # laseb alloleval lõpetamise kontrollil eristada "veel töötleb" (pilt alles,
            # .txt puudub) seisust "kõik mapping'u lehed on lahendatud". Laiend page_filename-st
            # (võib olla .png/.jpeg, mitte ainult .jpg).
            img_name = _remote_img_name(fname, info)
            try:
                sftp.remove(f"{work_dir}/{img_name}")
            except Exception:
                pass
            recovered.append(job_id)
            logger.info(f"Reaper taastas batch {job_id}/{fname} ({slug}/{info['page_filename']})")
        finally:
            _release(key)
    # Mappingut tohib kustutada ainult siis, kui staging on kadunud või kõik mapping'u
    # lehed on lahendatud. "0 .txt" ei tähenda valmis: OCR-server võib alles töödelda
    # allesolevaid pildifaile ja kirjutada .txt-id hiljem.
    try:
        remaining_files = set(sftp.listdir(work_dir))
    except FileNotFoundError:
        reocr_state.remove_batch_mapping(job_id)  # staging kadunud → mapping aegunud
        return

    unresolved = []
    for txt_name, info in pages.items():
        img_name = _remote_img_name(txt_name, info)
        if txt_name in remaining_files or img_name in remaining_files:
            unresolved.append(txt_name)

    if not unresolved:
        for d in (work_dir, job_dir):
            try:
                sftp.rmdir(d)
            except Exception:
                pass
        reocr_state.remove_batch_mapping(job_id)


def _recover_single(sftp, base: str, job_id: str, recovered: List[str], skipped: List[str]) -> None:
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
                _warn_skip_once(job_id, ".txt olemas, aga page_filename teadmata")
                return
            buf = io.BytesIO()
            sftp.getfo(txt_abs, buf)
            text = buf.getvalue().decode("utf-8", errors="replace")
            reocr_ops._write_ocr_file(slug, meta["page_filename"], text, job_id)
            # Orb on terminalis — varukoopia ei kuulu enam ühelegi elavale tööle (#217)
            reocr_ops._drop_backups(job_id)
            now = datetime.now().timestamp()
            reocr_ops._append_to_log(
                {"work_id": meta.get("work_id"), "slug": slug, "page_filename": meta["page_filename"],
                 "page_number": meta.get("page_number"), "status": "done", "error": None,
                 "started_at": None, "finished_at": now,
                 "recovered": True, "original_status": "error", "recovered_at": now}, job_id)
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
            result = scan_and_recover()
            mark_success("reocr_reaper", detail=result)
        except Exception as e:
            mark_error("reocr_reaper", e)
            logger.warning(f"Reaper loop viga: {e}")


def start_reaper_loop() -> None:
    threading.Thread(target=_reaper_loop, daemon=True, name="reocr-reaper").start()
    logger.info(f"Re-OCR reaper käivitatud (intervall {REOCR_REAPER_INTERVAL}s)")
