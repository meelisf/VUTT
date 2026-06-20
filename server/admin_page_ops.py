"""Lehekülgede järjestuse ja halduse utiliidid (admin).

Eraldatud main.py-st parema testitavuse ja hallatavuse jaoks.
"""

import fcntl
import os
import json
import shutil
import io
import re
import threading
import unicodedata
import uuid
from contextlib import contextmanager
from datetime import datetime
from git import Actor
from git.exc import GitCommandError
from PIL import Image
from .config import BASE_DIR, get_logger
from .git_ops import get_or_init_repo, save_with_git, delete_page_from_git, delete_pages_from_git
from .utils import find_directory_by_id, generate_nanoid
from .meilisearch_ops import sync_work_to_meilisearch

logger = get_logger(__name__)

# --- Teose-tasemel lukustus (lõimedevaheline + protsessidevaheline) ---
_work_thread_locks = {}
_work_thread_locks_guard = threading.Lock()


def _get_thread_lock(work_id):
    """Tagastab olemasoleva või loob uue threading.Lock'i antud teose ID jaoks."""
    with _work_thread_locks_guard:
        lk = _work_thread_locks.get(work_id)
        if lk is None:
            lk = threading.Lock()
            _work_thread_locks[work_id] = lk
        return lk


@contextmanager
def work_lock(work_id, work_dir):
    """Serialiseerib sama teose mutleerivad operatsioonid.

    threading.Lock = lõimedevaheline (üks worker); fcntl.flock = protsessidevaheline
    (tuleviku gunicorn mitme workeri jaoks). Lukufail {work_dir}/.vutt-lock.
    """
    tlock = _get_thread_lock(work_id)
    tlock.acquire()
    try:
        lockpath = os.path.join(work_dir, '.vutt-lock')
        f = open(lockpath, 'w')
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            yield
        finally:
            try:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
            finally:
                f.close()
    finally:
        tlock.release()


def natural_sort_key(name):
    """Kanooniline loomulik-sort võti (peab JS-poolega kokku langema).

    NFC-normaliseerimine, lower-case, numbri/teksti-plokid (numbrid arvuna).
    Viigi-katkestaja: originaalnimi (stabiilne determinism nt '02' vs '2').
    Tokeniseerimine: re.split(r'(\\d+)') → numbrist algav/lõppev string annab
    tühje elemente (nt '2.jpg' → ['', '2', '.jpg']) — JS peab käituma identselt.

    NB: kasutame .lower() (mitte .casefold()), et langeda kokku JS .toLowerCase()-iga
    (casefold on agressiivsem: 'ß'→'ss', mida JS-il pole). Eksootilise Unicode korral
    (nt lõpp-sigma) võivad järjekorrad ikka erineda — backend on autoriteetne, frontend
    sort on vaid eelvaate jaoks.
    """
    norm = unicodedata.normalize('NFC', name).lower()
    tokens = re.split(r'(\d+)', norm)
    key = []
    for i, tok in enumerate(tokens):
        if i % 2 == 1:           # paaritu indeks = numbriplokk
            key.append((1, int(tok), ''))
        else:                    # paaris indeks = tekst (sh tühjad)
            key.append((0, 0, tok))
    return (key, name)           # viigi-katkestaja: originaalnimi


# Piltide maksimaalne dimensioon (px) — kaitse pilllipommide vastu
MAX_DIMENSION = 10000


def detect_and_convert_image(content: bytes, filename: str = "") -> tuple:
    """Tuvastab pildi tüübi magic-byte'idega ja tagastab JPEG-baidid.

    JPG → tagastab sisu muutmata. PNG → teisendab JPEG-iks; läbipaistvus
    lamendatakse VALGELE taustale (mitte must, nagu convert('RGB') üksi annaks).
    Tagastab (bytes, '.jpg'). Viskab ValueError toetamata formaadi või liiga
    suure pildi korral.
    """
    if content[:3] == b'\xff\xd8\xff':
        kind = 'jpg'
    elif content[:8] == b'\x89PNG\r\n\x1a\n':
        kind = 'png'
    elif content[:4] == b'%PDF':
        raise ValueError(f"PDF pole toetatud (kasuta JPG/PNG): {filename}")
    else:
        raise ValueError(f"Toetamata formaat (lubatud JPG/PNG): {filename}")

    # Mõõtmete kontroll (.size loeb päisest, ei dekodeeri kogu pilti)
    with Image.open(io.BytesIO(content)) as probe:
        w, h = probe.size
        if w > MAX_DIMENSION or h > MAX_DIMENSION:
            raise ValueError(
                f"Pilt liiga suur ({w}x{h}px, max {MAX_DIMENSION}px): {filename}"
            )

    if kind == 'jpg':
        return content, '.jpg'

    # PNG → JPG, läbipaistvus valgele taustale
    with Image.open(io.BytesIO(content)) as img:
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            alpha = img.convert('RGBA')
            background = Image.new('RGBA', alpha.size, (255, 255, 255, 255))
            flat = Image.alpha_composite(background, alpha).convert('RGB')
        else:
            flat = img.convert('RGB')
        buf = io.BytesIO()
        flat.save(buf, format='JPEG', quality=95)
    return buf.getvalue(), '.jpg'


