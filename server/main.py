import os
import json
import threading
import unicodedata
import uuid
import re
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse, StreamingResponse, Response
from starlette.concurrency import run_in_threadpool

from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, COLLECTIONS_FILE, get_logger, ARCHIVES_FILE
from .utils import build_work_id_cache, find_directory_by_id, metadata_lock, generate_nanoid, atomic_write_json
from .access_ops import can_read_work, can_write_work, is_work_public

logger = get_logger(__name__)
from .meilisearch_ops import metadata_watcher_loop, _keepwarm_loop, sync_work_to_meilisearch_async, _ensure_filterable_attributes, update_collection_is_public_async
from .metadata_handler import build_meta_html, build_person_meta_html, build_persons_meta_html, build_sitemap_xml
from .people_ops import process_person_fields_metadata
from .entity_labels_ops import enrich_entity_labels_async, enrich_entity_labels_async_qcodes
from .git_ops import run_git_fsck, save_with_git, get_recent_commits, get_file_git_history, get_file_at_commit, get_commit_diff, get_or_init_repo
from .auth import delete_user_sessions, load_users, save_users
from .rate_limit import get_client_ip, check_rate_limit
# NB: upload/re-OCR endpointid + nende ops-importid elavad nüüd routerites
# (server/routers/upload.py, reocr.py). Paketi-tasandi re-eksport käib
# server/__init__.py kaudu otse ops-moodulitest, seega main.py ei impordi neid.
from .cache import (
    get_cached_collections, get_cached_suggestions, invalidate_cache,
    get_cached_archives,
)
# get_sorted_images on jätkuvalt kasutusel download endpointides; lehekülgede
# halduse endpointid + nende ops-importid elavad nüüd server/routers/pages.py-s.
from .admin_page_ops import get_sorted_images
from .prosopography.router import router as prosopography_router
from .routers.notifications import router as notifications_router
from .routers.upload import router as upload_router
from .routers.reocr import router as reocr_router
from .routers.pages import router as pages_router
from .routers.auth import router as auth_router
from .routers.admin import router as admin_router
from .routers.user_settings import router as user_settings_router
from .routers.public_registries import router as public_registries_router
from .prosopography.ops import update_page_person_mentions, rebuild_indices, _load_index
from .metadata_ops import save_work_metadata, bulk_update_field, ALLOWED_METADATA_FIELDS
from .marginalia_normalize import normalize_marginalia_tags

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"VUTT FastAPI käivitus.")
    from .prosopography.places_ops import validate_places_config
    try:
        validate_places_config()
        logger.info("places.json + origin_groups.json valideeritud")
    except ValueError as e:
        logger.error("places.json konfiguratsiooniviga: %s", e)
        raise SystemExit(1)
    build_work_id_cache()
    run_git_fsck()
    threading.Thread(target=rebuild_indices, daemon=True).start()
    threading.Thread(target=metadata_watcher_loop, daemon=True).start()
    threading.Thread(target=_keepwarm_loop, daemon=True).start()
    threading.Thread(target=_ensure_filterable_attributes, daemon=True).start()
    yield
    print("VUTT FastAPI sulgemine.")

