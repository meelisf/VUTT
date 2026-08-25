"""
Upload operatsioonid — teose lisamine PDF/piltidest OCR kaudu.

Etapp 1: staging haldus, state.json loogika, slug kontroll.
Etapp 2: SFTP transport, polling, thumbnailid, OCR jälgimine.
Etapp 4 lisab: import_as_work, cleanup_upload.
"""
import json
import os
import shutil
import threading
from datetime import datetime
from typing import Optional

from .config import BASE_DIR, UPLOADS_DIR, OCR_SERVER_HOST, OCR_SERVER_USER, OCR_SERVER_PATH, UPLOAD_ENABLED, get_logger
from .upload import file_detection as _file_detection
from .upload import state as _upload_state
from .upload import ocr_client as _ocr_client
from .upload import thumbs as _thumbs
from .upload import import_work as _import_work
from .utils import generate_nanoid, derive_year_fields
from .heartbeat import mark_error, mark_success, register_job
from . import ocr_reaper


def _normalize_txt_file(path: str):
    """Normaliseerib alla laetud OCR .txt marginaalia-tägid kanoonilisele kujule."""
    return _import_work.normalize_txt_file(path)

logger = get_logger(__name__)

# OCR-serveri SSH-connecti timeout (s). Hoiab event-loopi/threadi blokeerumast
# minuteid, kui OCR-server on kättesaamatu (vt tests/test_upload_ssh_timeout.py).
OCR_CONNECT_TIMEOUT = _ocr_client.OCR_CONNECT_TIMEOUT

# Compatibility-konstandid: testid ja admin-konfiguratsioon võivad neid upload_ops peal monkeypatchida.
UPLOAD_IMAGE_MAX_PIXELS = _file_detection.UPLOAD_IMAGE_MAX_PIXELS
UPLOAD_IMAGE_MAX_DIMENSION = _file_detection.UPLOAD_IMAGE_MAX_DIMENSION
SLUG_MAX_LEN = _file_detection.SLUG_MAX_LEN

# Mälupõhine progress elab state-moodulis; nimi jääb siin compatibility jaoks alles.
upload_progress = _upload_state.upload_progress

# Püsivad SSH ühendused elavad ocr_client-moodulis; nimed jäävad testide jaoks alles.
_ssh_connections = _ocr_client.ssh_connections
_ssh_lock = _ocr_client.ssh_lock


def _get_upload_lock(upload_id: str) -> threading.Lock:
    """Tagastab konkreetsele upload_id-le vastava luku."""
    return _upload_state.get_upload_lock(upload_id)


def _upload_dir(upload_id: str) -> str:
    """Tagastab upload staging kausta tee."""
    return _upload_state.upload_dir(upload_id)


def _state_path(upload_id: str) -> str:
    """Tagastab state.json faili tee."""
    return _upload_state.state_path(upload_id)


def _read_state(upload_id: str):
    """Loeb state.json (ei lukusta ise — kasuta _get_upload_lock)."""
    return _upload_state.read_state(upload_id)


def _write_state(upload_id: str, state: dict):
    """Kirjutab state.json atomaarse asendusega (ei lukusta ise — kasuta _get_upload_lock)."""
    return _upload_state.write_state(upload_id, state)


def _valid_upload_id(upload_id: str) -> bool:
    """Valideerib upload_id formaadi (ainult a-z0-9, max 20 märki)."""
    return _file_detection.valid_upload_id(upload_id)


def _valid_filename(filename: str) -> bool:
    """Valideerib failinime (ainult a-z0-9._-, keelatud .. ja /)."""
    return _file_detection.valid_filename(filename)


# =========================================================
# SSH / SFTP UTILIIDID (etapp 2)
# =========================================================

def _load_ssh_key():
    """Laeb SSH privaatvõtme tavalistest asukohtadest (~/.ssh/)."""
    return _ocr_client.load_ssh_key()


def get_or_create_ssh(upload_id: str):
    """
    Tagastab püsiva paramiko.Transport objekti antud upload_id jaoks.
    Loob uue ühenduse kui puudub või on katkine.
    """
    return _ocr_client.get_or_create_ssh(
        upload_id,
        host=OCR_SERVER_HOST,
        user=OCR_SERVER_USER,
        connect_timeout=OCR_CONNECT_TIMEOUT,
        load_key_func=_load_ssh_key,
    )


def close_ssh(upload_id: str):
    """Suleb ja eemaldab SSH ühenduse."""
    return _ocr_client.close_ssh(upload_id)


def _ssh_rm_rf(upload_id: str, remote_path: str):
    """Kustutab OCR serveris kausta rekursiivselt (`rm -rf`) SSH kanali kaudu."""
    return _ocr_client.ssh_rm_rf(upload_id, remote_path, get_ssh_func=get_or_create_ssh)