def get_page_sequence(json_path: str) -> float:
    """Loeb sequence välja .json failist. Tagastab float('inf') kui puudub."""
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                d = json.load(f)
                seq = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                if seq is not None:
                    return int(seq)
        except Exception:
            pass
    return float('inf')


def get_sorted_images(dir_path: str) -> list[str]:
    """Tagastab sequence järgi sorteeritud piltide nimekirja.
    Fallback: tähestikuline positsioon × 100 kui sequence puudub.
    NB: float('inf') fallback läheks katki kui mõni leht HAS sequence —
    siis float('inf') lehed sorteeritaks uue lehe järele, mitte ette.
    """
    images = [
        f for f in os.listdir(dir_path)
        if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')
    ]
    # Esmane tähestikuline sort positsioonifallback'i jaoks
    alpha_sorted = sorted(images)
    alpha_pos = {f: i for i, f in enumerate(alpha_sorted)}

    def effective_seq(f: str) -> int:
        s = get_page_sequence(os.path.join(dir_path, os.path.splitext(f)[0] + '.json'))
        if s == float('inf'):
            return (alpha_pos[f] + 1) * 100  # positsioonipõhine fallback
        return int(s)

    return sorted(images, key=lambda f: (effective_seq(f), f))


def reorder_pages(dir_path: str, new_order: list, username: str) -> dict:
    """Muudab lehekülgede järjekorda: omistab sequence väärtused new_order järgi.

    Args:
        dir_path: Teose kausta absoluutne tee
        new_order: Failinimede nimekiri soovitud järjekorras
        username: Kasutajanimi git commit'i jaoks

    Returns:
        {"status": "success"} või {"error": "..."}
    """
    folder_name = os.path.basename(dir_path)
    with work_lock(folder_name, dir_path):
        return _reorder_pages_unlocked(dir_path, new_order, username, folder_name)


def _reorder_pages_unlocked(dir_path: str, new_order: list, username: str, folder_name: str) -> dict:
    current_images = [
        f for f in os.listdir(dir_path)
        if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')
    ]

    # Valideeri: samad failid, sama arv
    if set(new_order) != set(current_images):
        return {"error": "Järjekorra nimekiri ei klapi teose failidega"}
    if len(new_order) != len(current_images):
        return {"error": "Järjekorra pikkus ei klapi"}

    changed_json_paths = []

    for i, img_name in enumerate(new_order):
        base = os.path.splitext(img_name)[0]
        json_path = os.path.join(dir_path, base + '.json')
        new_seq = (i + 1) * 100

        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                if 'meta_content' in d:
                    d['meta_content']['sequence'] = new_seq
                else:
                    d['sequence'] = new_seq
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(d, f, indent=2, ensure_ascii=False)
                os.chmod(json_path, 0o644)
            except Exception as e:
                return {"error": f"Viga faili {img_name} töötlemisel: {e}"}
        else:
            # Loo minimaalne JSON kui puudub
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump({'sequence': new_seq, 'status': 'Toores'}, f, indent=2)
            os.chmod(json_path, 0o644)

        changed_json_paths.append(json_path)

    # Git commit kõigi muudetud .json failidega korraga
    try:
        repo = get_or_init_repo()
        author = Actor(username, f"{username}@vutt.local")
        relative_paths = [os.path.relpath(p, BASE_DIR) for p in changed_json_paths]
        repo.index.add(relative_paths)
        commit_msg = f"Muuda lehekülgede järjekorda: {folder_name} [{username}]"
        repo.index.commit(commit_msg, author=author, committer=author)
        logger.info(f"Lehekülgede järjekord muudetud: {folder_name} ({len(new_order)} lehte)")
    except GitCommandError as e:
        logger.error(f"Git commit ebaõnnestus järjekorra muutmisel: {e}")
        return {"error": f"Git commit ebaõnnestus: {e}"}

    return {"status": "success"}


