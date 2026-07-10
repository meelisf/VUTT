import json
import os
import shutil
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from ..admin_page_ops import (
    clear_original_backup,
    delete_pages,
    detect_and_convert_image,
    get_page_sequence,
    get_sorted_images,
    rebalance_sequences,
    reorder_pages,
    restore_original_page_image,
    split_page,
    transform_page_image,
    work_lock,
    write_new_page,
    add_pages,
    _validate_base_names,
)
from ..config import BASE_DIR, get_logger
from ..deps import get_json_data, require_role
from ..git_ops import delete_page_from_git, save_with_git
from ..image_server import generate_thumbnail
from ..meilisearch_ops import sync_work_to_meilisearch
from ..utils import find_directory_by_id

logger = get_logger(__name__)
router = APIRouter()


@router.get("/admin/work/{work_id}/pages")
def admin_work_pages(work_id: str, user=Depends(require_role("admin"))):
    """Tagastab teose lehekülgede nimekirja halduseks (sequence järgi sorditud)."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    images = get_sorted_images(path)
    pages = []
    for i, img_name in enumerate(images):
        base = os.path.splitext(img_name)[0]
        json_path = os.path.join(path, base + ".json")
        txt_path = os.path.join(path, base + ".txt")

        status = "Toores"
        sequence = (i + 1) * 100
        if os.path.exists(json_path):
            try:
                with open(json_path, "r", encoding="utf-8") as f:
                    d = json.load(f)
                src = d.get("meta_content", d)
                status = src.get("status", "Toores")
                seq = d.get("sequence") or d.get("meta_content", {}).get("sequence")
                if seq is not None:
                    sequence = int(seq)
            except Exception:
                pass

        pages.append({
            "page_num": i + 1,
            "sequence": sequence,
            "base_name": base,
            "filename": img_name,
            "lehekylje_pilt": f"{folder_name}/{img_name}",
            "status": status,
            "has_text": os.path.exists(txt_path) and os.path.getsize(txt_path) > 0,
        })

    return {"status": "success", "pages": pages}


@router.delete("/admin/work/{work_id}/page/{page_num}")
def admin_delete_page(work_id: str, page_num: int, user=Depends(require_role("admin"))):
    """Kustutab teose lehekülje: liigutab .jpg prügikasti, kustutab .txt ja .json gitist."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    with work_lock(folder_name, path):
        images = get_sorted_images(path)
        if page_num < 1 or page_num > len(images):
            raise HTTPException(status_code=404, detail=f"Lehekülge {page_num} ei leitud")

        img_name = images[page_num - 1]
        base = os.path.splitext(img_name)[0]

        # Liiguta .jpg prügikasti
        trash_dir = os.path.join(BASE_DIR, "._trash", work_id, "pages")
        os.makedirs(trash_dir, exist_ok=True)
        img_path = os.path.join(path, img_name)
        if os.path.exists(img_path):
            shutil.move(img_path, os.path.join(trash_dir, img_name))

        # Kustuta .txt ja .json gitist
        commit_msg = f"Kustuta leht {page_num}: {folder_name}/{base} [{work_id}]"
        delete_page_from_git(folder_name, base, commit_msg, username=user["username"])

        # Sünkroniseeri Meilisearch (leheküljed renumberdatakse)
        sync_work_to_meilisearch(folder_name)

        new_page_count = len(get_sorted_images(path))
        return {"status": "success", "new_page_count": new_page_count}


