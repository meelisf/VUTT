# server/routers/exemplar_images.py
"""Eksemplari piltide otspunktid (ADR 0079). Nähtavus = teose nähtavus:
lugemine `can_read_work`, kirjutus `can_write_work` + admin (nagu eksemplarid)."""
import json
import mimetypes

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, RedirectResponse

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..exemplar_image_files import MAX_UPLOAD_BYTES
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import exemplar_images as ei

router = APIRouter()

MAX_FILES_PER_REQUEST = 200


def _dir_and_meta(work_id: str):
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    meta = load_work_metadata_by_id(work_id)
    if meta is None:
        raise HTTPException(status_code=503, detail="Teose metaandmeid ei saa praegu lugeda")
    return path, meta


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ei.ExemplarImagesError as e:
        if e.status == 409 and e.current is not None:
            raise HTTPException(status_code=409, detail={"message": str(e), "current": e.current})
        raise HTTPException(status_code=e.status, detail=str(e))


def _readable(work_id: str, eid: str, user) -> str:
    path, meta = _dir_and_meta(work_id)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub ligipääs")
    if not any(x.get("id") == eid for x in meta.get("exemplars") or []):
        raise HTTPException(status_code=404, detail="Eksemplari ei leitud")
    return path


def _writable(work_id: str, user) -> str:
    path, meta = _dir_and_meta(work_id)
    if not can_write_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub õigus selle teose eksemplare muuta")
    return path


@router.get("/works/{work_id}/exemplars/{eid}/images")
def get_images(work_id: str, eid: str, user=Depends(optional_user)):
    """Manifest. Vastus sõltub lugemisõigusest → EI lähe `server/cache.py`-sse."""
    path = _readable(work_id, eid, user)
    return ei.clean_manifest(_call(ei.read_manifest, path, eid))


@router.post("/works/{work_id}/exemplars/{eid}/images")
def upload_images(work_id: str, eid: str, files: list[UploadFile] = File(...),
                  source: str = Form("{}"), user=Depends(require_role("admin"))):
    path = _writable(work_id, user)
    try:
        src = json.loads(source or "{}")
    except ValueError:
        raise HTTPException(status_code=400, detail="Vigane allikas")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise HTTPException(status_code=413, detail="Liiga palju faile korraga")
    items = []
    for f in files:
        content = f.file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"Fail on liiga suur: {f.filename}")
        items.append((content, src))
    return _call(ei.add_uploads, path, eid, items, user["username"])


@router.patch("/works/{work_id}/exemplars/{eid}/images")
def patch_images(work_id: str, eid: str, body: dict = Body(...), user=Depends(require_role("admin"))):
    path = _writable(work_id, user)
    return _call(ei.patch_images, path, eid, body.get("revision"), body.get("images"), user["username"])


@router.delete("/works/{work_id}/exemplars/{eid}/images/{image_id}")
def delete_image(work_id: str, eid: str, image_id: str, revision: int,
                 user=Depends(require_role("admin"))):
    path = _writable(work_id, user)
    return _call(ei.delete_image, path, eid, image_id, revision, user["username"])


@router.get("/works/{work_id}/exemplars/{eid}/images/{image_id}/original")
def get_original(work_id: str, eid: str, image_id: str, user=Depends(optional_user)):
    path = _readable(work_id, eid, user)
    file_path, url = _call(ei.original_path, path, eid, image_id)
    if url:
        return RedirectResponse(url, status_code=302)
    media = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    return FileResponse(file_path, media_type=media, filename=file_path.rsplit("/", 1)[-1])