def _sftp_open(upload_id: str):
    """
    Loob SFTP seansi püsivalt SSH transpordilt.
    Proovib uuesti üks kord kui ühendus on katkine.
    """
    return _ocr_client.sftp_open(
        upload_id,
        get_ssh_func=get_or_create_ssh,
        close_ssh_func=close_ssh,
    )


def _extract_page_num(base: str) -> int:
    """
    Eraldab leheküljenumbri OCR failinimest.
    '{year}-{slug}_pg_001' → 1
    """
    return _file_detection.extract_page_num(base)


# =========================================================
# SLUG UTILIIDID
# =========================================================

def sanitize_slug(text: str) -> str:
    """Puhastab teksti, et see sobiks slug-iks (ainult a-z, 0-9, sidekriips, max 80 tähemärki)."""
    return _file_detection.sanitize_slug(text)


def _page_base_name(slug: str, work_id: str, pn: int) -> str:
    """Lehekülje failinime tüvi (ilma laiendita)."""
    return _file_detection.page_base_name(slug, work_id, pn)


def check_slug_conflict(year, slug: str) -> bool:
    """
    Tagastab True kui slug on juba kasutusel:
    1. data/{slug}/ eksisteerib (imporditud teos)
    2. mõni aktiivne upload kasutab sama slug-i (paralleelne üleslaadimine)
    """
    if os.path.isdir(os.path.join(BASE_DIR, slug)):
        return True
    for state in list_uploads():
        if state.get('meta', {}).get('slug') == slug:
            return True
    return False


# =========================================================
# PÕHIFUNKTSIOONID
# =========================================================

def remote_paths(ocr_model: str, upload_id: str, slug: str) -> tuple:
    """OCR-serveri staging- ja work-tee. ÜKS valem: create_upload ja
    mudelivahetus peavad andma sama vastuse."""
    staging = f"AUTO-OCR/{ocr_model}/{upload_id}"
    return staging, f"{staging}/{slug}"


def create_upload(meta: dict, username: Optional[str] = None) -> dict:
    """
    Loob uue upload staging'u ja tagastab state.json sisu.

    meta peab sisaldama: title, year, slug
    Valikulised: type, genre, creators, location, publisher,
                 collections, languages, tags
    username: kes uploadi lõi (ühtses OCR-vaates kuvamiseks)
    """
    upload_id = generate_nanoid()
    while os.path.isdir(_upload_dir(upload_id)):
        upload_id = generate_nanoid()

    year = str(meta.get('year', ''))
    # Saniteeri slug alati — see jõuab failiteedesse (data/{slug}/, SFTP) → path traversal kaitse.
    # sanitize_slug on idempotentne: juba korrektne slug ei muutu.
    base_slug = sanitize_slug(meta.get('slug') or meta.get('title', ''))
    # Küpseta work_id slug'i → kaust = {slug}-{work_id} (unikaalne, jälgitav).
    work_id = generate_nanoid()
    slug = f"{base_slug}-{work_id}"
    work_type = meta.get('type') or {}
    ocr_model = 'hand' if work_type.get('id') == 'Q87167' else 'print'
    staging_path, work_path = remote_paths(ocr_model, upload_id, slug)

    # Loo uploads/{id}/thumbs/ kaustad
    thumbs_dir = os.path.join(_upload_dir(upload_id), 'thumbs')
    os.makedirs(thumbs_dir, exist_ok=True)

    state = {
        "id": upload_id,
        "status": "pending",
        "username": username,
        "meta": {
            "title": meta.get('title', ''),
            "year": year,
            "slug": slug,
            "work_id": work_id,
            "type": meta.get('type'),
            "genre": meta.get('genre'),
            "creators": meta.get('creators', []),
            "location": meta.get('location'),
            "publisher": meta.get('publisher'),
            "collections": meta.get('collections', []),
            "languages": meta.get('languages', []),
            "tags": meta.get('tags', []),
        },
        "expected_pages": None,
        # Töötlusotsus, mitte bibliograafiline väide — vaikeväärtus tuletatakse
        # tüübist, aga edaspidi elab ta oma väljas ja meta.type ei muutu (§3).
        "ocr_model": ocr_model,
        "remote_staging_path": staging_path,
        "remote_work_path": work_path,
        "files": [],
        "created_at": datetime.now().isoformat(),
        "replace_work_id": meta.get('replace_work_id') or None,
    }

    lock = _get_upload_lock(upload_id)
    with lock:
        _write_state(upload_id, state)

    logger.info(f"Upload loodud: {upload_id} ({year}_{slug})")
    return state


