import json
import os
import re
import unicodedata
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from ..access_ops import require_catalog_access
from ..auth import is_at_least
from ..cache import get_cached_suggestions
from ..cache_invalidation import invalidate_all_caches as _invalidate_all_caches
from ..comment_history_ops import (
    apply_comment_restore,
    build_comment_history,
    find_comment_in_content,
)
from ..config import BASE_DIR
from ..deps import get_json_data, get_user, require_role
from ..entity_labels_ops import enrich_entity_labels_async, enrich_entity_labels_async_qcodes
from ..git_ops import (
    get_commit_diff,
    get_file_at_commit,
    get_file_git_history,
    get_recent_commits,
    save_with_git,
)
from ..marginalia_normalize import normalize_marginalia_tags
from ..meilisearch_ops import sync_work_to_meilisearch_async
from ..metadata_ops import bulk_update_works, save_work_metadata
from ..people_ops import process_person_fields_metadata
from ..prosopography.relations import update_page_person_mentions
from ..save_diff import page_content_unchanged
from ..utils import find_directory_by_id
router = APIRouter()

# Võtmed, mille SERVER kirjutab ja mida klient ei saada tagasi. Ilma nendeta
# pühiks iga redaktori salvestus need vaikselt ära — miski ei kuku, andmed
# lihtsalt kaovad. Uus serveripoolne lehe-väli LISATAKSE SIIA.
SERVERIPOOLSED_LEHE_VALJAD = ("sequence", "source")


def merge_serveripoolsed_valjad(olemasolev: dict, kliendilt: dict) -> dict:
    """Täidab kliendi meta_content'i augud kettal olevate serveriväljadega.

    Täidab AINULT augud: kui klient saatis välja, jääb kliendi oma peale.
    """
    tulemus = dict(kliendilt)
    wrapper = olemasolev.get("meta_content") if isinstance(olemasolev, dict) else None
    if not isinstance(wrapper, dict):
        wrapper = {}
    for vali in SERVERIPOOLSED_LEHE_VALJAD:
        vana = olemasolev.get(vali) if isinstance(olemasolev, dict) else None
        if vana is None:
            vana = wrapper.get(vali)
        if vana is not None and tulemus.get(vali) is None:
            tulemus[vali] = vana
    return tulemus


def _require_catalog_access(catalog: str, user: dict, *, write: bool = False) -> dict:
    """Õhuke wrapper jagatud helperi ümber — annab kaasa selle mooduli enda
    BASE_DIR-i (testid patchivad `editing.BASE_DIR`, mitte `access_ops`-i)."""
    return require_catalog_access(catalog, user, BASE_DIR, write=write)


def _catalog_from_filepath(filepath: str) -> tuple[str, str]:
    """Normaliseerib git-diffi tee kujule ``catalog/filename``."""
    parts = [part for part in str(filepath or "").replace("\\", "/").strip("/").split("/") if part]
    if len(parts) < 2 or any(part in (".", "..") for part in parts):
        raise HTTPException(status_code=400, detail="Vigane failitee")
    catalog, filename = parts[-2], parts[-1]
    if catalog != os.path.basename(catalog) or filename != os.path.basename(filename):
        raise HTTPException(status_code=400, detail="Vigane failitee")
    # Ligipääsuotsus kasutab teose kataloogi (eelviimane segment), kuid git-filter
    # peab säilitama kogu repo-suhtelise tee, sh config/prosopography prefiksi.
    return catalog, "/".join(parts)