@router.post("/admin/work/{work_id}/delete-pages")
async def admin_delete_pages(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Kustutab mitu lehekülge korraga (kõik-või-mitte-midagi)."""
    try:
        body = await request.json()
        base_names = _validate_base_names(body.get("base_names"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        raise HTTPException(status_code=400, detail="Vigane päring")

    result = await run_in_threadpool(delete_pages, work_id, base_names, username=user["username"])
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail={"missing": result["missing"]})
    if result["status"] == "conflict":
        raise HTTPException(status_code=409, detail={"missing": result["missing"]})
    return result


@router.post("/admin/work/{work_id}/page/{page_num}/replace-image")
def admin_replace_page_image(
    work_id: str,
    page_num: int,
    file: UploadFile = File(...),
    user=Depends(require_role("admin")),
):
    """
    Asendab lehekülje pildi uuega. Vana pilt säilitatakse prügikastis 90 päeva.
    Body: multipart — file (JPG/PNG)
    """
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    # Kogu endpoint on sync def: FastAPI käitab Pillow/fail/git/Meili tee threadpoolis.
    content = file.file.read()
    try:
        content, _ext = detect_and_convert_image(content, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    with work_lock(folder_name, path):
        images = get_sorted_images(path)
        if page_num < 1 or page_num > len(images):
            raise HTTPException(status_code=404, detail=f"Lehekülge {page_num} ei leitud")

        img_name = images[page_num - 1]
        img_path = os.path.join(path, img_name)
        base = os.path.splitext(img_name)[0]

        # Salvesta vana pilt prügikasti (._trash/{work_id}/replaced_images/)
        trash_dir = os.path.join(BASE_DIR, "._trash", work_id, "replaced_images")
        os.makedirs(trash_dir, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        trash_filename = f"{base}_{timestamp}{os.path.splitext(img_name)[1]}"
        if os.path.exists(img_path):
            shutil.copy2(img_path, os.path.join(trash_dir, trash_filename))
            logger.info(f"REPLACE-IMG: Vana pilt salvestatud: {trash_filename}")

        # Kirjuta uus pilt üle
        with open(img_path, "wb") as f:
            f.write(content)
        os.chmod(img_path, 0o644)

        # Regenereeri thumbnail
        thumbs_dir = os.path.join(path, "_thumbs")
        os.makedirs(thumbs_dir, exist_ok=True)
        thumb_path = os.path.join(thumbs_dir, f"_thumb_{img_name}")
        if os.path.exists(thumb_path):
            os.remove(thumb_path)
        generate_thumbnail(img_path, thumb_path)

        # Kirjuta püsiv logi
        log_path = os.path.join(BASE_DIR, "replace_image.log")
        log_entry = f"{datetime.now().isoformat()} | {work_id} | {folder_name}/{img_name} | leht {page_num} | {user['username']}\n"
        with open(log_path, "a", encoding="utf-8") as lf:
            lf.write(log_entry)

        # Asendatud pilt on lehe uus pristine algolek → eemalda vana ._originals kirje
        clear_original_backup(work_id, img_name)

        logger.info(f"REPLACE-IMG: {folder_name}/{img_name} asendatud ({user['username']})")
        sync_work_to_meilisearch(folder_name)
        return {"status": "success", "filename": img_name}


@router.post("/admin/work/{work_id}/add-page")
def admin_add_page(
    work_id: str,
    file: UploadFile = File(...),
    after_page_num: int = Form(-1),
    user=Depends(require_role("admin")),
):
    """
    Lisab teosele uue lehekülje (JPG/PNG).
    Body: multipart — file (JPG/PNG), after_page_num (int, 0=algusesse, -1=lõppu)
    Laienduspunkt: ocr_requested (bool, praegu ignoreeritakse)
    """
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    folder_name = os.path.basename(path)

    # Kogu endpoint on sync def: FastAPI käitab Pillow/fail/git/Meili tee threadpoolis.
    content = file.file.read()
    try:
        content, ext = detect_and_convert_image(content, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    with work_lock(folder_name, path):
        # Arvuta uus sequence (lukus — loeb värsket olekut)
        images = get_sorted_images(path)
        page_count = len(images)

        def seq_of(idx):
            """Tagastab lehe effective sequence; fallback: positsioon × 100."""
            if idx < 0 or idx >= len(images):
                return None
            base = os.path.splitext(images[idx])[0]
            s = get_page_sequence(os.path.join(path, base + ".json"))
            if s == float("inf"):
                return (idx + 1) * 100  # images on juba sorteeritud, positsioon on korrektne
            return int(s)

        if after_page_num == -1 or after_page_num >= page_count:
            # Lõppu
            last_seq = seq_of(page_count - 1)
            if last_seq == float("inf") or last_seq is None:
                new_seq = (page_count + 1) * 100
            else:
                new_seq = int(last_seq) + 100
        elif after_page_num == 0:
            # Algusesse
            first_seq = seq_of(0)
            if first_seq == float("inf") or first_seq is None:
                new_seq = 50
            else:
                new_seq = int(first_seq) // 2
                if new_seq <= 0:
                    rebalance_sequences(path)
                    images = get_sorted_images(path)
                    new_seq = 50
        else:
            # Vahele: pärast after_page_num-ndat (1-indekseeritud)
            idx = after_page_num - 1
            seq_before = seq_of(idx)
            seq_after = seq_of(idx + 1)
            if seq_before == float("inf") or seq_before is None:
                seq_before = after_page_num * 100
            if seq_after == float("inf") or seq_after is None:
                seq_after = (after_page_num + 1) * 100
            new_seq = (int(seq_before) + int(seq_after)) // 2
            if new_seq <= int(seq_before):
                # Ruumi pole — tasakaalusta
                rebalance_sequences(path)
                images = get_sorted_images(path)
                idx = after_page_num - 1
                seq_before = get_page_sequence(os.path.join(path, os.path.splitext(images[idx])[0] + ".json")) if idx < len(images) else after_page_num * 100
                seq_after_val = get_page_sequence(os.path.join(path, os.path.splitext(images[idx + 1])[0] + ".json")) if idx + 1 < len(images) else (after_page_num + 1) * 100
                new_seq = (int(seq_before) + int(seq_after_val)) // 2

        # Salvesta leht (jagatud helper; single → staging == work dir)
        page = write_new_page(path, path, folder_name, work_id, content, ext, new_seq)
        new_filename = page["filename"]
        base = page["base"]
        txt_path = page["txt_path"]
        json_path = page["json_path"]
        page_meta = page["page_meta"]

        # Git commit
        save_with_git(
            txt_path, "",
            user["username"],
            message=f"Lisa leht: {folder_name}/{base} [sequence={new_seq}]",
            additional_files=[(json_path, json.dumps(page_meta, indent=2, ensure_ascii=False))],
        )

        # Sünkroniseeri Meilisearch
        sync_work_to_meilisearch(folder_name)

        new_page_count = len(get_sorted_images(path))
        return {"status": "success", "new_page_count": new_page_count, "sequence": new_seq, "filename": new_filename}


@router.post("/admin/work/{work_id}/add-pages")
def admin_add_pages(
    work_id: str,
    files: list[UploadFile] = File(..., alias="file"),
    after_page_num: int = Form(-1),
    user=Depends(require_role("admin")),
):
    """Lisab teosele mitu lehekülge korraga (JPG/PNG), nimejärgi sorteeritud.
    Body: multipart — mitu `file`-välja + after_page_num (int, 0=algusesse, -1=lõppu).
    """
    upload_data = [(up.filename or "", up.file.read()) for up in files]

    try:
        result = add_pages(work_id, upload_data, after_page_num, user["username"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", **result}


@router.post("/admin/work/{work_id}/page/{page_num}/split")
async def admin_split_page(work_id: str, page_num: int, request: Request, user=Depends(require_role("admin"))):
    """Lõikab topeltlehekülje kaheks. Body: { split_x: float (0.05–0.95) }"""
    data = await get_json_data(request)
    split_x = data.get("split_x")
    if split_x is None:
        raise HTTPException(status_code=400, detail="split_x on kohustuslik")
    try:
        result = await run_in_threadpool(
            split_page, work_id, page_num, float(split_x), user["username"]
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehekülge ei leitud")
    return {"status": "success", "new_page_count": result["new_page_count"]}


@router.post("/admin/work/{work_id}/page-image/{filename}/transform")
async def admin_transform_page_image(work_id: str, filename: str, request: Request, user=Depends(require_role("admin"))):
    """Pöörab/kärbib/sirgestab lehepilti kohapeal. Body: { angle, crop|null, quad|null }"""
    data = await get_json_data(request)
    angle = data.get("angle", 0.0)
    crop = data.get("crop")
    quad = data.get("quad")
    try:
        result = await run_in_threadpool(
            transform_page_image,
            work_id,
            filename,
            angle=angle,
            crop=crop,
            quad=quad,
            username=user["username"],
        )
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehte ei leitud")
    return result


@router.post("/admin/work/{work_id}/page-image/{filename}/restore-original")
def admin_restore_original_page_image(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Taastab lehe pildi ._originals pristine versiooni."""
    try:
        result = restore_original_page_image(work_id, filename, username=user["username"])
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehte ei leitud")
    return result


@router.post("/admin/work/{work_id}/reorder-pages")
async def admin_reorder_pages(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Muudab lehekülgede järjekorda. Body: {\"order\": [\"fail1.jpg\", \"fail2.jpg\", ...]}"""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    data = await request.json()
    new_order = data.get("order", [])
    result = await run_in_threadpool(
        reorder_pages, path, new_order, user.get("username", "admin")
    )
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    folder_name = os.path.basename(path)
    await run_in_threadpool(sync_work_to_meilisearch, folder_name)
    return {"status": "success"}
