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
from .people_ops import people_refresh_loop, load_people_data, process_creators_metadata, get_refresh_status, refresh_all_people_safe
from .git_ops import run_git_fsck, save_with_git, get_recent_commits, delete_work_from_git, clear_git_failures, get_git_failures
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
    import_as_work, upload_progress
)

# Impordime vahemälu funktsioonid uuest cache moodulist
from .cache import (
    get_cached_collections,
    get_cached_vocabularies,
    get_cached_people_aliases,
    get_cached_people_register,
    get_cached_suggestions,
    invalidate_cache
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"VUTT FastAPI käivitus.")
    build_work_id_cache()
    print("Git repo terviklikkuse kontroll...")
    if run_git_fsck()["ok"]:
        print("Git repo terviklikkus: OK")
    watcher_thread = threading.Thread(target=metadata_watcher_loop, daemon=True)
    watcher_thread.start()
    people_thread = threading.Thread(target=people_refresh_loop, daemon=True)
    people_thread.start()
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
        raise HTTPException(status_code=401, detail="Autentimine nõutud (token puudub)")

    user, error = require_token({"auth_token": token}, min_role=min_role)
    if error:
        raise HTTPException(status_code=401, detail=error["message"])
    return user

def require_role(role: str):
    async def role_dependency(request: Request):
        return await get_user(request, min_role=role)
    return role_dependency

async def get_json_data(request: Request):
    if hasattr(request.state, "json_data"):
        return request.state.json_data
    return await request.json()

# =========================================================
# LOGIN JA VERIFY
# =========================================================

