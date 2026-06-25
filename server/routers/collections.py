import json
import os
import re

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from git import Actor

from ..auth import delete_user_sessions, load_users, save_users
from ..cache import get_cached_archives, get_cached_collections
from ..cache_invalidation import invalidate_all_caches as _invalidate_all_caches
from ..config import ARCHIVES_FILE, BASE_DIR, COLLECTIONS_FILE, get_logger
from ..deps import get_json_data, require_role
from ..git_ops import get_or_init_repo
from ..meilisearch_ops import sync_work_to_meilisearch_async, update_collection_is_public_async
from ..utils import atomic_write_json, find_directory_by_id, metadata_lock

logger = get_logger(__name__)
router = APIRouter()


@router.get("/collections")
async def collections(): return {"status": "success", "collections": get_cached_collections()}

@router.get("/config/archives")
async def get_archives(): return {"status": "success", "archives": get_cached_archives()}

@router.post("/config/archives")
async def create_archive(request: Request, user=Depends(require_role("admin"))):
    body = await get_json_data(request)
    archive_id = str(body.get("id") or "").strip()
    name = str(body.get("name") or "").strip()
    url = str(body.get("url") or "").strip()
    if not archive_id or not name:
        raise HTTPException(status_code=400, detail="Lühend ja nimi on kohustuslikud")
    archives = {}
    if os.path.exists(ARCHIVES_FILE):
        with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
            archives = json.load(f)
    if archive_id in archives:
        raise HTTPException(status_code=409, detail=f"Arhiiv tähisega '{archive_id}' on juba olemas")
    entry: dict = {"name": name}
    if url:
        entry["url"] = url
    archives[archive_id] = entry
    atomic_write_json(ARCHIVES_FILE, archives)
    _invalidate_all_caches()
    return {"status": "success", "id": archive_id, "archive": entry}