def rebalance_sequences(dir_path: str):
    """Nummerdab kõigi lehtede sequence väärtused ümber sammuga 100."""
    images = get_sorted_images(dir_path)
    for i, img_name in enumerate(images):
        base = os.path.splitext(img_name)[0]
        json_path = os.path.join(dir_path, base + '.json')
        new_seq = (i + 1) * 100
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                if 'meta_content' in d:
                    d['meta_content']['sequence'] = new_seq
                else:
                    d['sequence'] = new_seq
                with open(json_path, 'w', encoding='utf-8') as f:
                    json.dump(d, f, indent=2, ensure_ascii=False)
                os.chmod(json_path, 0o644)
            except Exception:
                pass
        else:
            with open(json_path, 'w', encoding='utf-8') as f:
                json.dump({'sequence': new_seq, 'status': 'Toores'}, f, indent=2)
            os.chmod(json_path, 0o644)


def split_text_at_pb(text: str) -> tuple:
    """Lõikab teksti esimese <pb/> tägi juures.
    Kui <pb/> puudub, tagastab mõlemale sama teksti.
    """
    if '<pb/>' in text:
        idx = text.index('<pb/>')
        return text[:idx].strip(), text[idx + 5:].strip()
    return text, text


def split_page(work_id: str, page_num: int, split_x: float, username: str) -> dict:
    """Lõikab topeltlehekülje kaheks vertikaalse lõikejoone alusel.

    Args:
        work_id: Teose ID
        page_num: Lehekülje number (1-indekseeritud)
        split_x: Lõikejoone asukoht (0.0–1.0), nt 0.47 = 47% laiusest
        username: Admin kasutajanimi git commitile

    Returns:
        {"success": True, "new_page_count": int} või {"found": False}

    Raises:
        ValueError: kui split_x on väljaspool [0.05, 0.95]
    """
    if not (0.05 <= split_x <= 0.95):
        raise ValueError(f"split_x peab olema vahemikus [0.05, 0.95], sain {split_x}")

    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}

    folder_name = os.path.basename(path)
    with work_lock(folder_name, path):
        images = get_sorted_images(path)
        if page_num < 1 or page_num > len(images):
            return {"found": False}

        orig_filename = images[page_num - 1]
        orig_base = os.path.splitext(orig_filename)[0]
        orig_img_path = os.path.join(path, orig_filename)
        orig_txt_path = os.path.join(path, orig_base + '.txt')
        orig_json_path = os.path.join(path, orig_base + '.json')

        # Loe originaali sequence
        orig_seq = get_page_sequence(orig_json_path)
        if orig_seq == float('inf'):
            orig_seq = page_num * 100
        orig_seq = int(orig_seq)

        # Loe originaali metaandmed (staatus jne)
        orig_meta = {'status': 'Toores'}
        if os.path.exists(orig_json_path):
            try:
                with open(orig_json_path, 'r', encoding='utf-8') as f:
                    orig_meta = json.load(f)
            except Exception:
                pass

        # Loe ja lõika tekst <pb/> juures
        orig_txt = ''
        if os.path.exists(orig_txt_path):
            with open(orig_txt_path, 'r', encoding='utf-8') as f:
                orig_txt = f.read()
        left_txt, right_txt = split_text_at_pb(orig_txt)

        # Lõika pilt Pillowiga
        try:
            from PIL import Image as PILImage, ImageOps
            with PILImage.open(orig_img_path) as raw:
                img = ImageOps.exif_transpose(raw)  # rakenda EXIF orientatsioon pikslitele
                width, height = img.size
                split_pixel = max(1, int(width * split_x))

                left_crop = img.crop((0, 0, split_pixel, height)).copy()
                right_crop = img.crop((split_pixel, 0, width, height)).copy()
        except ImportError:
            raise RuntimeError("Pillow pole paigaldatud")

        # Genereeri unikaalsed failinimed
        def _unique_name():
            nid = generate_nanoid()
            name = f"{folder_name}-{work_id}-{nid}.jpg"
            while os.path.exists(os.path.join(path, name)):
                nid = generate_nanoid()
                name = f"{folder_name}-{work_id}-{nid}.jpg"
            return name

        left_filename = _unique_name()
        right_filename = _unique_name()
        left_base = os.path.splitext(left_filename)[0]
        right_base = os.path.splitext(right_filename)[0]

        # Salvesta pildifailid kettale (ei ole git-tracked)
        left_img_path = os.path.join(path, left_filename)
        right_img_path = os.path.join(path, right_filename)
        left_crop.save(left_img_path, "JPEG", quality=95)
        right_crop.save(right_img_path, "JPEG", quality=95)
        os.chmod(left_img_path, 0o644)
        os.chmod(right_img_path, 0o644)

        # Koosta .json andmed mõlemale
        left_meta = {**orig_meta, 'sequence': orig_seq}
        right_meta = {**orig_meta, 'sequence': orig_seq + 50}

        left_txt_path = os.path.join(path, left_base + '.txt')
        left_json_path = os.path.join(path, left_base + '.json')
        right_txt_path = os.path.join(path, right_base + '.txt')
        right_json_path = os.path.join(path, right_base + '.json')

        # Kirjuta tekstifailid ja JSON-id kettale enne git commiti
        for fpath, content in [
            (left_txt_path, left_txt),
            (left_json_path, json.dumps(left_meta, indent=2, ensure_ascii=False)),
            (right_txt_path, right_txt),
            (right_json_path, json.dumps(right_meta, indent=2, ensure_ascii=False)),
        ]:
            with open(fpath, 'w', encoding='utf-8') as f:
                f.write(content)
            os.chmod(fpath, 0o644)

        # Git commit 1: lisa mõlemad uued lehed ühes commitinas
        save_with_git(
            left_txt_path, left_txt, username,
            message=f"Lõika leht {page_num} ({folder_name}): vasakpoolne [{work_id}]",
            additional_files=[
                (left_json_path, json.dumps(left_meta, indent=2, ensure_ascii=False)),
                (right_txt_path, right_txt),
                (right_json_path, json.dumps(right_meta, indent=2, ensure_ascii=False)),
            ]
        )

        # Liiguta originaali .jpg prügikasti (ei ole git-tracked)
        trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'pages')
        os.makedirs(trash_dir, exist_ok=True)
        if os.path.exists(orig_img_path):
            shutil.move(orig_img_path, os.path.join(trash_dir, orig_filename))

        # Git commit 2: eemalda originaali .txt ja .json
        delete_page_from_git(
            folder_name, orig_base,
            f"Lõika leht {page_num} ({folder_name}): eemalda originaal [{work_id}]",
            username
        )

        # Meilisearch sync
        sync_work_to_meilisearch(folder_name)

        new_page_count = len(get_sorted_images(path))
        return {"success": True, "new_page_count": new_page_count}


