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
from starlette.concurrency import run_in_threadpool

from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, get_logger
from .utils import build_work_id_cache, find_directory_by_id, generate_nanoid
from .access_ops import can_write_work

logger = get_logger(__name__)
from .meilisearch_ops import metadata_watcher_loop, _keepwarm_loop, sync_work_to_meilisearch_async, _ensure_filterable_attributes
from .people_ops import process_person_fields_metadata
from .entity_labels_ops import enrich_entity_labels_async, enrich_entity_labels_async_qcodes
from .git_ops import run_git_fsck, save_with_git, get_recent_commits, get_file_git_history, get_file_at_commit, get_commit_diff
# NB: upload/re-OCR endpointid + nende ops-importid elavad nüüd routerites
# (server/routers/upload.py, reocr.py). Paketi-tasandi re-eksport käib
# server/__init__.py kaudu otse ops-moodulitest, seega main.py ei impordi neid.
from .cache import get_cached_suggestions
from .prosopography.router import router as prosopography_router
from .routers.notifications import router as notifications_router
from .routers.upload import router as upload_router
from .routers.reocr import router as reocr_router
from .routers.pages import router as pages_router
from .routers.auth import router as auth_router
from .routers.admin import router as admin_router
from .routers.user_settings import router as user_settings_router
from .routers.public_registries import router as public_registries_router
from .routers.public import router as public_router
from .routers.collections import router as collections_router
from .prosopography.ops import update_page_person_mentions, rebuild_indices, _load_index
from .metadata_ops import save_work_metadata, bulk_update_field, ALLOWED_METADATA_FIELDS
from .cache_invalidation import invalidate_all_caches as _invalidate_all_caches
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
app.include_router(public_router)
app.include_router(collections_router)

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

# Teose _metadata.json lugemine (ühine — server/work_meta.py). Kasutatakse
# viewer-token, shareable, download, SEO meta ja collections ligipääsukontrollis.
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

@app.get("/health")
async def health(): return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
