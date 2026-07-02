import asyncio
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from ..config import UPLOAD_ENABLED, UPLOADS_DIR, get_logger
from ..deps import get_json_data, require_role
from ..upload_ops import (
    add_image_page,
    cancel_upload,
    create_upload,
    get_upload,
    import_as_work,
    list_uploads,
    poll_and_sync_thumbs,
    replace_work_content,
    sanitize_slug,
    save_and_transfer_to_ocr,
    update_upload_meta,
    _valid_upload_id,
)
from ..utils import build_work_id_cache

logger = get_logger(__name__)
router = APIRouter()


@router.get("/admin/uploads")
async def admin_uploads(user=Depends(require_role("admin"))):
    if not UPLOAD_ENABLED:
        raise HTTPException(status_code=503)
    uploads = await run_in_threadpool(list_uploads)
    return {"status": "success", "uploads": uploads}


@router.post("/admin/upload/create")
async def admin_upload_create(request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    # Saniteeri slug alati (ka kliendi antud) — väldib path traversal'i import_as_work-is.
    # sanitize_slug on idempotentne, seega juba korrektne slug ei muutu.
    slug = sanitize_slug(data.get("slug") or data.get("title", ""))
    data["slug"] = slug
    return {"status": "success", "upload": create_upload(data, username=user["username"])}


@router.get("/admin/upload/{upload_id}/status")
def admin_upload_status(upload_id: str, user=Depends(require_role("admin"))):
    # SÜNKROONNE def (mitte async) — FastAPI jooksutab selle threadpoolis, et
    # poll_and_sync_thumbs'i blokeeriv SFTP/SSH EI külmutaks event-loopi (ja
    # seeläbi kogu saiti), kui OCR-server on kättesaamatu (2026-06-13 outage).
    # poll_and_sync_thumbs tagastab oma "status" välja (upload olek: pending/processing/done jne)
    # mis kirjutab üle siinsest "success" — seega tagastatav "status" on upload olek, mitte HTTP wrapper
    return poll_and_sync_thumbs(upload_id)


@router.get("/admin/upload/{upload_id}/thumb/{page_num}")
async def admin_upload_thumb(upload_id: str, page_num: int, user=Depends(require_role("admin"))):
    if not _valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Vigane upload_id")
    path = os.path.join(UPLOADS_DIR, upload_id, "thumbs", f"{page_num:03d}.jpg")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="image/jpeg")


@router.post("/admin/upload/{upload_id}/files")
async def admin_upload_files(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    if not _valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Vigane upload_id")
    x_pg = int(request.headers.get("X-Page-Number", "0"))
    x_total = int(request.headers.get("X-Total-Pages", "0"))
    tmp_path = f"/tmp/vutt-upload-{upload_id}-pg{x_pg}" if x_pg > 0 else f"/tmp/vutt-upload-{upload_id}"
    try:
        with open(tmp_path, "wb") as f:
            async for chunk in request.stream():
                f.write(chunk)
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


def _import_upload_sync(upload_id: str, username: str) -> dict:
    """Blokeeriv import + cache rebuild; jooksutatakse ainult threadpoolis."""
    res = import_as_work(upload_id, username=username)
    build_work_id_cache()
    return res


@router.post("/admin/upload/{upload_id}/import")
async def admin_upload_import(upload_id: str, user=Depends(require_role("admin"))):
    try:
        res = await run_in_threadpool(_import_upload_sync, upload_id, user["username"])
        return {"status": "success", **res}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/admin/upload/{upload_id}/replace-work/{work_id}")
async def admin_upload_replace_work(
    upload_id: str,
    work_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(require_role("admin")),
):
    try:
        data = await request.json()
    except Exception:
        data = {}
    metadata_updates = (data.get("metadata_updates") or {}) if isinstance(data, dict) else {}
    res = await run_in_threadpool(
        replace_work_content,
        upload_id,
        work_id,
        metadata_updates,
        user["username"],
        background_tasks,
    )
    return {"status": "success", **res}


@router.get("/admin/upload/{upload_id}/meta")
async def admin_upload_get_meta(upload_id: str, user=Depends(require_role("admin"))):
    state = get_upload(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Upload ei leitud")
    return {"status": "success", "meta": state.get("meta", {})}


@router.patch("/admin/upload/{upload_id}/meta")
async def admin_upload_update_meta(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    if not update_upload_meta(upload_id, data):
        raise HTTPException(status_code=404, detail="Upload ei leitud")
    return {"status": "success"}


@router.delete("/admin/upload/{upload_id}")
async def admin_upload_cancel(upload_id: str, user=Depends(require_role("admin"))):
    if await run_in_threadpool(cancel_upload, upload_id):
        return {"status": "success"}
    raise HTTPException(status_code=500)
