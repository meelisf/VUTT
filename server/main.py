import os
import json
import threading
import unicodedata
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse

from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED
from .utils import build_work_id_cache, find_directory_by_id, metadata_lock
from .meilisearch_ops import metadata_watcher_loop, sync_work_to_meilisearch, sync_work_to_meilisearch_async, delete_work_from_meilisearch
from .metadata_handler import build_meta_html
from .people_ops import people_refresh_loop, process_creators_metadata, get_refresh_status, refresh_all_people_safe
from .git_ops import run_git_fsck, save_with_git, get_recent_commits, delete_work_from_git, clear_git_failures, get_git_failures, get_file_git_history, get_file_diff, get_file_at_commit, get_commit_diff
from .auth import verify_user, create_session, sessions, SESSION_DURATION, require_token, get_all_users, update_user_role, delete_user
from .rate_limit import get_client_ip, check_rate_limit
from .registration import (
    add_registration, load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token, validate_invite_token,
    create_user_from_invite
)
from .upload_ops import (
    sanitize_slug, check_slug_conflict, create_upload,
    list_uploads, get_upload, mark_page_deleted, cancel_upload,
    save_and_transfer_to_ocr, add_image_page, poll_and_sync_thumbs,
    import_as_work
)
from .cache import (
    get_cached_collections, get_cached_vocabularies, get_cached_people_aliases,
    get_cached_people_register, get_cached_suggestions, invalidate_cache
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"VUTT FastAPI käivitus.")
    build_work_id_cache()
    run_git_fsck()
    threading.Thread(target=metadata_watcher_loop, daemon=True).start()
    threading.Thread(target=people_refresh_loop, daemon=True).start()
    yield
    print("VUTT FastAPI sulgemine.")

app = FastAPI(title="VUTT API", version="1.0.0", lifespan=lifespan)

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

async def get_user(request: Request, min_role: str = "contributor"):
    """
    Ühtne autentimine. Loeb tokenit query-st (GET) või body-st (POST).
    Süstemaatiline lähenemine: token on kas 'token' või 'auth_token'.
    """
    token = request.query_params.get("token")
    if not token:
        try:
            body_bytes = await request.body()
            if body_bytes:
                body_data = json.loads(body_bytes)
                token = body_data.get("auth_token")
                request.state.json_data = body_data
        except: pass

    if not token:
        raise HTTPException(status_code=401, detail="Autentimine nõutud")

    user, error = require_token({"auth_token": token}, min_role=min_role)
    if error: raise HTTPException(status_code=401, detail=error["message"])
    return user

def require_role(role: str):
    async def role_dependency(request: Request):
        return await get_user(request, min_role=role)
    return role_dependency

async def get_json_data(request: Request):
    if hasattr(request.state, "json_data"): return request.state.json_data
    return await request.json()

# =========================================================
# KASUTAJAD JA SESSIOONID
# =========================================================

