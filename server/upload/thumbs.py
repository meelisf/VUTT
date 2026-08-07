"""Uploadi OCR-progressi polling ja pisipiltide sünk.

Moodul küsib OCR-serveri SFTP kaustast valmis JPG+TXT paare, loob lokaalsed
pisipildid ning uuendab uploadi state.json-i.
"""
import os
from datetime import datetime
from typing import Any, Callable

from ..config import OCR_SERVER_PATH, get_logger
from . import file_detection, state as upload_state
from .ocr_client import sftp_open

logger = get_logger(__name__)


def _close_quietly(sftp):
    """Sulgeb SFTP seansi vigu ignoreerides."""
    if sftp:
        try:
            sftp.close()
        except Exception:
            pass


def _create_thumbnail(sftp, remote_jpg: str, tmp_thumb: str, thumb_path: str):
    """Laeb remote JPG-i alla ja salvestab sellest lokaalse pisipildi."""
    sftp.get(remote_jpg, tmp_thumb)
    from PIL import Image

    with Image.open(tmp_thumb) as img:
        img.thumbnail((400, 600), Image.LANCZOS)
        img.save(thumb_path, "JPEG", quality=85)
    os.unlink(tmp_thumb)


def poll_and_sync_thumbs(
    upload_id: str,
    *,
    sftp_open_func: Callable[[str], Any] = sftp_open,
    ocr_server_path: str = OCR_SERVER_PATH,
) -> dict:
    """
    Küsib SFTP kaudu OCR serveri kausta, tuvastab valmis JPG+TXT paarid,
    laeb alla uued pisipildid (Pillow thumbnail 400x600) ja uuendab state.json.

    Tagastab: {status, ready, total, expected_pages, files, progress, error?}
    """
    state_lock = upload_state.get_upload_lock(upload_id)
    with state_lock:
        state = upload_state.read_state(upload_id)
    if not state:
        return {"error": "Upload ei leitud"}

    current_status = state.get("status", "pending")
    expected_pages = state.get("expected_pages")

    # Uploading/pending/collecting_images/error: SFTP-d pole vaja
    # PREPRESS_IDLE_STATUSES: fail on VUTT-i poolel, OCR-serveris pole veel midagi
    if current_status in (
        "pending", "uploading", "error", "imported", "collecting_images",
    ) + upload_state.PREPRESS_IDLE_STATUSES:
        return {
            "status": current_status,
            "ready": 0,
            "total": 0,
            "expected_pages": expected_pages,
            "files": state.get("files", []),
            "progress": upload_state.upload_progress.get(upload_id, {}),
            "error": state.get("error_message"),
        }

    slug = state["meta"]["slug"]
    remote_work = f"{ocr_server_path}/{state['remote_work_path']}"
    thumbs_dir = os.path.join(upload_state.upload_dir(upload_id), "thumbs")

    sftp = None
    try:
        sftp = sftp_open_func(upload_id)

        # --- Kontrolli VIGASED kausta ---
        vigased_path = f"{ocr_server_path}/VIGASED/{slug}.pdf"
        try:
            sftp.stat(vigased_path)
            # PDF on vigane — OCR teenus teisaldas selle
            err_msg = "PDF on vigane — OCR teenus ei suutnud seda töödelda"
            with state_lock:
                s = upload_state.read_state(upload_id)
                if s and s.get("status") != "error":
                    s["status"] = "error"
                    s["error_message"] = err_msg
                    upload_state.write_state(upload_id, s)
            return {
                "status": "error",
                "error": err_msg,
                "ready": 0,
                "total": 0,
                "expected_pages": expected_pages,
                "files": state.get("files", []),
                "progress": upload_state.upload_progress.get(upload_id, {}),
            }
        except FileNotFoundError:
            pass  # OK — PDF pole vigane

        # --- SFTP ls remote work path ---
        try:
            remote_files = sftp.listdir(remote_work)
        except FileNotFoundError:
            # Töökaust pole veel loodud (OCR pole alustanud)
            return {
                "status": "processing",
                "ready": 0,
                "total": 0,
                "expected_pages": expected_pages,
                "files": state.get("files", []),
                "progress": upload_state.upload_progress.get(upload_id, {}),
            }

        # --- Leia JPG-d ja TXT-d ---
        jpg_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith(".jpg")}
        txt_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith(".txt")}
        ready_bases = jpg_bases & txt_bases  # Mõlemad olemas = OCR valmis

        # --- Laadi alla UUED valmis JPG-d (ainult mille jaoks on ka TXT) ---
        os.makedirs(thumbs_dir, exist_ok=True)
        existing_thumbs = set(os.listdir(thumbs_dir))

        for base in sorted(ready_bases):
            page_num = file_detection.extract_page_num(base)
            if page_num <= 0:
                continue
            thumb_name = f"{page_num:03d}.jpg"
            if thumb_name in existing_thumbs:
                continue
            tmp_thumb = os.path.join(thumbs_dir, f"{page_num:03d}.jpg.tmp")
            if os.path.exists(tmp_thumb):
                continue  # Teise threadi poolt juba allalaadimisel

            try:
                thumb_path = os.path.join(thumbs_dir, thumb_name)
                _create_thumbnail(sftp, f"{remote_work}/{base}.jpg", tmp_thumb, thumb_path)
                existing_thumbs.add(thumb_name)
                logger.info(f"Thumbnail loodud: {upload_id}/{thumb_name}")
            except Exception as e:
                logger.warning(f"Thumbnail {thumb_name} allalaadimine ebaõnnestus: {e}")
                try:
                    os.unlink(tmp_thumb)
                except Exception:
                    pass

        # --- Ehita files massiiv ---
        all_page_nums = sorted(
            {file_detection.extract_page_num(b) for b in jpg_bases if file_detection.extract_page_num(b) > 0}
        )
        ready_page_nums = {file_detection.extract_page_num(b) for b in ready_bases if file_detection.extract_page_num(b) > 0}
        existing_deleted = {f["page"]: f.get("deleted", False) for f in state.get("files", [])}

        new_files = [
            {
                "page": pn,
                "filename": f"{pn:03d}.jpg",
                "has_ocr": pn in ready_page_nums,
                "deleted": existing_deleted.get(pn, False),
            }
            for pn in all_page_nums
        ]

        # --- Uus staatus ---
        ready_count = len(ready_page_nums)
        new_status = current_status
        if expected_pages and ready_count >= expected_pages:
            new_status = "done"
        elif all_page_nums:
            new_status = "reviewing"

        # --- Stall-indikaator: jälgi millal viimati uus valmis leht tekkis ---
        now_ts = datetime.now().timestamp()
        prev_ready = sum(1 for f in state.get("files", []) if f.get("has_ocr"))
        last_progress_at = state.get("last_progress_at")
        # Edenes (uusi valmis lehti) VÕI puudub baseline (esimene poll) → uuenda ajatempel
        if ready_count > prev_ready or last_progress_at is None:
            last_progress_at = now_ts

        # --- Uuenda state.json ---
        with state_lock:
            s = upload_state.read_state(upload_id)
            if s:
                s["files"] = new_files
                s["last_progress_at"] = last_progress_at
                if new_status != s.get("status"):
                    s["status"] = new_status
                upload_state.write_state(upload_id, s)

        return {
            "status": new_status,
            "ready": ready_count,
            "total": len(all_page_nums),
            "expected_pages": expected_pages,
            "files": new_files,
            "progress": upload_state.upload_progress.get(upload_id, {}),
            "stalled": upload_state.is_stalled(ready_count, expected_pages, last_progress_at, now_ts),
        }

    except Exception as e:
        logger.error(f"poll_and_sync_thumbs {upload_id}: {e}")
        return {
            "status": current_status,
            "ready": 0,
            "total": 0,
            "expected_pages": expected_pages,
            "files": state.get("files", []),
            "error": str(e),
            "progress": upload_state.upload_progress.get(upload_id, {}),
        }
    finally:
        _close_quietly(sftp)