@router.post("/save")
# NB: contributor tohib salvestada, aga ainult oma edit_collections'i teostesse —
# ulatuse kontrollib _require_catalog_access(write=True) allpool (ADR 0031).
async def save(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    text = unicodedata.normalize('NFC', data.get('text_content', '')) if data.get('text_content') else ""
    # Marginaalia-tägid kanoonilisele kujule (<m> välimiseks) — hoiab failid puhtana
    # ja teeb editori/otsingu usaldusväärseks (vt server/marginalia_normalize.py).
    text = normalize_marginalia_tags(text)
    catalog, filename = os.path.basename(data.get('original_path', '')), os.path.basename(data.get('file_name', ''))
    if not catalog or not filename: raise HTTPException(status_code=400, detail="Vigased teed")

    # Puuduv/vigane meta ei tohi muuta piiratud teose kontrolli fail-open'iks.
    await run_in_threadpool(_require_catalog_access, catalog, user, write=True)

    txt_path = os.path.join(BASE_DIR, catalog, filename)
    additional = []
    json_path = None
    meta_content = None
    if data.get('meta_content'):
        json_path = os.path.join(BASE_DIR, catalog, os.path.splitext(filename)[0] + ".json")
        meta_content = data['meta_content']
        # Säilita serveripoolsed väljad (nt sequence, source), mida klient ei saada.
        if os.path.exists(json_path):
            try:
                existing = await run_in_threadpool(_read_json_file, json_path)
                meta_content = merge_serveripoolsed_valjad(existing, meta_content)
            except Exception:
                pass
        additional.append((json_path, json.dumps(meta_content, indent=2, ensure_ascii=False)))

    # Muutusteta Ctrl+S: ei kirjuta kettale, ei commiti ega indekseeri (#173).
    # Kliendi värske updated_at üksi ei ole muudatus — vt server/save_diff.py.
    if await run_in_threadpool(page_content_unchanged, txt_path, text, json_path, meta_content):
        return {"status": "success", "changed": False, "git_committed": True, "commit_hash": ""}

    git_result = await run_in_threadpool(
        save_with_git,
        txt_path,
        text,
        user['username'],
        additional_files=additional if additional else None,
    )
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    work_id = (data.get('meta_content') or {}).get('work_id')
    if work_id:
        work_dir = os.path.join(BASE_DIR, catalog)
        background_tasks.add_task(update_page_person_mentions, work_id, work_dir)
    page_tag_qcodes = {
        t['id'] for t in (data.get('meta_content') or {}).get('page_tags', [])
        if isinstance(t, dict) and isinstance(t.get('id'), str) and t['id'].startswith('Q')
    }
    if page_tag_qcodes:
        background_tasks.add_task(enrich_entity_labels_async_qcodes, page_tag_qcodes)

    response = {"status": "success", "changed": True, "commit_hash": git_result.get("commit_hash", "")[:8], "git_committed": True}
    if git_result.get("success") is False:
        response["git_committed"] = False
        response["warning"] = "Tekst salvestati kettale, aga Git versioonihalduse commit ebaõnnestus."
        if git_result.get("error"):
            response["git_error"] = git_result.get("error")
    return response



@router.post("/update-work-metadata")
async def update_work_metadata(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    path = find_directory_by_id(data.get('work_id')) or os.path.join(BASE_DIR, os.path.basename(data.get('original_path', '')))
    meta_path = os.path.join(path, '_metadata.json')
    slug = os.path.basename(path)

    meta, changed = await run_in_threadpool(
        save_work_metadata,
        meta_path,
        data.get('metadata', {}),
        user['username'],
        f"Meta: {slug}",
        background_tasks=background_tasks,
        # Fail + Git peavad enne vastust valmis olema; Meilisearchi tuletatud
        # indeks võib uueneda taustal nagu lehekülje salvestamisel.
        sync_meili=False,
        call_ptw=True,
    )
    # Muutusteta salvestus ei vaja rikastamist ega cache'ide tühjendamist (#173).
    if changed:
        background_tasks.add_task(process_person_fields_metadata, meta)
        background_tasks.add_task(enrich_entity_labels_async, meta)
        _invalidate_all_caches()
    return {"status": "success", "changed": changed}

@router.post("/get-work-metadata")
async def get_work_meta_direct(request: Request, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    path = find_directory_by_id(data.get("work_id"))
    if path is None:
        raw_path = data.get("original_path", "")
        catalog = os.path.basename(raw_path) if raw_path else ""
    else:
        catalog = os.path.basename(path)
    metadata = await run_in_threadpool(_require_catalog_access, catalog, user)
    return {"status": "success", "metadata": metadata}

@router.post("/get-metadata-suggestions")
async def metadata_suggestions(request: Request, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    return {"status": "success", **get_cached_suggestions(data.get('lang', 'et'))}

# =========================================================
# GIT AJALUGU JA BULK
# =========================================================

def _resolve_bulk_items(work_ids, transform):
    """Lahendab work_id-d meta-teedeks. Tagastab (items, tundmatud_arv).

    Failisüsteemi skaneering (`find_directory_by_id`) käib threadpoolis, mitte
    event-loopis (ADR 0002).
    """
    items = []
    unknown = 0
    for work_id in work_ids or []:
        path = find_directory_by_id(work_id)
        meta_path = os.path.join(path, '_metadata.json') if path else None
        if meta_path and os.path.exists(meta_path):
            items.append((meta_path, transform))
        else:
            unknown += 1
    return items, unknown


async def _run_bulk(work_ids, transform, username, label, background_tasks, *, call_ptw=False):
    """Ühine bulk-tee: üks commit, garanteeritud Meili sünk, loendurid (#175)."""
    items, unknown = await run_in_threadpool(_resolve_bulk_items, work_ids, transform)
    counts = await run_in_threadpool(
        bulk_update_works,
        items,
        username,
        f"{label}: {len(items)} teost",
        background_tasks=background_tasks,
        call_ptw=call_ptw,
    )
    counts["failed"] += unknown
    _invalidate_all_caches()
    return {"status": "success", **counts}


@router.get("/recent-edits")
async def recent_edits(request: Request, user=Depends(get_user)):
    f_user = request.query_params.get('user') if is_at_least(user['role'], 'admin') else user['username']
    # Kollektsioonifilter ainult kitsendab; isikukaardid jäävad filtriga välja.
    f_collection = request.query_params.get('collection') or None
    res = await run_in_threadpool(
        get_recent_commits,
        username=f_user,
        limit=int(request.query_params.get('limit', 30)),
        skip=int(request.query_params.get('offset', 0)),
        collection=f_collection,
    )
    return {"status": "success", "commits": res["commits"], "has_more": res["has_more"], "is_admin": is_at_least(user['role'], 'admin')}

@router.post("/git-history")
async def git_history(request: Request, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    catalog = os.path.basename(data.get('original_path', ''))
    filename = os.path.basename(data.get('file_name', ''))
    if not catalog or not filename:
        raise HTTPException(status_code=400, detail="Vigane failitee")
    await run_in_threadpool(_require_catalog_access, catalog, user)
    path = os.path.join(catalog, filename)
    history = await run_in_threadpool(get_file_git_history, path)
    return {"status": "success", "history": history}

@router.post("/commit-diff")
async def commit_diff(request: Request, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    commit_hash = data.get('commit_hash')
    catalog, clean_path = _catalog_from_filepath(data.get('filepath', ''))
    try:
        await run_in_threadpool(_require_catalog_access, catalog, user)
    except HTTPException as exc:
        # Admini Review-vaade peab jätkuvalt nägema config/prosopography committe;
        # editorile on mitte-teose tee alati keelatud.
        if not (exc.status_code == 404 and is_at_least(user['role'], 'admin')):
            raise
    diff_res = await run_in_threadpool(get_commit_diff, commit_hash, filepaths=clean_path)
    return {"status": "success", **diff_res} if diff_res else {"status": "error"}

def _validate_page_paths(data):
    """Tuletab + valideerib catalog/filename/json-teed (ühine history+restore).

    Returns (catalog, filename, json_relpath, json_path, txt_path) või tõstab 400.
    """
    raw_file = data.get('file_name', '')
    if not raw_file or os.path.basename(raw_file) != raw_file:
        raise HTTPException(status_code=400, detail="Vigane failinimi")
    catalog = os.path.basename(data.get('original_path', ''))
    if not catalog:
        raise HTTPException(status_code=400, detail="Vigane tee")
    json_filename = os.path.splitext(raw_file)[0] + ".json"
    json_relpath = os.path.join(catalog, json_filename)
    json_path = os.path.join(BASE_DIR, catalog, json_filename)
    txt_path = os.path.join(BASE_DIR, catalog, raw_file)
    # Path traversal kaitse: tulemus peab jääma BASE_DIR-i
    base_real = os.path.realpath(BASE_DIR)
    if not os.path.realpath(json_path).startswith(base_real + os.sep):
        raise HTTPException(status_code=400, detail="Tee väljaspool lubatud kataloogi")
    return catalog, raw_file, json_relpath, json_path, txt_path


def _read_json_file(path: str):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def _read_text_file(path: str):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()


def _read_current_comments(json_path):
    """Loeb praeguse comments-massiivi kettalt (toetab meta_content wrapperit)."""
    if not os.path.exists(json_path):
        return []
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    source = data.get('meta_content', data) if isinstance(data, dict) else {}
    comments = source.get('comments', []) if isinstance(source, dict) else []
    return comments or []


@router.post("/page-comments/history")
async def page_comments_history(request: Request, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    _catalog, _filename, json_relpath, json_path, _txt = _validate_page_paths(data)
    await run_in_threadpool(_require_catalog_access, _catalog, user)
    current = await run_in_threadpool(_read_current_comments, json_path)
    result = await run_in_threadpool(build_comment_history, json_relpath, current)
    return {"status": "success", **result}


@router.post("/page-comments/restore")
async def page_comments_restore(
    request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("contributor"))
):
    data = await get_json_data(request)
    mode = data.get('mode')
    comment_id = data.get('comment_id')
    commit_hash = data.get('commit_hash')
    if mode not in ("version", "deleted") or not comment_id or not commit_hash:
        raise HTTPException(status_code=400, detail="Vigased parameetrid")

    catalog, _filename, json_relpath, json_path, txt_path = _validate_page_paths(data)
    await run_in_threadpool(_require_catalog_access, catalog, user, write=True)

    # commit_hash peab kuuluma SELLE faili ajalukku (mitte suvaline git-objekt)
    history = await run_in_threadpool(get_file_git_history, json_relpath, max_count=500)
    valid = {h['full_hash'] for h in history} | {h['hash'] for h in history}
    if commit_hash not in valid:
        raise HTTPException(status_code=400, detail="Commit ei kuulu selle faili ajalukku")

    content = await run_in_threadpool(get_file_at_commit, json_relpath, commit_hash)
    if content is None:
        raise HTTPException(status_code=400, detail="Commitist ei leitud faili")
    restored = find_comment_in_content(content, comment_id)
    if restored is None:
        raise HTTPException(status_code=404, detail="Kommentaari ei leitud sellest commitist")

    if not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="Lehe metaandmeid ei leitud")
    cur_data = await run_in_threadpool(_read_json_file, json_path)
    source = cur_data['meta_content'] if (
        isinstance(cur_data, dict) and isinstance(cur_data.get('meta_content'), dict)
    ) else cur_data
    current = source.get('comments', []) or []

    new_comments, error = apply_comment_restore(current, restored, mode)
    if error is not None:
        raise HTTPException(status_code=error[0], detail=error[1])
    source['comments'] = new_comments

    # .txt jääb muutmata (taastame ainult kommentaari)
    txt = await run_in_threadpool(_read_text_file, txt_path)

    await run_in_threadpool(
        save_with_git,
        txt_path,
        txt,
        user['username'],
        message=f"Restore comment {comment_id}: {commit_hash[:8]}",
        additional_files=[(json_path, json.dumps(cur_data, indent=2, ensure_ascii=False))],
    )
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {"status": "success", "comments": new_comments}


@router.post("/git-restore")
async def git_restore(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("contributor"))):
    data = await get_json_data(request)
    catalog, filename = os.path.basename(data.get('original_path', '')), os.path.basename(data.get('file_name', ''))
    if not catalog or not filename:
        raise HTTPException(status_code=400, detail="Vigane failitee")
    await run_in_threadpool(_require_catalog_access, catalog, user, write=True)
    path = os.path.join(BASE_DIR, catalog, filename)
    content = await run_in_threadpool(
        get_file_at_commit, os.path.join(catalog, filename), data.get('commit_hash')
    )
    if content is None: raise HTTPException(status_code=400, detail="Ei leitud")

    additional = None
    restored_text_annotations = None
    json_filename = os.path.splitext(filename)[0] + ".json"
    json_path = os.path.join(BASE_DIR, catalog, json_filename)
    restored_json = await run_in_threadpool(
        get_file_at_commit, os.path.join(catalog, json_filename), data.get('commit_hash')
    )
    if os.path.exists(json_path):
        current_meta = await run_in_threadpool(_read_json_file, json_path)
        if restored_json is not None:
            try:
                restored_meta = json.loads(restored_json)
                restored_text_annotations = restored_meta.get('text_annotations', [])
            except json.JSONDecodeError:
                restored_text_annotations = None
        elif not re.search(r"<ann\d+>", content):
            restored_text_annotations = []

        if restored_text_annotations is not None:
            current_meta['text_annotations'] = restored_text_annotations
            current_meta['updated_at'] = datetime.now().isoformat()
            additional = [(json_path, json.dumps(current_meta, indent=2, ensure_ascii=False))]

    await run_in_threadpool(
        save_with_git,
        path,
        content,
        user['username'],
        message=f"Restore: {data.get('commit_hash')[:8]}",
        additional_files=additional,
    )
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return {
        "status": "success",
        "restored_content": content,
        "restored_text_annotations": restored_text_annotations,
    }

@router.post("/works/bulk-collection")
async def bulk_collection(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Määrab mitme teose kollektsioonid korraga.

    Body: { work_ids: [...], mode: "add"|"set"|"remove", collection_id: "..." }
    - add: lisab kollektsiooni (kui pole juba)
    - set: asendab kõik kollektsioonid üheainsaga
    - remove: eemaldab konkreetse kollektsiooni
    - set + collection_id null/puudub: tühjendab kõik kollektsioonid
    """
    data = await get_json_data(request)
    mode = data.get('mode', 'set')
    collection_id = data.get('collection_id') or data.get('collection')

    def make_transform(coll_id=collection_id, m=mode):
        def transform(meta):
            current = meta.get('collections', [])
            if m == 'add':
                if coll_id and coll_id not in current:
                    return {'collections': current + [coll_id]}
                return {'collections': current}
            elif m == 'remove':
                return {'collections': [c for c in current if c != coll_id]}
            else:  # set
                return {'collections': [coll_id] if coll_id else []}
        return transform

    return await _run_bulk(
        data.get('work_ids', []), make_transform(), user['username'],
        "Bulk collection", background_tasks,
    )

@router.post("/works/bulk-tags")
async def bulk_tags(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    data = await get_json_data(request)
    tags_to_update = data.get('tags', [])
    tag_mode = data.get('mode', 'set')

    def make_transform(mode=tag_mode, new_tags=tags_to_update):
        def transform(meta):
            cur = list(meta.get('tags', []))
            if mode == 'add':
                for t in new_tags:
                    if t not in cur:
                        cur.append(t)
            elif mode == 'remove':
                remove_ids = {t['id'] for t in new_tags if t.get('id')}
                remove_labels = {t.get('label', '').lower() for t in new_tags if not t.get('id')}
                cur = [t for t in cur if not (
                    (t.get('id') and t['id'] in remove_ids) or
                    (not t.get('id') and t.get('label', '').lower() in remove_labels)
                )]
            else:
                cur = list(new_tags)
            return {'tags': cur}
        return transform

    return await _run_bulk(
        data.get('work_ids', []), make_transform(), user['username'],
        "Bulk tags", background_tasks, call_ptw=True,
    )

@router.post("/works/bulk-genre")
async def bulk_genre(request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("admin"))):
    """Määrab žanri mitmele teosele korraga.

    Body: { work_ids: [...], genre: LinkedEntity|null, mode: "add"|"set"|"remove" }
    - add: lisab žanri olemasolevate hulka (vaikimisi)
    - set: asendab kõik žanrid [genre]-ga (genre=null → tühjendab)
    - remove: eemaldab konkreetse žanri
    """
    data = await get_json_data(request)
    genre = data.get('genre')
    mode = data.get('mode', 'add')

    def make_transform(g=genre, m=mode):
        def transform(meta):
            current = meta.get('genre', [])
            if not isinstance(current, list):
                current = [current] if current else []
            if m == 'add':
                if g and g not in current:
                    current = current + [g]
            elif m == 'remove':
                current = [x for x in current if x != g]
            else:  # set
                current = [g] if g else []
            return {'genre': current}
        return transform

    return await _run_bulk(
        data.get('work_ids', []), make_transform(), user['username'],
        "Bulk genre", background_tasks,
    )

