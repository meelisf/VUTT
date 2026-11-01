# server/routers/work_exemplars.py
"""Teose eksemplaride otspunktid (ADR 0076). Eksemplarid muutuvad AINULT siin —
üldine /update-work-metadata lükkab `exemplars`-i ja `archive_refs`-i tagasi."""
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Response

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import work_exemplars as we

router = APIRouter()


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
    except we.ExemplarError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


def _writable(work_id: str, user: dict) -> str:
    path, meta = _dir_and_meta(work_id)
    if not can_write_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub õigus selle teose eksemplare muuta")
    return path


@router.get("/works/{work_id}/exemplars")
def list_exemplars(work_id: str, user=Depends(optional_user)):
    """Eksemplarid, lehtede päritolu ja konvoluudi kaaslased.

    Vastus sõltub kasutajast (kaaslase `readable`) → EI lähe `server/cache.py`-sse.
    """
    path, meta = _dir_and_meta(work_id)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub ligipääs")
    stems = we.page_stems(path)
    exemplars = meta.get("exemplars") or []
    unknown = meta.get(we.UNKNOWN_FIELD) or []
    # Lehenumbrid ainult erandlehtedele — vaade ei tea lehtede loendit.
    used = {s for x in exemplars for s in x.get("pages") or []} | set(unknown)
    numbers = {s: i + 1 for i, s in enumerate(stems) if s in used}
    return {
        "exemplars": exemplars,
        "unknown_pages": unknown,
        "page_numbers": numbers,
        "page_count": len(stems),
        "convolutes": we.resolve_convolutes(work_id, meta, user),
    }


@router.post("/works/{work_id}/exemplars", status_code=201)
def create(work_id: str, background_tasks: BackgroundTasks, body: dict = Body(...),
           user=Depends(require_role("admin"))):
    return _call(we.create_exemplar, _writable(work_id, user), body, user["username"], background_tasks)


@router.post("/works/{work_id}/exemplars/order")
def reorder(work_id: str, background_tasks: BackgroundTasks, body: dict = Body(...),
            user=Depends(require_role("admin"))):
    return {"exemplars": _call(we.reorder_exemplars, _writable(work_id, user), body.get("ids"),
                               user["username"], background_tasks)}


@router.post("/works/{work_id}/exemplars/page-origin")
def page_origin(work_id: str, background_tasks: BackgroundTasks, body: dict = Body(...),
                user=Depends(require_role("admin"))):
    """Body: `{stems: [...], origin: "unknown" | eksemplari id}` (ADR 0076 p 4)."""
    return _call(we.set_page_origin, _writable(work_id, user), body.get("stems"), body.get("origin"),
                 user["username"], background_tasks)


@router.put("/works/{work_id}/exemplars/{exemplar_id}")
def update(work_id: str, exemplar_id: str, background_tasks: BackgroundTasks, body: dict = Body(...),
           user=Depends(require_role("admin"))):
    return _call(we.update_exemplar, _writable(work_id, user), exemplar_id, body, user["username"],
                 background_tasks)


@router.delete("/works/{work_id}/exemplars/{exemplar_id}", status_code=204)
def delete(work_id: str, exemplar_id: str, background_tasks: BackgroundTasks,
           user=Depends(require_role("admin"))):
    _call(we.delete_exemplar, _writable(work_id, user), exemplar_id, user["username"], background_tasks)
    return Response(status_code=204)