ANGLE_EPS = 1e-4   # alla selle nurka käsitleme nullina (float-müra slidersist)
MIN_CROP_PX = 8    # minimaalne kärpe-mõõde pärast klampimist


def _compute_crop_box(crop, w: int, h: int):
    """Teisendab normaliseeritud kärpe (0–1) klampitud pikslikastiks (left,top,right,bottom).

    Tagastab None kui crop puudub. Raise ValueError kui pärast klampimist liiga väike.
    """
    if crop is None:
        return None
    for k in ("x", "y", "w", "h"):
        if k not in crop:
            raise ValueError(f"crop väli '{k}' puudub")
        if not (0.0 <= float(crop[k]) <= 1.0):
            raise ValueError(f"crop '{k}' peab olema vahemikus [0,1]")
    if float(crop["w"]) <= 0 or float(crop["h"]) <= 0:
        raise ValueError("crop w,h peavad olema > 0")

    left = max(0, min(w, int(round(float(crop["x"]) * w))))
    top = max(0, min(h, int(round(float(crop["y"]) * h))))
    right = max(0, min(w, int(round((float(crop["x"]) + float(crop["w"])) * w))))
    bottom = max(0, min(h, int(round((float(crop["y"]) + float(crop["h"])) * h))))

    if (right - left) < MIN_CROP_PX or (bottom - top) < MIN_CROP_PX:
        raise ValueError("kärbe on pärast klampimist liiga väike")
    return (left, top, right, bottom)


