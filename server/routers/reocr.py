import json
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, Request

from ..deps import get_json_data, require_role
from ..reocr_ops import (
    REOCR_MAX_CONCURRENT,
    build_reocr_status,
    get_active_batch_for_work,
    get_active_reocr_count,
    get_reocr_log,
    list_reocr_jobs,
    poll_reocr_job,
    start_reocr_batch,
    start_reocr_job,
)
from ..utils import find_directory_by_id, generate_nanoid

router = APIRouter()


@router.post("/admin/work/{work_id}/reocr-page")
async def admin_reocr_page(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Alustab lehekülje pildi re-OCR tööd. Tagastab job_id pollimiseks."""
    if get_active_reocr_count() >= REOCR_MAX_CONCURRENT:
        raise HTTPException(status_code=429, detail=f"Liiga palju korraga ({REOCR_MAX_CONCURRENT} max). Proovi hetke pärast uuesti.")
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    slug = os.path.basename(path)
    data = await get_json_data(request)
    page_filename = data.get("page_filename")
    if not page_filename:
        raise HTTPException(status_code=400, detail="page_filename puudub")
    img_path = os.path.join(path, page_filename)
    if not os.path.isfile(img_path):
        raise HTTPException(status_code=404, detail="Pilti ei leitud")
    page_number = data.get("page_number")
    meta_path = os.path.join(path, "_metadata.json")
    ocr_model = "print"
    if os.path.isfile(meta_path):
        with open(meta_path, "r", encoding="utf-8") as _mf:
            _meta = json.load(_mf)
        if isinstance(_meta.get("type"), dict) and _meta["type"].get("id") == "Q87167":
            ocr_model = "hand"
    tmp_path = f"/tmp/vutt-reocr-{generate_nanoid()}.jpg"
    shutil.copy2(img_path, tmp_path)
    job_id = start_reocr_job(work_id, slug, tmp_path, page_filename=page_filename, page_number=page_number, username=user["username"], material_type=ocr_model)
    return {"status": "accepted", "job_id": job_id}


@router.get("/admin/reocr/{job_id}/status")
async def admin_reocr_status(job_id: str, user=Depends(require_role("admin"))):
    """Küsib re-OCR töö staatust. Küsida korduvalt kuni done/error."""
    return {"status": "success", **poll_reocr_job(job_id)}


def _enrich_titles(items: list) -> list:
    """Lisab igale re-OCR kirjele 'title' (teose pealkiri work_id järgi). Slug jääb alles
    (tehniline, OCR-serveris vaatamiseks). Fallback pealkirjale = slug. Per-call cache."""
    title_cache: dict = {}
    for it in items:
        work_id = it.get("work_id")
        slug = it.get("slug", "")
        if not work_id:
            it["title"] = slug
            continue
        if work_id not in title_cache:
            title = slug
            path = find_directory_by_id(work_id)
            if path:
                try:
                    with open(os.path.join(path, "_metadata.json"), "r", encoding="utf-8") as f:
                        title = json.load(f).get("title") or slug
                except Exception:
                    pass
            title_cache[work_id] = title
        it["title"] = title_cache[work_id]
    return items


@router.get("/admin/reocr/jobs")
async def admin_reocr_jobs(user=Depends(require_role("admin"))):
    """Tagastab kõigi aktiivsete ja hiljutiste re-OCR tööde loendi."""
    return {"status": "success", "jobs": _enrich_titles(list_reocr_jobs())}


@router.get("/admin/reocr/log")
async def admin_reocr_log(offset: int = 0, limit: int = 50, user=Depends(require_role("admin"))):
    """Tagastab re-OCR ajalogi (püsiv, uuemad ees)."""
    log = get_reocr_log(offset, limit)
    log["entries"] = _enrich_titles(log["entries"])
    return {"status": "success", **log}


@router.get("/admin/work/{work_id}/page-ocr")
async def get_page_ocr(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Tagastab lehekülje .ocr faili sisu, kui see eksisteerib."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    stem = os.path.splitext(os.path.basename(filename))[0]
    ocr_path = os.path.join(path, stem + ".ocr")
    if not os.path.isfile(ocr_path):
        raise HTTPException(status_code=404, detail=".ocr fail puudub")
    with open(ocr_path, "r", encoding="utf-8") as f:
        text = f.read()
    return {"status": "success", "text": text}


@router.delete("/admin/work/{work_id}/page-ocr")
async def delete_page_ocr(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Kustutab lehekülje .ocr faili (tulemus rakendatud või tagasi lükatud)."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    stem = os.path.splitext(os.path.basename(filename))[0]
    ocr_path = os.path.join(path, stem + ".ocr")
    if os.path.isfile(ocr_path):
        os.remove(ocr_path)
    return {"status": "success"}


@router.post("/admin/work/{work_id}/reocr-batch")
async def admin_reocr_batch(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Alustab mitme lehe batch re-OCR tööd. Tagastab job_id."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    if get_active_batch_for_work(work_id):
        raise HTTPException(status_code=409, detail="Sellel teosel käib juba batch re-OCR.")
    slug = os.path.basename(path)
    data = await get_json_data(request)
    page_filenames = data.get("page_filenames") or []
    if not isinstance(page_filenames, list) or not page_filenames:
        raise HTTPException(status_code=400, detail="page_filenames puudub või tühi")
    material_type = data.get("material_type") if data.get("material_type") in ("print", "hand") else "print"
    pages = []
    for fn in page_filenames:
        # Turvalisus: ainult bare failinimi — väldi path traversal'i (nt ../../state/users.json)
        if not isinstance(fn, str) or fn != os.path.basename(fn):
            raise HTTPException(status_code=400, detail=f"Vigane failinimi: {fn}")
        if not os.path.isfile(os.path.join(path, fn)):
            raise HTTPException(status_code=400, detail=f"Pilti ei leitud: {fn}")
        pages.append((fn, None))
    job_id = start_reocr_batch(work_id, slug, path, pages, material_type=material_type, username=user["username"])
    return {"status": "accepted", "job_id": job_id}


@router.get("/admin/work/{work_id}/reocr-status")
async def admin_reocr_status_for_work(work_id: str, user=Depends(require_role("admin"))):
    """Teose re-OCR koondstaatus manage-lehele (active/ocr_ready/errors/progress)."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", **build_reocr_status(work_id, path)}
