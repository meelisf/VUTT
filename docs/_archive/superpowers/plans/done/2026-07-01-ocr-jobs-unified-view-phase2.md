# OCR-tööde ühtne vaade (Faas 2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Review-lehel üks ajajärjestatud nimekiri, mis näitab KÕIKI OCR-serveri töid (upload + üksik re-OCR + batch) tüübi-badge'i, ühtse staatuse ja järjekindla lingiga.

**Architecture:** Uus backend endpoint `GET /admin/ocr/jobs` kutsub puhast normaliseerijat `normalize_ocr_jobs(uploads, reocr_singles, reocr_batches, title_of)`, mis toodab ühtse kirje-kuju (tüüp, staatus, eelarvutatud link). Frontend renderdab ühe nimekirja. Upload-lingid deep-linkivad `/upload?resumeUpload={id}` → progress kohe näha.

**Tech Stack:** Python 3.9 (FastAPI), pytest; React 19 + TS, react-router, i18next.

**Eeldus:** Faas 1 (`2026-07-01-ocr-recovery-hardening-phase1.md`) on tarnitud (page_number lingid, batch-recovery). Faas 2 ei sõltu Faas 1 koodist otseselt, aga tarnitakse pärast.

## Global Constraints

- **Python 3.9 compat:** `Optional[X]`, `Dict`, `List` — MITTE `X | None`.
- **Testid:** `.venv/bin/python -m pytest tests/ -q`. Frontend: `npm run typecheck`.
- **Normaliseerija = puhas funktsioon** — DOM-/IO-vaba, `title_of` süstitakse; testitav ilma serverita.
- **`slow` on lipp** (status_key jääb `processing`, slow eraldi boolean).
- **Link arvutatakse backendis** (üks tõeallikas; frontend ei dubleeri tingimusi).
- **Sort-võti `started_at or 0.0`** — None ei tohi crash'ida (Py TypeError / JS ebastabiilne).
- **Commit-lõpp:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

| Fail | Vastutus | Muudatus |
|------|----------|----------|
| `server/reocr_ops.py` | + `list_reocr_batch_jobs()` (batch-summaarid globaalselt) | Lisa funktsioon |
| `server/ocr_jobs_normalize.py` | Puhas `normalize_ocr_jobs(...)` + `status_key`/`link` loogika | **Uus** |
| `server/routers/ocr_jobs.py` | `GET /admin/ocr/jobs` endpoint + title-cache | **Uus** |
| `server/main.py` | Registreeri `ocr_jobs` router | 2 rida |
| `src/pages/Review.tsx` | Fetch `/admin/ocr/jobs`; ühtne nimekiri, tüübi-badge | Edit |
| `src/pages/upload/useUploadWizard.ts` | Deep-link `?resumeUpload=` → `handleResume` | Lisa effect |
| `src/locales/{et,en}/review.json` | Tüübi-badge'id, uued status-kuvad | Edit |
| `tests/test_ocr_jobs_normalize.py` | Normaliseerija testid | **Uus** |
| `tests/test_reocr_batch.py` | `list_reocr_batch_jobs` test | Lisa |

---

## Task 1: `list_reocr_batch_jobs()` (`reocr_ops.py`)

**Files:**
- Modify: `server/reocr_ops.py` (lisa funktsioon `list_reocr_jobs` juurde)
- Test: `tests/test_reocr_batch.py` (lisa)

**Interfaces:**
- Produces: `list_reocr_batch_jobs() -> list` — iga batch-jobi kohta `{job_id, work_id, slug, username, status, slow, started_at, ready, total}`.

- [x] **Step 1: Write the failing test** (lisa `tests/test_reocr_batch.py` lõppu)

```python
def test_list_reocr_batch_jobs_summary():
    import server.reocr_ops as r
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()
        r._reocr_batch_jobs["b1"] = {
            "kind": "batch", "work_id": "wid", "slug": "w1", "username": "u",
            "status": "processing", "slow": True, "started_at": 123.0,
            "pages": [{"status": "ready"}, {"status": "processing"}, {"status": "error"}],
        }
    out = {j["job_id"]: j for j in r.list_reocr_batch_jobs()}
    assert out["b1"]["work_id"] == "wid"
    assert out["b1"]["ready"] == 1        # ainult "ready"
    assert out["b1"]["total"] == 3
    assert out["b1"]["slow"] is True
    assert out["b1"]["started_at"] == 123.0
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_list_reocr_batch_jobs_summary -q`
Expected: FAIL — `AttributeError: ... 'list_reocr_batch_jobs'`

