# server/routers/work_parts.py
"""Teose osade otspunktid (#464). Osad muutuvad AINULT siin — üldine
/update-work-metadata lükkab `parts` välja tagasi, et samaaegsed toimetajad ei
kirjutaks teineteise osi üle."""
import os

from fastapi import APIRouter, Body, Depends, HTTPException, Response

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import work_parts as wp

router = APIRouter()


def _dir_and_meta(work_id: str):
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    meta = load_work_metadata_by_id(work_id)
    if meta is None:
        raise HTTPException(status_code=503, detail="Teose metaandmeid ei saa praegu lugeda")
    return path, meta


def _call(fn, *args):
    try:
        return fn(*args)
    except wp.PartError as e:
        raise HTTPException(status_code=e.status, detail=str(e))


def _writable(work_id: str, user: dict) -> str:
    path, meta = _dir_and_meta(work_id)
    if not can_write_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub õigus selle teose osi muuta")
    return path


@router.get("/works/{work_id}/parts")
def list_parts(work_id: str, user=Depends(optional_user)):
    path, meta = _dir_and_meta(work_id)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub ligipääs")
    parts = meta.get("parts") or []
    # Lehenumbrid (/work/{id}/{nr}) ainult osades olevatele tüvedele — töölaua sisukord
    # ei tea lehtede loendit. Sama järjekord mis indekseerijal (page_stems).
    used = {s for p in parts for s in p.get("pages") or []}
    numbers = {s: i + 1 for i, s in enumerate(wp.page_stems(path)) if s in used} if used else {}
    return {"parts": parts, "page_numbers": numbers}


@router.post("/works/{work_id}/parts", status_code=201)
def create(work_id: str, body: dict = Body(...), user=Depends(require_role("editor"))):
    return _call(wp.create_part, _writable(work_id, user), body, user["username"])


@router.put("/works/{work_id}/parts/{part_id}")
def update(work_id: str, part_id: str, body: dict = Body(...), user=Depends(require_role("editor"))):
    return _call(wp.update_part, _writable(work_id, user), part_id, body, user["username"])


@router.delete("/works/{work_id}/parts/{part_id}", status_code=204)
def delete(work_id: str, part_id: str, user=Depends(require_role("editor"))):
    _call(wp.delete_part, _writable(work_id, user), part_id, user["username"])
    return Response(status_code=204)


@router.post("/works/{work_id}/parts/{part_id}/pages")
def change_pages(work_id: str, part_id: str, body: dict = Body(...), user=Depends(require_role("editor"))):
    return _call(wp.change_part_pages, _writable(work_id, user), part_id,
                 body.get("add") or [], body.get("remove") or [], user["username"])
