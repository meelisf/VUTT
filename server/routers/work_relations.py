# server/routers/work_relations.py
"""Teoste seoste otspunktid (#701, ADR 0075). Seos muutub AINULT siin —
/update-work-metadata lükkab `relations` välja tagasi."""
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import work_relations as wr

router = APIRouter()


def _source_meta(work_id: str) -> dict:
    if not find_directory_by_id(work_id):
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    meta = load_work_metadata_by_id(work_id)
    if meta is None:
        raise HTTPException(status_code=503, detail="Teose metaandmeid ei saa praegu lugeda")
    return meta


@router.get("/works/{work_id}/relations")
def get_relations(work_id: str, user=Depends(optional_user)):
    meta = _source_meta(work_id)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    # Vastus sõltub kasutajast (`readable`) → server/cache.py-sse EI lähe (ADR 0042).
    return wr.resolve_relations(meta, user)


@router.put("/works/{work_id}/relations")
def put_relations(work_id: str, background_tasks: BackgroundTasks, body: dict = Body(...),
                  user=Depends(require_role("admin"))):
    meta = _source_meta(work_id)
    if not can_write_work(meta, user):
        raise HTTPException(status_code=403, detail="Puudub õigus selle teose seoseid muuta")
    add, remove = body.get("add") or [], body.get("remove") or []
    if not isinstance(add, list) or not isinstance(remove, list):
        raise HTTPException(status_code=400, detail="add ja remove peavad olema loendid")
    # Kirjutusõigus ka igale sihtteosele: seos muudab mõlemat (ADR 0075).
    for item in add + remove:
        target = item.get("id") if isinstance(item, dict) else None
        target_meta = load_work_metadata_by_id(target) if isinstance(target, str) and target else None
        if target_meta is not None and not can_write_work(target_meta, user):
            raise HTTPException(status_code=403, detail="Puudub õigus seotud teost muuta")
    try:
        wr.apply_relation_changes(work_id, add, remove, user["username"], background_tasks)
    except wr.RelationError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    return {"relations": wr.resolve_relations(_source_meta(work_id), user)}
