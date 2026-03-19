"""
Prosopograafia FastAPI router.
Registreeritakse main.py-s: app.include_router(router, prefix="/prosopography")
"""
import json
from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import FileResponse

from ..auth import require_token
from ..entity_labels_ops import enrich_entity_labels_from_person_async
from .ops import (
    get_person,
    get_person_with_works,
    create_person,
    update_person,
    list_persons,
    add_identifier,
    apply_enrichment,
    merge_person,
    rebuild_indices,
    upload_person_image,
    get_person_image_path,
    delete_person_image,
)

router = APIRouter()

# =========================================================
# AUTH HELPERS
# =========================================================

async def _get_user(request: Request, min_role: str = "contributor"):
    """Loeb tokeni Authorization headerist, JSON body-st või query-st (deprecated)."""
    token = None

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()

    if not token:
        try:
            body = await request.body()
            if body:
                data = json.loads(body)
                token = data.get("auth_token") or data.get("token")
                request.state.json_data = data
        except Exception:
            pass

    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(status_code=401, detail="Autentimine nõutud")
    user, error = require_token({"auth_token": token}, min_role=min_role)
    if error:
        raise HTTPException(status_code=401, detail=error["message"])
    return user


async def _optional_user(request: Request):
    """Loeb tokeni kui on olemas, aga ei nõua autentimist."""
    token = request.query_params.get("token")
    if not token:
        return None
    user, error = require_token({"auth_token": token}, min_role="contributor")
    return None if error else user


def _require_role(role: str):
    async def dep(request: Request):
        return await _get_user(request, min_role=role)
    return dep


async def _get_json(request: Request) -> dict:
    if hasattr(request.state, "json_data"):
        return request.state.json_data
    return await request.json()


# =========================================================
# ENDPOINTID
# =========================================================

@router.get("")
async def prosopography_list(
    request: Request,
    q: str = None,
    gender: str = None,
    status_id: str = None,
    source: str = None,
    verification_level: str = None,
    ids: str = None,
    limit: int = 48,
    offset: int = 0,
    user=Depends(_optional_user),
):
    """Tagastab isikute nimekirja prosopography_index.json-st, pagineeritult."""
    id_list = [i for i in ids.split(",") if i] if ids else None
    return list_persons(
        q=q,
        gender=gender,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        ids=id_list,
        limit=limit,
        offset=offset,
    )


@router.post("/query")
async def prosopography_query(request: Request):
    """
    Body-põhine listingu endpoint suuremate filtrikomplektide jaoks.
    Väldib liiga pikka query stringi, kui ids massiiv on suur.
    """
    data = await _get_json(request)
    return list_persons(
        q=data.get("q"),
        gender=data.get("gender"),
        status_id=data.get("status_id"),
        source=data.get("source"),
        verification_level=data.get("verification_level"),
        ids=data.get("ids"),
        limit=data.get("limit", 48),
        offset=data.get("offset", 0),
    )


@router.post("")
async def prosopography_create(
    request: Request,
    user=Depends(_require_role("editor")),
):
    """Loob uue vutt:P kirje."""
    data = await _get_json(request)
    person = create_person(data, username=user["username"])
    enrich_entity_labels_from_person_async(person)
    return person


# ── Rikastuse eelvaade (ilma kirjet loomata) ──────────────────────────────

@router.get("/enrich/preview")
async def enrichment_preview(
    request: Request,
    scheme: str,
    id: str,
    user=Depends(_require_role("editor")),
):
    """
    Tagastab välisallika rikastuse eelvaate ilma kirjet loomata.
    Kutsutakse /persons/new vormi täitmisel.
    """
    from .enrichment import fetch_and_diff
    diff = fetch_and_diff(scheme, id, {})
    return diff


# ── Spetsiifilised /{person_id}/X ruutid enne generaalset /{person_id} ──

