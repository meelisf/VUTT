import os
import json
import shutil
import threading
import unicodedata
from datetime import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Depends, status, BackgroundTasks, UploadFile
from fastapi.datastructures import FormData
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, HTMLResponse, FileResponse, StreamingResponse

from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, COLLECTIONS_FILE, get_logger
from .utils import build_work_id_cache, find_directory_by_id, metadata_lock, generate_nanoid, atomic_write_json

logger = get_logger(__name__)
from .meilisearch_ops import metadata_watcher_loop, sync_work_to_meilisearch, sync_work_to_meilisearch_async, delete_work_from_meilisearch
from .metadata_handler import build_meta_html
from .people_ops import people_refresh_loop, process_creators_metadata, process_person_fields_metadata, get_refresh_status, refresh_all_people_safe
from .entity_labels_ops import load_entity_labels, enrich_entity_labels_async, refresh_all_entity_labels
from .git_ops import run_git_fsck, save_with_git, get_recent_commits, delete_work_from_git, delete_page_from_git, clear_git_failures, get_git_failures, get_file_git_history, get_file_diff, get_file_at_commit, get_commit_diff
from .auth import verify_user, create_session, require_token, get_all_users, update_user_role, delete_user
from .rate_limit import get_client_ip, check_rate_limit
from .registration import (
    add_registration, load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token, validate_invite_token,
    create_user_from_invite
)
from .upload_ops import (
    sanitize_slug, check_slug_conflict, create_upload, update_upload_meta,
    list_uploads, get_upload, mark_page_deleted, cancel_upload,
    save_and_transfer_to_ocr, add_image_page, poll_and_sync_thumbs,
    import_as_work,
)
from .reocr_ops import (
    start_reocr_job, poll_reocr_job, list_reocr_jobs,
    get_active_reocr_count, REOCR_MAX_CONCURRENT, get_reocr_log,
)
from .cache import (
    get_cached_collections, get_cached_vocabularies, get_cached_people_aliases,
    get_cached_people_register, get_cached_suggestions, invalidate_cache
)
from .trash_ops import list_deleted_works, restore_deleted_work, list_deleted_pages, restore_deleted_page
from .admin_page_ops import get_page_sequence, get_sorted_images, rebalance_sequences, reorder_pages
from .image_server import generate_thumbnail
from .prosopography.router import router as prosopography_router
from .metadata_ops import save_work_metadata, ALLOWED_METADATA_FIELDS

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
app.include_router(prosopography_router, prefix="/prosopography")

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
    Ühtne autentimine. Järjekord:
    1. Authorization: Bearer <token> header (eelistatud)
    2. query-param 'token' (ainult <img src> tüüpi GET-id, nt upload thumb)
    """
    token = None

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()

    if not token:
        token = request.query_params.get("token")

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
    # NB: See endpoint kasutab tahtlikult POST body tokenit, mitte Bearer päist.
    # Põhjus: endpoint verifitseerib tokenit iseennast — get_user() dependency
    # nõuaks kehtivat tokenit, mida me just kontrollima hakkame.
    data = await request.json()
    token = data.get("token", "").strip()
    user, error = require_token({"auth_token": token})
    if error:
        return {"status": "error", "valid": False, "message": error["message"]}
    return {"status": "success", "user": user, "valid": True}

@app.post("/register")
async def register(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/register')
    if not allowed: return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    if data.get('website'): return {"status": "success"}
    registration, error = add_registration(data.get('name', ''), data.get('email', ''), data.get('affiliation'), data.get('motivation', ''), gdpr_consent=bool(data.get('gdpr_consent')))
    if not registration: raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "id": registration["id"]}

@app.get("/invite/{token}")
async def check_invite(token: str):
    token_data, error = validate_invite_token(token)
    if token_data: return {"status": "success", "valid": True, "email": token_data["email"], "name": token_data["name"], "expires_at": token_data["expires_at"]}
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
    return {
        "status": "success",
        "invite_token": token_data['token'],
        "invite_url": f"/set-password?token={token_data['token']}",
        "expires_at": token_data['expires_at'],
        "email": token_data['email'],
        "name": token_data['name'],
    }

@app.post("/admin/registrations/reject")
async def reject_registration(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    reg = update_registration_status(data.get('registration_id'), "rejected", user["username"])
    if not reg: raise HTTPException(status_code=400, detail="Vigane taotlus")
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
    return {"status": "success", "items": list_deleted_works()}

@app.post("/admin/trash/{work_id}/restore")
async def admin_trash_restore(work_id: str, user=Depends(require_role("admin"))):
    res = restore_deleted_work(work_id, username=user['username'])
    if not res['ok']: raise HTTPException(status_code=400, detail=res['error'])
    return {"status": "success", "title": res.get('title')}

@app.get("/admin/work/{work_id}/trash-pages")
async def admin_trash_pages(work_id: str, user=Depends(require_role("admin"))):
    """Loetleb teose kustutatud leheküljed."""
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", "pages": list_deleted_pages(work_id, os.path.basename(path))}

@app.post("/admin/work/{work_id}/trash-pages/{filename}/restore")
async def admin_restore_page(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Taastab kustutatud lehekülje prügikastist."""
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    res = restore_deleted_page(work_id, os.path.basename(path), filename, username=user['username'])
    if not res['ok']: raise HTTPException(status_code=400, detail=res['error'])
    return {"status": "success"}

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
    delete_work_from_git(folder_name, title, work_id, username=user['username'])
    delete_work_from_meilisearch(work_id)
    build_work_id_cache()
    return {"status": "success"}

