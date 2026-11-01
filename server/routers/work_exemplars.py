# server/routers/work_exemplars.py
"""Teose eksemplaride otspunktid (ADR 0076). Eksemplarid muutuvad AINULT siin —
üldine /update-work-metadata lükkab `exemplars`-i ja `archive_refs`-i tagasi."""
import json

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from ..access_ops import can_read_work, can_write_work
from ..deps import optional_user, require_role
from ..utils import find_directory_by_id
from ..work_sets_access import load_work_metadata_by_id
from .. import work_exemplars as we
from .. import exemplar_proposals as epp
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


# ── Agendi ettepanekud (#703, ADR 0076 §7, ADR 0058) ────────────────────────
# Ainult superadmin (nagu osade ja tekstide ettepanekud). Submit on autentimata:
# õigus on agendikood, mis ei anna teose kirjutusõigust.

_SUBMIT_KEYS = {"code", "work_id", "rows", "note"}


def _epp(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except epp.ProposalError as e:
        conflict = str(e).startswith(("stale", "duplicate"))
        raise HTTPException(status_code=409 if conflict else 400, detail=str(e))


@router.post("/works/exemplar-proposals/submit")
async def exemplar_proposal_submit(request: Request):
    """MCP: ainult ootel ettepaneku talletamine; teost ei muudeta."""
    allowed, retry = check_rate_limit(get_client_ip(request), "/works/exemplar-proposals-submit")
    if not allowed:
        raise HTTPException(status_code=429, detail="Liiga palju katseid", headers={"Retry-After": str(retry)})
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > epp.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Ettepanek on liiga suur")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Vigane JSON")
    if not isinstance(data, dict) or not {"code", "work_id", "rows"} <= set(data) <= _SUBMIT_KEYS \
            or not isinstance(data["work_id"], str):
        raise HTTPException(status_code=400, detail="Vigane ettepaneku kuju")
    path = find_directory_by_id(data["work_id"])
    if not path:
        # Sama vastus mis vigase koodi korral: autentimata küsija ei saa teoste olemasolu kaardistada.
        raise HTTPException(status_code=400, detail="invalid_or_expired_handoff")
    return await run_in_threadpool(_epp, epp.submit, data["code"], data["work_id"], path,
                                   data["rows"], data.get("note"))


@router.get("/works/{work_id}/exemplar-proposals")
def exemplar_proposals(work_id: str, user=Depends(require_role("superadmin"))):
    return _epp(epp.list_for_work, work_id, _writable(work_id, user), user["username"])


@router.post("/works/{work_id}/exemplar-proposals/decide")
def exemplar_proposals_decide(work_id: str, background_tasks: BackgroundTasks,
                              body: dict = Body(...), user=Depends(require_role("superadmin"))):
    """`{items: [{proposal_id, index}], action: "accept" | "reject"}` — partii = üks commit."""
    path = _writable(work_id, user)
    picks = [(i.get("proposal_id"), i.get("index")) if isinstance(i, dict) else None
             for i in (body or {}).get("items") or []]
    return _epp(epp.decide, work_id, path, user["username"], picks, (body or {}).get("action"),
                background_tasks=background_tasks)