- [x] **Step 3: Implement** (lisa `server/reocr_ops.py`-sse, `list_reocr_jobs` järele)

```python
def list_reocr_batch_jobs() -> list:
    """Batch re-OCR tööde summaarid (ühtse OCR-vaate jaoks)."""
    with _reocr_batch_jobs_lock:
        items = list(_reocr_batch_jobs.items())
    out = []
    for jid, j in items:
        pages = j.get("pages", [])
        out.append({
            "job_id": jid,
            "work_id": j.get("work_id"),
            "slug": j.get("slug", ""),
            "username": j.get("username", ""),
            "status": j.get("status"),
            "slow": bool(j.get("slow", False)),
            "started_at": j.get("started_at"),
            "ready": sum(1 for e in pages if e.get("status") == "ready"),
            "total": len(pages),
        })
    return out
```

- [x] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -q`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "feat: list_reocr_batch_jobs — batch-summaarid ühtse OCR-vaate jaoks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Puhas normaliseerija (`ocr_jobs_normalize.py`)

**Files:**
- Create: `server/ocr_jobs_normalize.py`
- Test: `tests/test_ocr_jobs_normalize.py`

**Interfaces:**
- Consumes: upload-state dict'id (`list_uploads`), reocr-single dict'id (`list_reocr_jobs`), reocr-batch dict'id (`list_reocr_batch_jobs`, Task 1).
- Produces:
  - `normalize_ocr_jobs(uploads: List[dict], singles: List[dict], batches: List[dict], title_of: Callable[[Optional[str]], str]) -> List[dict]` — ühtne, ajajärjestatud (started_at DESC, None→0.0) kirjete loend kujuga: `{id, type, title, slug, work_id, page_number, status_key, slow, started_at, progress, link, error}`.

- [x] **Step 1: Write the failing test**

```python
# tests/test_ocr_jobs_normalize.py
"""normalize_ocr_jobs — puhas OCR-tööde normaliseerija."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.ocr_jobs_normalize import normalize_ocr_jobs


def _title_of(work_id):
    return {"wid": "Teose Pealkiri"}.get(work_id, work_id or "")


def test_normalize_upload_reviewing():
    uploads = [{
        "id": "u1", "status": "reviewing",
        "meta": {"title": "Uus teos", "slug": "uus-teos-x", "work_id": "wx"},
        "expected_pages": 12, "created_at": "2026-07-01T10:00:00",
        "files": [{"has_ocr": True, "deleted": False}, {"has_ocr": False, "deleted": False}],
    }]
    out = normalize_ocr_jobs(uploads, [], [], _title_of)
    e = out[0]
    assert e["type"] == "upload"
    assert e["title"] == "Uus teos"
    assert e["status_key"] == "review"
    assert e["progress"] == {"ready": 1, "total": 12}
    assert e["link"] == "/upload?resumeUpload=u1"
    assert e["started_at"] > 0


def test_normalize_upload_import_error():
    uploads = [{"id": "u2", "status": "error", "error_message": "import ebaõnnestus",
                "meta": {"title": "X", "slug": "x", "work_id": "wx"},
                "expected_pages": None, "created_at": "2026-07-01T10:00:00", "files": []}]
    e = normalize_ocr_jobs(uploads, [], [], _title_of)[0]
    assert e["status_key"] == "error"
    assert e["error"] == "import ebaõnnestus"
    assert e["link"] == "/upload?resumeUpload=u2"


def test_normalize_reocr_single_done_links_page():
    singles = [{"job_id": "s1", "work_id": "wid", "slug": "w1", "page_number": 42,
                "status": "done", "slow": False, "started_at": 100.0, "error": None}]
    e = normalize_ocr_jobs([], singles, [], _title_of)[0]
    assert e["type"] == "reocr"
    assert e["title"] == "Teose Pealkiri"
    assert e["status_key"] == "ready"
    assert e["link"] == "/work/wid/42"
    assert e["page_number"] == 42


def test_normalize_reocr_single_no_page_links_work():
    singles = [{"job_id": "s2", "work_id": "wid", "slug": "w1", "page_number": None,
                "status": "done", "slow": False, "started_at": 100.0, "error": None}]
    e = normalize_ocr_jobs([], singles, [], _title_of)[0]
    assert e["link"] == "/work/wid"


def test_normalize_reocr_batch():
    batches = [{"job_id": "b1", "work_id": "wid", "slug": "w1", "status": "processing",
                "slow": True, "started_at": 50.0, "ready": 3, "total": 8}]
    e = normalize_ocr_jobs([], [], batches, _title_of)[0]
    assert e["type"] == "batch"
    assert e["status_key"] == "processing"
    assert e["slow"] is True
    assert e["progress"] == {"ready": 3, "total": 8}
    assert e["link"] == "/work/wid"


def test_normalize_missing_fields_and_sort():
    # started_at=None ei tohi sort'i crash'ida; title puudub → slug
    uploads = [{"id": "u3", "status": "processing",
                "meta": {"title": "", "slug": "slug-only", "work_id": None},
                "expected_pages": None, "created_at": "vigane-kuupäev", "files": []}]
    singles = [{"job_id": "s3", "work_id": "wid", "slug": "w1", "page_number": 1,
                "status": "processing", "slow": False, "started_at": None, "error": None}]
    out = normalize_ocr_jobs(uploads, singles, [], _title_of)
    assert len(out) == 2
    u = next(x for x in out if x["id"] == "u3")
    assert u["title"] == "slug-only"          # tühi title → slug
    assert u["started_at"] == 0.0             # vigane created_at → 0.0
    assert u["link"] == "/upload?resumeUpload=u3"


def test_normalize_sorted_desc():
    singles = [
        {"job_id": "a", "work_id": "wid", "slug": "w", "page_number": 1, "status": "done", "slow": False, "started_at": 10.0, "error": None},
        {"job_id": "b", "work_id": "wid", "slug": "w", "page_number": 2, "status": "done", "slow": False, "started_at": 30.0, "error": None},
        {"job_id": "c", "work_id": "wid", "slug": "w", "page_number": 3, "status": "done", "slow": False, "started_at": 20.0, "error": None},
    ]
    ids = [e["id"] for e in normalize_ocr_jobs([], singles, [], _title_of)]
    assert ids == ["b", "c", "a"]  # started_at DESC
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_ocr_jobs_normalize.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ocr_jobs_normalize'`

- [x] **Step 3: Implement**

```python
# server/ocr_jobs_normalize.py
"""Puhas normaliseerija: upload + üksik/batch re-OCR tööd ÜHE kujuni ühtse vaate jaoks.