# =========================================================
# LEHEKÜLGEDE HALDUS (admin)
# =========================================================

@app.get("/admin/work/{work_id}/pages")
async def admin_work_pages(work_id: str, user=Depends(require_role("admin"))):
    """Tagastab teose lehekülgede nimekirja halduseks (sequence järgi sorditud)."""
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    images = get_sorted_images(path)
    pages = []
    for i, img_name in enumerate(images):
        base = os.path.splitext(img_name)[0]
        json_path = os.path.join(path, base + '.json')
        txt_path = os.path.join(path, base + '.txt')

        status = 'Toores'
        sequence = (i + 1) * 100
        if os.path.exists(json_path):
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    d = json.load(f)
                src = d.get('meta_content', d)
                status = src.get('status', 'Toores')
                seq = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                if seq is not None:
                    sequence = int(seq)
            except Exception:
                pass

        pages.append({
            'page_num': i + 1,
            'sequence': sequence,
            'base_name': base,
            'filename': img_name,
            'lehekylje_pilt': f"{folder_name}/{img_name}",
            'status': status,
            'has_text': os.path.exists(txt_path) and os.path.getsize(txt_path) > 0
        })

    return {"status": "success", "pages": pages}


@app.delete("/admin/work/{work_id}/page/{page_num}")
async def admin_delete_page(work_id: str, page_num: int, user=Depends(require_role("admin"))):
    """Kustutab teose lehekülje: liigutab .jpg prügikasti, kustutab .txt ja .json gitist."""
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    images = get_sorted_images(path)
    if page_num < 1 or page_num > len(images):
        raise HTTPException(status_code=404, detail=f"Lehekülge {page_num} ei leitud")

    img_name = images[page_num - 1]
    base = os.path.splitext(img_name)[0]

    # Liiguta .jpg prügikasti
    trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'pages')
    os.makedirs(trash_dir, exist_ok=True)
    img_path = os.path.join(path, img_name)
    if os.path.exists(img_path):
        shutil.move(img_path, os.path.join(trash_dir, img_name))

    # Kustuta .txt ja .json gitist
    commit_msg = f"Kustuta leht {page_num}: {folder_name}/{base} [{work_id}]"
    delete_page_from_git(folder_name, base, commit_msg, username=user['username'])

    # Sünkroniseeri Meilisearch (leheküljed renumberdatakse)
    sync_work_to_meilisearch(folder_name)

    new_page_count = len(get_sorted_images(path))
    return {"status": "success", "new_page_count": new_page_count}