@router.put("/config/archives/{archive_id}")
async def update_archive(archive_id: str, request: Request, user=Depends(require_role("admin"))):
    body = await get_json_data(request)
    name = str(body.get("name") or "").strip()
    url = str(body.get("url") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nimi on kohustuslik")
    archives = {}
    if os.path.exists(ARCHIVES_FILE):
        with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
            archives = json.load(f)
    if archive_id not in archives:
        raise HTTPException(status_code=404, detail=f"Arhiivi '{archive_id}' ei leitud")
    entry: dict = {"name": name}
    if url:
        entry["url"] = url
    archives[archive_id] = entry
    atomic_write_json(ARCHIVES_FILE, archives)
    _invalidate_all_caches()
    return {"status": "success", "id": archive_id, "archive": entry}

@router.delete("/config/archives/{archive_id}")
async def delete_archive(archive_id: str, force: bool = False, user=Depends(require_role("admin"))):
    archives = {}
    if os.path.exists(ARCHIVES_FILE):
        with open(ARCHIVES_FILE, 'r', encoding='utf-8') as f:
            archives = json.load(f)
    if archive_id not in archives:
        raise HTTPException(status_code=404, detail=f"Arhiivi '{archive_id}' ei leitud")
    if not force:
        in_use = _find_works_with_archive(archive_id)
        if in_use:
            work_titles = [meta.get('title', 'Pealkirjata') for _, meta in in_use[:3]]
            extra = f" ja {len(in_use) - 3} rohkem" if len(in_use) > 3 else ""
            raise HTTPException(
                status_code=409,
                detail=f"Arhiiv '{archive_id}' on kasutusel {len(in_use)} teoses: {', '.join(work_titles)}{extra}",
            )
    del archives[archive_id]
    atomic_write_json(ARCHIVES_FILE, archives)
    _invalidate_all_caches()
    return {"status": "success"}

@router.put("/admin/collections/{collection_id}")
async def admin_update_collection(collection_id: str, request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Uuendab kollektsiooni description, description_long, color ja visibility välju."""
    body = await request.json()
    description = body.get("description")      # { et, en }
    description_long = body.get("description_long")  # { et, en }
    color = body.get("color")  # string või None

    # Loe olemaolev fail
    if not os.path.exists(COLLECTIONS_FILE):
        return {"status": "error", "message": "collections.json ei leitud"}
    with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if collection_id not in data:
        return {"status": "error", "message": f"Kollektsioon '{collection_id}' ei leitud"}

    # Uuenda description, description_long ja color väljad (mitte nimi, hierarhia)
    if description is not None:
        if description.get("et") or description.get("en"):
            data[collection_id]["description"] = {
                "et": description.get("et", ""),
                "en": description.get("en", ""),
            }
        elif "description" in data[collection_id]:
            del data[collection_id]["description"]

    if description_long is not None:
        if description_long.get("et") or description_long.get("en"):
            data[collection_id]["description_long"] = {
                "et": description_long.get("et", ""),
                "en": description_long.get("en", ""),
            }
        elif "description_long" in data[collection_id]:
            del data[collection_id]["description_long"]

    if color is not None:
        if color.strip():
            data[collection_id]["color"] = color.strip()
        elif "color" in data[collection_id]:
            del data[collection_id]["color"]

    # Nähtavus
    visibility = body.get("visibility")
    old_visibility = data[collection_id].get("visibility", "public")
    if visibility in ("public", "restricted"):
        data[collection_id]["visibility"] = visibility
    elif visibility is not None:
        return {"status": "error", "message": "visibility peab olema 'public' või 'restricted'"}

    # Kirjuta tagasi
    atomic_write_json(COLLECTIONS_FILE, data)

    # Invalideerib cache → järgmine /collections päring laeb uued andmed
    _invalidate_all_caches()

    # Kui visibility muutus, uuenda Meilisearchis is_public asünkroonselt
    new_visibility = data[collection_id].get("visibility", "public")
    if visibility and old_visibility != new_visibility:
        background_tasks.add_task(update_collection_is_public_async, collection_id, new_visibility == "public")

    # allowed_collections: kasutajate ligipääsu haldus kollektsiooni tasandil
    allowed_users_param = body.get("allowed_users")
    if allowed_users_param is not None:
        users_data = load_users()
        changed_users = []
        for username, udata in users_data.items():
            current = set(udata.get("allowed_collections", []))
            updated = set(current)
            if username in allowed_users_param:
                updated.add(collection_id)
            else:
                updated.discard(collection_id)
            if updated != current:
                changed_users.append(username)
            users_data[username]["allowed_collections"] = list(updated)
        save_users(users_data)
        # Invalideeri muutunud kasutajate sessioonid, et uus ligipääs jõustuks kohe (Leid I)
        for username in changed_users:
            delete_user_sessions(username)

    return {"status": "success"}

@router.get("/admin/collections/{collection_id}/users")
async def admin_collection_users(collection_id: str, user=Depends(require_role("admin"))):
    """Tagastab kollektsiooni metaandmed koos ligipääsuga kasutajate nimekirjaga."""
    if not os.path.exists(COLLECTIONS_FILE):
        return {"status": "error", "message": "collections.json ei leitud"}
    with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if collection_id not in data:
        return {"status": "error", "message": f"Kollektsioon '{collection_id}' ei leitud"}
    col = data[collection_id]
    users_data = load_users()
    allowed_usernames = [
        uname for uname, udata in users_data.items()
        if collection_id in udata.get("allowed_collections", [])
    ]
    return {
        "status": "success",
        "collection": col,
        "allowed_users": allowed_usernames,
    }

@router.post("/admin/collections")
async def admin_create_collection(request: Request, user=Depends(require_role("admin"))):
    """Loob uue kollektsiooni. Body: {id, name_et, name_en, parent?, color?, is_virtual?}"""
    body = await request.json()
    collection_id = body.get("id", "").strip()
    name_et = body.get("name_et", "").strip()
    name_en = body.get("name_en", "").strip()
    parent = (body.get("parent") or "").strip() or None
    color = (body.get("color") or "").strip() or None
    is_virtual = bool(body.get("is_virtual", False))

    if not collection_id or not re.match(r'^[a-z0-9-]+$', collection_id):
        return {"status": "error", "message": "ID peab koosnema ainult väiketähtedest, numbritest ja sidekriipsudest"}
    if not name_et:
        return {"status": "error", "message": "Eestikeelne nimi on kohustuslik"}

    if not os.path.exists(COLLECTIONS_FILE):
        return {"status": "error", "message": "collections.json ei leitud"}
    with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if collection_id in data:
        return {"status": "error", "message": f"ID '{collection_id}' on juba kasutusel"}
    if parent and parent not in data:
        return {"status": "error", "message": f"Vanemkollektsioon '{parent}' ei leitud"}

    new_col: dict = {"name": {"et": name_et, "en": name_en or name_et}}
    if parent:
        new_col["parent"] = parent
    if color:
        new_col["color"] = color
    if is_virtual:
        new_col["type"] = "virtual_group"

    data[collection_id] = new_col

    atomic_write_json(COLLECTIONS_FILE, data)

    _invalidate_all_caches()
    return {"status": "success"}

def _cleanup_allowed_collections_on_delete(collection_id: str):
    """Eemaldab kustutatud kollektsiooni ID kõigi kasutajate allowed_collections'ist."""
    users_data = load_users()
    changed = False
    for uname, udata in users_data.items():
        current = udata.get("allowed_collections", [])
        if collection_id in current:
            users_data[uname]["allowed_collections"] = [c for c in current if c != collection_id]
            changed = True
    if changed:
        save_users(users_data)


def _find_works_with_collection(collection_id: str):
    """Leiab kõik teoste _metadata.json failid mis sisaldavad antud kollektsiooni ID-d."""
    results = []
    if not os.path.isdir(BASE_DIR):
        return results
    for folder in os.listdir(BASE_DIR):
        meta_path = os.path.join(BASE_DIR, folder, '_metadata.json')
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            if collection_id in meta.get('collections', []):
                results.append((meta_path, meta))
        except Exception:
            continue
    return results

def _find_works_with_archive(archive_id: str):
    """Leiab kõik teoste _metadata.json failid mis sisaldavad antud arhiivi ID-d."""
    results = []
    if not os.path.isdir(BASE_DIR):
        return results
    for folder in os.listdir(BASE_DIR):
        meta_path = os.path.join(BASE_DIR, folder, '_metadata.json')
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
            refs = meta.get('archive_refs') or []
            if any(isinstance(ref, dict) and ref.get('archive_id') == archive_id for ref in refs):
                results.append((meta_path, meta))
        except Exception:
            continue
    return results

@router.get("/admin/collections/{collection_id}/works-count")
def admin_collection_works_count(collection_id: str, user=Depends(require_role("admin"))):
    """Tagastab mitu teost on antud kollektsioonis.

    Tavaline (mitte-async) endpoint: FastAPI jooksutab selle threadpoolis, nii et
    _find_works_with_collection sync faililugemine ei blokeeri event loopi
    (vt docs/koodi_ulevaade_2026-06-24_gemini_soovitused.md Leid 4).
    """
    count = len(_find_works_with_collection(collection_id))
    return {"status": "success", "count": count}

@router.delete("/admin/collections/{collection_id}")
async def admin_delete_collection(collection_id: str, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Kustutab kollektsiooni ja eemaldab selle ID kõigi teoste metaandmetest. Keeldub kui on alamkollektsioone."""
    if not os.path.exists(COLLECTIONS_FILE):
        return {"status": "error", "message": "collections.json ei leitud"}
    with open(COLLECTIONS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    if collection_id not in data:
        return {"status": "error", "message": f"Kollektsioon '{collection_id}' ei leitud"}

    children = [k for k, v in data.items() if v.get("parent") == collection_id]
    if children:
        return {"status": "error", "message": f"Kollektsioonil on alamkollektsioonid ({', '.join(children)}). Kustuta need esmalt."}

    # Leia ja uuenda kõik mõjutatud teosed
    affected = _find_works_with_collection(collection_id)
    affected_work_ids = []

    if affected:
        repo = get_or_init_repo()
        files_to_add = []

        with metadata_lock:
            for meta_path, meta in affected:
                meta['collections'] = [c for c in meta.get('collections', []) if c != collection_id]
                new_content = json.dumps(meta, ensure_ascii=False, indent=2)
                with open(meta_path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                os.chmod(meta_path, 0o644)
                files_to_add.append(os.path.relpath(meta_path, BASE_DIR))
                if meta.get('id'):
                    affected_work_ids.append(meta['id'])

        # Üks git commit kõigi muudatuste kohta
        try:
            col_name = data[collection_id].get('name', {}).get('et', collection_id)
            author = Actor(user['username'], f"{user['username']}@vutt.local")
            repo.index.add(files_to_add)
            repo.index.commit(
                f"Kustuta kollektsioon '{col_name}': eemaldatud {len(affected)} teosest",
                author=author,
                committer=author
            )
        except Exception as e:
            logger.error(f"Git commit ebaõnnestus kollektsiooni kustutamisel: {e}")

        # Async Meilisearch sync mõjutatud teostele
        for work_id in affected_work_ids:
            path = find_directory_by_id(work_id)
            if path:
                background_tasks.add_task(sync_work_to_meilisearch_async, os.path.basename(path))

    # Kustuta kollektsioonist
    del data[collection_id]
    _cleanup_allowed_collections_on_delete(collection_id)
    atomic_write_json(COLLECTIONS_FILE, data)

    _invalidate_all_caches()
    return {"status": "success", "affected_works": len(affected)}


