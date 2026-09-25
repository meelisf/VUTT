"""Töökollektsioonide API (#354).

KÕIK teed autoriseerivad iga päringu: kogu ligipääs ja teoste lugemisõigus
muutuvad kogu `revision`-ist sõltumatult, seega `revision` EI OLE kehtivuse tõend.
`server/cache.py` on siin keelatud — sealsed vahemälud on globaalsed
moodulitasandi muutujad ja kasutajapõhise vastuse hoidmine seal oleks
risti-kasutaja leke.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from ..auth import is_at_least, users_role_snapshot
from ..deps import get_json_data, get_user, optional_user, require_role
from ..work_sets_access import can_manage_set, can_view_set, search_visible_work_ids
from ..work_sets_ops import (
    WorkSetAccessDenied,
    WorkSetConflict,
    WorkSetLimit,
    WorkSetNotFound,
    create_work_set,
    delete_work_set,
    list_work_sets,
    load_work_set,
    mutate_members,
    set_access,
    update_work_set,
)

router = APIRouter()


def _load_or_404(set_id: str) -> dict:
    ws = load_work_set(set_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return ws


def _load_viewable_or_404(set_id: str, user) -> dict:
    """Ligipääsu puudumine annab SAMA vastuse nagu puuduv kogu: tundmatu link
    ei tohi avaldada, et kogu eksisteerib ega mis ta nimi on."""
    ws = _load_or_404(set_id)
    if not can_view_set(ws, user):
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return ws


def _public_view(ws: dict, user) -> dict:
    """Avalik kuju: ilma õiguste loendi ja auditiväljadeta, kui kutsuja ei halda."""
    base = {
        "id": ws["id"],
        "name": ws.get("name"),
        "description": ws.get("description"),
        "visibility": ws.get("visibility"),
        "status": ws.get("status"),
        "revision": ws.get("revision"),
        "can_manage": can_manage_set(ws, user),
        # Kutsuja OMA ligipääsu kirje (Seaded → „Minu õigused"). Ainult tema enda
        # rida: kogu `access` loend jääb halduritele, sest see paljastaks teised
        # kasutajanimed. `None` = isiklikku kirjet ei ole — kogu on kas avalik või
        # kutsuja on admin, ja need kaks olekut ei ole „liikmesus".
        "my_access": ((ws.get("access") or {}).get(user.get("username"))
                      if user else None),
    }
    if base["can_manage"]:
        base["access"] = ws.get("access", {})
        base["created_by"] = ws.get("created_by")
        base["updated_at"] = ws.get("updated_at")
        base["ever_published"] = ws.get("ever_published", False)
    return base


@router.get("/work-sets")
def get_work_sets(include_archived: bool = False, user=Depends(optional_user)):
    sets = [ws for ws in list_work_sets() if can_view_set(ws, user)]
    if not include_archived:
        sets = [ws for ws in sets if ws.get("status", "active") == "active"]
    return {"status": "success", "work_sets": [_public_view(ws, user) for ws in sets]}


def _kontrolli_nimi(name) -> None:
    """Nimi on {et, en}; vähemalt üks keel peab olema antud. Sama reegel
    loomisel ja muutmisel — muidu saaks PATCH-iga nimeta kogu."""
    if not isinstance(name, dict) or not (name.get("et") or name.get("en")):
        raise HTTPException(status_code=400, detail="Nimi on kohustuslik")


@router.post("/work-sets")
async def post_work_set(request: Request, user=Depends(require_role("admin"))):
    body = await get_json_data(request)
    name = body.get("name") or {}
    _kontrolli_nimi(name)
    ws = await run_in_threadpool(create_work_set, name, body.get("description"),
                                 user["username"])
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.get("/work-sets/for-work/{work_id}")
def get_work_sets_for_work(work_id: str, user=Depends(optional_user)):
    """Kogud, kuhu see teos kuulub ja mida kutsuja näeb (#354).

    Deklareeritud ENNE `/work-sets/{set_id}` mustreid: FastAPI võtab esimese
    sobiva teekonna ja `for-work` peab literaalina võitma.

    Kuulumise kuvamine ei tohi olla LAIEM kui otsingu-nähtavus: kui kutsuja ei
    näe teost otsingus, ei tohi ta selle liikmesuste kaudu kogudest teada saada.
    Seepärast kontrollitakse siin sama predikaati, mis läheb otsingufiltrisse.

    Arhiveeritud kogu kuulumine JÄÄB nähtavaks — arhiveerimine ei kustuta
    liikmesust ja peidetud kuuluvus oleks kasutajale seletamatu.
    """
    # Import funktsiooni sees, MITTE mooduli tasandil: moodulitasandi import
    # seob nime laadimise hetkel ja testide monkeypatch `work_sets_access`-il
    # ei jõuaks siia. Sama muster nagu `_mutate`-is.
    from ..work_sets_access import is_search_visible, load_work_metadata_by_id

    meta = load_work_metadata_by_id(work_id)
    if meta is None or not is_search_visible(meta, user):
        return {"status": "success", "work_sets": []}
    out = [
        _public_view(ws, user)
        for ws in list_work_sets()
        if can_view_set(ws, user) and work_id in (ws.get("works") or [])
    ]
    return {"status": "success", "work_sets": out}


@router.get("/work-sets/{set_id}")
def get_work_set(set_id: str, user=Depends(optional_user)):
    ws = _load_viewable_or_404(set_id, user)
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.patch("/work-sets/{set_id}")
async def patch_work_set(set_id: str, request: Request, user=Depends(get_user)):
    ws = _load_or_404(set_id)
    if not can_manage_set(ws, user):
        raise HTTPException(status_code=403, detail="Puudub haldusõigus")
    body = await get_json_data(request)
    changes = {k: body[k] for k in ("name", "description", "status") if k in body}
    if "name" in changes:
        _kontrolli_nimi(changes["name"])
    if "visibility" in body:
        # Avaldamine on admini otsus: haldur kureerib sisu, mitte nähtavust.
        if not is_at_least(user.get("role") or "contributor", "admin"):
            raise HTTPException(status_code=403, detail="Nähtavust muudab admin")
        if body["visibility"] not in ("members", "public"):
            raise HTTPException(status_code=400, detail="Nähtavus peab olema members või public")
        changes["visibility"] = body["visibility"]
    if "status" in changes and changes["status"] not in ("active", "archived"):
        raise HTTPException(status_code=400, detail="Olek peab olema active või archived")
    try:
        ws = await run_in_threadpool(update_work_set, set_id, changes, user["username"],
                                     body.get("revision"))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    except WorkSetNotFound:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.put("/work-sets/{set_id}/access")
async def put_access(set_id: str, request: Request, user=Depends(require_role("admin"))):
    _load_or_404(set_id)
    body = await get_json_data(request)
    access = body.get("access")
    if not isinstance(access, dict):
        raise HTTPException(status_code=400, detail="access peab olema objekt")
    revision = body.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool):
        # Täisasendus ilma revisionita kirjutaks teise admini töö vaikselt üle.
        raise HTTPException(status_code=400, detail="revision on kohustuslik")

    # Hetktõmmis võetakse `users_lock` all ja see lukk on vabastatud ENNE
    # `_work_sets_lock`-i (ADR 0043 p3).
    users_snapshot = await run_in_threadpool(users_role_snapshot)
    try:
        ws = await run_in_threadpool(set_access, set_id, access, user,
                                     users_snapshot, revision)
    except WorkSetAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    except WorkSetNotFound:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return {"status": "success", "work_set": _public_view(ws, user)}


@router.delete("/work-sets/{set_id}")
def delete_work_set_route(set_id: str, user=Depends(require_role("admin"))):
    ws = _load_or_404(set_id)
    if ws.get("ever_published"):
        # Avaldatud kogu link on levinud: kustutamine teeks temast katkise viite.
        raise HTTPException(status_code=409,
                            detail="Avaldatud kogu arhiveeritakse, mitte ei kustutata")
    delete_work_set(set_id, user["username"])
    return {"status": "success"}


@router.get("/work-sets/{set_id}/works")
def get_work_set_works(set_id: str, user=Depends(optional_user)):
    """Otsingufiltri sisend. Autoriseerib IGA päringu — vt mooduli docstring."""
    ws = _load_viewable_or_404(set_id, user)
    ids = search_visible_work_ids(ws, user)
    return {"status": "success", "work_ids": ids, "count": len(ids),
            "revision": ws.get("revision")}


async def _mutate(set_id: str, request: Request, user, *, adding: bool):
    ws = _load_or_404(set_id)
    if not can_manage_set(ws, user):
        raise HTTPException(status_code=403, detail="Puudub haldusõigus")
    body = await get_json_data(request)
    work_ids = body.get("work_ids") or []
    if not isinstance(work_ids, list):
        raise HTTPException(status_code=400, detail="work_ids peab olema loend")

    if adding:
        # Lisamine ja eemaldamine EI ole sümmeetrilised: lisatav teos peab
        # eksisteerima ja olema kutsujale loetav; eemaldatav ei pea (kustutatud
        # teose viide peab olema koristatav). Kontroll käib ENNE mutatsiooni:
        # osaline lisamine jätaks kogusse teose, mille lisaja tagasi lükati.
        from ..access_ops import can_read_work
        from ..work_sets_access import load_work_metadata_by_id
        for work_id in work_ids:
            meta = await run_in_threadpool(load_work_metadata_by_id, work_id)
            if meta is None:
                raise HTTPException(status_code=400, detail=f"Tundmatu teos: {work_id}")
            if not can_read_work(meta, user):
                raise HTTPException(status_code=403, detail="Teos ei ole kutsujale loetav")

    try:
        ws = await run_in_threadpool(
            mutate_members, set_id,
            work_ids if adding else [], [] if adding else work_ids,
            user["username"], body.get("revision"))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    except WorkSetNotFound:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    except WorkSetLimit as e:
        # Kogu tegelik liikmete arv on admin-info: haldur, kes osa liikmeid ei näe,
        # tuletaks arvust nende hulga.
        if is_at_least(user.get("role") or "contributor", "admin"):
            raise HTTPException(status_code=409, detail={
                "error": "limit", "current": e.current, "adding": e.adding, "limit": e.limit})
        raise HTTPException(status_code=409, detail={"error": "limit"})
    ids = search_visible_work_ids(ws, user)
    return {"status": "success", "work_ids": ids, "count": len(ids),
            "revision": ws.get("revision")}


@router.post("/work-sets/{set_id}/works")
async def post_work_set_works(set_id: str, request: Request, user=Depends(get_user)):
    return await _mutate(set_id, request, user, adding=True)


@router.delete("/work-sets/{set_id}/works")
async def delete_work_set_works(set_id: str, request: Request, user=Depends(get_user)):
    return await _mutate(set_id, request, user, adding=False)
