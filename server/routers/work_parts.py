# server/routers/work_parts.py
"""Teose osade otspunktid (#464). Osad muutuvad AINULT siin — üldine
/update-work-metadata lükkab `parts` välja tagasi, et samaaegsed toimetajad ei
kirjutaks teineteise osi üle."""
import os

import json

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import work_parts as wp
from .. import work_part_proposals as wpp
from ..rate_limit import check_rate_limit, get_client_ip

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
    stems = wp.page_stems(path)
    # `pages_version` + `page_count`: agendi osade ettepanek (#492) viitab lehtedele numbritega.
    return {"parts": parts, "page_numbers": numbers, "page_count": len(stems),
            "pages_version": wpp.pages_version(path)}


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


# ── Agendi ettepanekud (#492 samm 2) ─────────────────────────────────────────

def _wpp(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except wpp.ProposalError as e:
        raise HTTPException(status_code=409 if str(e) == "stale_pages" else 400, detail=str(e))


@router.post("/works/{work_id}/parts/handoff")
def parts_handoff(work_id: str, user=Depends(require_role("editor"))):
    """Kood agendile selle teose osade ettepanekuteks (8 h, mitu esitust)."""
    allowed, retry = check_rate_limit(user["username"], "/works/parts-handoff")
    if not allowed:
        raise HTTPException(status_code=429, detail="Liiga palju koode", headers={"Retry-After": str(retry)})
    return _wpp(wpp.issue_handoff, work_id, _writable(work_id, user), user["username"])


@router.get("/works/{work_id}/parts/proposals")
def parts_proposals(work_id: str, user=Depends(require_role("editor"))):
    return _wpp(wpp.list_pending, work_id, _writable(work_id, user), user["username"])


@router.post("/works/{work_id}/parts/proposals/{proposal_id}/items/{index}/{action}")
def parts_proposal_decide(work_id: str, proposal_id: str, index: int, action: str,
                          body: dict = Body(default={}), user=Depends(require_role("editor"))):
    """Toimetaja otsus ühe osa kohta: accept (soovi korral parandatud `part`) või reject."""
    path = _writable(work_id, user)
    created = _wpp(wpp.decide, proposal_id, work_id, path, user["username"], index, action,
                   override=(body or {}).get("part"))
    return {"status": "accepted" if created else "rejected", "part": created}


@router.post("/works/parts-proposals/submit")
async def parts_proposal_submit(request: Request):
    """MCP: ainult ootel ettepaneku talletamine; kood ei anna teose kirjutusõigust."""
    allowed, retry = check_rate_limit(get_client_ip(request), "/works/parts-proposals-submit")
    if not allowed:
        raise HTTPException(status_code=429, detail="Liiga palju katseid", headers={"Retry-After": str(retry)})
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > wpp.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Ettepanek on liiga suur")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Vigane JSON")
    if not isinstance(data, dict) or set(data) != {"code", "work_id", "pages_version", "parts"} \
            or not isinstance(data["work_id"], str):
        raise HTTPException(status_code=400, detail="Vigane ettepaneku kuju")
    path = find_directory_by_id(data["work_id"])
    if not path:
        raise HTTPException(status_code=400, detail="invalid_or_expired_handoff")
    return await run_in_threadpool(_wpp, wpp.submit, data["code"], data["work_id"], path,
                                   data["pages_version"], data["parts"])