@router.get("/{person_id:path}/enrich/preview")
async def enrichment_preview_for_person(
    person_id: str,
    scheme: str,
    id: str = None,
    user=Depends(_require_role("editor")),
):
    """
    Tagastab rikastuse diff-i olemasoleva isiku suhtes.
    Identifikaator: ?id= query param (draft väärtus) või salvestatud kirjest.
    """
    from .enrichment import fetch_and_diff
    person = get_person(person_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    ext_id = id or next(
        (i["id"] for i in (person.get("identifiers") or []) if i.get("scheme") == scheme),
        None,
    )
    if not ext_id:
        raise HTTPException(status_code=400, detail=f"Isikul puudub {scheme} identifikaator")
    diff = fetch_and_diff(scheme, ext_id, person)
    return diff


@router.post("/{person_id:path}/identifiers")
async def prosopography_add_identifier(
    person_id: str,
    request: Request,
    user=Depends(_require_role("editor")),
):
    """
    Lisab identifikaatori + käivitab rikastuse.
    Body: {scheme: "wikidata"|"gnd", id: "Q12345"}
    Tagastab {person, diff: {auto_filled, conflicts}}
    """
    data = await _get_json(request)
    scheme = data.get("scheme")
    ext_id = data.get("id")
    if not scheme or not ext_id:
        raise HTTPException(status_code=400, detail="Nõutud: scheme ja id")
    try:
        person, diff = add_identifier(person_id, scheme, ext_id, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    return {"person": person, "diff": diff}


@router.post("/{person_id:path}/enrich")
async def prosopography_enrich(
    person_id: str,
    request: Request,
    user=Depends(_require_role("editor")),
):
    """
    Rakendab kasutaja kinnitatud rikastusmuudatused.
    Body: {approved: {field_path: value, ...}, _enrichment_scheme: "wikidata"}
    """
    data = await _get_json(request)
    approved = data.get("approved", {})
    approved["_enrichment_scheme"] = data.get("_enrichment_scheme")
    try:
        person = apply_enrichment(person_id, approved, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    return person


@router.post("/{person_id:path}/image")
async def prosopography_upload_image(
    person_id: str,
    request: Request,
    user=Depends(_require_role("editor")),
):
    """
    Laeb üles isiku profiilipildi (JPEG, PNG, WebP).
    Body: raw binaar, Content-Type päis määrab formaadi.
    """
    content_type = request.headers.get("content-type", "").split(";")[0].strip()
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Fail puudub")
    try:
        person = upload_person_image(person_id, body, content_type, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"image_url": person["image_url"], "updated_at": person["updated_at"]}


@router.get("/{person_id:path}/image")
async def prosopography_get_image(person_id: str):
    """Tagastab isiku pildi. Ei nõua autentimist (avalik)."""
    path = get_person_image_path(person_id)
    if path is None:
        raise HTTPException(status_code=404, detail="Pilt puudub")
    media_type = "image/webp" if path.endswith(".webp") else "image/jpeg"
    return FileResponse(path, media_type=media_type)


@router.delete("/{person_id:path}/image")
async def prosopography_delete_image(
    person_id: str,
    request: Request,
    user=Depends(_require_role("editor")),
):
    """Kustutab isiku pildi."""
    try:
        person = delete_person_image(person_id, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    return {"status": "ok", "updated_at": person["updated_at"]}


# ── Generaalsed /{person_id} ruutid — PEAVAD tulema PÄRAST spetsiifilisi ──

@router.post("/{source_id:path}/merge")
async def prosopography_merge(
    source_id: str,
    request: Request,
    user=Depends(_require_role("admin")),
):
    """
    Liidab source kirje target kirjesse (admin only).
    Body: { "target_id": "vutt:Pxxx" }
    Source → tombstone. Tagastab uuendatud target kirje.
    """
    data = await _get_json(request)
    target_id = (data.get("target_id") or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="target_id on kohustuslik.")
    try:
        result = merge_person(source_id, target_id, username=user["username"])
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {e}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return result


@router.get("/{person_id:path}")
async def prosopography_get(
    person_id: str,
    user=Depends(_optional_user),
):
    """Tagastab ühe isiku täisandmed + seotud teosed pöördindeksist."""
    person = get_person_with_works(person_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    # Redirectid: merged_into
    if person.get("merged_into"):
        raise HTTPException(
            status_code=301,
            headers={"Location": f"/prosopography/{person['merged_into']}"},
            detail=f"Kirje on liidendatud: {person['merged_into']}",
        )
    return person


@router.put("/{person_id:path}")
async def prosopography_update(
    person_id: str,
    request: Request,
    user=Depends(_require_role("editor")),
):
    """
    Uuendab isiku kirjet.
    Nõuab updated_at välja — kui ei klapi → 409 Conflict.
    """
    data = await _get_json(request)
    try:
        person = update_person(person_id, data, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    except ValueError as e:
        msg = str(e)
        if msg.startswith("conflict:"):
            current_updated_at = msg.split(":", 1)[1]
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "message": "Kirjet on vahepeal muudetud.",
                    "current_updated_at": current_updated_at,
                },
            )
        raise HTTPException(status_code=400, detail=msg)
    enrich_entity_labels_from_person_async(person)
    return person


@router.post("/admin/rebuild-indices")
async def prosopography_rebuild(
    user=Depends(_require_role("admin")),
):
    """Taastab kõik kolm read-modeli nullist (admin only)."""
    rebuild_indices()
    return {"status": "ok", "message": "Indeksid taastatud."}
