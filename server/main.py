import os
import json
import threading
import unicodedata
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, status, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import PORT, ALLOWED_ORIGINS, BASE_DIR
from .utils import build_work_id_cache
from .meilisearch_ops import metadata_watcher_loop
from .people_ops import people_refresh_loop, load_people_data
from .git_ops import run_git_fsck

# Impordime vahemälu funktsioonid (et vältida koodi dubleerimist)
# NB: Kuna file_server.py-s on need defineeritud, impordime sealt.
# Tulevikus võiks need liigutada nt server/cache.py alla.
from .file_server import (
    get_cached_collections,
    get_cached_vocabularies,
    get_cached_people_aliases,
    get_cached_people_register,
    get_cached_suggestions,
    invalidate_cache
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

# =========================================================
# ANDMETE SALVESTAMINE
# =========================================================

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
