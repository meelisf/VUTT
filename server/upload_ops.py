"""
Upload operatsioonid — teose lisamine PDF/piltidest OCR kaudu.

Etapp 1: staging haldus, state.json loogika, slug kontroll.
Etapp 2 lisab: SFTP transport, polling, thumbnailid, import.
"""
import json
import os
import re
import shutil
import threading
import unicodedata
from datetime import datetime

from .config import BASE_DIR, UPLOADS_DIR, get_logger
from .utils import generate_nanoid

logger = get_logger(__name__)

# Lock per upload_id — kaitseb samaaegset state.json lugemist/kirjutamist
_upload_locks: dict = {}
_locks_lock = threading.Lock()


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
# SLUG UTILIIDID
# =========================================================

def sanitize_slug(text: str) -> str:
    """Puhastab teksti, et see sobiks slug-iks (ainult a-z, 0-9, sidekriips)."""
    normalized = unicodedata.normalize('NFD', text)
    ascii_text = ''.join(c for c in normalized if unicodedata.category(c) != 'Mn')
    slug = ascii_text.lower()
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug or 'teos'


def check_slug_conflict(year, slug: str) -> bool:
    """
    Tagastab True kui year+slug on juba kasutusel:
    1. data/{year}_{slug}/ eksisteerib (imporditud teos)
    2. mõni aktiivne upload kasutab sama year+slug (paralleelne üleslaadimine)
    """
    if os.path.isdir(os.path.join(BASE_DIR, f"{year}_{slug}")):
        return True
    for state in list_uploads():
        m = state.get('meta', {})
        if str(m.get('year')) == str(year) and m.get('slug') == slug:
            return True
    return False


# =========================================================
# PÕHIFUNKTSIOONID
# =========================================================

def create_upload(meta: dict) -> dict:
    """
    Loob uue upload staging'u ja tagastab state.json sisu.

    meta peab sisaldama: title, year, slug
    Valikulised: type, type_object, genre, genre_object, creators,
                 location, location_object, publisher, publisher_object,
                 collection, languages, tags, tags_object
    """
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
            "type_object": meta.get('type_object'),
            "genre": meta.get('genre'),
            "genre_object": meta.get('genre_object'),
            "creators": meta.get('creators', []),
            "location": meta.get('location'),
            "location_object": meta.get('location_object'),
            "publisher": meta.get('publisher'),
            "publisher_object": meta.get('publisher_object'),
            "collection": meta.get('collection'),
            "languages": meta.get('languages', []),
            "tags": meta.get('tags', []),
            "tags_object": meta.get('tags_object', []),
        },
        "expected_pages": None,
        "remote_staging_path": f"AUTO-OCR/{upload_id}",
        "remote_work_path": f"AUTO-OCR/{upload_id}/{year}-{slug}",
        "files": [],
        "created_at": datetime.now().isoformat()
    }

    lock = _get_upload_lock(upload_id)
    with lock:
        _write_state(upload_id, state)

    logger.info(f"Upload loodud: {upload_id} ({year}_{slug})")
    return state


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


def cancel_upload(upload_id: str) -> bool:
    """
    Tühistab upload'i ja kustutab lokaalse staging kausta.
    NB: SFTP/SSH koristus OCR serveris lisatakse etapp 2-s.
    Tagastab True kui õnnestus.
    """
    if not _valid_upload_id(upload_id):
        return False

    upload_path = _upload_dir(upload_id)
    if not os.path.isdir(upload_path):
        return False

    try:
        shutil.rmtree(upload_path)
        with _locks_lock:
            _upload_locks.pop(upload_id, None)
        logger.info(f"Upload tühistatud: {upload_id}")
        return True
    except Exception as e:
        logger.error(f"cancel_upload {upload_id}: {e}")
        return False