@app.post("/login")
async def login(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/login')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"})
    
    data = await request.json()
    user = verify_user(data.get("username", "").strip(), data.get("password", ""))
    if user:
        return {"status": "success", "user": user, "token": create_session(user)}
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

# =========================================================
# REGISTREERIMINE (AVALIK)
# =========================================================

@app.post("/register")
async def register(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/register')
    if not allowed: return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    
    data = await request.json()
    if data.get('website'): return {"status": "success"} # Honeypot

    name, email = data.get('name', '').strip(), data.get('email', '').strip().lower()
    motivation = data.get('motivation', '').strip()
    if not name or not email or '@' not in email or not motivation:
        raise HTTPException(status_code=400, detail="Vigased andmed")

    registration, error = add_registration(name, email, data.get('affiliation'), motivation)
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
# ADMIN: REGISTREERINGUD JA KASUTAJAD (POST)
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

# =========================================================
# ADMIN: PRÜGIKAST, GIT JA TERVIS
# =========================================================

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

@app.post("/admin/work/{work_id}/delete")
@app.delete("/admin/work/{work_id}")
async def admin_work_delete(work_id: str, user=Depends(require_role("admin"))):
    import shutil
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)
    # Loe pealkiri git commit sõnumiks
    meta_path = os.path.join(path, '_metadata.json')
    title = work_id
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
            title = meta.get('title', work_id)
    except: pass
    
    # Liiguta JPG-d prügikasti
    trash_dir = os.path.join(BASE_DIR, '._trash', work_id)
    os.makedirs(trash_dir, exist_ok=True)
    for fname in os.listdir(path):
        if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            shutil.move(os.path.join(path, fname), os.path.join(trash_dir, fname))
    
    shutil.rmtree(path)
    delete_work_from_git(folder_name, title, work_id)
    delete_work_from_meilisearch(work_id)
    if work_id in build_work_id_cache(): pass # Värskendab cache'i
    return {"status": "success"}

# =========================================================
# PENDING-EDITS (KAASTÖÖLISTE MUUDATUSED)
# =========================================================

@app.post("/save-pending")
async def save_pending(request: Request, user=Depends(require_role("contributor"))):
    from .pending_edits import create_pending_edit
    data = await get_json_data(request)
    success, edit_id, other_pending = create_pending_edit(
        data.get('work_id'), data.get('lehekylje_number'),
        user['username'], data.get('original_text'), data.get('new_text')
    )
    return {"status": "success", "edit_id": edit_id, "has_other_pending": other_pending}

@app.post("/pending-edits/check")
async def pending_check(request: Request, user=Depends(get_user)):
    data = await get_json_data(request)
    from .pending_edits import get_pending_edits_for_page, get_user_pending_edit_for_page
    work_id, page_num = data.get('work_id'), data.get('lehekylje_number')
    all_pending = get_pending_edits_for_page(work_id, page_num)
    own_pending = get_user_pending_edit_for_page(work_id, page_num, user['username'])
    return {
        "status": "success",
        "has_own_pending": own_pending is not None,
        "own_pending_edit": own_pending,
        "other_pending_count": len([e for e in all_pending if e['username'] != user['username']])
    }

# =========================================================
# ANDMETE SALVESTAMINE JA META
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
# GIT / HISTORY / BULK
# =========================================================

@app.post("/backups")
async def backups(user=Depends(require_role("admin"))):
    return {"status": "success", "backups": get_recent_commits(limit=50)["commits"]}

@app.get("/recent-edits")
async def recent_edits(request: Request, user=Depends(get_user)):
    f_user = request.query_params.get('user') if user['role'] == 'admin' else user['username']
    res = get_recent_commits(username=f_user, limit=int(request.query_params.get('limit', 30)), skip=int(request.query_params.get('offset', 0)))
    return {"status": "success", "commits": res["commits"], "has_more": res["has_more"], "is_admin": user['role'] == 'admin'}

@app.post("/works/bulk-tags")
async def bulk_tags(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not path: continue
        meta_path = os.path.join(path, '_metadata.json')
        with metadata_lock:
            with open(meta_path, 'r', encoding='utf-8') as f: meta = json.load(f)
            cur = meta.get('tags', [])
            if data.get('mode') == 'add': 
                for t in data.get('tags', []):
                    if t not in cur: cur.append(t)
            else: cur = data.get('tags', [])
            meta['tags'] = cur
            save_with_git(meta_path, json.dumps(meta, indent=2, ensure_ascii=False), user['username'], message=f"Bulk tags: {work_id}")
            background_tasks.add_task(sync_work_to_meilisearch_async, os.path.basename(path))
    invalidate_cache()
    return {"status": "success"}

@app.post("/works/bulk-genre")
async def bulk_genre(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not path: continue
        meta_path = os.path.join(path, '_metadata.json')
        with metadata_lock:
            with open(meta_path, 'r', encoding='utf-8') as f: meta = json.load(f)
            meta['genre'] = data.get('genre')
            save_with_git(meta_path, json.dumps(meta, indent=2, ensure_ascii=False), user['username'], message=f"Bulk genre: {work_id}")
            background_tasks.add_task(sync_work_to_meilisearch_async, os.path.basename(path))
    invalidate_cache()
    return {"status": "success"}

@app.post("/works/bulk-collection")
async def bulk_collection(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not path: continue
        meta_path = os.path.join(path, '_metadata.json')
        with metadata_lock:
            with open(meta_path, 'r', encoding='utf-8') as f: meta = json.load(f)
            meta['collection'] = data.get('collection')
            save_with_git(meta_path, json.dumps(meta, indent=2, ensure_ascii=False), user['username'], message=f"Bulk coll: {work_id}")
            background_tasks.add_task(sync_work_to_meilisearch_async, os.path.basename(path))
    invalidate_cache()
    return {"status": "success"}

# =========================================================
# UPLOAD (OCR JA IMPORT)
# =========================================================

@app.get("/admin/uploads")
async def admin_uploads(user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    return {"status": "success", "uploads": list_uploads()}

@app.post("/admin/upload/create")
async def admin_upload_create(request: Request, user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    data = await get_json_data(request)
    title, year = data.get('title', '').strip(), str(data.get('year', '')).strip()
    if not title or not year: raise HTTPException(status_code=400, detail="Pealkiri ja aasta kohustuslikud")
    slug = data.get('slug', '').strip() or sanitize_slug(title)
    if check_slug_conflict(year, slug):
        return JSONResponse(status_code=409, content={"status": "error", "message": f"Slug '{slug}' on juba kasutusel", "conflict": True})
    return {"status": "success", "upload": create_upload(data)}

@app.get("/admin/upload/{upload_id}/status")
async def admin_upload_status(upload_id: str, user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    return {"status": "success", **poll_and_sync_thumbs(upload_id)}

@app.get("/admin/upload/{upload_id}/thumb/{page_num}")
async def admin_upload_thumb(upload_id: str, page_num: int, user=Depends(require_role("admin"))):
    from .config import UPLOADS_DIR
    from fastapi.responses import FileResponse
    thumb_path = os.path.join(UPLOADS_DIR, upload_id, 'thumbs', f"{page_num:03d}.jpg")
    if not os.path.isfile(thumb_path): raise HTTPException(status_code=404)
    return FileResponse(thumb_path, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=300"})

@app.post("/admin/upload/{upload_id}/files")
async def admin_upload_files(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    x_pg, x_total = int(request.headers.get('X-Page-Number', '0')), int(request.headers.get('X-Total-Pages', '0'))
    tmp_path = f"/tmp/vutt-upload-{upload_id}-pg{x_pg}" if x_pg > 0 else f"/tmp/vutt-upload-{upload_id}"
    with open(tmp_path, 'wb') as f:
        async for chunk in request.stream(): f.write(chunk)
    try:
        pages = add_image_page(upload_id, tmp_path, x_pg, x_total) if x_pg > 0 else save_and_transfer_to_ocr(upload_id, tmp_path)
        return {"status": "accepted", "upload_id": upload_id, "expected_pages": pages}
    except Exception as e:
        if os.path.exists(tmp_path): os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/admin/upload/{upload_id}/delete-page")
async def admin_upload_delete_page(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    if mark_page_deleted(upload_id, data.get('filename'), data.get('deleted', True)): return {"status": "success"}
    raise HTTPException(status_code=404)

@app.post("/admin/upload/{upload_id}/import")
async def admin_upload_import(upload_id: str, user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    try:
        result = import_as_work(upload_id)
        build_work_id_cache()
        return {"status": "success", **result}
    except ValueError as e: raise HTTPException(status_code=400, detail=str(e))

@app.delete("/admin/upload/{upload_id}")
async def admin_upload_cancel(upload_id: str, user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    if cancel_upload(upload_id): return {"status": "success"}
    raise HTTPException(status_code=500, detail="Tühistamine ebaõnnestus")

# =========================================================
# AVALIKUD JA ÜLDISED
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
    user_chars_dir = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_chars')
    chars_file = os.path.join(user_chars_dir, f"{user['username']}.json")
    if os.path.exists(chars_file):
        with open(chars_file, 'r', encoding='utf-8') as f: data = json.load(f)
        return {"status": "success", "characters": data.get("characters", []), "is_custom": True}
    return {"status": "success", "characters": [], "is_custom": False}

@app.post("/user-chars")
async def save_user_chars(request: Request, user=Depends(get_user)):
    from .config import COLLECTIONS_FILE
    data = await get_json_data(request)
    user_chars_dir = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_chars')
    os.makedirs(user_chars_dir, exist_ok=True)
    chars_file = os.path.join(user_chars_dir, f"{user['username']}.json")
    if data.get('reset'):
        if os.path.exists(chars_file): os.remove(chars_file)
        return {"status": "success", "reset": True}
    with open(chars_file, 'w', encoding='utf-8') as f: json.dump({"characters": data.get('characters', [])}, f, ensure_ascii=False, indent=2)
    return {"status": "success"}

@app.get("/meta/work/{work_id}")
async def work_meta(work_id: str):
    from .metadata_handler import handle_metadata_request
    class Mock:
        def __init__(self): self.body = b""
        def send_response(self, c): pass
        def send_header(self, k, v): pass
        def end_headers(self): pass
        @property
        def wfile(self):
            class W:
                def __init__(self, p): self.p = p
                def write(self, b): self.p.body += b
            return W(self)
    mock = Mock()
    handle_metadata_request(mock, work_id)
    return HTMLResponse(content=mock.body.decode('utf-8'))

@app.get("/health")
async def health(): return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
