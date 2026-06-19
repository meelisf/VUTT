"""Lehekülgede järjestuse ja halduse utiliidid (admin).

Eraldatud main.py-st parema testitavuse ja hallatavuse jaoks.
"""

import os
import json
import shutil
from datetime import datetime
from git import Actor
from git.exc import GitCommandError
from .config import BASE_DIR, get_logger
from .git_ops import get_or_init_repo, save_with_git, delete_page_from_git
from .utils import find_directory_by_id, generate_nanoid
from .meilisearch_ops import sync_work_to_meilisearch

logger = get_logger(__name__)


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
        folder_name = os.path.basename(dir_path)
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

    logger.info(f"TRANSFORM: {os.path.basename(path)}/{filename} ({username})")
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
