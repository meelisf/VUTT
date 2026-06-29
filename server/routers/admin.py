import json
import os
import shutil
import threading

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth import delete_user, get_all_users, update_user_role
from ..config import BASE_DIR
from ..deps import get_json_data, require_role
from ..git_ops import clear_git_failures, delete_work_from_git, get_git_failures, run_git_fsck
from ..meilisearch_ops import delete_work_from_meilisearch
from ..people_ops import get_refresh_status, refresh_all_people_safe
from ..registration import (
    create_invite_token,
    get_registration_by_id,
    load_pending_registrations,
    update_registration_status,
)
from ..password_reset import create_reset_token
from ..trash_ops import list_deleted_pages, list_deleted_works, restore_deleted_page, restore_deleted_work
from ..utils import build_work_id_cache, find_directory_by_id

router = APIRouter()


@router.post("/admin/registrations")
async def admin_registrations(user=Depends(require_role("admin"))):
    return {"status": "success", "registrations": load_pending_registrations()["registrations"]}


@router.post("/admin/registrations/approve")
async def approve_registration(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    reg = get_registration_by_id(data.get("registration_id"))
    if not reg or reg["status"] != "pending":
        raise HTTPException(status_code=400, detail="Vigane taotlus")
    update_registration_status(reg["id"], "approved", user["username"])
    token_data = create_invite_token(reg["email"], reg["name"], user["username"], username=reg.get("username"))
    return {
        "status": "success",
        "invite_token": token_data["token"],
        "invite_url": f"/set-password?token={token_data['token']}",
        "expires_at": token_data["expires_at"],
        "email": token_data["email"],
        "username": token_data["username"],
        "name": token_data["name"],
    }


@router.post("/admin/registrations/reject")
async def reject_registration(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    reg = update_registration_status(data.get("registration_id"), "rejected", user["username"])
    if not reg:
        raise HTTPException(status_code=400, detail="Vigane taotlus")
    return {"status": "success"}


@router.post("/admin/users")
async def admin_users(user=Depends(require_role("admin"))):
    return {"status": "success", "users": get_all_users()}


@router.post("/admin/users/update-role")
async def admin_update_role(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message = update_user_role(data.get("username"), data.get("new_role"), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success"}


@router.post("/admin/users/delete")
async def admin_delete_user(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    success, message = delete_user(data.get("username"), user)
    if not success:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success"}


@router.post("/admin/users/reset-password")
async def admin_reset_password(request: Request, user=Depends(require_role("admin"))):
    """Genereerib olemasolevale kasutajale ühekordse parooli-taastamise lingi.

    Privileegide eskaleerumise kaitse: admin ei tohi lähtestada võrdse/kõrgema
    õigusega kasutajat (sh teist admini), v.a iseennast.
    """
    from ..auth import load_users
    data = await get_json_data(request)
    target = (data.get("username") or "").strip()
    if not target:
        raise HTTPException(status_code=400, detail="Kasutajanimi puudub")

    users = load_users()
    if target not in users:
        raise HTTPException(status_code=404, detail="Kasutajat ei leitud")

    role_hierarchy = {"contributor": 0, "editor": 1, "admin": 2}
    acting_level = role_hierarchy.get(user.get("role", "contributor"), 0)
    target_level = role_hierarchy.get(users[target].get("role", "contributor"), 0)
    if target != user["username"] and target_level >= acting_level:
        raise HTTPException(status_code=403, detail="Ei saa lähtestada võrdse või kõrgema õigusega kasutajat")

    token_data, error = create_reset_token(target, user["username"])
    if not token_data:
        raise HTTPException(status_code=400, detail=error)
    return {
        "status": "success",
        "reset_url": f"/set-password?token={token_data['token']}&reset=1",
        "expires_at": token_data["expires_at"],
        "username": token_data["username"],
        "name": token_data["name"],
    }


@router.post("/admin/trash")
async def admin_trash(user=Depends(require_role("admin"))):
    return {"status": "success", "items": list_deleted_works()}


@router.post("/admin/trash/{work_id}/restore")
async def admin_trash_restore(work_id: str, user=Depends(require_role("admin"))):
    res = restore_deleted_work(work_id, username=user["username"])
    if not res["ok"]:
        raise HTTPException(status_code=400, detail=res["error"])
    return {"status": "success", "title": res.get("title")}


@router.get("/admin/work/{work_id}/metadata")
async def admin_work_metadata(work_id: str, user=Depends(require_role("admin"))):
    """Tagastab teose _metadata.json sisu."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    meta_path = os.path.join(path, "_metadata.json")
    if not os.path.exists(meta_path):
        raise HTTPException(status_code=404, detail="Metaandmete fail puudub")
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


@router.get("/admin/work/{work_id}/trash-pages")
async def admin_trash_pages(work_id: str, user=Depends(require_role("admin"))):
    """Loetleb teose kustutatud leheküljed."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", "pages": list_deleted_pages(work_id, os.path.basename(path))}


@router.post("/admin/work/{work_id}/trash-pages/{filename}/restore")
async def admin_restore_page(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Taastab kustutatud lehekülje prügikastist."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    res = restore_deleted_page(work_id, os.path.basename(path), filename, username=user["username"])
    if not res["ok"]:
        raise HTTPException(status_code=400, detail=res["error"])
    return {"status": "success"}


@router.post("/admin/git-failures")
async def admin_git_failures(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    if data.get("action") == "clear":
        clear_git_failures()
        return {"status": "success"}
    return {"status": "success", "failures": get_git_failures()}


@router.post("/admin/git-health")
async def admin_git_health(user=Depends(require_role("admin"))):
    return {"status": "success", "git_ok": run_git_fsck()["ok"]}


@router.post("/admin/people-refresh")
async def admin_people_refresh(user=Depends(require_role("admin"))):
    threading.Thread(target=refresh_all_people_safe, daemon=True).start()
    return {"status": "success"}


@router.post("/admin/people-refresh-status")
async def admin_people_refresh_status(user=Depends(require_role("admin"))):
    return {"status": "success", **get_refresh_status()}


@router.delete("/admin/work/{work_id}")
async def admin_work_delete(work_id: str, user=Depends(require_role("admin"))):
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)
    title = work_id
    try:
        meta_path = os.path.join(path, "_metadata.json")
        if os.path.exists(meta_path):
            with open(meta_path, "r", encoding="utf-8") as f:
                title = json.load(f).get("title", work_id)
    except Exception:
        pass

    trash_dir = os.path.join(BASE_DIR, "._trash", work_id)
    os.makedirs(trash_dir, exist_ok=True)
    for fname in os.listdir(path):
        if fname.lower().endswith((".jpg", ".jpeg", ".png")):
            shutil.move(os.path.join(path, fname), os.path.join(trash_dir, fname))

    shutil.rmtree(path)
    delete_work_from_git(folder_name, title, work_id, username=user["username"])
    delete_work_from_meilisearch(work_id)
    from ..prosopography.indices import update_work_collections
    update_work_collections(work_id, [])
    build_work_id_cache()
    return {"status": "success"}
