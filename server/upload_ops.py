"""
Upload operatsioonid — teose lisamine PDF/piltidest OCR kaudu.

Etapp 1: staging haldus, state.json loogika, slug kontroll.
Etapp 2: SFTP transport, polling, thumbnailid, OCR jälgimine.
Etapp 4 lisab: import_as_work, cleanup_upload.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import unicodedata
from datetime import datetime

from .config import BASE_DIR, UPLOADS_DIR, OCR_SERVER_HOST, OCR_SERVER_USER, OCR_SERVER_PATH, get_logger
from .utils import generate_nanoid

logger = get_logger(__name__)

# Lock per upload_id — kaitseb samaaegset state.json lugemist/kirjutamist
_upload_locks: dict = {}
_locks_lock = threading.Lock()

# =========================================================
# MÄLUPÕHINE PROGRESS (SFTP üleslaadimise jälgimine)
# Kettale kirjutatakse alles pärast edastuse lõppu.
# =========================================================
upload_progress: dict = {}  # {upload_id: {"bytes_sent": 0, "bytes_total": 0, "error": None}}

# =========================================================
# PÜSIVAD SSH ÜHENDUSED (üks per upload_id)
# =========================================================
_ssh_connections: dict = {}
_ssh_lock = threading.Lock()


def _get_upload_lock(upload_id: str) -> threading.Lock:
    """Tagastab konkreetsele upload_id-le vastava luku."""
    with _locks_lock:
        if upload_id not in _upload_locks:
            _upload_locks[upload_id] = threading.Lock()
        return _upload_locks[upload_id]


def _upload_dir(upload_id: str) -> str:
    """Tagastab upload staging kausta tee."""
    return os.path.join(UPLOADS_DIR, upload_id)


def _state_path(upload_id: str) -> str:
    """Tagastab state.json faili tee."""
    return os.path.join(_upload_dir(upload_id), "state.json")


def _read_state(upload_id: str):
    """Loeb state.json (ei lukusta ise — kasuta _get_upload_lock)."""
    path = _state_path(upload_id)
    if not os.path.exists(path):
        return None
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _write_state(upload_id: str, state: dict):
    """Kirjutab state.json (ei lukusta ise — kasuta _get_upload_lock)."""
    path = _state_path(upload_id)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def _valid_upload_id(upload_id: str) -> bool:
    """Valideerib upload_id formaadi (ainult a-z0-9, max 20 märki)."""
    return bool(re.match(r'^[a-z0-9]{1,20}$', upload_id))


def _valid_filename(filename: str) -> bool:
    """Valideerib failinime (ainult a-z0-9._-, keelatud .. ja /)."""
    return bool(re.match(r'^[a-z0-9._-]+$', filename)) and '..' not in filename


# =========================================================
# SSH / SFTP UTILIIDID (etapp 2)
# =========================================================

def _load_ssh_key():
    """Laeb SSH privaatvõtme tavalistest asukohtadest (~/.ssh/)."""
    try:
        import paramiko
    except ImportError:
        raise RuntimeError("paramiko pole paigaldatud (pip install paramiko)")

    key_paths = [
        ("ed25519", os.path.expanduser("~/.ssh/id_ed25519")),
        ("ecdsa",   os.path.expanduser("~/.ssh/id_ecdsa")),
        ("rsa",     os.path.expanduser("~/.ssh/id_rsa")),
    ]
    for key_type, path in key_paths:
        if not os.path.exists(path):
            continue
        try:
            if key_type == "ed25519":
                return paramiko.Ed25519Key.from_private_key_file(path)
            elif key_type == "ecdsa":
                return paramiko.ECDSAKey.from_private_key_file(path)
            else:
                return paramiko.RSAKey.from_private_key_file(path)
        except Exception as e:
            logger.warning(f"SSH võtme laadimine ebaõnnestus ({path}): {e}")

    raise FileNotFoundError("SSH privaatvõtit ei leitud (~/.ssh/id_ed25519 ega teised)")


def get_or_create_ssh(upload_id: str):
    """
    Tagastab püsiva paramiko.Transport objekti antud upload_id jaoks.
    Loob uue ühenduse kui puudub või on katkine.
    """
    try:
        import paramiko
    except ImportError:
        raise RuntimeError("paramiko pole paigaldatud (pip install paramiko)")

    with _ssh_lock:
        transport = _ssh_connections.get(upload_id)
        if transport and transport.is_active():
            return transport

        # Sulge vana katkine ühendus
        if transport:
            try:
                transport.close()
            except Exception:
                pass

        logger.info(f"SSH: loob ühenduse {OCR_SERVER_USER}@{OCR_SERVER_HOST} (upload {upload_id})")
        transport = paramiko.Transport((OCR_SERVER_HOST, 22))
        transport.set_keepalive(30)
        transport.connect()
        key = _load_ssh_key()
        transport.auth_publickey(OCR_SERVER_USER, key)
        _ssh_connections[upload_id] = transport
        return transport


def close_ssh(upload_id: str):
    """Suleb ja eemaldab SSH ühenduse."""
    with _ssh_lock:
        transport = _ssh_connections.pop(upload_id, None)
    if transport:
        try:
            transport.close()
        except Exception:
            pass


def _sftp_open(upload_id: str):
    """
    Loob SFTP seansi püsivalt SSH transpordilt.
    Proovib uuesti üks kord kui ühendus on katkine.
    """
    try:
        import paramiko
    except ImportError:
        raise RuntimeError("paramiko pole paigaldatud (pip install paramiko)")

    for attempt in range(2):
        try:
            transport = get_or_create_ssh(upload_id)
            return paramiko.SFTPClient.from_transport(transport)
        except Exception:
            if attempt == 0:
                close_ssh(upload_id)  # Eemalda katkine ühendus, proovi uuesti
            else:
                raise


def _extract_page_num(base: str) -> int:
    """
    Eraldab leheküljenumbri OCR failinimest.
    '{year}-{slug}_pg_001' → 1
    """
    parts = base.rsplit('_pg_', 1)
    if len(parts) == 2:
        try:
            return int(parts[1])
        except ValueError:
            pass
    return 0


# =========================================================
# SLUG UTILIIDID
# =========================================================

SLUG_MAX_LEN = 80

def sanitize_slug(text: str) -> str:
    """Puhastab teksti, et see sobiks slug-iks (ainult a-z, 0-9, sidekriips, max 80 tähemärki)."""
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    slug = ascii_text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug[:SLUG_MAX_LEN].rstrip('-')
    return slug or 'teos'


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

def create_upload(meta: dict) -> dict:
    """
    Loob uue upload staging'u ja tagastab state.json sisu.

    meta peab sisaldama: title, year, slug
    Valikulised: type, genre, creators, location, publisher,
                 collections, languages, tags
    """
    upload_id = generate_nanoid()
    while os.path.isdir(_upload_dir(upload_id)):
        upload_id = generate_nanoid()

    year = str(meta.get('year', ''))
    slug = meta.get('slug', sanitize_slug(meta.get('title', '')))

    # Loo uploads/{id}/thumbs/ kaustad
    thumbs_dir = os.path.join(_upload_dir(upload_id), 'thumbs')
    os.makedirs(thumbs_dir, exist_ok=True)

    state = {
        "id": upload_id,
        "status": "pending",
        "meta": {
            "title": meta.get('title', ''),
            "year": year,
            "slug": slug,
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
        "remote_staging_path": f"AUTO-OCR/{upload_id}",
        "remote_work_path": f"AUTO-OCR/{upload_id}/{slug}",
        "files": [],
        "created_at": datetime.now().isoformat()
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
    allowed = {
        'title', 'year', 'collections', 'languages',
        'type', 'genre',
        'creators', 'location',
        'publisher', 'tags',
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
    if not os.path.isdir(UPLOADS_DIR):
        return []

    result = []
    for entry in os.scandir(UPLOADS_DIR):
        if not entry.is_dir():
            continue
        state_file = os.path.join(entry.path, 'state.json')
        if not os.path.exists(state_file):
            continue
        try:
            with open(state_file, 'r', encoding='utf-8') as f:
                state = json.load(f)
            if state.get('status') != 'imported':
                result.append(state)
        except Exception as e:
            logger.warning(f"list_uploads: ei saa lugeda {state_file}: {e}")

    result.sort(key=lambda s: s.get('created_at', ''), reverse=True)
    return result


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
    with open(path, 'rb') as f:
        header = f.read(1024)
    if b'%PDF' in header[:1024]:
        return 'pdf'
    if header[:2] == b'\xff\xd8':
        return 'jpeg'
    if header[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if header[:4] in (b'II\x2a\x00', b'MM\x00\x2a'):  # little-endian ja big-endian TIFF
        return 'tiff'
    return 'unknown'


def save_and_transfer_to_ocr(upload_id: str, tmp_path: str) -> int:
    """
    Edastab faili OCR serverisse SFTP kaudu.

    - PDF: pdfinfo → lehekülgede arv → staging kausta → OCR server lõhub ise lahti
    - JPG/PNG: pannakse otse remote work kausta {slug}_pg_001.jpg nimega
      (OCR server leiab pildi rglob-iga ja teeb OCR-i ilma PDF-i lahti lõhkumata)

    Tagastab expected_pages (int).
    Tõstab ValueError kui fail on vigane või toetamata formaadis.
    """
    state_lock = _get_upload_lock(upload_id)
    with state_lock:
        state = _read_state(upload_id)
    if not state:
        raise ValueError(f"Upload {upload_id} ei leitud")

    year = state['meta']['year']
    slug = state['meta']['slug']

    # --- Tuvasta faili tüüp ---
    file_type = _detect_file_type(tmp_path)

    if file_type in ('jpeg', 'png', 'tiff'):
        # Pildi puhul: laadi otse remote work kausta, OCR server teeb ise üles
        pages = 1
        file_size = os.path.getsize(tmp_path)
        upload_progress[upload_id] = {"bytes_sent": 0, "bytes_total": file_size, "error": None}

        remote_staging_abs = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
        remote_work_abs = f"{OCR_SERVER_PATH}/{state['remote_work_path']}"
        remote_img_name = f"{slug}_pg_001.jpg"

        with state_lock:
            s = _read_state(upload_id)
            s['expected_pages'] = pages
            s['status'] = 'uploading'
            _write_state(upload_id, s)

        def _sftp_transfer_image():
            sftp = None
            try:
                sftp = _sftp_open(upload_id)
                # Loo staging + work kaustad
                for remote_dir in (remote_staging_abs, remote_work_abs):
                    try:
                        sftp.stat(remote_dir)
                    except FileNotFoundError:
                        sftp.mkdir(remote_dir)

                remote_tmp = f"{remote_work_abs}/{remote_img_name}.tmp"
                remote_dst = f"{remote_work_abs}/{remote_img_name}"

                def _progress(transferred, total):
                    upload_progress[upload_id]['bytes_sent'] = transferred
                    upload_progress[upload_id]['bytes_total'] = total

                # Konverteeri JPEG-iks kui PNG või TIFF
                if file_type in ('png', 'tiff'):
                    from PIL import Image
                    conv_path = tmp_path + '.conv.jpg'
                    with Image.open(tmp_path) as img:
                        img.convert('RGB').save(conv_path, 'JPEG', quality=95)
                    sftp.put(conv_path, remote_tmp, callback=_progress)
                    os.unlink(conv_path)
                else:
                    sftp.put(tmp_path, remote_tmp, callback=_progress)

                # Kustuta sihtfail kui see juba eksisteerib (uuesti üleslaadimine)
                try:
                    sftp.stat(remote_dst)
                    sftp.unlink(remote_dst)
                except FileNotFoundError:
                    pass
                sftp.rename(remote_tmp, remote_dst)
                logger.info(f"Pilt edastatud OCR serverisse: {upload_id} ({remote_img_name})")

                with state_lock:
                    s = _read_state(upload_id)
                    if s:
                        s['status'] = 'processing'
                        _write_state(upload_id, s)

            except Exception as e:
                logger.error(f"SFTP pilt {upload_id}: {e}")
                upload_progress[upload_id]['error'] = str(e)
                with state_lock:
                    s = _read_state(upload_id)
                    if s:
                        s['status'] = 'error'
                        s['error_message'] = str(e)
                        _write_state(upload_id, s)
            finally:
                if sftp:
                    try:
                        sftp.close()
                    except Exception:
                        pass
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass

        thread = threading.Thread(target=_sftp_transfer_image, daemon=True, name=f"sftp-img-{upload_id}")
        thread.start()
        return pages

    elif file_type == 'unknown':
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise ValueError(
            "Toetamata failivorming. Palun laadi üles PDF, JPG, PNG või TIFF fail."
        )

    # file_type == 'pdf' → tavapärane PDF flow allpool

    # --- Loe lehekülgede arv pdfinfo abil ---
    try:
        result = subprocess.run(
            ['pdfinfo', tmp_path],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            logger.error(f"pdfinfo viga: {result.stderr}")
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
            raise ValueError(
                f"Vigane PDF — fail ei ole korrektne PDF-dokument (pdfinfo viga). "
                f"Kontrolli, et laadid üles õige faili."
            )

        pages = None
        for line in result.stdout.splitlines():
            if line.startswith('Pages:'):
                pages = int(line.split(':', 1)[1].strip())
                break
        if pages is None:
            logger.error(f"pdfinfo väljundis puudus 'Pages:': {result.stdout}")
            raise ValueError("PDF lehekülgede arvu ei õnnestunud tuvastada")

    except FileNotFoundError:
        raise ValueError("pdfinfo pole paigaldatud (apt install poppler-utils)")
    except subprocess.TimeoutExpired:
        raise ValueError("PDF analüüs võttis liiga kaua — fail on liiga suur või kahjustatud")

    # --- Uuenda state.json ja progress ---
    file_size = os.path.getsize(tmp_path)
    upload_progress[upload_id] = {"bytes_sent": 0, "bytes_total": file_size, "error": None}

    with state_lock:
        state = _read_state(upload_id)
        state['expected_pages'] = pages
        state['status'] = 'uploading'
        _write_state(upload_id, state)

    # Remote teed (OCR_SERVER_PATH on absoluutne tee OCR serveris)
    remote_staging_abs = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
    remote_pdf_name = f"{slug}.pdf"
    remote_pdf_tmp_name = f"{slug}.pdf.tmp"

    # --- Daemon thread SFTP edastuseks ---
    def _sftp_transfer():
        sftp = None
        try:
            sftp = _sftp_open(upload_id)

            # Loo staging kaust OCR serveris
            try:
                sftp.stat(remote_staging_abs)
            except FileNotFoundError:
                sftp.mkdir(remote_staging_abs)

            remote_tmp = f"{remote_staging_abs}/{remote_pdf_tmp_name}"
            remote_pdf = f"{remote_staging_abs}/{remote_pdf_name}"

            def _progress(transferred, total):
                upload_progress[upload_id]['bytes_sent'] = transferred
                upload_progress[upload_id]['bytes_total'] = total

            sftp.put(tmp_path, remote_tmp, callback=_progress)
            sftp.rename(remote_tmp, remote_pdf)

            logger.info(f"SFTP upload valmis: {upload_id} ({pages} lk, {file_size} B)")

            with state_lock:
                s = _read_state(upload_id)
                if s:
                    s['status'] = 'processing'
                    _write_state(upload_id, s)

        except Exception as e:
            logger.error(f"SFTP transfer {upload_id}: {e}")
            upload_progress[upload_id]['error'] = str(e)
            with state_lock:
                s = _read_state(upload_id)
                if s:
                    s['status'] = 'error'
                    s['error_message'] = str(e)
                    _write_state(upload_id, s)
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass
            try:
                os.unlink(tmp_path)
            except Exception:
                pass

    thread = threading.Thread(target=_sftp_transfer, daemon=True, name=f"sftp-{upload_id}")
    thread.start()
    return pages


def poll_and_sync_thumbs(upload_id: str) -> dict:
    """
    Küsib SFTP kaudu OCR serveri kausta, tuvastab valmis JPG+TXT paarid,
    laeb alla uued pisipildid (Pillow thumbnail 400x600) ja uuendab state.json.

    Tagastab: {status, ready, total, expected_pages, files, progress, error?}
    """
    state_lock = _get_upload_lock(upload_id)
    with state_lock:
        state = _read_state(upload_id)
    if not state:
        return {"error": "Upload ei leitud"}

    current_status = state.get('status', 'pending')
    expected_pages = state.get('expected_pages')

    # Uploading/pending/collecting_images/error: SFTP-d pole vaja
    if current_status in ('pending', 'uploading', 'error', 'imported', 'collecting_images'):
        return {
            "status": current_status,
            "ready": 0,
            "total": 0,
            "expected_pages": expected_pages,
            "files": state.get('files', []),
            "progress": upload_progress.get(upload_id, {}),
            "error": state.get('error_message'),
        }

    year = state['meta']['year']
    slug = state['meta']['slug']
    remote_work = f"{OCR_SERVER_PATH}/{state['remote_work_path']}"
    thumbs_dir = os.path.join(_upload_dir(upload_id), 'thumbs')

    sftp = None
    try:
        sftp = _sftp_open(upload_id)

        # --- Kontrolli VIGASED kausta ---
        vigased_path = f"{OCR_SERVER_PATH}/VIGASED/{slug}.pdf"
        try:
            sftp.stat(vigased_path)
            # PDF on vigane — OCR teenus teisaldas selle
            err_msg = "PDF on vigane — OCR teenus ei suutnud seda töödelda"
            with state_lock:
                s = _read_state(upload_id)
                if s and s.get('status') != 'error':
                    s['status'] = 'error'
                    s['error_message'] = err_msg
                    _write_state(upload_id, s)
            return {
                "status": "error",
                "error": err_msg,
                "ready": 0,
                "total": 0,
                "expected_pages": expected_pages,
                "files": state.get('files', []),
                "progress": upload_progress.get(upload_id, {}),
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
                "files": state.get('files', []),
                "progress": upload_progress.get(upload_id, {}),
            }

        # --- Leia JPG-d ja TXT-d ---
        jpg_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith('.jpg')}
        txt_bases = {os.path.splitext(f)[0] for f in remote_files if f.lower().endswith('.txt')}
        ready_bases = jpg_bases & txt_bases  # Mõlemad olemas = OCR valmis

        # --- Laadi alla UUED valmis JPG-d (ainult mille jaoks on ka TXT) ---
        os.makedirs(thumbs_dir, exist_ok=True)
        existing_thumbs = set(os.listdir(thumbs_dir))

        for base in sorted(ready_bases):
            page_num = _extract_page_num(base)
            if page_num <= 0:
                continue
            thumb_name = f"{page_num:03d}.jpg"
            if thumb_name in existing_thumbs:
                continue
            tmp_thumb = os.path.join(thumbs_dir, f"{page_num:03d}.jpg.tmp")
            if os.path.exists(tmp_thumb):
                continue  # Teise threadi poolt juba allalaadimisel

            try:
                sftp.get(f"{remote_work}/{base}.jpg", tmp_thumb)
                from PIL import Image
                with Image.open(tmp_thumb) as img:
                    img.thumbnail((400, 600), Image.LANCZOS)
                    img.save(os.path.join(thumbs_dir, thumb_name), "JPEG", quality=85)
                os.unlink(tmp_thumb)
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
            {_extract_page_num(b) for b in jpg_bases if _extract_page_num(b) > 0}
        )
        ready_page_nums = {_extract_page_num(b) for b in ready_bases if _extract_page_num(b) > 0}
        existing_deleted = {f['page']: f.get('deleted', False) for f in state.get('files', [])}

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
            new_status = 'done'
        elif all_page_nums:
            new_status = 'reviewing'

        # --- Uuenda state.json ---
        with state_lock:
            s = _read_state(upload_id)
            if s:
                s['files'] = new_files
                if new_status != s.get('status'):
                    s['status'] = new_status
                _write_state(upload_id, s)

        return {
            "status": new_status,
            "ready": ready_count,
            "total": len(all_page_nums),
            "expected_pages": expected_pages,
            "files": new_files,
            "progress": upload_progress.get(upload_id, {}),
        }

    except Exception as e:
        logger.error(f"poll_and_sync_thumbs {upload_id}: {e}")
        return {
            "status": current_status,
            "ready": 0,
            "total": 0,
            "expected_pages": expected_pages,
            "files": state.get('files', []),
            "error": str(e),
            "progress": upload_progress.get(upload_id, {}),
        }
    finally:
        if sftp:
            try:
                sftp.close()
            except Exception:
                pass


def add_image_page(upload_id: str, tmp_path: str, page_number: int, total_pages: int) -> int:
    """
    Lisab ühe pildilehe multi-image üleslaadimisse (sünkroonne SFTP).

    - Kui page_number == 1, lähtestatakse received_pages loendur.
    - Kui kõik lehed edastatud (received_pages >= total_pages), muutub staatus 'processing'-ks.
    - Tagastab total_pages.
    - Tõstab ValueError kui failitüüp vale või SFTP ebaõnnestub.
    """
    state_lock = _get_upload_lock(upload_id)
    with state_lock:
        state = _read_state(upload_id)
    if not state:
        raise ValueError(f"Upload {upload_id} ei leitud")

    current_status = state.get('status')
    if current_status not in ('pending', 'collecting_images'):
        raise ValueError(
            f"Upload on olekus '{current_status}' — lehte ei saa lisada. "
            "Oodatav: 'pending' või 'collecting_images'."
        )

    slug = state['meta']['slug']
    file_type = _detect_file_type(tmp_path)

    if file_type == 'unknown':
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise ValueError("Toetamata failivorming. Palun laadi üles JPG või PNG fail.")

    if file_type == 'pdf':
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
        raise ValueError("Multi-page režiim ei toeta PDF-e — kasuta PDF puhul üksikut üleslaadimist.")

    remote_img_name = f"{slug}_pg_{page_number:03d}.jpg"
    remote_staging_abs = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
    remote_work_abs = f"{OCR_SERVER_PATH}/{state['remote_work_path']}"

    # Uuenda state → collecting_images; lk 1 puhul lähtesta loendur
    with state_lock:
        s = _read_state(upload_id)
        if s['status'] == 'pending' or page_number == 1:
            s['status'] = 'collecting_images'
            s['expected_pages'] = total_pages
            s['received_pages'] = 0
        _write_state(upload_id, s)

    # Sünkroonne SFTP (blokeerib kuni fail on OCR serveris)
    sftp = None
    try:
        sftp = _sftp_open(upload_id)

        for remote_dir in (remote_staging_abs, remote_work_abs):
            try:
                sftp.stat(remote_dir)
            except FileNotFoundError:
                sftp.mkdir(remote_dir)

        remote_tmp = f"{remote_work_abs}/{remote_img_name}.tmp"
        remote_dst = f"{remote_work_abs}/{remote_img_name}"

        if file_type in ('png', 'tiff'):
            from PIL import Image
            conv_path = tmp_path + '.conv.jpg'
            with Image.open(tmp_path) as img:
                img.convert('RGB').save(conv_path, 'JPEG', quality=95)
            sftp.put(conv_path, remote_tmp)
            os.unlink(conv_path)
        else:
            sftp.put(tmp_path, remote_tmp)

        # Kustuta sihtfail kui see juba eksisteerib (uuesti üleslaadimine)
        try:
            sftp.stat(remote_dst)
            sftp.unlink(remote_dst)
        except FileNotFoundError:
            pass
        sftp.rename(remote_tmp, remote_dst)
        logger.info(f"Multi-image: lk {page_number}/{total_pages} edastatud → {upload_id} ({remote_img_name})")

        # Inkrementeeri loendur; kui kõik valmis → processing
        with state_lock:
            s = _read_state(upload_id)
            if s:
                received = s.get('received_pages', 0) + 1
                s['received_pages'] = received
                if received >= total_pages:
                    s['status'] = 'processing'
                    logger.info(f"Multi-image: kõik {total_pages} lehte edastatud → processing ({upload_id})")
                _write_state(upload_id, s)

    except ValueError:
        raise
    except Exception as e:
        logger.error(f"SFTP multi-image {upload_id} lk {page_number}: {e}")
        with state_lock:
            s = _read_state(upload_id)
            if s:
                s['status'] = 'error'
                s['error_message'] = str(e)
                _write_state(upload_id, s)
        raise ValueError(f"Faili edastamine ebaõnnestus: {e}")
    finally:
        if sftp:
            try:
                sftp.close()
            except Exception:
                pass
        try:
            os.unlink(tmp_path)
        except Exception:
            pass

    return total_pages


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
    """
    Impordib OCR-itud teose VUTT andmebaasi.

    1. Laeb alla JPG+TXT failid OCR serverist (SFTP)
    2. Loob data/{slug}/ struktuuri
    3. Loob _metadata.json ja lehekülgede JSON-id
    4. Git commit (originaal OCR)
    5. Meilisearch sünk (async)
    6. Koristab OCR serveri staging kausta
    7. Märgib upload 'imported'-ks

    Tagastab: {"work_id": "...", "slug": "..."}
    Viskab ValueError kui midagi läheb valesti.
    """
    state_lock = _get_upload_lock(upload_id)
    with state_lock:
        state = _read_state(upload_id)
    if not state:
        raise ValueError("Upload ei leitud")

    current_status = state.get('status')
    if current_status not in ('done', 'reviewing'):
        raise ValueError(
            f"Upload peab olema 'done' või 'reviewing' olekus, praegu: '{current_status}'"
        )

    meta = state['meta']
    title = meta['title']
    slug = meta['slug']
    work_collections = meta.get('collections') or []
    languages = meta.get('languages') or []
    try:
        year = int(str(meta.get('year', '')))
    except (ValueError, TypeError):
        year = None

    # Filtreeri: ainult OCR-iga, mitte-kustutatud lehed
    importable = [f for f in state.get('files', []) if f.get('has_ocr') and not f.get('deleted')]
    if not importable:
        raise ValueError("Imporditavaid lehekülgi pole (kõik kustutatud või OCR puudub)")
    importable.sort(key=lambda f: f['page'])

    # Genereeri work_id (nanoid)
    work_id = generate_nanoid()

    # Sihtkoha kaust data/{slug}/
    work_dir = os.path.join(BASE_DIR, slug)
    if os.path.exists(work_dir):
        raise ValueError(f"Kaust data/{slug}/ on juba olemas")
    os.makedirs(work_dir)

    remote_work = f"{OCR_SERVER_PATH}/{state['remote_work_path']}"

    sftp = None
    try:
        sftp = _sftp_open(upload_id)

        # Leia tegelikud remote failinimed
        try:
            remote_items = sftp.listdir(remote_work)
        except Exception as e:
            raise ValueError(f"Ei saa lugeda OCR kausta: {e}")

        # Map: page_num → jpg_filename
        jpg_map = {}
        for item in remote_items:
            if item.endswith('.jpg') and '_pg_' in item:
                pn = _extract_page_num(item.rsplit('.', 1)[0])
                if pn > 0:
                    jpg_map[pn] = item

        # Lae alla iga soovitud leht
        downloaded = 0
        for entry in importable:
            pn = entry['page']
            if pn not in jpg_map:
                logger.warning(f"import {upload_id}: lk {pn} JPG puudub, vahele jäetud")
                continue

            jpg_name = jpg_map[pn]
            txt_name = jpg_name.replace('.jpg', '.txt')

            base_name = f"{slug}-{work_id}-{pn:03d}"
            local_jpg = os.path.join(work_dir, f"{base_name}.jpg")
            local_txt = os.path.join(work_dir, f"{base_name}.txt")
            local_json = os.path.join(work_dir, f"{base_name}.json")

            sftp.get(f"{remote_work}/{jpg_name}", local_jpg)
            os.chmod(local_jpg, 0o644)

            try:
                sftp.get(f"{remote_work}/{txt_name}", local_txt)
            except FileNotFoundError:
                open(local_txt, 'w').close()
            os.chmod(local_txt, 0o644)

            page_json = {"sequence": pn * 100, "status": "Toores", "page_tags": [], "comments": [], "history": []}
            with open(local_json, 'w', encoding='utf-8') as f:
                json.dump(page_json, f, ensure_ascii=False, indent=2)
            os.chmod(local_json, 0o644)
            downloaded += 1

        sftp.close()
        sftp = None

        if downloaded == 0:
            raise ValueError("Ühtegi lehekülge ei õnnestunud alla laadida")

    except ValueError:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise ValueError(f"Failide allalaadimine ebaõnnestus: {e}")
    finally:
        if sftp:
            try:
                sftp.close()
            except Exception:
                pass

    # _metadata.json — kõik upload formis sisestatud metaandmed
    OPTIONAL_META_FIELDS = [
        "creators", "tags",
        "type", "genre",
        "location", "publisher",
        "ester_id", "external_url", "year_display",
    ]
    metadata = {
        "id": work_id,
        "slug": slug,
        "title": title,
        "collections": work_collections,
        "languages": languages,
    }
    if year is not None:
        metadata["year"] = year
    for field in OPTIONAL_META_FIELDS:
        if field in meta and meta[field] not in (None, [], ""):
            metadata[field] = meta[field]
    # tags ja creators peavad alati olemas olema (tühi list kui puudub)
    metadata.setdefault("tags", [])
    metadata.setdefault("creators", [])
    meta_path = os.path.join(work_dir, '_metadata.json')
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    os.chmod(meta_path, 0o644)

    # Git commit
    try:
        from .git_ops import commit_new_work_to_git
        commit_new_work_to_git(slug, username=username)
        logger.info(f"import {upload_id}: git commit OK ({slug})")
    except Exception as e:
        logger.warning(f"import {upload_id}: git commit ebaõnnestus: {e}")

    # Meilisearch sünk (sünkroonne — ootame lõpuni, et teos oleks kohe kättesaadav)
    try:
        from .meilisearch_ops import sync_work_to_meilisearch
        ok = sync_work_to_meilisearch(slug)
        if ok:
            logger.info(f"import {upload_id}: meilisearch sync OK ({slug})")
        else:
            logger.warning(f"import {upload_id}: meilisearch sync ebaõnnestus või timeout ({slug})")
    except Exception as e:
        logger.warning(f"import {upload_id}: meilisearch sync viga: {e}")

    # Uuenda upload state → 'imported'
    with state_lock:
        s = _read_state(upload_id)
        if s:
            s['status'] = 'imported'
            s['work_id'] = work_id
            _write_state(upload_id, s)

    # Koristame OCR serveri (mitte kriitiline)
    remote_staging = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
    try:
        transport = get_or_create_ssh(upload_id)
        chan = transport.open_session()
        chan.set_combine_stderr(True)
        chan.exec_command(f'rm -rf "{remote_staging}"')
        chan.recv_exit_status()
        chan.close()
        close_ssh(upload_id)
        logger.info(f"import {upload_id}: OCR serveri kaust koristatud: {remote_staging}")
    except Exception as e:
        logger.warning(f"import {upload_id}: OCR koristamine ebaõnnestus: {e}")

    logger.info(f"import {upload_id}: valmis → work_id={work_id}, slug={slug}, lehed={downloaded}")
    return {"work_id": work_id, "slug": slug}


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
        try:
            transport = get_or_create_ssh(upload_id)
            chan = transport.open_session()
            chan.set_combine_stderr(True)
            chan.exec_command(f'rm -rf "{remote_staging}"')
            chan.recv_exit_status()
            chan.close()
            logger.info(f"OCR serveri kaust koristatud: {remote_staging}")
        except Exception as e:
            logger.warning(f"cancel_upload SSH koristus ebaõnnestus {upload_id}: {e}")

    close_ssh(upload_id)

    try:
        shutil.rmtree(upload_path)
        with _locks_lock:
            _upload_locks.pop(upload_id, None)
        upload_progress.pop(upload_id, None)
        logger.info(f"Upload tühistatud: {upload_id}")
        return True
    except Exception as e:
        logger.error(f"cancel_upload {upload_id}: {e}")
        return False


