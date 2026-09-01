import json
import os
import shutil

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from ..auth import is_at_least
from ..config import gemini_enabled
from ..deps import get_json_data, require_role
from ..meilisearch_ops import sync_work_to_meilisearch_async
from ..reocr_apply import apply_ocr_results, discard_ocr_results
from ..reocr_ops import (
    REOCR_MAX_CONCURRENT,
    build_reocr_status,
    cancel_reocr_job,
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

VALID_PROVIDERS = ("loss", "gemini")


def _resolve_provider(data: dict, user: dict) -> str:
    """Pakkuja bodyst + rollivärav.

    Kontroll on FUNKTSIOONI sees, mitte `Depends`-is: FastAPI dependency ei näe
    request body't ja pakkuja tuleb sealt. LOSS-tee lävi jääb `admin`-iks.
    """
    provider = data.get("provider") or "loss"
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail="Tundmatu pakkuja: {}".format(provider))
    if provider == "gemini":
        if not is_at_least(user.get("role", "contributor"), "superadmin"):
            raise HTTPException(status_code=403, detail="Gemini-tee on ainult superadminile")
        if not gemini_enabled():
            raise HTTPException(status_code=503, detail="Gemini ei ole seadistatud (GEMINI_API_KEY)")
    return provider


def _prepare_reocr_page(path: str, page_filename: str):
    """Loeb mudeli meta ja kopeerib pildi temp-kausta blokeeriva I/O-na."""
    img_path = os.path.join(path, page_filename)
    if not os.path.isfile(img_path):
        raise HTTPException(status_code=404, detail="Pilti ei leitud")
    meta_path = os.path.join(path, "_metadata.json")
    ocr_model = "print"
    if os.path.isfile(meta_path):
        with open(meta_path, "r", encoding="utf-8") as meta_file:
            meta = json.load(meta_file)
        if isinstance(meta.get("type"), dict) and meta["type"].get("id") == "Q87167":
            ocr_model = "hand"
    tmp_path = f"/tmp/vutt-reocr-{generate_nanoid()}.jpg"
    shutil.copy2(img_path, tmp_path)
    return tmp_path, ocr_model


def _validate_batch_pages(path: str, page_filenames):
    """Kontrollib iga faili olemasolu (blokeeriv stat per fail); jookseb threadpool'is."""
    pages = []
    for fn in page_filenames:
        # Turvalisus: ainult bare failinimi — väldi path traversal'i (nt ../../state/users.json)
        if not isinstance(fn, str) or fn != os.path.basename(fn):
            raise HTTPException(status_code=400, detail=f"Vigane failinimi: {fn}")
        if not os.path.isfile(os.path.join(path, fn)):
            raise HTTPException(status_code=400, detail=f"Pilti ei leitud: {fn}")
        pages.append((fn, None))
    return pages


@router.post("/admin/work/{work_id}/reocr-page")
async def admin_reocr_page(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Alustab lehekülje pildi re-OCR tööd. Tagastab job_id pollimiseks."""
    if get_active_reocr_count() >= REOCR_MAX_CONCURRENT:
        raise HTTPException(status_code=429, detail=f"Liiga palju korraga ({REOCR_MAX_CONCURRENT} max). Proovi hetke pärast uuesti.")
    path = await run_in_threadpool(find_directory_by_id, work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teos ei leitud")
    slug = os.path.basename(path)
    data = await get_json_data(request)
    page_filename = data.get("page_filename")
    if not page_filename:
        raise HTTPException(status_code=400, detail="page_filename puudub")
    # Turvalisus: ainult bare failinimi — väldi path traversal'i (nt ../../state/users.json)
    if not isinstance(page_filename, str) or page_filename != os.path.basename(page_filename):
        raise HTTPException(status_code=400, detail="Vigane failinimi")
    page_number = data.get("page_number")
    provider = _resolve_provider(data, user)
    tmp_path, ocr_model = await run_in_threadpool(
        _prepare_reocr_page, path, page_filename
    )
    job_id = await run_in_threadpool(
        start_reocr_job,
        work_id,
        slug,
        tmp_path,
        page_filename=page_filename,
        page_number=page_number,
        username=user["username"],
        material_type=ocr_model,
        provider=provider,
    )
    return {"status": "accepted", "job_id": job_id}


@router.get("/admin/reocr/{job_id}/status")
async def admin_reocr_status(job_id: str, user=Depends(require_role("admin"))):
    """Küsib re-OCR töö staatust. Küsida korduvalt kuni done/error."""
    # poll_reocr_job teeb SFTP stat/getfo päringuid; ära blokeeri uvicorni event-loopi.
    result = await run_in_threadpool(poll_reocr_job, job_id)
    return {"status": "success", **result}


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
def admin_reocr_jobs(user=Depends(require_role("admin"))):
    """Tagastab kõigi aktiivsete ja hiljutiste re-OCR tööde loendi."""
    return {"status": "success", "jobs": _enrich_titles(list_reocr_jobs())}


@router.get("/admin/reocr/log")
def admin_reocr_log(offset: int = 0, limit: int = 50, user=Depends(require_role("admin"))):
    """Tagastab re-OCR ajalogi (püsiv, uuemad ees)."""
    log = get_reocr_log(offset, limit)
    log["entries"] = _enrich_titles(log["entries"])
    return {"status": "success", **log}


@router.get("/admin/work/{work_id}/page-ocr")
def get_page_ocr(work_id: str, filename: str, user=Depends(require_role("admin"))):
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
def delete_page_ocr(work_id: str, filename: str, user=Depends(require_role("admin"))):
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
    path = await run_in_threadpool(find_directory_by_id, work_id)
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
    provider = _resolve_provider(data, user)
    # Failide olemasolu-kontroll (kuni terve teose jagu stat-e) threadpool'is
    pages = await run_in_threadpool(_validate_batch_pages, path, page_filenames)
    job_id = await run_in_threadpool(
        start_reocr_batch,
        work_id,
        slug,
        path,
        pages,
        material_type=material_type,
        username=user["username"],
        provider=provider,
    )
    return {"status": "accepted", "job_id": job_id}


@router.get("/admin/work/{work_id}/reocr-status")
def admin_reocr_status_for_work(work_id: str, user=Depends(require_role("admin"))):
    """Teose re-OCR koondstaatus manage-lehele (active/ocr_ready/errors/progress)."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", **build_reocr_status(work_id, path)}


