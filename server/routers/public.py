import json
import os

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response, StreamingResponse

from ..access_ops import can_read_work, can_write_work, is_work_public
from ..admin_page_ops import get_sorted_images
from ..cache import get_cached_collections
from ..cache_invalidation import _sitemap_cache, _home_cache
from ..config import BASE_DIR
from ..deps import optional_user as _get_optional_user, require_role
from ..metadata_handler import build_home_meta_html, build_meta_html, build_person_meta_html, build_persons_meta_html, build_sitemap_xml
from ..metadata_ops import save_work_metadata
from ..prosopography.ops import _load_index, _load_work_collections, get_person_with_works, get_persons_for_work
from ..rate_limit import check_rate_limit, get_client_ip
from ..utils import find_directory_by_id
from ..work_meta import load_work_metadata as _load_work_metadata

router = APIRouter()


@router.post("/work/{work_id}/shareable")
async def toggle_shareable(work_id: str, request: Request, background_tasks: BackgroundTasks, user=Depends(require_role("editor"))):
    """Seab teose shareable lipu. Body: {shareable: bool}. Nähtav editorile ja adminile."""
    body = await request.json()
    shareable = bool(body.get("shareable", False))

    folder = find_directory_by_id(work_id)
    if not folder:
        return {"status": "error", "message": "Teos ei leitud"}

    meta_path = os.path.join(folder, '_metadata.json')
    # Kirjutamisõiguse kontroll praeguse (toggle-eelse) seisu põhjal (Leid G).
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                _cur_meta = json.load(f)
        except Exception:
            _cur_meta = None
        if _cur_meta is not None and not can_write_work(_cur_meta, user):
            raise HTTPException(status_code=403, detail="Puudub õigus selle teose jagamist muuta")
    slug = os.path.basename(folder)
    save_work_metadata(
        meta_path,
        {"shareable": shareable},
        user["username"],
        f"{'Aktiveeri' if shareable else 'Deaktiveeri'} jagamine: {slug}",
        background_tasks=background_tasks,
        sync_meili=True,
        call_ptw=False,
    )
    return {"status": "success", "shareable": shareable}


@router.get("/work/{work_id}/viewer-token")
async def get_viewer_token(work_id: str, request: Request):
    """Tagastab Meilisearch tokeni + pildi HMAC andmed juurdepääsuks ühele teosele.
    Kasutatakse shareable ja restricted teoste otselinkide jaoks."""
    import hashlib as _hashlib
    import hmac as _hmac
    import time as _time
    from ..config import IMAGE_TOKEN_SECRET
    from ..meilisearch_ops import generate_work_scoped_meili_token
    
    meta = _load_work_metadata(work_id)
    if meta is None:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    user = _get_optional_user(request)
    if not can_read_work(meta, user):
        raise HTTPException(status_code=403, detail="Ligipääs keelatud")
    meili_token = generate_work_scoped_meili_token(work_id)
    image_exp = int(_time.time()) + 3600
    image_sig = _hmac.new(
        IMAGE_TOKEN_SECRET.encode(),
        f"image:{work_id}:{image_exp}".encode(),
        _hashlib.sha256,
    ).hexdigest()
    return {"token": meili_token, "image_exp": image_exp, "image_sig": image_sig}