@app.post("/admin/work/{work_id}/page/{page_num}/replace-image")
async def admin_replace_page_image(work_id: str, page_num: int, request: Request, user=Depends(require_role("admin"))):
    """
    Asendab lehekülje pildi uuega. Vana pilt säilitatakse prügikastis 90 päeva.
    Body: multipart — file (JPG/PNG)
    """
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    images = get_sorted_images(path)
    if page_num < 1 or page_num > len(images):
        raise HTTPException(status_code=404, detail=f"Lehekülge {page_num} ei leitud")

    img_name = images[page_num - 1]
    img_path = os.path.join(path, img_name)
    base = os.path.splitext(img_name)[0]

    # Parse multipart
    try:
        form: FormData = await request.form()
        file: UploadFile = form.get('file')
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Vigane vorm: {e}")

    if not file:
        raise HTTPException(status_code=400, detail="Fail puudub")

    # Kontrolli failitüüpi ja konverteeri PNG → JPG
    content = await file.read()
    if content[:4] == b'\xff\xd8\xff\xe0' or content[:4] == b'\xff\xd8\xff\xe1':
        pass  # JPG on OK
    elif content[:8] == b'\x89PNG\r\n\x1a\n':
        # Teisenda PNG → JPG
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(content))
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=95)
            content = buf.getvalue()
        except ImportError:
            raise HTTPException(status_code=500, detail="Pillow pole saadaval PNG teisendamiseks")
    else:
        raise HTTPException(status_code=400, detail="Toetatud formaadid: JPG, PNG")

    # Salvesta vana pilt prügikasti (._trash/{work_id}/replaced_images/)
    trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'replaced_images')
    os.makedirs(trash_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    trash_filename = f"{base}_{timestamp}{os.path.splitext(img_name)[1]}"
    if os.path.exists(img_path):
        shutil.copy2(img_path, os.path.join(trash_dir, trash_filename))
        logger.info(f"REPLACE-IMG: Vana pilt salvestatud: {trash_filename}")

    # Kirjuta uus pilt üle
    with open(img_path, 'wb') as f:
        f.write(content)
    os.chmod(img_path, 0o644)

    # Regenereeri thumbnail
    thumbs_dir = os.path.join(path, '_thumbs')
    os.makedirs(thumbs_dir, exist_ok=True)
    thumb_path = os.path.join(thumbs_dir, f"_thumb_{img_name}")
    if os.path.exists(thumb_path):
        os.remove(thumb_path)
    generate_thumbnail(img_path, thumb_path)

    # Kirjuta püsiv logi
    log_path = os.path.join(BASE_DIR, 'replace_image.log')
    log_entry = f"{datetime.now().isoformat()} | {work_id} | {folder_name}/{img_name} | leht {page_num} | {user['username']}\n"
    with open(log_path, 'a', encoding='utf-8') as lf:
        lf.write(log_entry)

    logger.info(f"REPLACE-IMG: {folder_name}/{img_name} asendatud ({user['username']})")
    sync_work_to_meilisearch(folder_name)
    return {"status": "success", "filename": img_name}


@app.post("/admin/work/{work_id}/add-page")
async def admin_add_page(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """
    Lisab teosele uue lehekülje (JPG/PNG).
    Body: multipart — file (JPG/PNG), after_page_num (int, 0=algusesse, -1=lõppu)
    Laienduspunkt: ocr_requested (bool, praegu ignoreeritakse)
    """
    path = find_directory_by_id(work_id)
    if not path: raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    # Parse multipart
    try:
        form: FormData = await request.form()
        file: UploadFile = form.get('file')
        after_page_num = int(form.get('after_page_num', -1))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Vigane vorm: {e}")


    if not file:
        raise HTTPException(status_code=400, detail="Fail puudub")

    # Kontrolli failitüüpi
    content = await file.read()
    if content[:4] == b'\xff\xd8\xff\xe0' or content[:4] == b'\xff\xd8\xff\xe1':
        ext = '.jpg'
    elif content[:8] == b'\x89PNG\r\n\x1a\n':
        # Teisenda PNG → JPG
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(content))
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            buf = io.BytesIO()
            img.save(buf, format='JPEG', quality=95)
            content = buf.getvalue()
        except ImportError:
            pass
        ext = '.jpg'
    elif content[:4] == b'%PDF':
        raise HTTPException(status_code=400, detail="PDF pole toetatud, kasuta JPG/PNG")
    else:
        raise HTTPException(status_code=400, detail="Toetatud formaadid: JPG, PNG")

    # Arvuta uus sequence
    images = get_sorted_images(path)
    page_count = len(images)

    def seq_of(idx):
        """Tagastab lehe effective sequence; fallback: positsioon × 100."""
        if idx < 0 or idx >= len(images):
            return None
        base = os.path.splitext(images[idx])[0]
        s = get_page_sequence(os.path.join(path, base + '.json'))
        if s == float('inf'):
            return (idx + 1) * 100  # images on juba sorteeritud, positsioon on korrektne
        return int(s)

    if after_page_num == -1 or after_page_num >= page_count:
        # Lõppu
        last_seq = seq_of(page_count - 1)
        if last_seq == float('inf') or last_seq is None:
            new_seq = (page_count + 1) * 100
        else:
            new_seq = int(last_seq) + 100
    elif after_page_num == 0:
        # Algusesse
        first_seq = seq_of(0)
        if first_seq == float('inf') or first_seq is None:
            new_seq = 50
        else:
            new_seq = int(first_seq) // 2
            if new_seq <= 0:
                rebalance_sequences(path)
                images = get_sorted_images(path)
                new_seq = 50
    else:
        # Vahele: pärast after_page_num-ndat (1-indekseeritud)
        idx = after_page_num - 1
        seq_before = seq_of(idx)
        seq_after = seq_of(idx + 1)
        if seq_before == float('inf') or seq_before is None:
            seq_before = after_page_num * 100
        if seq_after == float('inf') or seq_after is None:
            seq_after = (after_page_num + 1) * 100
        new_seq = (int(seq_before) + int(seq_after)) // 2
        if new_seq <= int(seq_before):
            # Ruumi pole — tasakaalusta
            rebalance_sequences(path)
            images = get_sorted_images(path)
            idx = after_page_num - 1
            seq_before = get_page_sequence(os.path.join(path, os.path.splitext(images[idx])[0] + '.json')) if idx < len(images) else after_page_num * 100
            seq_after_val = get_page_sequence(os.path.join(path, os.path.splitext(images[idx+1])[0] + '.json')) if idx + 1 < len(images) else (after_page_num + 1) * 100
            new_seq = (int(seq_before) + int(seq_after_val)) // 2

    # Salvesta pildifail ainulaadse nimega ({folder_name}-{work_id}-{nanoid}, kontrolli kolliisiooni)
    new_id = generate_nanoid()
    new_filename = f"{folder_name}-{work_id}-{new_id}{ext}"
    while os.path.exists(os.path.join(path, new_filename)):
        new_id = generate_nanoid()
        new_filename = f"{folder_name}-{work_id}-{new_id}{ext}"
    new_img_path = os.path.join(path, new_filename)
    with open(new_img_path, 'wb') as f:
        f.write(content)
    os.chmod(new_img_path, 0o644)

    # Loo tühi .txt
    base = os.path.splitext(new_filename)[0]
    txt_path = os.path.join(path, base + '.txt')
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write('')
    os.chmod(txt_path, 0o644)

    # Loo minimaalne .json sequence'ga
    json_path = os.path.join(path, base + '.json')
    page_meta = {'sequence': new_seq, 'status': 'Toores'}
    with open(json_path, 'w', encoding='utf-8') as f:
        json.dump(page_meta, f, indent=2, ensure_ascii=False)
    os.chmod(json_path, 0o644)

    # Git commit
    txt_rel = os.path.join(folder_name, base + '.txt')
    json_rel = os.path.join(folder_name, base + '.json')
    save_with_git(
        txt_path, '',
        user['username'],
        message=f"Lisa leht: {folder_name}/{base} [sequence={new_seq}]",
        additional_files=[(json_path, json.dumps(page_meta, indent=2, ensure_ascii=False))]
    )

    # Sünkroniseeri Meilisearch
    sync_work_to_meilisearch(folder_name)

    new_page_count = len(get_sorted_images(path))
    return {"status": "success", "new_page_count": new_page_count, "sequence": new_seq, "filename": new_filename}


@app.post("/admin/work/{work_id}/reorder-pages")
async def admin_reorder_pages(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Muudab lehekülgede järjekorda. Body: {"order": ["fail1.jpg", "fail2.jpg", ...]}"""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    data = await request.json()
    new_order = data.get("order", [])
    result = reorder_pages(path, new_order, user.get("username", "admin"))
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    folder_name = os.path.basename(path)
    sync_work_to_meilisearch(folder_name)
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
    return {"status": "success", "commit_hash": git_result.get("commit_hash", "")[:8]}

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
        with metadata_lock:
            with open(os.path.join(path, '_metadata.json'), 'r', encoding='utf-8') as f:
                cur_meta = json.load(f)
        current = cur_meta.get('collections', [])
        if mode == 'add':
            if collection_id and collection_id not in current:
                current = current + [collection_id]
        elif mode == 'remove':
            current = [c for c in current if c != collection_id]
        else:  # set
            current = [collection_id] if collection_id else []
        save_work_metadata(
            os.path.join(path, '_metadata.json'),
            {'collections': current},
            user['username'],
            f"Bulk collection: {work_id}",
            background_tasks=background_tasks,
            sync_meili=False,
            call_ptw=False,
        )
    invalidate_cache()
    return {"status": "success"}

@app.post("/works/bulk-tags")
async def bulk_tags(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    for work_id in data.get('work_ids', []):
        path = find_directory_by_id(work_id)
        if not (path and os.path.exists(os.path.join(path, '_metadata.json'))): continue
        # Loe praegused tägid, arvuta uus nimekiri
        with metadata_lock:
            with open(os.path.join(path, '_metadata.json'), 'r', encoding='utf-8') as f:
                cur_meta = json.load(f)
        cur = cur_meta.get('tags', [])
        if data.get('mode') == 'add':
            for t in data.get('tags', []):
                if t not in cur: cur.append(t)
        else:
            cur = data.get('tags', [])
        save_work_metadata(
            os.path.join(path, '_metadata.json'),
            {'tags': cur},
            user['username'],
            f"Bulk tags: {work_id}",
            background_tasks=background_tasks,
            sync_meili=False,
            call_ptw=True,
        )
    invalidate_cache()
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
        with metadata_lock:
            with open(os.path.join(path, '_metadata.json'), 'r', encoding='utf-8') as f:
                cur_meta = json.load(f)
        current = cur_meta.get('genre', [])
        if not isinstance(current, list): current = [current] if current else []
        if mode == 'add':
            if genre and genre not in current: current.append(genre)
        elif mode == 'remove':
            current = [g for g in current if g != genre]
        else:  # set
            current = [genre] if genre else []
        save_work_metadata(
            os.path.join(path, '_metadata.json'),
            {'genre': current},
            user['username'],
            f"Bulk genre: {work_id}",
            background_tasks=background_tasks,
            sync_meili=False,
            call_ptw=False,
        )
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
    # poll_and_sync_thumbs tagastab oma "status" välja (upload olek: pending/processing/done jne)
    # mis kirjutab üle siinsest "success" — seega tagastatav "status" on upload olek, mitte HTTP wrapper
    return poll_and_sync_thumbs(upload_id)

@app.get("/admin/upload/{upload_id}/thumb/{page_num}")
async def admin_upload_thumb(upload_id: str, page_num: int, user=Depends(require_role("admin"))):
    path = os.path.join(UPLOADS_DIR, upload_id, 'thumbs', f"{page_num:03d}.jpg")
    if not os.path.isfile(path): raise HTTPException(status_code=404)
    return FileResponse(path, media_type="image/jpeg")

@app.post("/admin/upload/{upload_id}/files")
async def admin_upload_files(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    x_pg, x_total = int(request.headers.get('X-Page-Number', '0')), int(request.headers.get('X-Total-Pages', '0'))
    tmp_path = f"/tmp/vutt-upload-{upload_id}-pg{x_pg}" if x_pg > 0 else f"/tmp/vutt-upload-{upload_id}"
    try:
        with open(tmp_path, 'wb') as f:
            async for chunk in request.stream():
                f.write(chunk)
        import asyncio
        loop = asyncio.get_running_loop()
        if x_pg > 0:
            pages = await loop.run_in_executor(None, add_image_page, upload_id, tmp_path, x_pg, x_total)
        else:
            pages = await loop.run_in_executor(None, save_and_transfer_to_ocr, upload_id, tmp_path)
        return {"status": "accepted", "upload_id": upload_id, "expected_pages": pages}
    except ValueError as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        logger.error(f"Üleslaadimise viga ({upload_id}): {e}")
        raise HTTPException(status_code=500, detail="Serveri viga faili töötlemisel")

@app.post("/admin/upload/{upload_id}/import")
async def admin_upload_import(upload_id: str, user=Depends(require_role("admin"))):
    try:
        res = import_as_work(upload_id, username=user['username'])
        build_work_id_cache()
        return {"status": "success", **res}
    except ValueError as e: raise HTTPException(status_code=400, detail=str(e))

@app.get("/admin/upload/{upload_id}/meta")
async def admin_upload_get_meta(upload_id: str, user=Depends(require_role("admin"))):
    state = get_upload(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Upload ei leitud")
    return {"status": "success", "meta": state.get("meta", {})}

@app.patch("/admin/upload/{upload_id}/meta")
async def admin_upload_update_meta(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    if not update_upload_meta(upload_id, data):
        raise HTTPException(status_code=404, detail="Upload ei leitud")
    return {"status": "success"}

@app.delete("/admin/upload/{upload_id}")
async def admin_upload_cancel(upload_id: str, user=Depends(require_role("admin"))):
    if cancel_upload(upload_id): return {"status": "success"}
    raise HTTPException(status_code=500)

# =========================================================
# RE-OCR — olemasoleva lehekülje uuesti transkribeerimine
# =========================================================

@app.post("/admin/work/{work_id}/reocr-page")
async def admin_reocr_page(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Alustab lehekülje pildi re-OCR tööd. Tagastab job_id pollimiseks."""
    if get_active_reocr_count() >= REOCR_MAX_CONCURRENT:
        raise HTTPException(status_code=429, detail=f"Liiga palju korraga ({REOCR_MAX_CONCURRENT} max). Proovi hetke pärast uuesti.")
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    slug = os.path.basename(path)
    data = await get_json_data(request)
    page_filename = data.get("page_filename")
    if not page_filename:
        raise HTTPException(status_code=400, detail="page_filename puudub")
    img_path = os.path.join(path, page_filename)
    if not os.path.isfile(img_path):
        raise HTTPException(status_code=404, detail="Pilti ei leitud")
    page_number = data.get("page_number")
    tmp_path = f"/tmp/vutt-reocr-{generate_nanoid()}.jpg"
    shutil.copy2(img_path, tmp_path)
    job_id = start_reocr_job(work_id, slug, tmp_path, page_filename=page_filename, page_number=page_number, username=user['username'])
    return {"status": "accepted", "job_id": job_id}

@app.get("/admin/reocr/{job_id}/status")
async def admin_reocr_status(job_id: str, user=Depends(require_role("admin"))):
    """Küsib re-OCR töö staatust. Küsida korduvalt kuni done/error."""
    return {"status": "success", **poll_reocr_job(job_id)}

@app.get("/admin/reocr/jobs")
async def admin_reocr_jobs(user=Depends(require_role("admin"))):
    """Tagastab kõigi aktiivsete ja hiljutiste re-OCR tööde loendi."""
    return {"status": "success", "jobs": list_reocr_jobs()}

@app.get("/admin/reocr/log")
async def admin_reocr_log(offset: int = 0, limit: int = 50, user=Depends(require_role("admin"))):
    """Tagastab re-OCR ajalogi (püsiv, uuemad ees)."""
    return {"status": "success", **get_reocr_log(offset, limit)}

@app.get("/admin/work/{work_id}/page-ocr")
async def get_page_ocr(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Tagastab lehekülje .ocr faili sisu, kui see eksisteerib."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    stem = os.path.splitext(os.path.basename(filename))[0]
    ocr_path = os.path.join(path, stem + ".ocr")
    if not os.path.isfile(ocr_path):
        raise HTTPException(status_code=404, detail=".ocr fail puudub")
    with open(ocr_path, "r", encoding="utf-8") as f:
        text = f.read()
    return {"status": "success", "text": text}

@app.delete("/admin/work/{work_id}/page-ocr")
async def delete_page_ocr(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Kustutab lehekülje .ocr faili (tulemus rakendatud või tagasi lükatud)."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    stem = os.path.splitext(os.path.basename(filename))[0]
    ocr_path = os.path.join(path, stem + ".ocr")
    if os.path.isfile(ocr_path):
        os.remove(ocr_path)
    return {"status": "success"}

# =========================================================
# AVALIKUD ANDMED JA SEO
# =========================================================

@app.get("/collections")
async def collections(): return {"status": "success", "collections": get_cached_collections()}

@app.put("/admin/collections/{collection_id}")
async def admin_update_collection(collection_id: str, request: Request, user=Depends(require_role("admin"))):
    """Uuendab kollektsiooni description, description_long ja color välju."""
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

    # Kirjuta tagasi
    atomic_write_json(COLLECTIONS_FILE, data)

    # Invalideerib cache → järgmine /collections päring laeb uued andmed
    invalidate_cache()

    return {"status": "success"}

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

    invalidate_cache()
    return {"status": "success"}

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

@app.get("/admin/collections/{collection_id}/works-count")
async def admin_collection_works_count(collection_id: str, user=Depends(require_role("admin"))):
    """Tagastab mitu teost on antud kollektsioonis."""
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
    atomic_write_json(COLLECTIONS_FILE, data)

    invalidate_cache()
    return {"status": "success", "affected_works": len(affected)}

@app.get("/vocabularies")
async def vocabularies(): return {"status": "success", "vocabularies": get_cached_vocabularies()}

@app.get("/people-aliases")
async def people_aliases(): return {"status": "success", "aliases": get_cached_people_aliases()}

@app.get("/people-register")
async def people_register(): return {"status": "success", "people": get_cached_people_register()}

@app.get("/entity-labels")
async def entity_labels(): return load_entity_labels()

@app.post("/admin/refresh-entity-labels")
async def admin_refresh_entity_labels(user=Depends(require_role("admin"))):
    """Värskendab kõik labels.json Q-koodid Wikidatast (admin)."""
    count = refresh_all_entity_labels()
    return {"updated": count}

@app.get("/user-chars")
async def get_user_chars(request: Request, user=Depends(get_user)):
    path = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_chars', f"{user['username']}.json")
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f: return {"status": "success", "characters": json.load(f).get("characters", []), "is_custom": True}
    return {"status": "success", "characters": [], "is_custom": False}

@app.post("/user-chars")
async def save_user_chars(request: Request, user=Depends(get_user)):
    data = await get_json_data(request)
    dir_path = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_chars')
    os.makedirs(dir_path, exist_ok=True)
    path = os.path.join(dir_path, f"{user['username']}.json")
    if data.get('reset'):
        if os.path.exists(path): os.remove(path)
        return {"status": "success", "reset": True}
    atomic_write_json(path, {"characters": data.get('characters', [])})
    return {"status": "success"}

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

@app.get("/meta/work/{work_id}")
async def work_meta(work_id: str):
    return HTMLResponse(content=build_meta_html(work_id))

@app.get("/health")
async def health(): return {"status": "ok"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
