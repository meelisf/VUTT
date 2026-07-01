"""Ühtne OCR-tööde vaade: upload + üksik/batch re-OCR ühes normaliseeritud loendis."""
import json
import os

from fastapi import APIRouter, Depends

from ..deps import require_role
from ..ocr_jobs_normalize import normalize_ocr_jobs
from ..reocr_ops import list_reocr_batch_jobs, list_reocr_jobs
from ..upload_ops import list_uploads
from ..utils import find_directory_by_id

router = APIRouter()


def _make_title_reader():
    """Tagastab title_of(work_id) -> str, mis loeb _metadata.json ja cache'ib per-päring."""
    cache = {}

    def title_of(work_id):
        if not work_id:
            return ""
        if work_id in cache:
            return cache[work_id]
        title = ""
        path = find_directory_by_id(work_id)
        if path:
            try:
                with open(os.path.join(path, "_metadata.json"), "r", encoding="utf-8") as f:
                    title = json.load(f).get("title") or ""
            except Exception:
                title = ""
        cache[work_id] = title
        return title

    return title_of


@router.get("/admin/ocr/jobs")
async def admin_ocr_jobs(user=Depends(require_role("admin"))):
    """Kõik OCR-serveri tööd (upload + üksik + batch) ühes normaliseeritud loendis."""
    jobs = normalize_ocr_jobs(
        list_uploads(), list_reocr_jobs(), list_reocr_batch_jobs(), _make_title_reader()
    )
    return {"status": "success", "jobs": jobs}