def update_upload_meta(upload_id: str, updates: dict) -> bool:
    """Uuendab staging uploadi metaandmeid. Slug ei muutu."""
    if not _valid_upload_id(upload_id):
        return False
    # NB: allow-list peab katma KÕIK väljad, mida UploadMetaForm PATCH-ib —
    # tundmatu väli visatakse vaikselt ära (vastus on ikka 200 OK) ja kaob
    # impordil. external_url ja ester_id jäid varem just nii salvestumata.
    allowed = {
        'title', 'year', 'year_display', 'collections', 'languages',
        'type', 'genre',
        'creators', 'location',
        'publisher', 'tags',
        'ester_id', 'external_url',
        'archive_refs',
    }
    lock = _get_upload_lock(upload_id)
    with lock:
        state = _read_state(upload_id)
        if not state:
            return False
        for key, val in updates.items():
            if key in allowed:
                state['meta'][key] = val
        _write_state(upload_id, state)
    return True


def list_uploads() -> list:
    """Tagastab kõik aktiivsed (mitte-imporditud) üleslaadimised, uuemad ees."""
    return _upload_state.list_upload_states()


def get_upload(upload_id: str):
    """Tagastab ühe upload state'i või None kui ei leidu."""
    if not _valid_upload_id(upload_id):
        return None
    lock = _get_upload_lock(upload_id)
    with lock:
        return _read_state(upload_id)


def mark_page_deleted(upload_id: str, filename: str, deleted: bool = True) -> bool:
    """
    Märgib lehe deleted=True/False state.json-is.
    Tagastab True kui õnnestus, False kui upload/leht ei leitud.
    """
    if not _valid_upload_id(upload_id) or not _valid_filename(filename):
        return False

    lock = _get_upload_lock(upload_id)
    with lock:
        state = _read_state(upload_id)
        if not state:
            return False

        found = False
        for file_entry in state.get('files', []):
            if file_entry.get('filename') == filename:
                file_entry['deleted'] = deleted
                found = True
                break

        if not found:
            return False

        _write_state(upload_id, state)
        return True


def _detect_file_type(path: str) -> str:
    """Tuvastab faili tüübi magic bytes alusel. Tagastab 'pdf', 'jpeg', 'png', 'tiff' või 'unknown'."""
    return _file_detection.detect_file_type(path)


def _validate_upload_image(path: str) -> tuple[int, int]:
    """Kontrollib pildi mõõtmeid enne OCR-serverisse saatmist."""
    # Hoia vanad upload_ops monkeypatchid ühilduvana.
    _file_detection.UPLOAD_IMAGE_MAX_PIXELS = UPLOAD_IMAGE_MAX_PIXELS
    _file_detection.UPLOAD_IMAGE_MAX_DIMENSION = UPLOAD_IMAGE_MAX_DIMENSION
    return _file_detection.validate_upload_image(path)


# =========================================================
# SFTP TRANSFER (etapp 2): PDF/pildi edastamine OCR serverisse
#
# save_and_transfer_to_ocr dispatchib failitüübi järgi kahte haru:
#   - pilt (JPEG/PNG/TIFF) → _prepare_image_upload + _sftp_transfer_image
#   - PDF                  → _prepare_pdf_upload  + _sftp_transfer_pdf
# Ühised helperid (_set_upload_state, _init_upload_progress, _sftp_progress_cb,
# _ensure_remote_dirs, _close_sftp_and_unlink) jagavad state/progress ja SFTP
# raamistikku, mida mõlemad taustalõimed kasutavad.
# =========================================================

def _safe_unlink(path: str):
    """Kustutab faili, ignoreerides vigu (ajutised failid, juba kustutatud)."""
    return _file_detection.safe_unlink(path)


def _set_upload_state(upload_id: str, *, status: Optional[str] = None, **extra):
    """Uuendab state.json välju upload-i luku all (thread-turvaline)."""
    return _upload_state.set_upload_state(upload_id, status=status, **extra)


def _init_upload_progress(upload_id: str, tmp_path: str) -> int:
    """Lähtestab mälupõhise SFTP progressi (bytes_total = faili suurus)."""
    return _upload_state.init_upload_progress(upload_id, tmp_path)


def _sftp_progress_cb(upload_id: str):
    """Loob SFTP put() callback'i, mis uuendab upload_progress mäludikti."""
    return _upload_state.sftp_progress_cb(upload_id)


def _ensure_remote_dirs(sftp, remote_dirs):
    """Loob OCR-serveri kaustad kui need puuduvad (idempotentne)."""
    return _ocr_client.ensure_remote_dirs(sftp, remote_dirs)


def _close_sftp_and_unlink(sftp, tmp_path: str):
    """Taustalõime finally-puhastus: sulge SFTP seanss ja kustuta ajutine fail."""
    return _ocr_client.close_sftp_and_unlink(sftp, tmp_path)


def _count_pdf_pages(tmp_path: str) -> int:
    """Loeb PDF-i lehekülgede arvu pdfinfo abil."""
    return _file_detection.count_pdf_pages(tmp_path, logger)


def _prepare_image_upload(state: dict) -> tuple:
    """Arvutab pildi-upload'i (alati 1 leht) remote teed."""
    return _ocr_client.prepare_image_upload(state, ocr_server_path=OCR_SERVER_PATH)


