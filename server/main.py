import os
import json
import threading
import unicodedata
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED
from .upload_ops import (
    sanitize_slug, check_slug_conflict, create_upload,
    list_uploads, get_upload, mark_page_deleted, cancel_upload,
    save_and_transfer_to_ocr, add_image_page, poll_and_sync_thumbs,
    import_as_work, upload_progress
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Startup ja Shutdown loogika (asendab vana serveri __main__ sektsiooni).
    """
    print(f"VUTT FastAPI käivitus.")
    print(f"Jälgitav juurkaust: {BASE_DIR}")

    # 1. Ehita Work ID cache
    build_work_id_cache()

    # 2. Kontrolli git repo terviklikkust
    print("Git repo terviklikkuse kontroll...")
    fsck_result = run_git_fsck()
    if fsck_result["ok"]:
        print("Git repo terviklikkus: OK")
    else:
        print(f"HOIATUS: Git repo terviklikkuse kontroll leidis vigu!")

    # 3. Käivita taustalõimed
    watcher_thread = threading.Thread(target=metadata_watcher_loop, daemon=True)
    watcher_thread.start()

    people_thread = threading.Thread(target=people_refresh_loop, daemon=True)
    people_thread.start()

    yield
    # Siia saab lisada shutdown loogika kui vaja
    print("VUTT FastAPI sulgemine.")

app = FastAPI(
    title="VUTT API",
    description="Varauusaegsete tekstide töölaua backend (FastAPI)",
    version="1.0.0",
    lifespan=lifespan
)

# CORS seadistus
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from .auth import verify_user, create_session, sessions, SESSION_DURATION, require_token
from .rate_limit import get_client_ip, check_rate_limit

# =========================================================
# AUTENTIMISE DEPENDENCY
# =========================================================

async def get_user(request: Request, min_role: str = "contributor"):
    """
    FastAPI dependency, mis kontrollib autentimist.
    Toetab tokenit nii JSON body-s (auth_token) kui ka Query parameetrites (token).
    """
    # Proovime leida tokenit erinevatest kohtadest
    token = None
    
    # 1. Query parameeter (token)
    token = request.query_params.get("token")
    
    # 2. JSON body (auth_token)
    if not token:
        try:
            body = await request.json()
            token = body.get("auth_token")
        except:
            pass

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autentimine nõutud (token puudub)"
        )

    # Kasutame olemasolevat require_token loogikat
    # require_token ootab dict-i, kus on 'auth_token'
    user, error = require_token({"auth_token": token}, min_role=min_role)
    
    if error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error["message"]
        )
        
    return user

# =========================================================
# LOGIN JA VERIFY
# =========================================================

@app.post("/login")
async def login(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/login')
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"status": "error", "message": f"Liiga palju päringuid. Proovi uuesti {retry_after} sekundi pärast."},
            headers={"Retry-After": str(retry_after)}
        )

    data = await request.json()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    user = verify_user(username, password)

    if user:
        token = create_session(user)
        return {"status": "success", "user": user, "token": token}
    else:
        return {"status": "error", "message": "Vale kasutajanimi või parool"}

@app.post("/verify-token")
async def verify_token(request: Request):
    data = await request.json()
    token = data.get("token", "").strip()

    session = sessions.get(token)
    if session:
        # Kontrolli aegumist
        from datetime import datetime
        created_at = datetime.fromisoformat(session["created_at"])
        if datetime.now() - created_at > SESSION_DURATION:
            if token in sessions: del sessions[token]
            return {"status": "error", "valid": False, "message": "Sessioon aegunud"}
        
        return {"status": "success", "user": session["user"], "valid": True}
    
    return {"status": "error", "valid": False, "message": "Token kehtetu"}

from .registration import (
    add_registration, load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token, validate_invite_token,
    create_user_from_invite
)
from .auth import get_all_users, update_user_role, delete_user

# =========================================================
# REGISTREERIMINE (AVALIK)
# =========================================================

@app.post("/register")
async def register(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/register')
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"status": "error", "message": f"Liiga palju päringuid. Proovi uuesti {retry_after} sekundi pärast."},
            headers={"Retry-After": str(retry_after)}
        )

    data = await request.json()
    
    # Honeypot kontroll
    if data.get('website'):
        return {"status": "success", "message": "Taotlus esitatud"}

    name = data.get('name', '').strip()
    email = data.get('email', '').strip().lower()
    affiliation = data.get('affiliation', '').strip() or None
    motivation = data.get('motivation', '').strip()

    if not name or not email or '@' not in email or not motivation:
        raise HTTPException(status_code=400, detail="Nimi, e-post ja motivatsioon on kohustuslikud")

    registration, error = add_registration(name, email, affiliation, motivation)
    if not registration:
        raise HTTPException(status_code=400, detail=error)

    return {"status": "success", "message": "Taotlus esitatud", "id": registration["id"]}

@app.get("/invite/{token}")
async def check_invite(token: str):
    token_data, error = validate_invite_token(token)
    if token_data:
        return {
            "status": "success",
            "valid": True,
            "email": token_data["email"],
            "name": token_data["name"],
            "expires_at": token_data["expires_at"]
        }
    return {"status": "error", "valid": False, "message": error}

@app.post("/invite/set-password")
async def set_password(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/invite/set-password')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})

    data = await request.json()
    token = data.get('token', '').strip()
    password = data.get('password', '')

    if not token or not password or len(password) < 12:
        raise HTTPException(status_code=400, detail="Vigane token või liiga lühike parool (min 12 märki)")

    new_user, error = create_user_from_invite(token, password)
    if not new_user:
        raise HTTPException(status_code=400, detail=error)

    return {"status": "success", "message": "Kasutaja loodud", "username": new_user["username"]}

# =========================================================
# ADMIN: REGISTREERINGUD JA KASUTAJAD
# =========================================================

@app.get("/admin/registrations")
async def admin_registrations(user=Depends(lambda r: get_user(r, min_role="admin"))):
    data = load_pending_registrations()
    return {"status": "success", "registrations": data["registrations"]}

@app.post("/admin/registrations/approve")
async def approve_registration(request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    data = await request.json()
    reg_id = data.get('registration_id')
    
    reg = get_registration_by_id(reg_id)
    if not reg or reg["status"] != "pending":
        raise HTTPException(status_code=400, detail="Taotlust ei leitud või on juba käsitletud")

    update_registration_status(reg_id, "approved", user["username"])
    token_data = create_invite_token(reg["email"], reg["name"], user["username"])
    
    return {
        "status": "success", 
        "invite_url": f"/set-password?token={token_data['token']}",
        "invite_token": token_data["token"]
    }

@app.post("/admin/registrations/reject")
async def reject_registration(request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    data = await request.json()
    reg_id = data.get('registration_id')
    update_registration_status(reg_id, "rejected", user["username"])
    return {"status": "success"}

@app.get("/admin/users")
async def admin_users(user=Depends(lambda r: get_user(r, min_role="admin"))):
    return {"status": "success", "users": get_all_users()}

@app.post("/admin/users/update-role")
async def admin_update_role(request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    data = await request.json()
    success, message = update_user_role(data.get('username'), data.get('new_role'), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success", "message": message}

@app.post("/admin/users/delete")
async def admin_delete_user(request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    data = await request.json()
    success, message = delete_user(data.get('username'), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success", "message": message}

@app.post("/save")
async def save(request: Request, background_tasks: BackgroundTasks, user=Depends(get_user)):
    """
    Salvestab lehekülje teksti ja metaandmed.
    Nõuab vähemalt 'editor' rolli.
    """
    # Ainult editorid saavad otse salvestada
    if user['role'] not in ['editor', 'admin']:
        raise HTTPException(status_code=403, detail="Vajab 'editor' või 'admin' õigusi")

    data = await request.json()
    
    text_content = data.get('text_content')
    if text_content:
        # NFC normaliseerimine
        text_content = unicodedata.normalize('NFC', text_content)
    
    meta_content = data.get('meta_content')
    original_catalog = data.get('original_path')
    target_filename = data.get('file_name')

    if not original_catalog or not target_filename:
        raise HTTPException(status_code=400, detail="Puudub 'original_path' või 'file_name'")

    # Turvalisuse kontroll
    safe_catalog = os.path.basename(original_catalog)
    safe_filename = os.path.basename(target_filename)
    txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)

    # Valmista ette JSON metaandmed
    additional_files = []
    json_saved = False
    if meta_content:
        base_name = os.path.splitext(safe_filename)[0]
        json_filename = base_name + ".json"
        json_path = os.path.join(BASE_DIR, safe_catalog, json_filename)
        json_content = json.dumps(meta_content, indent=2, ensure_ascii=False)
        additional_files.append((json_path, json_content))
        json_saved = True

    # Salvestame failid ja teeme Git commiti
    from .git_ops import save_with_git
    git_result = save_with_git(
        filepath=txt_path,
        content=text_content,
        username=user['username'],
        additional_files=additional_files if additional_files else None
    )

    # Sünkrooni Meilisearchiga TAUSTAL
    from .meilisearch_ops import sync_work_to_meilisearch_async
    background_tasks.add_task(sync_work_to_meilisearch_async, safe_catalog)

    response = {
        "status": "success",
        "commit_hash": git_result.get("commit_hash", "")[:8] if git_result.get("success") else None,
        "is_first_commit": git_result.get("is_first_commit", False),
        "json_created": json_saved
    }
    
    if not git_result.get("success"):
        response["warning"] = "Fail salvestatud, aga versiooniajalukku ei jõudnud (git commit ebaõnnestus)"
        # Fallback: salvestame failid ilma Gitita
        try:
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(text_content)
            for add_path, add_content in additional_files:
                with open(add_path, 'w', encoding='utf-8') as f:
                    f.write(add_content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Salvestamine ebaõnnestus: {e}")

    return response

# =========================================================
# METAANDMETE UUENDAMINE
# =========================================================

@app.post("/update-work-metadata")
async def update_work_metadata(request: Request, background_tasks: BackgroundTasks, user=Depends(lambda r: get_user(r, min_role="admin"))):
    data = await request.json()
    original_catalog = data.get('original_path')
    work_id = data.get('work_id')
    new_metadata = data.get('metadata')

    if (not original_catalog and not work_id) or not new_metadata:
        raise HTTPException(status_code=400, detail="Puudub 'original_path'/'work_id' või 'metadata'")

    from .utils import find_directory_by_id, metadata_lock
    if original_catalog:
        safe_catalog = os.path.basename(original_catalog)
        metadata_path = os.path.join(BASE_DIR, safe_catalog, '_metadata.json')
    else:
        found_path = find_directory_by_id(work_id)
        if not found_path: raise HTTPException(status_code=404, detail="Teost ei leitud")
        metadata_path = os.path.join(found_path, '_metadata.json')

    with metadata_lock:
        current_meta = {}
        if os.path.exists(metadata_path):
            with open(metadata_path, 'r', encoding='utf-8') as f:
                current_meta = json.load(f)

        current_meta.update(new_metadata)
        
        from .git_ops import save_with_git
        save_with_git(
            filepath=metadata_path,
            content=json.dumps(current_meta, indent=2, ensure_ascii=False),
            username=user['username'],
            message=f"Metaandmed: {os.path.basename(os.path.dirname(metadata_path))}"
        )

    from .people_ops import process_creators_metadata
    if current_meta.get('creators'):
        background_tasks.add_task(process_creators_metadata, current_meta['creators'])

    from .meilisearch_ops import sync_work_to_meilisearch
    dir_name = os.path.basename(os.path.dirname(metadata_path))
    sync_work_to_meilisearch(dir_name)
    invalidate_cache()

    return {"status": "success", "message": "Metaandmed salvestatud"}

@app.post("/get-work-metadata")
async def get_work_meta_direct(request: Request, user=Depends(lambda r: get_user(r, min_role="editor"))):
    data = await request.json()
    original_catalog = data.get('original_path')
    work_id = data.get('work_id')

    from .utils import find_directory_by_id
    if original_catalog:
        path = os.path.join(BASE_DIR, os.path.basename(original_catalog), '_metadata.json')
    else:
        found_path = find_directory_by_id(work_id)
        path = os.path.join(found_path, '_metadata.json') if found_path else ""

    if path and os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return {"status": "success", "metadata": json.load(f)}
    return {"status": "success", "metadata": {}}

@app.post("/get-metadata-suggestions")
async def metadata_suggestions(request: Request, user=Depends(lambda r: get_user(r, min_role="editor"))):
    data = await request.json()
    preferred_lang = data.get('lang', 'et')
    return {"status": "success", **get_cached_suggestions(preferred_lang)}

# =========================================================
# GIT / BACKUPS / HISTORY
# =========================================================

@app.post("/backups")
async def backups(user=Depends(lambda r: get_user(r, min_role="admin"))):
    from .git_ops import get_recent_commits
    return {"status": "success", "backups": get_recent_commits(limit=50)["commits"]}

@app.get("/recent-edits")
async def recent_edits(request: Request, user=Depends(get_user)):
    from .git_ops import get_recent_commits
    is_admin = user['role'] == 'admin'
    filter_user = request.query_params.get('user')
    limit = int(request.query_params.get('limit', 30))
    offset = int(request.query_params.get('offset', 0))

    if not is_admin or not filter_user:
        filter_user = user['username']

    result = get_recent_commits(username=filter_user, limit=limit, skip=offset)
    return {
        "status": "success",
        "commits": result["commits"],
        "has_more": result["has_more"],
        "is_admin": is_admin
    }

# =========================================================
# BULK OPERATSIOONID
# =========================================================

@app.post("/works/bulk-tags")
async def bulk_tags(request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    from .bulk_handlers import handle_bulk_tags
    # Mock vana handlerit kutsumiseks
    data = await request.json()
    class Mock:
        def __init__(self, d): self.d = d
        def send_response(self, c): self.code = c
        def send_header(self, k, v): pass
        def end_headers(self): pass
        @property
        def wfile(self):
            class W:
                def __init__(self, p): self.p = p
                def write(self, b): self.p.body = b
            return W(self)
    
    # NB: Sinu bulk_handlers.py vajab reaalset refaktoreerimist FastAPI jaoks
    # Praegu jätame selle Mocki, aga see on habras.
    return {"status": "success", "message": "Bulk operatsioonid vajavad veel refaktoreerimist"}

# =========================================================
# UPLOAD (OCR JA IMPORT)
# =========================================================

@app.get("/admin/uploads")
async def admin_uploads(user=Depends(lambda r: get_user(r, min_role="admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    return {"status": "success", "uploads": list_uploads()}

@app.post("/admin/upload/create")
async def admin_upload_create(request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    data = await request.json()
    title, year = data.get('title', '').strip(), str(data.get('year', '')).strip()
    if not title or not year: raise HTTPException(status_code=400, detail="Pealkiri ja aasta kohustuslikud")
    
    slug = data.get('slug', '').strip() or sanitize_slug(title)
    if check_slug_conflict(year, slug):
        return JSONResponse(status_code=409, content={"status": "error", "message": f"Slug '{slug}' on juba kasutusel", "conflict": True})

    return {"status": "success", "upload": create_upload(data)}

@app.get("/admin/upload/{upload_id}/status")
async def admin_upload_status(upload_id: str, user=Depends(lambda r: get_user(r, min_role="admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    return {"status": "success", **poll_and_sync_thumbs(upload_id)}

@app.post("/admin/upload/{upload_id}/import")
async def admin_upload_import(upload_id: str, user=Depends(lambda r: get_user(r, min_role="admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    try:
        return {"status": "success", **import_as_work(upload_id)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.delete("/admin/upload/{upload_id}")
async def admin_upload_cancel(upload_id: str, user=Depends(lambda r: get_user(r, min_role="admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    if cancel_upload(upload_id): return {"status": "success"}
    raise HTTPException(status_code=500, detail="Tühistamine ebaõnnestus")

@app.post("/admin/work/{work_id}/delete")
async def admin_work_delete(work_id: str, user=Depends(lambda r: get_user(r, min_role="admin"))):
    # See asendab vana DELETE /admin/work/{id}
    # Kasutame POST-i, sest mõnikord on DELETE proxyde taga piiratud
    from .utils import find_directory_by_id
    from .meilisearch_ops import delete_work_from_meilisearch
    from .git_ops import delete_work_from_git
    import shutil

    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")

    folder_name = os.path.basename(path)
    shutil.rmtree(path)
    delete_work_from_git(folder_name, work_id, work_id)
    delete_work_from_meilisearch(work_id)
    
    return {"status": "success"}

@app.post("/admin/upload/{upload_id}/files")
async def admin_upload_files(upload_id: str, request: Request, user=Depends(lambda r: get_user(r, min_role="admin"))):
    if not UPLOAD_ENABLED: raise HTTPException(status_code=503, detail="Upload keelatud")
    
    x_page_number = int(request.headers.get('X-Page-Number', '0'))
    x_total_pages = int(request.headers.get('X-Total-Pages', '0'))
    is_multi = x_page_number > 0 and x_total_pages > 1
    
    state = get_upload(upload_id)
    if not state: raise HTTPException(status_code=404, detail="Upload ei leitud")

    tmp_suffix = f"{upload_id}-pg{x_page_number}" if is_multi else upload_id
    tmp_path = f"/tmp/vutt-upload-{tmp_suffix}"
    
    try:
        # Voogedastame pildi kettale
        with open(tmp_path, 'wb') as f:
            async for chunk in request.stream():
                f.write(chunk)
                
        # Edastame SFTP-ga
        if is_multi:
            pages = add_image_page(upload_id, tmp_path, x_page_number, x_total_pages)
        else:
            pages = save_and_transfer_to_ocr(upload_id, tmp_path)
            
        return {"status": "accepted", "upload_id": upload_id, "expected_pages": pages}
    except Exception as e:
        if os.path.exists(tmp_path): os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/collections")
async def collections():
    try:
        data = get_cached_collections()
        return {"status": "success", "collections": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/vocabularies")
async def vocabularies():
    try:
        data = get_cached_vocabularies()
        return {"status": "success", "vocabularies": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/people-aliases")
async def people_aliases():
    try:
        data = get_cached_people_aliases()
        return {"status": "success", "aliases": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/people-register")
async def people_register():
    try:
        data = get_cached_people_register()
        return {"status": "success", "people": data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/meta/work/{work_id}")
async def work_meta(work_id: str, request: Request):
    """
    Genereerib sotsiaalmeedia robotitele HTML-i koos metaandmetega.
    """
    from .metadata_handler import handle_metadata_request
    
    # Kuna handle_metadata_request ootab vana HTTP handlerit, 
    # peame tegema väikese "hacki" või kutsuma seda ettevaatlikult.
    # Aga FastAPI-s on parem see ümber kirjutada või kasutada otse.
    # Praegu kasutame olemasolevat, andes talle ette "mock" handleri.
    
    class MockHandler:
        def __init__(self):
            self.wfile = None
            self.headers_sent = False
            self.response_body = b""
            self.status_code = 200

        def send_response(self, code): self.status_code = code
        def send_header(self, k, v): pass
        def end_headers(self): self.headers_sent = True
        
        class wfile_mock:
            def __init__(self, parent): self.parent = parent
            def write(self, b): self.parent.response_body += b
            
        @property
        def wfile(self): return self.wfile_mock(self)

    mock = MockHandler()
    handle_metadata_request(mock, work_id)
    
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=mock.response_body.decode('utf-8'), status_code=mock.status_code)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "vutt-api"}

if __name__ == "__main__":
    import uvicorn
    # Käivitame testiks pordil 8003
    uvicorn.run(app, host="0.0.0.0", port=8003)