DOM-/IO-vaba. title_of süstitakse (endpoint annab cache'itud lugeja, test lambda).
"""
from datetime import datetime
from typing import Callable, Dict, List, Optional


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
    if status == "processing":
        return "processing"
    if status in ("reviewing", "done"):
        return "review"
    if status == "imported":
        return "imported"
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
    ready = sum(1 for f in files if f.get("has_ocr") and not f.get("deleted"))
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
        "error": state.get("error_message"),
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
    }


def normalize_ocr_jobs(uploads: List[dict], singles: List[dict], batches: List[dict],
                       title_of: Callable[[Optional[str]], str]) -> List[dict]:
    """Ühtne, ajajärjestatud (started_at DESC, None→0.0) OCR-tööde loend."""
    out: List[dict] = []
    out += [_normalize_upload(u, title_of) for u in uploads]
    out += [_normalize_single(s, title_of) for s in singles]
    out += [_normalize_batch(b, title_of) for b in batches]
    out.sort(key=lambda e: e.get("started_at") or 0.0, reverse=True)
    return out
```

- [x] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_ocr_jobs_normalize.py -q`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/ocr_jobs_normalize.py tests/test_ocr_jobs_normalize.py
git commit -m "feat: normalize_ocr_jobs — puhas upload+re-OCR normaliseerija

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Endpoint `GET /admin/ocr/jobs` (`routers/ocr_jobs.py`)

**Files:**
- Create: `server/routers/ocr_jobs.py`
- Modify: `server/main.py` (registreeri router)

**Interfaces:**
- Consumes: `normalize_ocr_jobs` (Task 2), `list_uploads`, `list_reocr_jobs`, `list_reocr_batch_jobs` (Task 1), `find_directory_by_id`.
- Produces: `GET /admin/ocr/jobs` → `{status:"success", jobs:[...]}`.

- [x] **Step 1: Write the failing test** (lisa `tests/test_ocr_jobs_normalize.py` lõppu — endpoint-tasandi title-cache lugeja)

```python
def test_title_reader_reads_metadata(tmp_path, monkeypatch):
    import json
    import server.routers.ocr_jobs as oj
    work = tmp_path / "w1"
    work.mkdir()
    (work / "_metadata.json").write_text(json.dumps({"title": "Loetud Pealkiri"}), encoding="utf-8")
    monkeypatch.setattr(oj, "find_directory_by_id", lambda wid: str(work) if wid == "wid" else None)
    reader = oj._make_title_reader()
    assert reader("wid") == "Loetud Pealkiri"
    assert reader("puudub") == ""     # ei leidu → tühi (normaliseerija fallback slug'ile)
    # cache: teine kutse ei ava faili uuesti (sama tulemus)
    assert reader("wid") == "Loetud Pealkiri"
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_ocr_jobs_normalize.py::test_title_reader_reads_metadata -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.routers.ocr_jobs'`

- [x] **Step 3: Implement router**

```python
# server/routers/ocr_jobs.py
"""Ühtne OCR-tööde vaade: upload + üksik/batch re-OCR ühes normaliseeritud loendis."""
import json
import os

from fastapi import APIRouter, Depends

from ..deps import require_role
from ..ocr_jobs_normalize import normalize_ocr_jobs
from ..reocr_ops import list_reocr_jobs, list_reocr_batch_jobs
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
```

- [x] **Step 4: Register router in main.py**

`server/main.py` — lisa import (`from .routers.reocr import router as reocr_router` juurde, rida ~19):

```python
from .routers.ocr_jobs import router as ocr_jobs_router
```

Ja registreerimise juurde (`app.include_router(reocr_router)` juurde, rida ~56):

```python
app.include_router(ocr_jobs_router)
```

- [x] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_ocr_jobs_normalize.py -q && .venv/bin/python -c "import server.main; print('main imports OK')"`
Expected: PASS + "main imports OK"

- [x] **Step 6: Commit**

```bash
git add server/routers/ocr_jobs.py server/main.py tests/test_ocr_jobs_normalize.py
git commit -m "feat: GET /admin/ocr/jobs — ühtne OCR-tööde endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Upload deep-link (`useUploadWizard.ts`)

**Files:**
- Modify: `src/pages/upload/useUploadWizard.ts` (lisa effect resume-param'ile)

**Interfaces:**
- Consumes: `searchParams`, `pendingUploads`, `handleResume` (olemas).
- Produces: `/upload?resumeUpload={id}` avab otse selle uploadi ülevaatusele; param eemaldatakse pärast.

- [x] **Step 1: Add deep-link resume effect**

`src/pages/upload/useUploadWizard.ts` — lisa `useRef` import kui puudub (`import { useRef } from 'react'`) ja `useNavigate` on juba imporditud. Lisa `handleResume` funktsiooni JÄREL (rida ~471) effect:

```typescript
  const resumeHandledRef = useRef(false);
  useEffect(() => {
    if (resumeHandledRef.current) return;
    const targetId = searchParams.get('resumeUpload');
    if (!targetId || pendingUploads.length === 0) return;
    const match = pendingUploads.find((u) => u.id === targetId);
    if (!match) return;
    resumeHandledRef.current = true;
    handleResume(match);
    // Eemalda param, et back/forward remount ei käivitaks resume't uuesti
    navigate(location.pathname, { replace: true });
  }, [pendingUploads, searchParams, navigate]);
```

**NB:** kontrolli, et `location` on saadaval (`useLocation`) või kasuta `window.location.pathname`. Kui `useLocation` pole imporditud, lisa `import { useLocation } from 'react-router-dom'` ja `const location = useLocation()`. `handleResume` on funktsioon samas hookis — effect'i deps ei vaja seda (stabiilne closure); kui lint nõuab, lisa `// eslint-disable-next-line react-hooks/exhaustive-deps`.

- [x] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: 0 errorit

- [x] **Step 3: Commit**

```bash
git add src/pages/upload/useUploadWizard.ts
git commit -m "feat: upload deep-link ?resumeUpload= avab otse uploadi ülevaatusele

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — ühtne nimekiri Review-lehel

**Files:**
- Modify: `src/pages/Review.tsx` (tüüp, fetch, render)
- Modify: `src/locales/et/review.json`, `src/locales/en/review.json`

**Interfaces:**
- Consumes: `GET /admin/ocr/jobs` (Task 3) → `{jobs:[{id,type,title,slug,work_id,page_number,status_key,slow,started_at,progress,link,error}]}`.

- [x] **Step 1: Replace ReocrJob type with unified OcrJob**

`src/pages/Review.tsx` — asenda `interface ReocrJob {...}` (aktiivsete tööde tüüp) järgnevaga (jäta `reocrLog` tüüp ReocrJob-iks eraldi — vt allpool):

```typescript
interface OcrJob {
  id: string;
  type: 'upload' | 'reocr' | 'batch';
  title: string;
  slug: string;
  work_id: string | null;
  page_number: number | null;
  status_key: 'uploading' | 'processing' | 'review' | 'ready' | 'imported' | 'error';
  slow: boolean;
  started_at: number | null;
  progress: { ready: number; total: number } | null;
  link: string;
  error: string | null;
}
```

Muuda `reocrJobs` olek: `const [reocrJobs, setReocrJobs] = useState<OcrJob[]>([]);` (ajaloo `reocrLog` jääb ReocrJob-iks, mille tüüp on juba failis — kui see kasutab slow/queue_ahead välju, jäta need alles).

- [x] **Step 2: Point fetch at unified endpoint**

`loadReocrJobs`-is asenda URL:

```typescript
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/ocr/jobs`, { headers: getAuthHeaders(token), timeout: 10000 });
```

Ja pollimise `hasActive` kontroll (`j.status === ...`) → `status_key`:

```typescript
    const hasActive = reocrJobs.some(j => j.status_key === 'uploading' || j.status_key === 'processing');
```

- [x] **Step 3: Replace active-jobs render with unified rows**

Asenda aktiivsete tööde `.map(job => {...})` plokk järgnevaga (kasutab `status_key`, `type`, `link`, `progress`; kulunud aeg + slow badge nagu enne):

```tsx
                  {[...reocrJobs].sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0)).map(job => {
                    const isActive = job.status_key === 'uploading' || job.status_key === 'processing';
                    const isSlow = isActive && job.slow;
                    const isError = job.status_key === 'error';
                    return (
                      <div key={job.id}
                        className={`flex items-center gap-4 px-4 py-3 rounded-lg border ${
                          isActive ? 'border-amber-200 bg-amber-50' :
                          isError ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'
                        }`}>
                        <div className="shrink-0">
                          {isActive ? <Loader2 size={18} className="animate-spin text-amber-600" />
                            : isError ? <XCircle size={18} className="text-red-500" />
                            : <CheckCircle size={18} className="text-green-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                              {t(`ocr.type.${job.type}`)}
                            </span>
                            <span className="font-medium text-gray-800 text-sm">{job.title || job.slug}</span>
                            {job.title && <span className="text-xs text-gray-400 font-mono" title={job.slug}>{job.slug}</span>}
                            {job.page_number && <span className="text-xs text-gray-500">lk {job.page_number}</span>}
                            {job.progress && <span className="text-xs text-gray-500">{job.progress.ready}/{job.progress.total} lk</span>}
                            {job.work_id && (
                              <a href={job.link} target="_blank" rel="noreferrer"
                                className="text-xs text-primary-600 hover:underline flex items-center gap-0.5">
                                <ExternalLink size={11} />
                              </a>
                            )}
                          </div>
                          {job.error && <p className="text-xs text-red-600 mt-0.5">{job.error}</p>}
                        </div>
                        <div className="text-xs text-gray-500 text-right shrink-0">
                          {job.started_at && (
                            <div className="flex items-center gap-1 justify-end">
                              <Clock size={11} />
                              {isActive ? formatElapsed(job.started_at)
                                : new Date(job.started_at * 1000).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                        <a href={job.link} target={job.link.startsWith('/work') ? '_blank' : undefined} rel="noreferrer"
                          className={`shrink-0 text-xs font-medium px-2 py-1 rounded ${
                            isSlow ? 'bg-amber-100 text-amber-800' :
                            isActive ? 'bg-amber-100 text-amber-700' :
                            isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                          {isSlow ? t('reocr.slow') : t(`ocr.statusKey.${job.status_key}`)}
                        </a>
                      </div>
                    );
                  })}
```

**NB:** `formatElapsed` on juba failis (eelmisest featuurist). Kui `reocrJobs.filter(...)` loendurit kasutatakse mujal (nt aktiivsete arv, rida ~510), muuda `j.status === ...` → `j.status_key === ...`.

- [x] **Step 4: Add i18n keys**

`src/locales/et/review.json` — `reocr` bloki KÕRVALE (juur-tasand) lisa `ocr` blokk:

```json
  "ocr": {
    "type": { "upload": "Üleslaadimine", "reocr": "Re-OCR", "batch": "Batch" },
    "statusKey": {
      "uploading": "üleslaadimine",
      "processing": "OCR töötleb",
      "review": "ülevaatusel",
      "ready": "valmis",
      "imported": "imporditud",
      "error": "viga"
    }
  },
```

`src/locales/en/review.json` — sama:

```json
  "ocr": {
    "type": { "upload": "Upload", "reocr": "Re-OCR", "batch": "Batch" },
    "statusKey": {
      "uploading": "uploading",
      "processing": "OCR running",
      "review": "in review",
      "ready": "ready",
      "imported": "imported",
      "error": "error"
    }
  },
```

- [x] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errorit

- [x] **Step 6: Commit**

```bash
git add src/pages/Review.tsx src/locales/et/review.json src/locales/en/review.json
git commit -m "feat: Review ühtne OCR-tööde nimekiri (upload+reocr+batch, tüübi-badge)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy (pärast kõiki taske)

Backend (`--no-cache`):
```bash
ssh vutt && cd ~/VUTT && git pull
docker compose build --no-cache backend && docker compose up -d backend
curl -s -H "Authorization: Bearer <admin-token>" https://vutt.utlib.ut.ee/admin/ocr/jobs | head
```
Frontend: `npm run build && rsync -avz dist/ vutt:~/VUTT/dist/`

**Verifitseeri:** lae teos üles (`/upload`) → Review-lehel ilmub "Üleslaadimine"-badge'iga rida progressiga; klõps badge'il → deep-link `/upload?resumeUpload=…` avab ülevaatuse; re-OCR/batch read näitavad tüübi-badge'i + linki.

## Self-Review — spec coverage

- ✅ 2a ühtne endpoint + puhas normaliseerija + title-cache: Task 2 (normaliseerija) + Task 3 (endpoint/cache).
- ✅ Batch nimekirjas: Task 1 `list_reocr_batch_jobs` + normaliseerija `_normalize_batch`.
- ✅ status_key sõnavara: Task 2 `_upload_status_key`/`_reocr_status_key` + Task 5 i18n.
- ✅ Link backendis (üks tõeallikas): Task 2 `_upload_link`/`_work_link`; frontend kasutab `job.link`.
- ✅ Sort `started_at or 0.0`: Task 2 `normalize_ocr_jobs` + `test_normalize_missing_fields_and_sort`.
- ✅ Upload import-viga → error + deep-link: Task 2 `test_normalize_upload_import_error`.
- ✅ 2b üks nimekiri tüübi-badge'iga: Task 5 render + i18n.
- ✅ 2c deep-link effect (pendingUploads laadimisel) + param-strip: Task 4.
- ✅ Slug jääb (tehniline) + title esile: Task 5 render.