def _prepare_pdf_upload(state: dict, tmp_path: str) -> tuple:
    """Arvutab PDF-upload'i remote teed (pärast pdfinfo lehekülgede loendust)."""
    return _ocr_client.prepare_pdf_upload(
        state,
        tmp_path,
        ocr_server_path=OCR_SERVER_PATH,
        count_pdf_pages_func=_count_pdf_pages,
    )


def _sftp_transfer_image(upload_id: str, tmp_path: str, file_type: str,
                          remote_dirs, remote_tmp: str, remote_dst: str,
                          remote_img_name: str):
    """Taustalõime sihtfunktsioon: edastab üksiku pildi OCR-serverisse."""
    return _ocr_client.transfer_image(
        upload_id,
        tmp_path,
        file_type,
        remote_dirs,
        remote_tmp,
        remote_dst,
        remote_img_name,
        sftp_open_func=_sftp_open,
        validate_upload_image_func=_validate_upload_image,
    )


def _sftp_transfer_pdf(upload_id: str, tmp_path: str,
                        remote_dirs, remote_tmp: str, remote_dst: str,
                        pages: int, file_size: int):
    """Taustalõime sihtfunktsioon: edastab PDF-i OCR-serverisse."""
    return _ocr_client.transfer_pdf(
        upload_id,
        tmp_path,
        remote_dirs,
        remote_tmp,
        remote_dst,
        pages,
        file_size,
        sftp_open_func=_sftp_open,
    )


def save_and_transfer_to_ocr(upload_id: str, tmp_path: str) -> int:
    """Salvestab üleslaaditud faili VUTT-i poolele.

    NIMI ON AJALOOLINE: fail EI lähe enam kohe OCR-serverisse (vt
    server/upload/store_source.py). Edastus toimub prepress/apply
    endpointist, kui admin on sammu 3 läbinud.

    JPG/PNG/TIFF üksikpilt käsitletakse ühelehelise pildikaustana.
    """
    from .upload import store_source

    with _get_upload_lock(upload_id):
        state = _read_state(upload_id)
    if not state:
        raise ValueError(f"Upload {upload_id} ei leitud")

    file_type = _detect_file_type(tmp_path)
    if file_type in ('jpeg', 'png', 'tiff'):
        return store_source.store_image_page(upload_id, tmp_path, 1, 1)
    return store_source.store_pdf(upload_id, tmp_path)


# Stall-indikaator: mitu sekundit ilma uue valmis leheta enne kui töö märgitakse
# UI-s "kinni jäänuks" (NÕUANDEV — staatust ei muudeta, töid ei katkestata).
# Kanooniline väärtus elab state-moodulis; siin compatibility-re-export (testid loevad).
UPLOAD_STALL_THRESHOLD = _upload_state.UPLOAD_STALL_THRESHOLD


def _is_stalled(ready_count: int, expected_pages, last_progress_at, now_ts: float) -> bool:
    """Kas OCR-töö paistab kinni jäänud."""
    return _upload_state.is_stalled(ready_count, expected_pages, last_progress_at, now_ts)


def poll_and_sync_thumbs(upload_id: str) -> dict:
    """
    Küsib SFTP kaudu OCR serveri kausta, tuvastab valmis JPG+TXT paarid,
    laeb alla uued pisipildid (Pillow thumbnail 400x600) ja uuendab state.json.
    """
    return _thumbs.poll_and_sync_thumbs(
        upload_id,
        sftp_open_func=_sftp_open,
        ocr_server_path=OCR_SERVER_PATH,
    )


def add_image_page(upload_id: str, tmp_path: str, page_number: int, total_pages: int) -> int:
    """Lisab ühe pildilehe multi-image üleslaadimisse.

    Pildid kogutakse uploads/{id}/source/ kausta, mitte enam otse
    OCR-serverisse — muidu oleks poolitamiseks hilja.
    """
    from .upload import store_source

    return store_source.store_image_page(upload_id, tmp_path, page_number, total_pages)


def get_ocr_status(upload_id: str) -> dict:
    """
    Tagastab state.json info + mälupõhise progressi (ilma SFTP-ta).
    Kasutatakse uploading-staatuses kui SFTP transfer on käimas.
    """
    lock = _get_upload_lock(upload_id)
    with lock:
        state = _read_state(upload_id)
    if not state:
        return {"error": "Upload ei leitud"}
    return {
        "status": state.get('status'),
        "expected_pages": state.get('expected_pages'),
        "files": state.get('files', []),
        "progress": upload_progress.get(upload_id, {}),
        "meta": state.get('meta', {}),
        "error": state.get('error_message'),
    }


