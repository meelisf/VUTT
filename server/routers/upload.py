import asyncio
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from ..config import UPLOAD_ENABLED, UPLOADS_DIR, get_logger
from ..deps import get_json_data, require_role
from ..upload import prepress, prepress_apply, prepress_plan, store_source
from ..upload import state as upload_state
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
    upload = await run_in_threadpool(create_upload, data, username=user["username"])
    return {"status": "success", "upload": upload}


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


# =========================================================
# PREPRESS — poolitamine enne OCR-i (kõik /admin/ all)
# =========================================================

def _load_prepress(upload_id: str) -> tuple:
    """Ühine eeltöö: valideeri upload_id, loe state ja plaan.

    Normaliseerib vana kujuga plaani (`enabled`) ja KIRJUTAB tulemuse tagasi —
    muidu näeks apply endiselt legacy-kuju ja poolitaks kõik lehed.
    """
    if not _valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Vigane upload_id")
    state = upload_state.read_state(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Uploadi ei leitud")
    plan = state.get("prepress")
    if plan is not None and "enabled" in plan:
        plan = upload_state.mutate_prepress(
            upload_id, prepress_plan.normalize_legacy_plan
        )
    return state, plan


def _validate_split_x(value) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Vigane x")
    if not (0.0 < x < 1.0):
        raise HTTPException(status_code=400, detail="x peab olema vahemikus (0, 1)")
    return x


@router.get("/admin/upload/{upload_id}/prepress")
def admin_prepress_get(upload_id: str, user=Depends(require_role("admin"))):
    """Plaan + eelvaate edenemine. Sync def — loeb ainult ketast."""
    state, plan = _load_prepress(upload_id)
    page_count = len((plan or {}).get("pages", []))
    result = dict(plan or prepress_plan.default_plan(0))
    result["page_count"] = page_count
    result["output_page_count"] = prepress_plan.output_page_count(plan, page_count)
    result["trivial"] = prepress_plan.is_trivial_plan(plan)
    result["status"] = state.get("status")
    result["ocr_model"] = state.get("ocr_model", "print")
    return result


@router.post("/admin/upload/{upload_id}/prepress/start")
def admin_prepress_start(upload_id: str, user=Depends(require_role("admin"))):
    """Käivitab 100 DPI eelvaate. Idempotentne (juba renderdav → no-op)."""
    state, plan = _load_prepress(upload_id)
    if state.get("status") not in ("awaiting_split", "prepping"):
        raise HTTPException(status_code=409, detail="Upload ei ole poolitamise ootel")
    prepress.start_preview(upload_id)
    return {"status": "started"}


@router.get("/admin/upload/{upload_id}/preview/{page_num}")
def admin_prepress_preview(upload_id: str, page_num: int,
                           user=Depends(require_role("admin"))):
    """100 DPI kontaktlehe pisipilt."""
    _load_prepress(upload_id)
    path = prepress.preview_path(upload_id, page_num)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="image/jpeg")


@router.post("/admin/upload/{upload_id}/prepress")
async def admin_prepress_save(upload_id: str, request: Request,
                              user=Depends(require_role("admin"))):
    """Salvestab plaani. Kirjutab AINULT plaani välju (mutate_prepress)."""
    data = await get_json_data(request)
    _load_prepress(upload_id)

    default_x = _validate_split_x(data.get("default_split_x", 0.5))
    incoming = data.get("pages") or []
    if not isinstance(incoming, list):
        raise HTTPException(status_code=400, detail="pages peab olema list")

    clean = {}
    for entry in incoming:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="Vigane lehekirje")
        mode = entry.get("mode", "default")
        if mode not in ("default", "custom", "nosplit"):
            raise HTTPException(status_code=400, detail="Vigane mode: {}".format(mode))
        split_x = entry.get("split_x")
        if mode == "custom":
            split_x = _validate_split_x(split_x)
        clean[entry.get("n")] = {
            "mode": mode,
            "split_x": split_x if mode == "custom" else None,
            "excluded": bool(entry.get("excluded")),
        }

    def _apply(plan):
        plan["default_split_x"] = default_x
        for page in plan.get("pages", []):
            update = clean.get(page.get("n"))
            if update:
                page.update(update)

    plan = await run_in_threadpool(upload_state.mutate_prepress, upload_id, _apply)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plaani ei leitud")
    page_count = len(plan.get("pages", []))
    return {
        "status": "saved",
        "output_page_count": prepress_plan.output_page_count(plan, page_count),
        "trivial": prepress_plan.is_trivial_plan(plan),
    }


@router.post("/admin/upload/{upload_id}/prepress/apply")
def admin_prepress_apply(upload_id: str, user=Depends(require_role("admin"))):
    """Lõpetab sammu 3. Valib teekonna plaani järgi.

    Sync def — try_begin_applying on blokeeriv faililukk (ADR 0002).
    """
    state, plan = _load_prepress(upload_id)

    if prepress_plan.is_trivial_plan(plan):
        # Tänane tee: originaalfail muutmata OCR-serverisse.
        if not upload_state.try_begin_applying(upload_id):
            return JSONResponse(
                status_code=409,
                content={"detail": "Töö juba käib", "status": state.get("status")},
            )
        store_source.transfer_stored_source(upload_id)
        return {"status": "transferring", "path": "original"}

    if not prepress_apply.start_apply(upload_id):
        return JSONResponse(
            status_code=409,
            content={"detail": "Töö juba käib", "status": state.get("status")},
        )
    return {"status": "applying", "path": "split"}


@router.post("/admin/upload/{upload_id}/ocr-model")
async def admin_set_ocr_model(upload_id: str, request: Request,
                              user=Depends(require_role("admin"))):
    """Vahetab OCR-mudelit. EI muuda meta.type-i — see on bibliograafiline väli.

    Miks mitte PATCH /meta: update_upload_meta allow-list viskab tundmatu välja
    vaikselt ära ja tagastab ikka 200 (nii jäid varem salvestumata external_url
    ja ester_id), ning mudel ei ole ka meta väli.
    """
    data = await get_json_data(request)
    model = data.get("model")
    if model not in upload_state.OCR_MODELS:
        raise HTTPException(status_code=400, detail="Vigane mudel")
    _load_prepress(upload_id)
    ok = await run_in_threadpool(upload_state.try_set_ocr_model, upload_id, model)
    if not ok:
        return JSONResponse(
            status_code=409,
            content={"detail": "Mudelit saab muuta ainult enne OCR-i saatmist"},
        )
    return {"status": "saved", "ocr_model": model}


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
    state = await run_in_threadpool(get_upload, upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Upload ei leitud")
    return {"status": "success", "meta": state.get("meta", {})}


@router.patch("/admin/upload/{upload_id}/meta")
async def admin_upload_update_meta(upload_id: str, request: Request, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    if not await run_in_threadpool(update_upload_meta, upload_id, data):
        raise HTTPException(status_code=404, detail="Upload ei leitud")
    return {"status": "success"}


@router.delete("/admin/upload/{upload_id}")
async def admin_upload_cancel(upload_id: str, user=Depends(require_role("admin"))):
    if await run_in_threadpool(cancel_upload, upload_id):
        return {"status": "success"}
    raise HTTPException(status_code=500)