@router.get("/download/{work_id}")
async def download_work(request: Request, work_id: str, content: str = "both"):
    """Laeb alla teose failid.
    content:
      'text'   → üks kokku liidetud .txt fail (sequence järjekorras)
      'images' → ZIP kõigi piltidega
      'both'   → ZIP piltide + kokku liidetud tekstifailiga
    """
    import zipfile

    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/download')
    if not allowed:
        raise HTTPException(status_code=429, detail=f"Liiga palju päringuid. Proovi uuesti {retry_after}s pärast.")

    folder = find_directory_by_id(work_id)
    if not folder:
        raise HTTPException(status_code=404, detail="Teos ei leitud")

    # Ligipääsukontroll
    meta_for_access = _load_work_metadata(work_id)
    if meta_for_access is not None:
        user = _get_optional_user(request)
        if not can_read_work(meta_for_access, user):
            raise HTTPException(status_code=403, detail="Ligipääs keelatud")

    slug = os.path.basename(folder)

    # Loe metaandmed päise jaoks (tekst) ja failinimeks kasutame slug-i otse
    meta_path = os.path.join(folder, '_metadata.json')
    title = slug
    author = ''
    year = ''
    try:
        with open(meta_path, 'r', encoding='utf-8') as f:
            meta = json.load(f)
        title = meta.get('title', slug)
        year = str(meta.get('year', ''))
        creators = meta.get('creators', [])
        if creators:
            author = creators[0].get('name', '') if isinstance(creators[0], dict) else str(creators[0])
    except Exception:
        pass

    # Failinimeks: slug eesliitega aastaarv kui see seal juba pole
    file_slug = slug if (not year or slug.startswith(year)) else f"{year}-{slug}"

    # Sequence järgi sorteeritud pildid
    sorted_images = get_sorted_images(folder)

    if content == 'text':
        import re
        def _strip_tags(text: str) -> str:
            """Eemaldab XML/HTML tagid tekstist."""
            return re.sub(r'<[^>]+>', '', text)

        def _build_full_text() -> str:
            """Koostab kokku liidetud tekstifaili sisu (tagideta)."""
            parts = [title]
            if author: parts.append(f'\n{author}')
            if year: parts.append(f', {year}')
            parts.append('\n\n')
            for i, img_fname in enumerate(sorted_images, start=1):
                base = os.path.splitext(img_fname)[0]
                txt_path = os.path.join(folder, base + '.txt')
                if os.path.exists(txt_path):
                    parts.append(f'---- lk {i} ----\n')
                    with open(txt_path, 'r', encoding='utf-8') as f:
                        parts.append(_strip_tags(f.read()))
                    parts.append('\n')
            return ''.join(parts)
            
        buf = _build_full_text().encode('utf-8')
        return StreamingResponse(
            iter([buf]),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{file_slug}.txt"'}
        )

    # ZIP (images või both) — failid nimetatud {file_slug}_pg_NNN.ext sequence järjekorras
    import tempfile

    tmp = tempfile.NamedTemporaryFile(suffix='.zip', delete=False)
    try:
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zf:
            if os.path.exists(meta_path):
                zf.write(meta_path, f"{file_slug}/_metadata.json")

            for i, img_fname in enumerate(sorted_images, start=1):
                base = os.path.splitext(img_fname)[0]
                ext = img_fname.rsplit('.', 1)[-1].lower()

                # Lisa pilt
                img_path = os.path.join(folder, img_fname)
                if os.path.isfile(img_path):
                    zf.write(img_path, f"{file_slug}/{file_slug}_pg_{i:03d}.{ext}")

                # Lisa tekst eraldi failina (ainult 'both' puhul)
                if content == 'both':
                    txt_path = os.path.join(folder, base + '.txt')
                    if os.path.exists(txt_path):
                        zf.write(txt_path, f"{file_slug}/{file_slug}_pg_{i:03d}.txt")

        tmp.seek(0)

        def _stream_and_cleanup():
            try:
                with open(tmp.name, 'rb') as f:
                    while chunk := f.read(65536):
                        yield chunk
            finally:
                try:
                    os.unlink(tmp.name)
                except OSError:
                    pass

        return StreamingResponse(
            _stream_and_cleanup(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{file_slug}.zip"'}
        )
    except Exception:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
        raise

@router.get("/meta/home")
async def home_meta(request: Request):
    """Bot-koduleht: kollektsioonide kaupa grupeeritud teosed + isikute-hub.
    Linkgraafi peamine jaotuspunkt (iga avalik teos 1 hüppe kaugusel /-st)."""
    import time
    from .. import utils as utils_module
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/home')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    now = time.time()
    if _home_cache["html"] is None or now > _home_cache["expires"]:
        _home_cache["html"] = build_home_meta_html(
            dict(utils_module.WORK_ID_CACHE),
            is_work_public,
            _load_work_metadata,
            _load_work_collections(),
            get_cached_collections() or {},
        )
        _home_cache["expires"] = now + 3600
    return HTMLResponse(content=_home_cache["html"])


@router.get("/meta/persons")
async def persons_meta(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/persons')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    entries = _load_index().get("entries", [])
    return HTMLResponse(content=build_persons_meta_html(entries))


@router.get("/meta/person/{person_id:path}")
async def person_meta(person_id: str, request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/person')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    # Resolvi isiku AVALIKUD teosed ristviidete jaoks (linkgraaf isik↔teos)
    work_links = []
    person = get_person_with_works(person_id)
    if person:
        seen = set()
        for w in person.get("works", []):
            wid = w.get("work_id")
            if not wid or wid in seen:
                continue
            seen.add(wid)
            meta = _load_work_metadata(wid)
            if meta is None or not is_work_public(meta):
                continue
            work_links.append({"work_id": wid, "title": meta.get("title") or wid})
    html = build_person_meta_html(person_id, work_links=work_links)
    if html is None:
        return HTMLResponse(content="<html><body>Isikut ei leitud</body></html>", status_code=404)
    return HTMLResponse(content=html)


@router.get("/meta/work/{work_id}")
async def work_meta(work_id: str, request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, '/meta/work')
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"}, headers={"Retry-After": str(retry_after)})
    meta = _load_work_metadata(work_id)
    if meta is not None:
        user = _get_optional_user(request)
        if not can_read_work(meta, user):
            return HTMLResponse(content="<html><body>Ligipääs keelatud</body></html>", status_code=403)
    # Loojate isikukaardid ristviidete jaoks (linkgraaf teos↔isik)
    creator_persons = get_persons_for_work(work_id)
    return HTMLResponse(content=build_meta_html(work_id, creator_persons=creator_persons))

@router.get("/sitemap.xml")
async def sitemap_xml():
    import time
    from .. import utils as utils_module
    now = time.time()
    if _sitemap_cache["xml"] is None or now > _sitemap_cache["expires"]:
        person_index = _load_index()
        _sitemap_cache["xml"] = build_sitemap_xml(
            dict(utils_module.WORK_ID_CACHE),
            is_work_public,
            _load_work_metadata,
            person_index.get("entries", []),
        )
        _sitemap_cache["expires"] = now + 3600
    return Response(content=_sitemap_cache["xml"], media_type="application/xml")