def transform_page_image(work_id, filename, angle=0.0, crop=None, username="admin"):
    """Pöörab ja/või kärbib lehepilti kohapeal (failinimi/tekst/JSON/sequence säilivad).

    Varundab ENNE ülekirjutust (trash + esmane ._originals), kasutab atomaarset os.replace'i.
    Tagastab no-op / changed / found:False sõnastiku; raise ValueError vigaste parameetrite korral.
    """
    angle = float(angle)

    # No-op kaitse (float-tolerantsiga)
    if abs(angle) < ANGLE_EPS and crop is None:
        return {"success": True, "changed": False, "reason": "no_transform"}

    # Path-traversal kaitse
    if os.path.basename(filename) != filename or "/" in filename or "\\" in filename:
        raise ValueError("vigane failinimi")

    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}

    folder_name = os.path.basename(path)
    with work_lock(folder_name, path):
        if filename not in get_sorted_images(path):
            return {"found": False}

        img_path = os.path.join(path, filename)
        base, ext = os.path.splitext(filename)
        ext_l = ext.lower()

        # 1) Varunda ENNE muutmist — trash
        trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'replaced_images')
        os.makedirs(trash_dir, exist_ok=True)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        shutil.copy2(img_path, os.path.join(trash_dir, f"{base}_{timestamp}{ext}"))

        # 2) Pristine originaal — ainult esimesel korral
        orig_dir = os.path.join(BASE_DIR, '._originals', work_id)
        os.makedirs(orig_dir, exist_ok=True)
        orig_backup = os.path.join(orig_dir, filename)
        if not os.path.exists(orig_backup):
            shutil.copy2(img_path, orig_backup)  # enne exif_transpose'i → 100% muutumatu

        # 3) Teisendus Pillow'ga
        from PIL import Image as PILImage, ImageOps
        with PILImage.open(img_path) as raw:
            img = ImageOps.exif_transpose(raw)
            is_jpeg = ext_l in ('.jpg', '.jpeg')
            if is_jpeg and img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            if abs(angle) >= ANGLE_EPS:
                # CSS positiivne = päripäeva → Pillow vastupäeva → -angle
                fill = (255, 255, 255) if img.mode == 'RGB' else 255
                img = img.rotate(-angle, expand=True, fillcolor=fill)
            box = _compute_crop_box(crop, img.width, img.height)
            if box is not None:
                img = img.crop(box)
            out_w, out_h = img.size

            # 4) Salvesta tmp-faili SAMAS kaustas (EXDEV kaitse), siis atomaarne replace
            tmp_path = img_path + '.tmp'
            if is_jpeg:
                img.save(tmp_path, "JPEG", quality=95)
            else:
                img.save(tmp_path, "PNG")
        os.replace(tmp_path, img_path)
        os.chmod(img_path, 0o644)

        # 5) Regenereeri thumbnail — vea korral ei rollback'i
        thumbnail_warning = False
        try:
            from .image_server import generate_thumbnail
            thumbs_dir = os.path.join(path, '_thumbs')
            os.makedirs(thumbs_dir, exist_ok=True)
            thumb_path = os.path.join(thumbs_dir, f"_thumb_{filename}")
            if os.path.exists(thumb_path):
                os.remove(thumb_path)
            generate_thumbnail(img_path, thumb_path)
        except Exception as e:
            logger.error(f"TRANSFORM: thumbnaili regen ebaõnnestus {filename}: {e}")
            thumbnail_warning = True

        # 6) Logi (struktureeritud). NB: Meilit EI sünki — failinimi/tekst/sequence ei muutu.
        log_path = os.path.join(BASE_DIR, 'transform_image.log')
        with open(log_path, 'a', encoding='utf-8') as lf:
            lf.write(
                f"{datetime.now().isoformat()} | {username} | {work_id} | {filename} | "
                f"angle={angle} crop={crop} | -> {out_w}x{out_h}\n"
            )

        logger.info(f"TRANSFORM: {folder_name}/{filename} ({username})")
        return {
            "success": True, "changed": True, "filename": filename,
            "size": [out_w, out_h], "thumbnail_warning": thumbnail_warning,
        }


def clear_original_backup(work_id, filename):
    """Kustutab pristine originaali (._originals) — kutsub replace-image, sest asendatud
    pilt on lehe uus algolek (vt spec: replace-image ↔ originals loogikaauk)."""
    if os.path.basename(filename) != filename or "/" in filename or "\\" in filename:
        return
    orig_backup = os.path.join(BASE_DIR, '._originals', work_id, filename)
    if os.path.exists(orig_backup):
        os.remove(orig_backup)