app = FastAPI(title="VUTT API", version="1.0.0", lifespan=lifespan)
app.include_router(prosopography_router, prefix="/prosopography")
app.include_router(notifications_router)
app.include_router(upload_router)
app.include_router(reocr_router)
app.include_router(pages_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(user_settings_router)
app.include_router(public_registries_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================================================
# AUTENTIMISE DEPENDENCY
# =========================================================

# =========================================================
# AUTENTIMISE DEPENDENCY (ühine — server/deps.py)
# =========================================================
# Refaktoreeringu Faas 0: funktsioonid on tõstetud server/deps.py-sse, et
# luua üks tõene allikas kõigile domeeni-routeritele (vt
# docs/REFACTOR_main_py_2026-06-25.md). Siin jäetakse backward-compat
# re-eksport, sest osa main.py endpointe ja teste viitab neile nimedele.
from .deps import get_user, require_role, get_json_data
from .deps import optional_user as _get_optional_user

# Teose _metadata.json lugemine (ühine — server/work_meta.py). Kasutatakse
# viewer-token, shareable, download, SEO meta ja collections ligipääsukontrollis.
from .work_meta import load_work_metadata as _load_work_metadata
from .work_meta import read_work_meta_direct_sync as _read_work_meta_direct_sync

# =========================================================
# TOIMETAMINE JA SALVESTAMINE
# =========================================================

@app.post("/save")
# NB: contributor roll on reserveeritud tulevaste pending-edits funktsioonide jaoks.
# Praegu loob registreerimine kõik kasutajad 'editor' rolliga (registration.py).
# Kui contributor-roll kunagi aktiveeritakse, tuleb /save endpoint uuendada
# (hetkel nõuab 'editor' miinimumi, mis blokeerib contributor kasutajate salvestused).
async def save(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    text = unicodedata.normalize('NFC', data.get('text_content', '')) if data.get('text_content') else ""
    # Marginaalia-tägid kanoonilisele kujule (<m> välimiseks) — hoiab failid puhtana
    # ja teeb editori/otsingu usaldusväärseks (vt server/marginalia_normalize.py).
    text = normalize_marginalia_tags(text)
    catalog, filename = os.path.basename(data.get('original_path', '')), os.path.basename(data.get('file_name', ''))
    if not catalog or not filename: raise HTTPException(status_code=400, detail="Vigased teed")

    # Kirjutamisõiguse kontroll: piiratud kollektsiooni teosesse saab kirjutada ainult
    # editor allowed_collections kattuvusega või admin (Leid G). Avalikud teosed läbivad alati.
    _work_meta_path = os.path.join(BASE_DIR, catalog, '_metadata.json')
    if os.path.exists(_work_meta_path):
        try:
            with open(_work_meta_path, 'r', encoding='utf-8') as f:
                _work_meta = json.load(f)
        except Exception:
            _work_meta = None
        if _work_meta is not None and not can_write_work(_work_meta, user):
            raise HTTPException(status_code=403, detail="Puudub õigus sellesse teosesse kirjutada")

    txt_path = os.path.join(BASE_DIR, catalog, filename)
    additional = []
    if data.get('meta_content'):
        json_path = os.path.join(BASE_DIR, catalog, os.path.splitext(filename)[0] + ".json")
        meta_content = data['meta_content']
        # Säilita sequence väli kui on olemas (ära lase salvestamisel üle kirjutada)
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    existing = json.load(f)
                existing_seq = existing.get('sequence') or existing.get('meta_content', {}).get('sequence')
                if existing_seq is not None and meta_content.get('sequence') is None:
                    meta_content['sequence'] = existing_seq
            except Exception:
                pass
        additional.append((json_path, json.dumps(meta_content, indent=2, ensure_ascii=False)))

    git_result = save_with_git(txt_path, text, user['username'], additional_files=additional if additional else None)
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    work_id = (data.get('meta_content') or {}).get('work_id')
    if work_id:
        work_dir = os.path.join(BASE_DIR, catalog)
        background_tasks.add_task(update_page_person_mentions, work_id, work_dir)
    page_tag_qcodes = {
        t['id'] for t in (data.get('meta_content') or {}).get('page_tags', [])
        if isinstance(t, dict) and isinstance(t.get('id'), str) and t['id'].startswith('Q')
    }
    if page_tag_qcodes:
        background_tasks.add_task(enrich_entity_labels_async_qcodes, page_tag_qcodes)
    return {"status": "success", "commit_hash": git_result.get("commit_hash", "")[:8]}


# =========================================================
# TEAVITUSED (notifications) — tõstetud Faas 1 server/routers/notifications.py +
# server/notifications_ops.py. Siin backward-compat re-eksport, sest osa main.py
# endpointe ja teste võivad viidata vanadele ``_``-nimedele.
# =========================================================
from .notifications_ops import (
    safe_username as _safe_username,
    get_notifications_path as _get_notifications_path,
    load_notifications as _load_notifications,
    save_notifications as _save_notifications,
    append_notification as _append_notification,
    create_notification as _create_notification,
    find_username_by_display_name as _find_username_by_display_name,
    _notifications_lock,
)


@app.post("/update-work-metadata")
async def update_work_metadata(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    path = find_directory_by_id(data.get('work_id')) or os.path.join(BASE_DIR, os.path.basename(data.get('original_path', '')))
    meta_path = os.path.join(path, '_metadata.json')
    slug = os.path.basename(path)

    meta = save_work_metadata(
        meta_path,
        data.get('metadata', {}),
        user['username'],
        f"Meta: {slug}",
        background_tasks=background_tasks,
        sync_meili=True,
        call_ptw=True,
    )
    background_tasks.add_task(process_person_fields_metadata, meta)
    background_tasks.add_task(enrich_entity_labels_async, meta)
    _invalidate_all_caches()
    return {"status": "success"}

@app.post("/get-work-metadata")
async def get_work_meta_direct(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    # Faililugemine threadpoolis, et mitte blokeerida event loopi
    # (vt docs/koodi_ulevaade_2026-06-24_gemini_soovitused.md Leid 4).
    metadata = await run_in_threadpool(_read_work_meta_direct_sync, data.get('work_id'), data.get('original_path', ''))
    return {"status": "success", "metadata": metadata}

@app.post("/get-metadata-suggestions")
async def metadata_suggestions(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    return {"status": "success", **get_cached_suggestions(data.get('lang', 'et'))}

# =========================================================
# GIT AJALUGU JA BULK
# =========================================================

@app.get("/recent-edits")
async def recent_edits(request: Request, user=Depends(get_user)):
    f_user = request.query_params.get('user') if user['role'] == 'admin' else user['username']
    res = get_recent_commits(username=f_user, limit=int(request.query_params.get('limit', 30)), skip=int(request.query_params.get('offset', 0)))
    return {"status": "success", "commits": res["commits"], "has_more": res["has_more"], "is_admin": user['role'] == 'admin'}

@app.post("/git-history")
async def git_history(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    path = os.path.join(os.path.basename(data.get('original_path', '')), os.path.basename(data.get('file_name', '')))
    return {"status": "success", "history": get_file_git_history(path)}

@app.post("/commit-diff")
async def commit_diff(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    commit_hash, filepath = data.get('commit_hash'), data.get('filepath', '')
    clean_path = os.path.join(filepath.strip('/').split('/')[-2], filepath.strip('/').split('/')[-1]) if '/' in filepath else None
    diff_res = get_commit_diff(commit_hash, filepaths=clean_path)
    if not diff_res or not diff_res.get('diff'): diff_res = get_commit_diff(commit_hash)
    return {"status": "success", **diff_res} if diff_res else {"status": "error"}

@app.post("/git-restore")
async def git_restore(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    catalog, filename = os.path.basename(data.get('original_path', '')), os.path.basename(data.get('file_name', ''))
    path = os.path.join(BASE_DIR, catalog, filename)
    content = get_file_at_commit(os.path.join(catalog, filename), data.get('commit_hash'))
    if content is None: raise HTTPException(status_code=400, detail="Ei leitud")

    additional = None
    restored_text_annotations = None
    json_filename = os.path.splitext(filename)[0] + ".json"
    json_path = os.path.join(BASE_DIR, catalog, json_filename)
    restored_json = get_file_at_commit(os.path.join(catalog, json_filename), data.get('commit_hash'))
    if os.path.exists(json_path):
        with open(json_path, 'r', encoding='utf-8') as f:
            current_meta = json.load(f)
        if restored_json is not None:
            try:
                restored_meta = json.loads(restored_json)
                restored_text_annotations = restored_meta.get('text_annotations', [])
            except json.JSONDecodeError:
                restored_text_annotations = None
        elif not re.search(r"<ann\d+>", content):
            restored_text_annotations = []

        if restored_text_annotations is not None:
            current_meta['text_annotations'] = restored_text_annotations
            current_meta['updated_at'] = datetime.now().isoformat()
            additional = [(json_path, json.dumps(current_meta, indent=2, ensure_ascii=False))]

    save_with_git(
        path,
        content,
        user['username'],
        message=f"Restore: {data.get('commit_hash')[:8]}",
        additional_files=additional,
    )
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {
        "status": "success",
        "restored_content": content,
        "restored_text_annotations": restored_text_annotations,
    }

@app.post("/works/bulk-collection")
async def bulk_collection(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Määrab mitme teose kollektsioonid korraga.

    Body: { work_ids: [...], mode: "add"|"set"|"remove", collection_id: "..." }
    - add: lisab kollektsiooni (kui pole juba)
    - set: asendab kõik kollektsioonid üheainsaga
    - remove: eemaldab konkreetse kollektsiooni
    - set + collection_id null/puudub: tühjendab kõik kollektsioonid
    """
    data = await get_json_data(request)
    mode = data.get('mode', 'set')
    collection_id = data.get('collection_id') or data.get('collection')

    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue

        def make_transform(coll_id=collection_id, m=mode):
            def transform(meta):
                current = meta.get('collections', [])
                if m == 'add':
                    if coll_id and coll_id not in current:
                        return {'collections': current + [coll_id]}
                    return {'collections': current}
                elif m == 'remove':
                    return {'collections': [c for c in current if c != coll_id]}
                else:  # set
                    return {'collections': [coll_id] if coll_id else []}
            return transform

        bulk_update_field(
            os.path.join(path, '_metadata.json'),
            make_transform(),
            user['username'],
            f"Bulk collection: {work_id}",
            background_tasks=background_tasks,
        )
    _invalidate_all_caches()
    return {"status": "success"}

@app.post("/works/bulk-tags")
async def bulk_tags(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    tags_to_update = data.get('tags', [])
    tag_mode = data.get('mode', 'set')

    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue

        def make_transform(mode=tag_mode, new_tags=tags_to_update):
            def transform(meta):
                cur = list(meta.get('tags', []))
                if mode == 'add':
                    for t in new_tags:
                        if t not in cur:
                            cur.append(t)
                elif mode == 'remove':
                    remove_ids = {t['id'] for t in new_tags if t.get('id')}
                    remove_labels = {t.get('label', '').lower() for t in new_tags if not t.get('id')}
                    cur = [t for t in cur if not (
                        (t.get('id') and t['id'] in remove_ids) or
                        (not t.get('id') and t.get('label', '').lower() in remove_labels)
                    )]
                else:
                    cur = list(new_tags)
                return {'tags': cur}
            return transform

        bulk_update_field(
            os.path.join(path, '_metadata.json'),
            make_transform(),
            user['username'],
            f"Bulk tags: {work_id}",
            background_tasks=background_tasks,
            call_ptw=True,
        )
    _invalidate_all_caches()
    return {"status": "success"}

@app.post("/works/bulk-genre")
async def bulk_genre(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Määrab žanri mitmele teosele korraga.

    Body: { work_ids: [...], genre: LinkedEntity|null, mode: "add"|"set"|"remove" }
    - add: lisab žanri olemasolevate hulka (vaikimisi)
    - set: asendab kõik žanrid [genre]-ga (genre=null → tühjendab)
    - remove: eemaldab konkreetse žanri
    """
    data = await get_json_data(request)
    genre = data.get('genre')
    mode = data.get('mode', 'add')

    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue

        def make_transform(g=genre, m=mode):
            def transform(meta):
                current = meta.get('genre', [])
                if not isinstance(current, list):
                    current = [current] if current else []
                if m == 'add':
                    if g and g not in current:
                        current = current + [g]
                elif m == 'remove':
                    current = [x for x in current if x != g]
                else:  # set
                    current = [g] if g else []
                return {'genre': current}
            return transform

        bulk_update_field(
            os.path.join(path, '_metadata.json'),
            make_transform(),
            user['username'],
            f"Bulk genre: {work_id}",
            background_tasks=background_tasks,
        )
    _invalidate_all_caches()
    return {"status": "success"}

# =========================================================
# AVALIKUD ANDMED JA SEO
# =========================================================

@app.get("/collections")
async def collections(): return {"status": "success", "collections": get_cached_collections()}

@app.get("/config/archives")
async def get_archives(): return {"status": "success", "archives": get_cached_archives()}

@app.post("/config/archives")
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

@app.put("/config/archives/{archive_id}")
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

@app.delete("/config/archives/{archive_id}")
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

@app.put("/admin/collections/{collection_id}")
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

@app.get("/admin/collections/{collection_id}/users")
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

@app.post("/admin/collections")
async def admin_create_collection(request: Request, user=Depends(require_role("admin"))):
    """Loob uue kollektsiooni. Body: {id, name_et, name_en, parent?, color?, is_virtual?}"""
    import re
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

@app.get("/admin/collections/{collection_id}/works-count")
def admin_collection_works_count(collection_id: str, user=Depends(require_role("admin"))):
    """Tagastab mitu teost on antud kollektsioonis.

    Tavaline (mitte-async) endpoint: FastAPI jooksutab selle threadpoolis, nii et
    _find_works_with_collection sync faililugemine ei blokeeri event loopi
    (vt docs/koodi_ulevaade_2026-06-24_gemini_soovitused.md Leid 4).
    """
    count = len(_find_works_with_collection(collection_id))
    return {"status": "success", "count": count}

@app.delete("/admin/collections/{collection_id}")
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


@app.post("/work/{work_id}/shareable")
async def toggle_shareable(work_id: str, request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))):
    """Seab teose shareable lipu. Body: {shareable: bool}. Nähtav editorile ja adminile."""
    body = await request.json()
    shareable = bool(body.get("shareable", False))

    folder = find_directory_by_id(work_id)
    if not folder:
        return {"status": "error", "message": "Teos ei leitud"}

    meta_path = os.path.join(folder, '_metadata.json')
    # Kirjutamisõiguse kontroll praeguse (toggle-eelse) seisu põhjal (Leid G).
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                _cur_meta = json.load(f)
        except Exception:
            _cur_meta = None
        if _cur_meta is not None and not can_write_work(_cur_meta, user):
            raise HTTPException(status_code=403, detail="Puudub õigus selle teose jagamist muuta")
    slug = os.path.basename(folder)
    save_work_metadata(
        meta_path,
        {"shareable": shareable},
        user["username"],
        f"{'Aktiveeri' if shareable else 'Deaktiveeri'} jagamine: {slug}",
        background_tasks=background_tasks,
        sync_meili=True,
        call_ptw=False,
    )
    return {"status": "success", "shareable": shareable}


@app.get("/work/{work_id}/viewer-token")
async def get_viewer_token(work_id: str, request: Request):
    """Tagastab Meilisearch tokeni + pildi HMAC andmed juurdepääsuks ühele teosele.
    Kasutatakse shareable ja restricted teoste otselinkide jaoks."""
    import hashlib as _hashlib
    import hmac as _hmac
    import time as _time
    from .meilisearch_ops import generate_work_scoped_meili_token
    from .config import IMAGE_TOKEN_SECRET
    meta = _load_work_metadata(work_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    user = _get_optional_user(request)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=403, detail="Ligipääs keelatud")
    meili_token = generate_work_scoped_meili_token(work_id)
    image_exp = int(_time.time()) + 3600
    image_sig = _hmac.new(
        IMAGE_TOKEN_SECRET.encode(),
        f"image:{work_id}:{image_exp}".encode(),
        _hashlib.sha256,
    ).hexdigest()
    return {"token": meili_token, "image_exp": image_exp, "image_sig": image_sig}


@app.get("/download/{work_id}")
async def download_work(request: Request, work_id: str, content: str = "both"):
    """Laeb alla teose failid.
    content:
      'text'   → üks kokku liidetud .txt fail (sequence järjekorras)
      'images' → ZIP kõigi piltidega
      'both'   → ZIP piltide + kokku liidetud tekstifailiga
    """
    import zipfile

    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/download')
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Liiga palju päringuid. Proovi uuesti {retry_after}s pärast.")

    folder = find_directory_by_id(work_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Teos ei leitud")

    # Ligipääsukontroll
    meta_for_access = _load_work_metadata(work_id)
    if meta_for_access is not None:
        user = _get_optional_user(request)
        if not can_read_work(meta_for_access, user):
            raise HTTPException(status_code=403, detail="Ligipääs keelatud")

    slug = os.path.basename(folder)

    # Loe metaandmed päise jaoks (tekst) ja failinimeks kasutame slug-i otse
    meta_path = os.path.join(folder, '_metadata.json')
    title = slug
    author = ''
    year = ''
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        title = meta.get('title', slug)
        year = str(meta.get('year', ''))
        creators = meta.get('creators', [])
        if creators:
            author = creators[0].get('name', '') if isinstance(creators[0], dict) else str(creators[0])
    except Exception:
        pass

    # Failinimeks: slug eesliitega aastaarv kui see seal juba pole
    file_slug = slug if (not year or slug.startswith(year)) else f"{year}-{slug}"

    # Sequence järgi sorteeritud pildid
    sorted_images = get_sorted_images(folder)

    if content == 'text':
        import re
        def _strip_tags(text: str) -> str:
            """Eemaldab XML/HTML tagid tekstist."""
            return re.sub(r'<[^>]+>', '', text)

        def _build_full_text() -> str:
            """Koostab kokku liidetud tekstifaili sisu (tagideta)."""
            parts = [title]
            if author: parts.append(f'\n{author}')
            if year: parts.append(f', {year}')
            parts.append('\n\n')
            for i, img_fname in enumerate(sorted_images, start=1):
                base = os.path.splitext(img_fname)[0]
                txt_path = os.path.join(folder, base + '.txt')
                if os.path.exists(txt_path):
                    parts.append(f'---- lk {i} ----\n')
                    with open(txt_path, 'r', encoding='utf-8') as f:
                        parts.append(_strip_tags(f.read()))
                    parts.append('\n')
            return ''.join(parts)
            
        buf = _build_full_text().encode('utf-8')
        return StreamingResponse(
            iter([buf]),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{file_slug}.txt"'}
        )

    # ZIP (images või both) — failid nimetatud {file_slug}_pg_NNN.ext sequence järjekorras
    import tempfile

    tmp = tempfile.NamedTemporaryFile(suffix='.zip', delete=False)
    try:
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
            if os.path.exists(meta_path):
                zf.write(meta_path, f"{file_slug}/_metadata.json")

            for i, img_fname in enumerate(sorted_images, start=1):
                base = os.path.splitext(img_fname)[0]
                ext = img_fname.rsplit('.', 1)[-1].lower()

                # Lisa pilt
                img_path = os.path.join(folder, img_fname)
                if os.path.isfile(img_path):
                    zf.write(img_path, f"{file_slug}/{file_slug}_pg_{i:03d}.{ext}")

                # Lisa tekst eraldi failina (ainult 'both' puhul)
                if content == 'both':
                    txt_path = os.path.join(folder, base + '.txt')
                    if os.path.exists(txt_path):
                        zf.write(txt_path, f"{file_slug}/{file_slug}_pg_{i:03d}.txt")

        tmp.seek(0)

        def _stream_and_cleanup():
            try:
                with open(tmp.name, 'rb') as f:
                    while chunk := f.read(65536):
                        yield chunk
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass

        return StreamingResponse(
            _stream_and_cleanup(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{file_slug}.zip"'}
        )
    except Exception:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise

@app.get("/meta/persons")
async def persons_meta(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/persons')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    return HTMLResponse(content=build_persons_meta_html())


@app.get("/meta/person/{person_id:path}")
async def person_meta(person_id: str, request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/person')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    html = build_person_meta_html(person_id)
    if html is None:
        return HTMLResponse(content="<html><body>Isikut ei leitud</body></html>", status_code=404)
    return HTMLResponse(content=html)


@app.get("/meta/work/{work_id}")
async def work_meta(work_id: str, request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/work')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    meta = _load_work_metadata(work_id)
    if meta is not None:
        user = _get_optional_user(request)
        if not can_read_work(meta, user):
            return HTMLResponse(content="<html><body>Ligipääs keelatud</body></html>", status_code=403)
    return HTMLResponse(content=build_meta_html(work_id))

_sitemap_cache: dict = {"xml": None, "expires": 0.0}


def _invalidate_all_caches():
    """Tühjendab kõik cache'id: kollektsioonid, soovitused, sitemap."""
    invalidate_cache()
    _sitemap_cache["xml"] = None


@app.get("/sitemap.xml")
async def sitemap_xml():
    import time
    from . import utils as utils_module
    now = time.time()
    if _sitemap_cache["xml"] is None or now > _sitemap_cache["expires"]:
        person_index = _load_index()
        _sitemap_cache["xml"] = build_sitemap_xml(
            dict(utils_module.WORK_ID_CACHE),
            is_work_public,
            _load_work_metadata,
            person_index.get("entries", []),
        )
        _sitemap_cache["expires"] = now + 3600
    return Response(content=_sitemap_cache["xml"], media_type="application/xml")


@app.get("/health")
async def health(): return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