@app.post("/login")
async def login(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/login')
    if not allowed: return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"})
    data = await request.json()
    user = verify_user(data.get("username", "").strip(), data.get("password", ""))
    if user: return {"status": "success", "user": user, "token": create_session(user)}
    return {"status": "error", "message": "Vale kasutajanimi või parool"}

@app.post("/verify-token")
async def verify_token(request: Request):
    data = await request.json()
    token = data.get("token", "").strip()
    session = sessions.get(token)
    if session:
        from datetime import datetime
        if datetime.now() - datetime.fromisoformat(session["created_at"]) > SESSION_DURATION:
            del sessions[token]
            return {"status": "error", "valid": False, "message": "Sessioon aegunud"}
        return {"status": "success", "user": session["user"], "valid": True}
    return {"status": "error", "valid": False, "message": "Token kehtetu"}

@app.post("/register")
async def register(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/register')
    if not allowed: return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    if data.get('website'): return {"status": "success"}
    registration, error = add_registration(data.get('name', ''), data.get('email', ''), data.get('affiliation'), data.get('motivation', ''))
    if not registration: raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "id": registration["id"]}

@app.get("/invite/{token}")
async def check_invite(token: str):
    token_data, error = validate_invite_token(token)
    if token_data: return {"status": "success", "valid": True, "email": token_data["email"], "name": token_data["name"]}
    return {"status": "error", "valid": False, "message": error}

@app.post("/invite/set-password")
async def set_password(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/invite/set-password')
    if not allowed: return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    new_user, error = create_user_from_invite(data.get('token', ''), data.get('password', ''))
    if not new_user: raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "username": new_user["username"]}

# =========================================================
# ADMIN JA HALDUS (POST)
# =========================================================

@app.post("/admin/registrations")
async def admin_registrations(user=Depends(require_role("admin"))):
    return {"status": "success", "registrations": load_pending_registrations()["registrations"]}

@app.post("/admin/registrations/approve")
async def approve_registration(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    reg = get_registration_by_id(data.get('registration_id'))
    if not reg or reg["status"] != "pending": raise HTTPException(status_code=400, detail="Vigane taotlus")
    update_registration_status(reg["id"], "approved", user["username"])
    token_data = create_invite_token(reg["email"], reg["name"], user["username"])
    return {"status": "success", "invite_token": token_data['token']}

@app.post("/admin/registrations/reject")
async def reject_registration(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    update_registration_status(data.get('registration_id'), "rejected", user["username"])
    return {"status": "success"}

@app.post("/admin/users")
async def admin_users(user=Depends(require_role("admin"))):
    return {"status": "success", "users": get_all_users()}

@app.post("/admin/users/update-role")
async def admin_update_role(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message = update_user_role(data.get('username'), data.get('new_role'), user)
    if not success: raise HTTPException(status_code=400, detail=message)
    return {"status": "success"}

@app.post("/admin/users/delete")
async def admin_delete_user(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message = delete_user(data.get('username'), user)
    if not success: raise HTTPException(status_code=400, detail=message)
    return {"status": "success"}

@app.post("/admin/trash")
async def admin_trash(user=Depends(require_role("admin"))):
    from .trash_ops import list_deleted_works
    return {"status": "success", "items": list_deleted_works()}

@app.post("/admin/trash/{work_id}/restore")
async def admin_trash_restore(work_id: str, user=Depends(require_role("admin"))):
    from .trash_ops import restore_deleted_work
    res = restore_deleted_work(work_id)
    if not res['ok']: raise HTTPException(status_code=400, detail=res['error'])
    return {"status": "success", "title": res.get('title')}

@app.post("/admin/git-failures")
async def admin_git_failures(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    if data.get('action') == 'clear':
        clear_git_failures()
        return {"status": "success"}
    return {"status": "success", "failures": get_git_failures()}

@app.post("/admin/git-health")
async def admin_git_health(user=Depends(require_role("admin"))):
    return {"status": "success", "git_ok": run_git_fsck()["ok"]}

@app.post("/admin/people-refresh")
async def admin_people_refresh(user=Depends(require_role("admin"))):
    threading.Thread(target=refresh_all_people_safe, daemon=True).start()
    return {"status": "success"}

@app.post("/admin/people-refresh-status")
async def admin_people_refresh_status(user=Depends(require_role("admin"))):
    return {"status": "success", **get_refresh_status()}

@app.delete("/admin/work/{work_id}")
async def admin_work_delete(work_id: str, user=Depends(require_role("admin"))):
    import shutil
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)
    title = work_id
    try:
        meta_path = os.path.join(path, '_metadata.json')
        if os.path.exists(meta_path):
            with open(meta_path, 'r', encoding='utf-8') as f: title = json.load(f).get('title', work_id)
    except: pass
    
    trash_dir = os.path.join(BASE_DIR, '._trash', work_id)
    os.makedirs(trash_dir, exist_ok=True)
    for fname in os.listdir(path):
        if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            shutil.move(os.path.join(path, fname), os.path.join(trash_dir, fname))
    
    shutil.rmtree(path)
    delete_work_from_git(folder_name, title, work_id)
    delete_work_from_meilisearch(work_id)
    build_work_id_cache()
    return {"status": "success"}

# =========================================================
# TOIMETAMINE JA SALVESTAMINE
# =========================================================

@app.post("/save")
async def save(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    text = unicodedata.normalize('NFC', data.get('text_content', '')) if data.get('text_content') else ""
    catalog, filename = os.path.basename(data.get('original_path', '')), os.path.basename(data.get('file_name', ''))
    if not catalog or not filename: raise HTTPException(status_code=400, detail="Vigased teed")
    
    txt_path = os.path.join(BASE_DIR, catalog, filename)
    additional = []
    if data.get('meta_content'):
        json_path = os.path.join(BASE_DIR, catalog, os.path.splitext(filename)[0] + ".json")
        additional.append((json_path, json.dumps(data['meta_content'], indent=2, ensure_ascii=False)))

    git_result = save_with_git(txt_path, text, user['username'], additional_files=additional if additional else None)
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {"status": "success", "commit_hash": git_result.get("commit_hash", "")[:8]}

@app.post("/update-work-metadata")
async def update_work_metadata(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    path = find_directory_by_id(data.get('work_id')) or os.path.join(BASE_DIR, os.path.basename(data.get('original_path', '')))
    meta_path = os.path.join(path, '_metadata.json')
    with metadata_lock:
        with open(meta_path, 'r', encoding='utf-8') as f: meta = json.load(f)
        meta.update(data.get('metadata', {}))
        save_with_git(meta_path, json.dumps(meta, indent=2, ensure_ascii=False), user['username'], message=f"Meta: {os.path.basename(os.path.dirname(meta_path))}")
    if meta.get('creators'): background_tasks.add_task(process_creators_metadata, meta['creators'])
    sync_work_to_meilisearch(os.path.basename(os.path.dirname(meta_path)))
    invalidate_cache()
    return {"status": "success"}

@app.post("/get-work-metadata")
async def get_work_meta_direct(request: Request, user=Depends(require_role("editor"))):
    data = await get_json_data(request)
    path = find_directory_by_id(data.get('work_id')) or os.path.join(BASE_DIR, os.path.basename(data.get('original_path', '')))
    meta_path = os.path.join(path, '_metadata.json')
    if os.path.exists(meta_path):
        with open(meta_path, 'r', encoding='utf-8') as f: return {"status": "success", "metadata": json.load(f)}
    return {"status": "success", "metadata": {}}

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
    save_with_git(path, content, user['username'], message=f"Restore: {data.get('commit_hash')[:8]}")
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {"status": "success", "restored_content": content}

@app.post("/works/bulk-tags")
async def bulk_tags(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue
        with metadata_lock:
            with open(os.path.join(path, '_metadata.json'), 'r', encoding='utf-8') as f: meta = json.load(f)
            cur = meta.get('tags', [])
            if data.get('mode') == 'add': 
                for t in data.get('tags', []):
                    if t not in cur: cur.append(t)
            else: cur = data.get('tags', [])
            meta['tags'] = cur
            save_with_git(os.path.join(path, '_metadata.json'), json.dumps(meta, indent=2, ensure_ascii=False), user['username'], message=f"Bulk tags: {work_id}")
            background_tasks.add_task(sync_work_to_meilisearch_async, os.path.basename(path))
    invalidate_cache()
    return {"status": "success"}

# =========================================================
# UPLOAD JA OCR (GET status, POST files/import, DELETE cancel)
# =========================================================

@app.get("/admin/uploads")
async def admin_uploads(user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503)
    return {"status": "success", "uploads": list_uploads()}

@app.post("/admin/upload/create")
async def admin_upload_create(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    slug = data.get('slug') or sanitize_slug(data.get('title', ''))
    if check_slug_conflict(data.get('year'), slug): return JSONResponse(status_code=409, content={"status": "error", "conflict": True})
    return {"status": "success", "upload": create_upload(data)}

@app.get("/admin/upload/{upload_id}/status")
async def admin_upload_status(upload_id: str, user=Depends(require_role("admin"))):
    return {"status": "success", **poll_and_sync_thumbs(upload_id)}

@app.get("/admin/upload/{upload_id}/thumb/{page_num}")
async def admin_upload_thumb(upload_id: str, page_num: int, user=Depends(require_role("admin"))):
    from .config import UPLOADS_DIR
    from fastapi.responses import FileResponse
    path = os.path.join(UPLOADS_DIR, upload_id, 'thumbs', f"{page_num:03d}.jpg")
    if not os.path.isfile(path): raise HTTPException(status_code=404)
    return FileResponse(path, media_type="image/jpeg")

@app.post("/admin/upload/{upload_id}/files")
async def admin_upload_files(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    x_pg, x_total = int(request.headers.get('X-Page-Number', '0')), int(request.headers.get('X-Total-Pages', '0'))
    tmp_path = f"/tmp/vutt-upload-{upload_id}-pg{x_pg}" if x_pg > 0 else f"/tmp/vutt-upload-{upload_id}"
    with open(tmp_path, 'wb') as f:
        async for chunk in request.stream(): f.write(chunk)
    pages = add_image_page(upload_id, tmp_path, x_pg, x_total) if x_pg > 0 else save_and_transfer_to_ocr(upload_id, tmp_path)
    return {"status": "accepted", "upload_id": upload_id, "expected_pages": pages}

@app.post("/admin/upload/{upload_id}/import")
async def admin_upload_import(upload_id: str, user=Depends(require_role("admin"))):
    try:
        res = import_as_work(upload_id)
        build_work_id_cache()
        return {"status": "success", **res}
    except ValueError as e: raise HTTPException(status_code=400, detail=str(e))

@app.delete("/admin/upload/{upload_id}")
async def admin_upload_cancel(upload_id: str, user=Depends(require_role("admin"))):
    if cancel_upload(upload_id): return {"status": "success"}
    raise HTTPException(status_code=500)

# =========================================================
# AVALIKUD ANDMED JA SEO
# =========================================================

@app.get("/collections")
async def collections(): return {"status": "success", "collections": get_cached_collections()}

@app.get("/vocabularies")
async def vocabularies(): return {"status": "success", "vocabularies": get_cached_vocabularies()}

@app.get("/people-aliases")
async def people_aliases(): return {"status": "success", "aliases": get_cached_people_aliases()}

@app.get("/people-register")
async def people_register(): return {"status": "success", "people": get_cached_people_register()}

@app.get("/user-chars")
async def get_user_chars(request: Request, user=Depends(get_user)):
    from .config import COLLECTIONS_FILE
    path = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_chars', f"{user['username']}.json")
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f: return {"status": "success", "characters": json.load(f).get("characters", []), "is_custom": True}
    return {"status": "success", "characters": [], "is_custom": False}

@app.post("/user-chars")
async def save_user_chars(request: Request, user=Depends(get_user)):
    from .config import COLLECTIONS_FILE
    data = await get_json_data(request)
    dir_path = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_chars')
    os.makedirs(dir_path, exist_ok=True)
    path = os.path.join(dir_path, f"{user['username']}.json")
    if data.get('reset'):
        if os.path.exists(path): os.remove(path)
        return {"status": "success", "reset": True}
    with open(path, 'w', encoding='utf-8') as f: json.dump({"characters": data.get('characters', [])}, f, ensure_ascii=False, indent=2)
    return {"status": "success"}

@app.get("/meta/work/{work_id}")
async def work_meta(work_id: str):
    return HTMLResponse(content=build_meta_html(work_id))

@app.get("/health")
async def health(): return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