def write_new_page(work_dir, staging_dir, folder_name, work_id, content, ext, seq):
    """Kirjutab uue lehe pildi + tühja .txt + minimaalse .json kausta staging_dir.

    Nimekollisiooni kontroll käib nii work_dir kui staging_dir suhtes. EI committi.
    """
    new_id = generate_nanoid()
    filename = f"{folder_name}-{work_id}-{new_id}{ext}"
    while os.path.exists(os.path.join(work_dir, filename)) or \
            os.path.exists(os.path.join(staging_dir, filename)):
        new_id = generate_nanoid()
        filename = f"{folder_name}-{work_id}-{new_id}{ext}"

    base = os.path.splitext(filename)[0]
    img_path = os.path.join(staging_dir, filename)
    txt_path = os.path.join(staging_dir, base + '.txt')
    json_path = os.path.join(staging_dir, base + '.json')
    page_meta = {'sequence': seq, 'status': 'Toores'}
    json_str = json.dumps(page_meta, indent=2, ensure_ascii=False)

    with open(img_path, 'wb') as f:
        f.write(content)
    os.chmod(img_path, 0o644)
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write('')
    os.chmod(txt_path, 0o644)
    with open(json_path, 'w', encoding='utf-8') as f:
        f.write(json_str)
    os.chmod(json_path, 0o644)

    return {
        "filename": filename, "base": base,
        "img_path": img_path, "txt_path": txt_path, "json_path": json_path,
        "json_str": json_str, "page_meta": dict(page_meta),
    }


