"""Puhas normaliseerija: upload + üksik/batch re-OCR tööd ÜHE kujuni ühtse vaate jaoks.

DOM-/IO-vaba. title_of süstitakse (endpoint annab cache'itud lugeja, test lambda).
"""
from datetime import datetime
from typing import Callable, List, Optional
from .upload import page_status


def _parse_ts(value) -> float:
    """ISO-string VÕI float → timestamp; parse-viga → 0.0 (sort-turvaline)."""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return datetime.fromisoformat(str(value)).timestamp()
    except Exception:
        return 0.0


def _upload_status_key(status: str) -> str:
    if status in ("pending", "uploading", "collecting_images"):
        return "uploading"
    # ada_fetching = ADA-serverist failide server-server allalaadimine — see
    # on käimasolev töö, mitte viga; kuvatakse nagu tavaline 'uploading'
    # (vt ka queue_ahead_pages allpool: 'uploading' loetakse aktiivseks).
    if status == "ada_fetching":
        return "uploading"
    if status == "processing":
        return "processing"
    if status in ("reviewing", "done"):
        return "review"
    if status == "imported":
        return "imported"
    # ada_error langeb siia (nagu iga muu tõrge) — vt _normalize_upload
    # error_message-fallback ada_error-le.
    return "error"


def _upload_link(state: dict, status_key: str) -> str:
    if status_key == "imported":
        wid = state.get("meta", {}).get("work_id")
        return f"/work/{wid}" if wid else "/upload"
    return f"/upload?resumeUpload={state.get('id')}"


def _normalize_upload(state: dict, title_of) -> dict:
    meta = state.get("meta", {}) or {}
    status = state.get("status", "pending")
    status_key = _upload_status_key(status)
    files = state.get("files", []) or []
    # Dashboard näitab „tekstiga lehti", seega `is_ready`, mitte `is_resolved`;
    # kustutatud leht ei ole kasutaja jaoks tehtud töö (#261).
    ready = page_status.count(files, page_status.is_ready, skip_deleted=True)
    total = state.get("expected_pages") or len(files)
    title = meta.get("title") or meta.get("slug", "")
    return {
        "id": state.get("id"),
        "type": "upload",
        "title": title,
        "slug": meta.get("slug", ""),
        "work_id": meta.get("work_id"),
        "page_number": None,
        "status_key": status_key,
        "slow": False,
        "started_at": _parse_ts(state.get("created_at")),
        "progress": {"ready": ready, "total": total} if total else None,
        "link": _upload_link(state, status_key),
        # ADA-tõmbaja kirjutab vea ada_error-isse, mitte error_message-isse
        # (vt sama fallback server/upload/thumbs.py-s).
        "error": state.get("error_message") or state.get("ada_error"),
        "username": state.get("username") or "",  # None (vanad uploadid) → ""
    }


def _reocr_status_key(status: str) -> str:
    if status in ("uploading",):
        return "uploading"
    if status == "processing":
        return "processing"
    if status == "done":
        return "ready"
    return "error"


def _work_link(work_id: Optional[str], page_number) -> str:
    if not work_id:
        return ""
    return f"/work/{work_id}/{page_number}" if page_number else f"/work/{work_id}"


def _normalize_single(job: dict, title_of) -> dict:
    return {
        "id": job.get("job_id"),
        "type": "reocr",
        "title": title_of(job.get("work_id")) or job.get("slug", ""),
        "slug": job.get("slug", ""),
        "work_id": job.get("work_id"),
        "page_number": job.get("page_number"),
        "status_key": _reocr_status_key(job.get("status")),
        "slow": bool(job.get("slow", False)),
        "started_at": _parse_ts(job.get("started_at")),
        "progress": None,
        "link": _work_link(job.get("work_id"), job.get("page_number")),
        "error": job.get("error"),
        "username": job.get("username", ""),
    }


def _normalize_batch(job: dict, title_of) -> dict:
    total = job.get("total", 0)
    return {
        "id": job.get("job_id"),
        "type": "batch",
        "title": title_of(job.get("work_id")) or job.get("slug", ""),
        "slug": job.get("slug", ""),
        "work_id": job.get("work_id"),
        "page_number": None,
        "status_key": _reocr_status_key(job.get("status")),
        "slow": bool(job.get("slow", False)),
        "started_at": _parse_ts(job.get("started_at")),
        "progress": {"ready": job.get("ready", 0), "total": total} if total else None,
        "link": _work_link(job.get("work_id"), None),
        "error": job.get("error"),
        "username": job.get("username", ""),
    }


def _lehti(kirje: dict) -> int:
    """Töö suurus lehtedes. Teadmata suurus loeb ÜHEKS, mitte nulliks.

    Null tähendaks „selle töö taga ei ole midagi" ja teadmata suurusega töö
    kaoks järjekorrast ära just siis, kui ta on kõige värskem (upload, mille
    fail alles saabub).
    """
    edenemine = kirje.get("progress") or {}
    return int(edenemine.get("total") or 1)


def normalize_ocr_jobs(uploads: List[dict], singles: List[dict], batches: List[dict],
                       title_of: Callable[[Optional[str]], str]) -> List[dict]:
    """Ühtne, ajajärjestatud (started_at DESC, None→0.0) OCR-tööde loend."""
    out: List[dict] = []
    out += [_normalize_upload(u, title_of) for u in uploads]
    out += [_normalize_single(s, title_of) for s in singles]
    out += [_normalize_batch(b, title_of) for b in batches]
    # queue_ahead_pages: ühtne lokaalne FIFO-lähend üle KÕIGI aktiivsete
    # (upload + üksik re-OCR + batch) started_at järgi, LEHTEDES (#251).
    #
    # Töid lugev vastus („~2 varasemat tööd") võib tähendada 3 lehte või 800 —
    # just see vahe oli algne kaebus. Lehtede arv on kohapeal olemas: upload ja
    # batch kannavad `progress.total`, üksik re-OCR on definitsiooni järgi üks
    # leht. OCR-serveri päris järjekorda me endiselt ei tea, ja SSH-loendus ei
    # aitaks: Gemini-tee ei käi LOSSist üldse läbi.
    active = [e for e in out if e["status_key"] in ("uploading", "processing")]
    for e in out:
        if e["status_key"] in ("uploading", "processing"):
            st = e.get("started_at") or 0.0
            e["queue_ahead_pages"] = sum(
                _lehti(o) for o in active if (o.get("started_at") or 0.0) < st)
        else:
            e["queue_ahead_pages"] = 0
    out.sort(key=lambda e: e.get("started_at") or 0.0, reverse=True)
    return out
