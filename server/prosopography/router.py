"""
Prosopograafia FastAPI router.
Registreeritakse main.py-s: app.include_router(router, prefix="/prosopography")
"""
import json
import os
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Depends
from fastapi.responses import FileResponse

from ..auth import require_token
from ..config import get_logger
from ..entity_labels_ops import enrich_entity_labels_from_person_async
from .ops import (
    get_person,
    get_person_with_works,
    create_person,
    update_person,
    list_persons,
    get_person_map_markers,
    get_person_facets,
    get_relation_type_suggestions,
    add_identifier,
    apply_enrichment,
    merge_person,
    delete_person,
    rebuild_indices,
    upload_person_image,
    get_person_image_path,
    delete_person_image,
    bulk_update_occupation,
    _safe_nanoid,
)
from .reciprocal_ops import sync_reciprocals
from .work_relations_ops import get_work_relations
from .places_ops import get_places, get_places_meta, put_place, search_places_wikidata, fetch_place_wikidata, _propagate_place_change, _propagate_place_merge, refresh_all_place_labels, merge_places, delete_place, put_group, delete_group, auto_assign_group_parents
from ..git_ops import get_file_git_history, get_file_at_commit, get_or_init_repo, save_with_git
from ..rate_limit import get_client_ip, check_rate_limit

logger = get_logger(__name__)

router = APIRouter()


def _check_wikidata_rate_limit(request: Request):
    """Rate-limit anonüümsetele Wikidata-proksi endpointidele (proxy abuse / DoS kaitse)."""
    allowed, retry_after = check_rate_limit(get_client_ip(request), '/prosopography/wikidata')
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Liiga palju päringuid, proovi uuesti {retry_after}s pärast",
            headers={"Retry-After": str(retry_after)},
        )

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
    occupation: str = None,
    origin_group: str = None,
    origin_place: str = None,
    institution: str = None,
    status_id: str = None,
    source: str = None,
    verification_level: str = None,
    year_from: int = None,
    year_to: int = None,
    imm_year_from: int = None,
    imm_year_to: int = None,
    sort_by: str = None,
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
        occupation=occupation,
        origin_group=origin_group,
        origin_place=origin_place,
        institution=institution,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        year_from=year_from,
        year_to=year_to,
        imm_year_from=imm_year_from,
        imm_year_to=imm_year_to,
        sort_by=sort_by,
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
        occupation=data.get("occupation"),
        origin_group=data.get("origin_group"),
        institution=data.get("institution"),
        status_id=data.get("status_id"),
        source=data.get("source"),
        verification_level=data.get("verification_level"),
        year_from=data.get("year_from"),
        year_to=data.get("year_to"),
        imm_year_from=data.get("imm_year_from"),
        imm_year_to=data.get("imm_year_to"),
        sort_by=data.get("sort_by"),
        ids=data.get("ids"),
        limit=data.get("limit", 48),
        offset=data.get("offset", 0),
    )


@router.get("/map")
async def prosopography_map(
    request: Request,
    q: str = None,
    gender: str = None,
    occupation: str = None,
    origin_group: str = None,
    institution: str = None,
    status_id: str = None,
    source: str = None,
    verification_level: str = None,
    year_from: int = None,
    year_to: int = None,
    imm_year_from: int = None,
    imm_year_to: int = None,
    ids: str = None,
    related_to: str = None,
    user=Depends(_optional_user),
):
    """Tagastab koordinaadiga isikud päritolukoha järgi grupeeritud markeritena."""
    id_list = [i for i in ids.split(",") if i] if ids else None
    return get_person_map_markers(
        q=q,
        gender=gender,
        occupation=occupation,
        origin_group=origin_group,
        institution=institution,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        year_from=year_from,
        year_to=year_to,
        imm_year_from=imm_year_from,
        imm_year_to=imm_year_to,
        ids=id_list,
        related_to=related_to,
    )


@router.get("/facets")
async def prosopography_facets(
    q: str = None,
    gender: str = None,
    ids: str = None,
):
    """Tagastab persons-lehe facetid filtripaneeli jaoks."""
    id_list = [i for i in ids.split(",") if i] if ids else None
    return get_person_facets(
        q=q,
        gender=gender,
        ids=id_list,
    )