def allocate_sequences(existing_seqs: list, after_page_num: int, n: int) -> dict:
    """Jaotab n uut sequence-väärtust valitud positsioonile.

    Sisestus:
        existing_seqs: olemasolevate lehtede sequence'id sorteeritud järjekorras (M tk).
        after_page_num: -1=lõppu, 0=algusesse, 1..M=selle lehe järele.
        n: kui palju uusi lehti lisa.

    Väljund:
        {"new_seqs": [n], "renumber": None|[M]}.
        new_seqs: uute lehtede rangelt kasvavad sequence'id.
        renumber: kui pesa mahutab, None. Kui ei mahuta,
                  olemasolevate lehtede uued sequence'id ühendatud järjestuses.
    """
    m = len(existing_seqs)
    # Sisestuspunkt P = mitu olemasolevat lehte jääb ette
    p = m if after_page_num == -1 else after_page_num

    def renumber_all():
        """Ühendatud järjestus: ette p olemasolevat, siis n uut, siis ülejäänud."""
        existing_new = [(i + 1) * 100 if i < p else (i + 1 + n) * 100
                        for i in range(m)]
        new_seqs = [(p + k) * 100 for k in range(1, n + 1)]
        return {"new_seqs": new_seqs, "renumber": existing_new}

    # Lõppu või tühja teosesse
    if p >= m:
        seq_before = existing_seqs[-1] if m else 0
        return {"new_seqs": [seq_before + 100 * k for k in range(1, n + 1)],
                "renumber": None}

    # Algusesse
    if p == 0:
        seq_after = existing_seqs[0]
        gap = seq_after  # alumine piir 0 (eksklusiivne)
        if gap > n:
            return {"new_seqs": [gap * k // (n + 1) for k in range(1, n + 1)],
                    "renumber": None}
        return renumber_all()

    # Vahele
    seq_before = existing_seqs[p - 1]
    seq_after = existing_seqs[p]
    gap = seq_after - seq_before
    if gap > n:
        return {"new_seqs": [seq_before + gap * k // (n + 1) for k in range(1, n + 1)],
                "renumber": None}
    return renumber_all()


# --- Bulk-lehe lisamise limiidid ---
MAX_FILES_PER_REQUEST = 20
MAX_REQUEST_BYTES = 200 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024


def add_pages(work_id, files, after_page_num, username):
    """Lisab mitu pildifaili teosele valitud positsioonile (nimejärgi sorteeritud).

    files: list of (filename, bytes). Tagastab dict (vt Interfaces). Viskab
    ValueError valideerimisvigade korral; found=False kui teost pole.

    Atomaarsus: üks väljakutse = ÜKS git-commit (kõik uued lehed + ümbernummerdatud
    olemasolevad). Osalise vea korral (mõni fail kirjutatud, siis viga) teeb
    `_cleanup_bulk` täieliku tagasipööramise. NB: frontend tükeldab suured partiid
    (>MAX_FILES_PER_REQUEST / >MAX_REQUEST_BYTES) mitmeks päringuks — iga tükk on
    eraldi commit, seega tükkide-ülest atomaarsust EI ole (vahepealse tüki viga jätab
    varasemad tükid sisse). Vt WorkManage.tsx handleAddPage.
    """
    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}
    folder_name = os.path.basename(path)

    # --- Limiidi-kontroll (enne luku võtmist) ---
    if not files:
        raise ValueError("Faile pole")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise ValueError(f"Liiga palju faile (max {MAX_FILES_PER_REQUEST})")
    total = 0
    for name, content in files:
        if len(content) > MAX_SINGLE_FILE_BYTES:
            raise ValueError(f"Fail liiga suur: {name}")
        total += len(content)
    if total > MAX_REQUEST_BYTES:
        raise ValueError("Partii kogumaht liiga suur")

    # --- Valideeri + teisenda KÕIK enne kirjutamist (enne luku võtmist) ---
    converted = []  # (orig_name, jpeg_bytes, ext)
    for name, content in files:
        jpeg, ext = detect_and_convert_image(content, name)   # ValueError → katki
        converted.append((name, jpeg, ext))

    # --- Sorteeri nimejärgi (backend autoriteetne) ---
    converted.sort(key=lambda t: natural_sort_key(t[0]))
    n = len(converted)

    with work_lock(folder_name, path):
        # --- Vahemikukontroll (lukus — sequence loeb värsket olekut) ---
        images = get_sorted_images(path)
        page_count = len(images)
        if not (after_page_num == -1 or 0 <= after_page_num <= page_count):
            raise ValueError(f"Vigane positsioon: {after_page_num}")

        # --- Jaota sequence'id ---
        existing_seqs = []
        for i, im in enumerate(images):
            jp = os.path.join(path, os.path.splitext(im)[0] + '.json')
            s = get_page_sequence(jp)
            if s == float('inf'):
                existing_seqs.append((i + 1) * 100)
            else:
                existing_seqs.append(int(s))
        alloc = allocate_sequences(existing_seqs, after_page_num, n)
        new_seqs = alloc["new_seqs"]
        renumber = alloc["renumber"]

        # --- Temp-staging ---
        staging = os.path.join(path, f".tmp-bulk-{uuid.uuid4().hex[:8]}")
        os.makedirs(staging, exist_ok=True)
        written_pages = []        # write_new_page dictid (staging-teedega)
        moved_final = []          # lõppasukohta liigutatud teed (cleanup jaoks)
        json_backups = {}         # olemasoleva json_path -> originaalsisu (restore jaoks)

        try:
            # Kirjuta uued lehed staging-kausta
            for (name, jpeg, ext), seq in zip(converted, new_seqs):
                page = write_new_page(path, staging, folder_name, work_id, jpeg, ext, seq)
                written_pages.append(page)

            # Liiguta uued failid (img+txt+json) lõppasukohta (os.replace = atomaarne/FS)
            for page in written_pages:
                for src in (page["img_path"], page["txt_path"], page["json_path"]):
                    dst = os.path.join(path, os.path.basename(src))
                    os.replace(src, dst)
                    moved_final.append(dst)

            # Renumberdamisel: uuenda olemasolevate lehtede json sequence (säilita ülejäänu)
            renumber_files = []   # (json_path, new_content) save_with_git jaoks
            if renumber is not None:
                for im, new_seq in zip(images, renumber):
                    jp = os.path.join(path, os.path.splitext(im)[0] + '.json')
                    orig = ''
                    d = {}
                    if os.path.exists(jp):
                        with open(jp, 'r', encoding='utf-8') as f:
                            orig = f.read()
                        try:
                            d = json.loads(orig)
                        except Exception:
                            d = {}
                    json_backups[jp] = orig
                    if 'meta_content' in d:
                        d['meta_content']['sequence'] = new_seq
                    else:
                        d['sequence'] = new_seq
                    new_content = json.dumps(d, indent=2, ensure_ascii=False)
                    with open(jp, 'w', encoding='utf-8') as f:
                        f.write(new_content)
                    renumber_files.append((jp, new_content))

            # --- ÜKS git-commit ---
            # primary = esimese uue lehe .txt; additional = ülejäänud txt + kõik json
            first = written_pages[0]
            first_txt_final = os.path.join(path, first["base"] + '.txt')
            additional = []
            for page in written_pages:
                base = page["base"]
                if page is not first:
                    additional.append((os.path.join(path, base + '.txt'), ''))
                additional.append((os.path.join(path, base + '.json'), page["json_str"]))
            additional.extend(renumber_files)

            res = save_with_git(
                first_txt_final, '', username,
                message=f"Lisa {n} lehte: {folder_name} [after={after_page_num}]",
                additional_files=additional,
            )
            if not res.get("success"):
                raise RuntimeError(f"Git commit ebaõnnestus: {res.get('error')}")
        except Exception:
            _cleanup_bulk(staging, moved_final, json_backups)
            raise
        finally:
            # Eemalda staging-kaust igal juhul (kui veel alles)
            if os.path.isdir(staging):
                try:
                    shutil.rmtree(staging, ignore_errors=True)
                except Exception:
                    logger.critical(f"Bulk staging cleanup ebaõnnestus: {staging}")

        # --- Meili sync (viga ei tühista juba salvestatut) ---
        meili_warning = None
        try:
            sync_work_to_meilisearch(folder_name)
        except Exception as e:
            meili_warning = str(e)
            logger.error(f"add_pages meili sync ebaõnnestus ({folder_name}): {e}")

        inserted = [{"filename": p["filename"], "sequence": s}
                    for p, s in zip(written_pages, new_seqs)]
        return {
            "found": True,
            "new_page_count": len(get_sorted_images(path)),
            "inserted": inserted,
            "meili_warning": meili_warning,
        }


def _cleanup_bulk(staging, moved_final, json_backups):
    """Robustne cleanup: kustuta staging + lõppasukohta liigutatud uued failid,
    taasta olemasolevad .json-id. Cleanup-viga logitakse critical-ina."""
    try:
        if os.path.isdir(staging):
            shutil.rmtree(staging, ignore_errors=True)
    except Exception:
        logger.critical(f"Bulk cleanup: staging eemaldamine ebaõnnestus: {staging}")
    for dst in moved_final:
        try:
            if os.path.exists(dst):
                os.remove(dst)
        except Exception:
            logger.critical(f"Bulk cleanup: uue faili eemaldamine ebaõnnestus: {dst}")
    for jp, orig in json_backups.items():
        try:
            with open(jp, 'w', encoding='utf-8') as f:
                f.write(orig)
        except Exception:
            logger.critical(f"Bulk cleanup: json taastamine ebaõnnestus: {jp}")


def delete_pages(work_id, base_names, username):
    """Kustutab mitu lehekülge korraga (kõik-või-mitte-midagi).

    Lahendab base_names'id praeguste failide vastu; kui osa puudub → conflict,
    midagi ei kustutata. Liigutab pildid prügikasti, kutsub batch git-kustutuse
    ühe commitiga ja ühe Meilisearch-sünki. Git-tõrkel taastab pildid (rollback).
    """
    path = find_directory_by_id(work_id)
    if not path:
        return {"status": "not_found", "missing": list(base_names)}
    folder_name = os.path.basename(path)

    with work_lock(folder_name, path):
        images = get_sorted_images(path)
        # base_name → tegelik pildifaili nimi (säilitab laiendi)
        by_base = {os.path.splitext(img)[0]: img for img in images}

        missing = [b for b in base_names if b not in by_base]
        if len(missing) == len(base_names):
            return {"status": "not_found", "missing": missing}
        if missing:
            return {"status": "conflict", "missing": missing}

        trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'pages')
        os.makedirs(trash_dir, exist_ok=True)

        # Logi enne mutatsiooni (käsitsi taastamiseks kui protsess krahhib)
        logger.info(f"delete_pages: {folder_name} kustutab {base_names}")

        moved = []  # (orig_path, trash_path) rollbackiks
        for base in base_names:
            img_name = by_base[base]
            src = os.path.join(path, img_name)
            dst = os.path.join(trash_dir, img_name)
            if os.path.exists(src):
                shutil.move(src, dst)
                moved.append((src, dst))

        try:
            commit_msg = f"Kustuta {len(base_names)} lehte: {folder_name} [{work_id}]"
            delete_pages_from_git(folder_name, base_names, commit_msg, username=username)
        except Exception:
            # Rollback: pildid prügikastist tagasi
            for src, dst in moved:
                if os.path.exists(dst):
                    shutil.move(dst, src)
            raise

        sync_work_to_meilisearch(folder_name)
        new_page_count = len(get_sorted_images(path))
        return {"status": "success", "deleted": list(base_names), "new_page_count": new_page_count}
