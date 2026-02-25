"""Lehekülgede järjestuse ja halduse utiliidid (admin).

Eraldatud main.py-st parema testitavuse ja hallatavuse jaoks.
"""

import os
import json
from git import Actor
from git.exc import GitCommandError
from .config import BASE_DIR, get_logger
from .git_ops import get_or_init_repo

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