@router.post("/facets")
async def prosopography_facets_post(request: Request):
    """POST variant /facets — kasuta kui ids nimekiri on pikk (414 vältimiseks)."""
    data = await _get_json(request)
    id_list = data.get("ids") or None
    return get_person_facets(
        q=data.get("q"),
        gender=data.get("gender"),
        ids=id_list,
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


@router.post("/admin/places/{source_key}/merge")
async def places_merge(
    source_key: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(_require_role("admin")),
):
    """
    Ühendab source_key sihtkoha target_key alla (admin).
    Body: {"target_key": "smaland"}
    Tagastab: {"redirected": N, "target_key": "smaland"}
    """
    data = await _get_json(request)
    target_key = data.get("target_key", "").strip()
    if not target_key:
        raise HTTPException(status_code=400, detail="target_key on kohustuslik")
    try:
        result = merge_places(source_key, target_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    background_tasks.add_task(_propagate_place_merge, source_key, target_key)

    return result


# ── Ajalugu ja taastamine ──────────────────────────────────

@router.get("/{person_id:path}/history")
async def person_history(person_id: str, user=Depends(_require_role("editor"))):
    """Tagastab isikukaardi muudatuste ajaloo (git commitid)."""
    try:
        nanoid = _safe_nanoid(person_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    relative_path = f"config/prosopography/{nanoid}.json"
    history = get_file_git_history(relative_path, max_count=50)
    return {"status": "ok", "history": history}


@router.get("/{person_id:path}/diff")
async def person_diff(person_id: str, commit: str, user=Depends(_require_role("editor"))):
    """Tagastab commit-i muutunud väljade loendi võrreldes eelmise commitiga."""
    try:
        nanoid = _safe_nanoid(person_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    relative_path = f"config/prosopography/{nanoid}.json"

    after_content = get_file_at_commit(relative_path, commit)
    if after_content is None:
        raise HTTPException(status_code=404, detail="Commit ei leitud")

    try:
        repo = get_or_init_repo()
        commit_obj = repo.commit(commit)
        parent_hash = commit_obj.parents[0].hexsha if commit_obj.parents else None
    except Exception:
        raise HTTPException(status_code=404, detail="Commit ei leitud")

    before_content = get_file_at_commit(relative_path, parent_hash) if parent_hash else None

    try:
        after = json.loads(after_content)
        before = json.loads(before_content) if before_content else {}
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="JSON parse viga")

    from .ops import compute_person_diff
    return {"status": "ok", "changes": compute_person_diff(before, after)}


@router.post("/{person_id:path}/restore")
async def person_restore(person_id: str, request: Request, user=Depends(_require_role("admin"))):
    """Taastab isikukaardi antud commit-i seisule. Teeb uue git commit-i."""
    from ..config import PROSOPOGRAPHY_DIR
    from .ops import _update_index_entry, _update_aliases_entry
    from datetime import datetime, timezone

    data = await request.json()
    commit_hash = data.get("commit_hash")
    if not commit_hash:
        raise HTTPException(status_code=400, detail="commit_hash puudub")

    try:
        nanoid = _safe_nanoid(person_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    relative_path = f"config/prosopography/{nanoid}.json"

    content = get_file_at_commit(relative_path, commit_hash)
    if content is None:
        raise HTTPException(status_code=404, detail="Commit ei leitud")

    try:
        person = json.loads(content)
    except json.JSONDecodeError:
        raise HTTPException(status_code=500, detail="JSON parse viga")

    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = user["username"]

    path = os.path.join(PROSOPOGRAPHY_DIR, f"{nanoid}.json")
    name = (person.get("name") or {}).get("label") or person_id
    save_with_git(
        path,
        json.dumps(person, ensure_ascii=False, indent=2),
        user["username"],
        message=f"Prosopo taastamine: {name} [{person_id}]",
    )

    _update_index_entry(person)
    _update_aliases_entry(person)
    return {"status": "ok", "person": person}


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


@router.delete("/{person_id:path}/delete")
async def prosopography_delete_person(
    person_id: str,
    request: Request,
    user=Depends(_require_role("admin")),
):
    """Kustutab isikukaardi jäädavalt (admin only). Blokeerib kui teostes/relations viited."""
    try:
        result = delete_person(person_id, username=user["username"])
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    except ValueError as e:
        msg = str(e)
        if msg.startswith("WORK_REFS:"):
            count = msg.split(":")[1]
            raise HTTPException(status_code=409, detail=f"Isikul on {count} teose viitet. Eemalda viited enne kustutamist.")
        if msg.startswith("RELATION_REFS:"):
            count = msg.split(":")[1]
            raise HTTPException(status_code=409, detail=f"Isikul on {count} seost teistes isikukaartides. Eemalda seosed enne kustutamist.")
        raise HTTPException(status_code=400, detail=msg)
    return result


@router.get("/relation-type-suggestions")
async def prosopography_relation_type_suggestions():
    """Tagastab kõigis kaartides kasutatud unikaalsed seose tüübid. Avalik endpoint."""
    return get_relation_type_suggestions()


@router.get("/work-relations/{person_id:path}")
async def prosopography_work_relations(
    person_id: str,
    limit: int = 10,
    offset: int = 0,
):
    """Teostest tuletatud isiku-isiku seosed. Avalik endpoint."""
    return get_work_relations(person_id, limit=limit, offset=offset)


# ── Places register ────────────────────────────────────────────────────────

@router.get("/places/wikidata-search")
async def places_wikidata_search(request: Request, q: str = "", lang: str = "en"):
    """Otsib Wikidatast kohti nime järgi. Avalik (rate-limititud, et vältida proksi kuritarvitust)."""
    _check_wikidata_rate_limit(request)
    return search_places_wikidata(q.strip(), lang=lang)


@router.get("/places/wikidata/{qid}")
async def places_wikidata_fetch(qid: str, request: Request):
    """Pärib Wikidatast koha andmed (labelid, tüüp, P131 ülempiirkonnad). Avalik (rate-limititud)."""
    _check_wikidata_rate_limit(request)
    result = fetch_place_wikidata(qid)
    if result is None:
        raise HTTPException(status_code=400, detail=f"Vigane Q-kood: {qid}")
    return result


@router.get("/places")
async def places_list():
    """Tagastab kõik places.json kirjed. Avalik — töötab kõigil rollidel."""
    return get_places()


@router.get("/places/meta")
async def places_meta():
    """Tagastab origin_groups.json sisu + lubatud type väärtused. Avalik."""
    return get_places_meta()


@router.post("/admin/places/refresh-labels")
def places_refresh_labels(user=Depends(_require_role("admin"))):
    """Värskendab kõik places.json kohade labelid Wikidatast + taastab indeksid (admin)."""
    count = refresh_all_place_labels()
    import threading
    threading.Thread(target=rebuild_indices, daemon=True).start()
    return {"updated": count}


@router.put("/admin/groups/{key}")
async def groups_put(key: str, request: Request, user=Depends(_require_role("admin"))):
    """Lisab või uuendab gruppi (admin). Body: {labels, sort_order, parent}"""
    data = await _get_json(request)
    try:
        return put_group(key, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/admin/groups/{key}")
async def groups_delete(key: str, user=Depends(_require_role("admin"))):
    """Kustutab grupi (admin)."""
    try:
        delete_group(key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"deleted": key}


@router.post("/admin/groups/auto-assign")
async def groups_auto_assign(user=Depends(_require_role("admin"))):
    """Rakendab automaatse parent seadmise teadaolevatele alamgruppidele."""
    return auto_assign_group_parents()


@router.delete("/admin/places/{key}")
async def places_delete(
    key: str,
    user=Depends(_require_role("admin")),
):
    """Kustutab koha places.json-st (admin). Blokeerib kui on alamkohti või isikuviiteid."""
    try:
        delete_place(key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"deleted": key}


@router.put("/admin/places/{key}")
async def places_put(
    key: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(_require_role("editor")),
):
    """
    Lisab/uuendab koha places.json-s.
    Nõuab editor rolli.
    Pärast salvestust käivitab sihtotstarbelise propagatsiooni background task-ina.
    Body: {id?, labels?, parent_key?, group?, type?, historical_names?, notes?}
    """
    data = await _get_json(request)
    try:
        entry = put_place(key, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    background_tasks.add_task(_propagate_place_change, key)

    return {"key": key, "entry": entry}


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
    Pärast salvestust sünkroniseerib vastastikused seosed (best-effort).
    """
    data = await _get_json(request)
    # Loe vana seis ENNE salvestust — server-side diff vastastikuste seoste jaoks
    old_person = get_person(person_id)
    old_relations = (old_person or {}).get("relations", [])
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
    # Sünkroniseeri vastastikused seosed (best-effort — viga ei blokeeri 200 vastust)
    try:
        a_label = (person.get("name") or {}).get("label", "")
        sync_reciprocals(
            person_id,
            old_relations,
            person.get("relations", []),
            a_label,
            username=user["username"],
        )
    except Exception:
        logger.exception("sync_reciprocals ebaõnnestus isiku %s jaoks", person_id)
    enrich_entity_labels_from_person_async(person)
    return person


@router.post("/admin/rebuild-indices")
async def prosopography_rebuild(
    user=Depends(_require_role("admin")),
):
    """Taastab kõik kolm read-modeli nullist (admin only)."""
    rebuild_indices()
    return {"status": "ok", "message": "Indeksid taastatud."}


@router.post("/bulk-occupation")
async def prosopography_bulk_occupation(
    request: Request,
    user=Depends(_require_role("editor")),
):
    """Massiga ameti määramine/asendamine. Nõuab editor-rolli."""
    data = await _get_json(request)
    occupation = data.get("occupation")
    mode = data.get("mode", "add")
    person_ids = data.get("person_ids") or []

    if not occupation or not isinstance(occupation, dict):
        raise HTTPException(status_code=400, detail="occupation on kohustuslik")
    if mode not in ("add", "replace"):
        raise HTTPException(status_code=400, detail="mode peab olema 'add' või 'replace'")
    if not person_ids:
        raise HTTPException(status_code=400, detail="person_ids on kohustuslik")

    return bulk_update_occupation(
        occupation=occupation,
        mode=mode,
        person_ids=person_ids,
    )