def import_as_work(upload_id: str, username: str = None) -> dict:
    """Impordib OCR-itud teose VUTT andmebaasi (compatibility-wrapper)."""
    return _import_work.import_as_work(
        upload_id,
        username=username,
        base_dir=BASE_DIR,
        ocr_server_path=OCR_SERVER_PATH,
        get_upload_lock_func=_get_upload_lock,
        read_state_func=_read_state,
        write_state_func=_write_state,
        sftp_open_func=_sftp_open,
        ssh_rm_rf_func=_ssh_rm_rf,
        close_ssh_func=close_ssh,
        page_base_name_func=_page_base_name,
        extract_page_num_func=_extract_page_num,
        generate_nanoid_func=generate_nanoid,
        normalize_txt_file_func=_normalize_txt_file,
    )

def replace_work_content(upload_id: str, target_work_id: str, metadata_updates: dict, username: str, background_tasks) -> dict:
    """
    Asendab olemasoleva teose sisu uue OCR-itud materjaliga.

    1. Laeb upload state, valideerib staatust
    2. Leiab sihtteose kausta (target_work_id järgi)
    3. Arhiveerib vanad JPG-d prügikasti
    4. Git rm vanad lehed (txt + json, v.a. _metadata.json)
    5. Laeb alla uued lehed SFTP kaudu (samasugune loogika nagu import_as_work)
    6. Uuendab metaandmeid (kui metadata_updates pole tühi)
    7. Git commit uuendatud sisuga
    8. Meilisearch sünk
    9. Märgib upload 'imported'-ks

    Tagastab: {"work_id": target_work_id, "slug": slug}
    """
    from fastapi import HTTPException
    from .utils import find_directory_by_id

    # 1. Lae upload state
    state_lock = _get_upload_lock(upload_id)
    with state_lock:
        state = _read_state(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Upload ei leitud")

    current_status = state.get('status')
    if current_status not in ('done', 'reviewing'):
        raise HTTPException(
            status_code=400,
            detail=f"Upload peab olema 'done' või 'reviewing' olekus, praegu: '{current_status}'"
        )

    # 2. Leia sihtteose kaust
    work_dir = find_directory_by_id(target_work_id)
    if not work_dir:
        raise HTTPException(status_code=404, detail=f"Teos work_id='{target_work_id}' ei leitud")

    # 3. Slug kaustnimest
    slug = os.path.basename(work_dir)

    # 4. Loe _metadata.json et saada originaalne work_id
    meta_path = os.path.join(work_dir, '_metadata.json')
    with open(meta_path, 'r', encoding='utf-8') as f:
        existing_meta = json.load(f)
    work_id = existing_meta.get('id', target_work_id)

    # Täielikkuse preflight ENNE vana sisu puutumist. Hiljem kontrollime remote
    # loendit uuesti, et katta ka preflight'i ja downloadi vaheline muutus.
    importable = [f for f in state.get('files', []) if f.get('has_ocr') and not f.get('deleted')]
    if not importable:
        raise HTTPException(status_code=400, detail="Imporditavaid lehekülgi pole (kõik kustutatud või OCR puudub)")
    importable.sort(key=lambda f: f['page'])
    remote_work = f"{OCR_SERVER_PATH}/{state['remote_work_path']}"
    preflight_sftp = None
    try:
        preflight_sftp = _sftp_open(upload_id)
        remote_items = preflight_sftp.listdir(remote_work)
        _import_work.validate_remote_ocr_files(importable, remote_items, _extract_page_num)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR kausta kontroll ebaõnnestus: {e}")
    finally:
        if preflight_sftp:
            try:
                preflight_sftp.close()
            except Exception:
                pass

    # Salvesta git HEAD rollback'i jaoks
    from .git_ops import get_or_init_repo
    repo = get_or_init_repo()
    old_head = repo.head.commit.hexsha

    # Lipp: kas destruktiivsed sammud on alanud (arhiveerimine/git rm)
    destructive_started = False

    # 5. Arhiveeri vanad JPG-d prügikasti
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    trash_dir = os.path.join(BASE_DIR, '._trash', target_work_id, 'replaced_content', timestamp)
    os.makedirs(trash_dir, exist_ok=True)

    destructive_started = True
    for fname in os.listdir(work_dir):
        if fname.endswith('.jpg') and os.path.isfile(os.path.join(work_dir, fname)):
            shutil.move(os.path.join(work_dir, fname), os.path.join(trash_dir, fname))

    logger.info(f"replace {upload_id}: vanad JPG-d arhiveeritud → {trash_dir}")

    # 6. Git rm vanad lehed (txt + json, v.a. _metadata.json) — JPG-d on gitignore all.
    # Kui see ebaõnnestub, katkesta enne uute failide allalaadimist: muidu võib teosesse
    # jääda vana ja uus .txt/.json sisu segamini.
    try:
        old_tracked = []
        for fname in os.listdir(work_dir):
            if fname == '_metadata.json':
                continue
            if fname.endswith('.txt') or fname.endswith('.json'):
                old_tracked.append(fname)
                fpath = os.path.join(work_dir, fname)
                if os.path.exists(fpath):
                    repo.git.rm(os.path.join(slug, fname))
        if old_tracked:
            logger.info(f"replace {upload_id}: git rm {len(old_tracked)} vana faili")
    except Exception as e:
        logger.error(f"replace {upload_id}: git rm viga, katkestan ja taastan vana sisu: {e}")
        try:
            repo.git.checkout(old_head, '--', slug)
            logger.info(f"replace {upload_id}: rollback git checkout OK (head={old_head[:8]})")
        except Exception as rb_git_err:
            logger.error(f"replace {upload_id}: rollback git checkout ebaõnnestus: {rb_git_err}")
        try:
            for fname in os.listdir(trash_dir):
                if fname.endswith('.jpg'):
                    shutil.move(os.path.join(trash_dir, fname), os.path.join(work_dir, fname))
            logger.info(f"replace {upload_id}: rollback JPG-d tagasi liigutatud")
        except Exception as rb_jpg_err:
            logger.error(f"replace {upload_id}: rollback JPG liigutamine ebaõnnestus: {rb_jpg_err}")
        raise HTTPException(status_code=500, detail=f"Vana sisu eemaldamine ebaõnnestus: {e}")

    # 7. Lae alla uued lehed SFTP kaudu. Remote loend valideeritakse uuesti,
    # sest fail võis preflight'i järel kaduda; sellisel juhul käivitub rollback.
    sftp = None
    downloaded = 0
    try:
        sftp = _sftp_open(upload_id)

        try:
            remote_items = sftp.listdir(remote_work)
        except Exception as e:
            raise ValueError(f"Ei saa lugeda OCR kausta: {e}")

        # Sama täielikkuse invariant mis uue teose impordil: osalist asendust
        # ei tohi edukaks lugeda ega selle staging'ut hiljem kustutada.
        jpg_map = _import_work.validate_remote_ocr_files(
            importable, remote_items, _extract_page_num
        )

        for entry in importable:
            pn = entry['page']
            jpg_name = jpg_map[pn]
            txt_name = jpg_name.replace('.jpg', '.txt')

            base_name = _page_base_name(slug, work_id, pn)
            local_jpg = os.path.join(work_dir, f"{base_name}.jpg")
            local_txt = os.path.join(work_dir, f"{base_name}.txt")
            local_json = os.path.join(work_dir, f"{base_name}.json")

            sftp.get(f"{remote_work}/{jpg_name}", local_jpg)
            os.chmod(local_jpg, 0o644)

            try:
                sftp.get(f"{remote_work}/{txt_name}", local_txt)
                _normalize_txt_file(local_txt)
            except FileNotFoundError:
                raise ValueError(f"OCR TXT kadus allalaadimise ajal (lk {pn}); asendus katkestati")
            os.chmod(local_txt, 0o644)

            page_json = {"sequence": pn * 100, "status": "Toores", "page_tags": [], "comments": [], "history": []}
            with open(local_json, 'w', encoding='utf-8') as fh:
                json.dump(page_json, fh, ensure_ascii=False, indent=2)
            os.chmod(local_json, 0o644)
            downloaded += 1

        sftp.close()
        sftp = None

        if downloaded == 0:
            raise ValueError("Ühtegi lehekülge ei õnnestunud alla laadida")

    except (ValueError, Exception) as e:
        # Rollback: taasta git-jälgitud failid ja JPG-d kui destruktiivsed sammud alustasid
        if destructive_started:
            logger.error(f"replace_work_content: rollback after error: {e}")
            try:
                repo.git.checkout(old_head, '--', slug)
                logger.info(f"replace {upload_id}: rollback git checkout OK (head={old_head[:8]})")
            except Exception as rb_git_err:
                logger.error(f"replace {upload_id}: rollback git checkout ebaõnnestus: {rb_git_err}")
            try:
                for fname in os.listdir(trash_dir):
                    if fname.endswith('.jpg'):
                        shutil.move(os.path.join(trash_dir, fname), os.path.join(work_dir, fname))
                logger.info(f"replace {upload_id}: rollback JPG-d tagasi liigutatud")
            except Exception as rb_jpg_err:
                logger.error(f"replace {upload_id}: rollback JPG liigutamine ebaõnnestus: {rb_jpg_err}")
        error_detail = str(e) if isinstance(e, ValueError) else f"Failide allalaadimine ebaõnnestus: {e}"
        raise HTTPException(status_code=500, detail=error_detail)
    finally:
        if sftp:
            try:
                sftp.close()
            except Exception:
                pass

    # 8. Uuenda metaandmeid upload state['meta'] põhjal (säilita id ja slug originaalist)
    try:
        upload_meta = state.get('meta', {})
        OPTIONAL_META_FIELDS = [
            "creators", "genre", "type", "tags",
            "location", "publisher",
            "ester_id", "external_url", "year_display",
            "archive_refs",
        ]
        updates = {}
        if upload_meta.get('title'):
            updates['title'] = upload_meta['title']
        year_val, year_display_val = derive_year_fields(
            upload_meta.get('year'), upload_meta.get('year_display')
        )
        if year_val is not None:
            updates['year'] = year_val
        if year_display_val:
            updates['year_display'] = year_display_val
        if upload_meta.get('collections') is not None:
            updates['collections'] = upload_meta.get('collections') or []
        if upload_meta.get('languages') is not None:
            updates['languages'] = upload_meta.get('languages') or []
        for field in OPTIONAL_META_FIELDS:
            if field in upload_meta:
                updates[field] = upload_meta[field]
        # Kirjuta otse (säilita id ja slug originaalist)
        if updates:
            from .metadata_ops import save_work_metadata
            save_work_metadata(
                meta_path,
                updates,
                username,
                "Uuenda metadata asendusel",
                background_tasks=background_tasks,
                sync_meili=False,
                call_ptw=False,
            )
            logger.info(f"replace {upload_id}: metadata uuendatud ({len(updates)} välja)")
    except Exception as e:
        logger.warning(f"replace {upload_id}: metadata uuendamine ebaõnnestus: {e}")

    # 9. Git commit uuendatud sisuga
    try:
        from .git_ops import get_or_init_repo
        from git import Actor
        repo = get_or_init_repo()
        repo.git.add(slug)
        if repo.is_dirty(index=True):
            author_name = username if username else "Automaatne"
            actor = Actor(author_name, f"{author_name}@vutt.local")
            repo.index.commit(
                f"Asenda sisu: {slug} ({work_id})",
                author=actor,
                committer=actor,
            )
            logger.info(f"replace {upload_id}: git commit OK ({slug})")
        else:
            logger.info(f"replace {upload_id}: git — muutusi pole, commit vahele jäetud")
    except Exception as e:
        logger.warning(f"replace {upload_id}: git commit ebaõnnestus: {e}")

    # 10. Meilisearch sünk
    try:
        from .meilisearch_ops import sync_work_to_meilisearch
        ok = sync_work_to_meilisearch(slug)
        if ok:
            logger.info(f"replace {upload_id}: meilisearch sync OK ({slug})")
        else:
            logger.warning(f"replace {upload_id}: meilisearch sync ebaõnnestus ({slug})")
    except Exception as e:
        logger.warning(f"replace {upload_id}: meilisearch sync viga: {e}")

    # 11. Koristame OCR serveri (mitte kriitiline)
    remote_staging = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
    try:
        _ssh_rm_rf(upload_id, remote_staging)
        close_ssh(upload_id)
        logger.info(f"replace {upload_id}: OCR serveri kaust koristatud: {remote_staging}")
    except Exception as e:
        logger.warning(f"replace {upload_id}: OCR koristamine ebaõnnestus: {e}")

    # 12. Märgi upload 'imported'-ks
    with state_lock:
        s = _read_state(upload_id)
        if s:
            s['status'] = 'imported'
            s['replace_work_id'] = target_work_id
            _write_state(upload_id, s)

    logger.info(f"replace {upload_id}: valmis → work_id={target_work_id}, slug={slug}, lehed={downloaded}")
    return {"work_id": target_work_id, "slug": slug}


def cancel_upload(upload_id: str) -> bool:
    """
    Tühistab upload'i: suleb SSH, koristab OCR serveri staging kausta ja
    kustutab lokaalse staging kausta.
    Tagastab True kui õnnestus.
    """
    if not _valid_upload_id(upload_id):
        return False

    upload_path = _upload_dir(upload_id)
    if not os.path.isdir(upload_path):
        return False

    # Loe state et teada remote_staging_path ja staatus
    lock = _get_upload_lock(upload_id)
    with lock:
        state = _read_state(upload_id)

    # SSH koristus OCR serveris (kui oli juba kaugemale jõutud kui 'pending')
    if state and state.get('status') not in ('pending', 'error'):
        remote_staging = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
        remote_work = state.get('remote_work_path')
        remote_work_abs = f"{OCR_SERVER_PATH}/{remote_work}" if remote_work else ""
        try:
            # Failid kohe, kataloog hiljem reaperiga (#225): `rm -rf` lennusoleva
            # batchi alt kukutab OCR-teenuse (.txt kirjutus on veakäsitluseta).
            sftp = _sftp_open(upload_id)
            try:
                if remote_work_abs:
                    _ocr_client.cleanup_run_files(sftp, remote_work_abs)
                _ocr_client.cleanup_run_files(sftp, remote_staging)
            finally:
                try:
                    sftp.close()
                except Exception:
                    pass
            if remote_work_abs:
                ocr_reaper.schedule_reap(remote_work_abs)
            ocr_reaper.schedule_reap(remote_staging)
            logger.info(f"OCR serveri kausta failid koristatud: {remote_staging}")
        except Exception as e:
            logger.warning(f"cancel_upload kaugkoristus ebaõnnestus {upload_id}: {e}")

    close_ssh(upload_id)

    try:
        shutil.rmtree(upload_path)
        _upload_state.remove_upload_lock(upload_id)
        upload_progress.pop(upload_id, None)
        logger.info(f"Upload tühistatud: {upload_id}")
        return True
    except Exception as e:
        logger.error(f"cancel_upload {upload_id}: {e}")
        return False



# =========================================================
# TAUSTASÜNK — proaktiivne OCR-progressi uuendamine
# =========================================================
# Probleem: poll_and_sync_thumbs (state.json sünk) käivitus AINULT kui frontend
# päris /admin/upload/{id}/status, ja frontend pollis ainult parajasti avatud
# uploadi. Öösel lehe lahti jättes (taustatab/uni → setInterval throttle) ükski
# päring ei käinud → state.json jäi õhtusesse seisu → hommikul "pooleli" ka hard
# refreshi järel; alles uploadi avamine käivitas aeglase sünki. Lahendus (sama
# muster nagu re-OCR _reocr_poll_loop): daemon-thread, mis pollib perioodiliselt
# KÕIKI aktiivseid uploade, nii et state.json on alati värske ja öised tööd
# jõuavad ise 'done'-ni — kasutaja ei pea olema Upload lehel.

# Sünki vajavad ainult need staatused, mille puhul poll_and_sync_thumbs teeb
# tegelikku SFTP-tööd. Ülejäänud short-circuitivad (pending/uploading/error/
# imported/collecting_images) või on lõppseis (done) — neid pole mõtet pollida.

# Taustasünki intervall (s). Pikem kui re-OCR oma (10s), sest upload-poll laeb
# SFTP kaudu pisipilte (raskem) ja töid on tüüpiliselt vähe. Env-st ülekirjutatav.
UPLOAD_SYNC_INTERVAL = int(os.getenv("UPLOAD_SYNC_INTERVAL", "60"))
register_job("upload_sync", interval_seconds=UPLOAD_SYNC_INTERVAL, description="Aktiivsete uploadide OCR-progressi taustasünk")


def _uploads_needing_sync(states: list) -> list:
    """Tagastab aktiivsete uploadide id-d, mille OCR-progressi tuleb taustal sünkida."""
    return _upload_state.uploads_needing_sync(states)


def _upload_sync_loop():
    """Daemon-thread: pollib perioodiliselt kõiki aktiivseid uploade, et OCR-progress
    uueneks ka siis kui keegi pole Upload lehel. Iga viga (OCR-server maas vms) on
    isoleeritud per-upload — poll_and_sync_thumbs püüab oma erandid ise kinni."""
    import time
    while True:
        time.sleep(UPLOAD_SYNC_INTERVAL)
        try:
            ids = _uploads_needing_sync(list_uploads())
        except Exception as e:
            mark_error("upload_sync", e)
            logger.warning(f"upload-sync: aktiivsete uploadide lugemine ebaõnnestus: {e}")
            continue
        errors = 0
        for uid in ids:
            try:
                poll_and_sync_thumbs(uid)
            except Exception as e:
                errors += 1
                logger.warning(f"upload-sync taustapoll viga ({uid}): {e}")
        if errors:
            mark_error("upload_sync", f"{errors} uploadi poll ebaõnnestus", detail={"active_uploads": len(ids), "errors": errors})
        else:
            mark_success("upload_sync", detail={"active_uploads": len(ids)})

        # Katkestamisel alles jäetud kaugkataloogid (#225): eemalda need, kui
        # armuaeg on täis ja ükski batch ei saa enam lennus olla.
        try:
            reaped = ocr_reaper.reap_due(lambda p: _ssh_rm_rf("reaper", p))
            if reaped:
                close_ssh("reaper")
        except Exception as e:
            logger.warning(f"OCR-kataloogide reaper: {e}")


def start_upload_sync_loop():
    """Käivita upload taustasünk daemon-thread. Kutsutakse main.py lifespan'ist,
    et see jookseks AINULT API-protsessis (uvicorn server.main).

    NB: EI käivita seda import-kõrvalmõjuna. `python3 -m server.image_server`
    impordib enne `server` paketi (server/__init__.py → upload_ops), nii et
    moodulitaseme käivitus tekitaks teise, asjatu upload-sync threadi ka
    pildiserveri protsessis (topelt SFTP-poll iga 60s + state.json võistlus).

    Käivitatakse ainult kui upload-funktsionaalsus on lubatud (testides/ilma
    OCR-serverita UPLOAD_ENABLED=false → ei tekita asjatut SFTP-koormust)."""
    if not UPLOAD_ENABLED:
        return
    threading.Thread(target=_upload_sync_loop, daemon=True, name="upload-sync").start()
    logger.info(f"Upload taustasünk käivitatud (intervall {UPLOAD_SYNC_INTERVAL}s)")