def _validate_apply_pages(page_filenames) -> list:
    """Ainult mittetühi list bare failinimesid — väldi path traversal'i.

    Sama kaitse nagu _validate_batch_pages, aga ilma kettakontrollita (puuduv
    .ocr ei ole viga, see läheb 'failed' loendisse).
    """
    if not isinstance(page_filenames, list) or not page_filenames:
        raise HTTPException(status_code=400, detail="page_filenames puudub või tühi")
    for fn in page_filenames:
        if not isinstance(fn, str) or not fn or fn != os.path.basename(fn):
            raise HTTPException(status_code=400, detail=f"Vigane failinimi: {fn}")
    return page_filenames


@router.post("/admin/work/{work_id}/reocr-apply")
async def admin_reocr_apply(
    work_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(require_role("admin")),
):
    """Rakendab ootel .ocr tulemused .txt failidesse: ÜKS git-commit, ÜKS Meili sünk.

    Lehtede loend tuleb kliendilt, mitte serveri "võta kõik" loogikast — nii
    rakendatakse täpselt see, mida kasutajale kinnitusdialoogis näidati.
    """
    path = await run_in_threadpool(find_directory_by_id, work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    data = await get_json_data(request)
    page_filenames = _validate_apply_pages(data.get("page_filenames"))
    result = await run_in_threadpool(
        apply_ocr_results, path, page_filenames, user["username"]
    )
    if result["applied"]:
        background_tasks.add_task(sync_work_to_meilisearch_async, os.path.basename(path))
    return {"status": "success", **result}


@router.post("/admin/work/{work_id}/reocr-discard")
async def admin_reocr_discard(
    work_id: str, request: Request, user=Depends(require_role("admin"))
):
    """Kustutab ootel .ocr tulemused ilma rakendamata. Sisu ei muutu → Meili sünki pole."""
    path = await run_in_threadpool(find_directory_by_id, work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    data = await get_json_data(request)
    page_filenames = _validate_apply_pages(data.get("page_filenames"))
    result = await run_in_threadpool(discard_ocr_results, path, page_filenames)
    return {"status": "success", **result}


@router.delete("/admin/reocr/{job_id}")
def admin_reocr_cancel(job_id: str, user=Depends(require_role("admin"))):
    """Katkestab re-OCR töö (üksik või batch).

    Sync def — kogu töö on blokeeriv I/O (SFTP + failisüsteem), ADR 0002.

    200 garanteerib VUTT-i poole katkestamise: pollimist ei ole, teose lukk on
    vaba, tulemust ei rakendata. Kui LOSSi koristus ebaõnnestus, võib
    kaugserveris jääk edasi eksisteerida — vastuses `remote_cleanup: "failed"`.
    """
    try:
        return cancel_reocr_job(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Tööd ei leitud")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        # Kirjutaja ei peatunud — töö jääb `cancelling` olekusse, stardi-taaste
        # korjab üles. Klient võib hiljem uuesti proovida.
        raise HTTPException(status_code=503, detail=str(e))
