# Batch re-OCR manage-lehel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lubada adminil manage-lehel valida mitu lehekülge ja saata need ühe klikiga uuesti OCR-i (batch re-OCR), nähes per-lehe staatust ja edenemist; tulemused jäävad staging'usse (`.ocr`) ülevaatuseks.

**Architecture:** Üks multi-image batch-job (üks `job_id`, üks staging-kaust, N pilti) väldib `REOCR_MAX_CONCURRENT=20` piiri. OCR-teenus (`loss/kataloogi-jalgimine-ja-ocr.py`) batchib ise 3-kaupa, sest kõik pildid on korraga puus. Tulemus↔leht mapping on **autoriteetne job-registrist**, mitte failinime-järjekorrast. Backend taustal-poll laeb iga `.txt` valmides alla → kirjutab `.ocr` faili; manage pollib koond-staatust ainult aktiivse batchi ajal.

**Tech Stack:** Backend Python 3.9 (FastAPI, paramiko SFTP), pytest. Frontend React 19 + TypeScript + Tailwind, vitest, i18next.

## Global Constraints

- **Python 3.9 compat:** EI tohi kasutada `str | None` ega `dict | None` tüübisüntaksit. Kasuta `typing.Optional`, `List`, `Tuple`, `Dict`.
- **`async def` + blokeeriv I/O on KEELATUD** (intsident `a89e905`): kogu SFTP (upload, poll) PEAB jooksma taustal `threading.Thread`-is, MITTE `async def` endpointi sees. Endpoint ainult registreerib töö ja tagastab kohe.
- **Mapping autoriteetsus:** tulemuse `.txt` → lehe `.ocr` seos loetakse AINULT job-registri kirje `page_filename` ↔ `remote_txt_name` väljadest. EI tohi sortida remote-faile ja eeldada positsioonilist vastavust.
- **Eesti keel koodikommentaarides.** UI tekst i18n kaudu (`et` + `en` mõlemad).
- **Konfiguratsioon:** `BASE_DIR`, `OCR_SERVER_PATH` tulevad `server/config.py`-st (juba imporditud `reocr_ops.py`-sse). Testid patchivad `reocr_ops.BASE_DIR` (mooduli-globaal), MITTE `config.BASE_DIR`.
- **Staging-mudel:** auto-rakendust EI ole. Tulemus → `{stem}.ocr` fail; admin rakendab Workspace'is olemasoleva `useReOcr` voo kaudu.

---

## File Structure

**Backend:**
- `server/reocr_ops.py` (modify) — uued: `_write_ocr_file`, `_build_batch_pages`, `start_reocr_batch`, `get_active_batch_for_work`, `_download_txt_if_ready`, `_poll_batch_job`, `_finalize_batch_if_complete`, `_batch_inactive`, `build_reocr_status`, batch-registri + poll-loop. Refaktor: `poll_reocr_job` kasutab `_write_ocr_file`.
- `server/main.py` (modify) — uued endpointid `POST /admin/work/{id}/reocr-batch`, `GET /admin/work/{id}/reocr-status`.

**Frontend:**
- `src/utils/reocrStatus.ts` (create) — puhtad funktsioonid: `mapReocrState`, `selectableNoTextFiles`, tüübid.
- `src/pages/manage/PageCard.tsx` (modify) — `hasText` + `reocrState` propid + märgid.
- `src/pages/WorkManage.tsx` (modify) — re-OCR sektsioon, "Vali tekstita", batch-käivitus + kinnitus, staatuse-poll, progress.
- `src/locales/et/workspace.json` + `src/locales/en/workspace.json` (modify) — uued `manage.reocr.*` võtmed.

**Tests:**
- `tests/test_reocr_batch.py` (create) — backend pure-logic testid.
- `src/utils/__tests__/reocrStatus.test.ts` (create) — frontend util testid.

---

## Task 1: Ekstrakti jagatud `.ocr` kirjutamise helper

**Files:**
- Modify: `server/reocr_ops.py` (uus funktsioon + refaktor `poll_reocr_job` read 262-272)
- Test: `tests/test_reocr_batch.py`

**Interfaces:**
- Produces: `_write_ocr_file(slug: str, page_filename: str, text: str) -> str` — kirjutab `{BASE_DIR}/{slug}/{stem}.ocr`, tagastab tee.

- [ ] **Step 1: Write the failing test**

Loo `tests/test_reocr_batch.py`:

```python
"""Batch re-OCR backend testid — puhas loogika, ilma päris OCR-serverita."""
import os
import pytest


def test_write_ocr_file_kirjutab_stem_ocr(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    work_dir = tmp_path / "1700-teos"
    work_dir.mkdir()

    path = reocr_ops._write_ocr_file("1700-teos", "1700-teos-pg005.jpg", "Tekst siin.")

    assert path == str(work_dir / "1700-teos-pg005.ocr")
    assert (work_dir / "1700-teos-pg005.ocr").read_text(encoding="utf-8") == "Tekst siin."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_write_ocr_file_kirjutab_stem_ocr -v`
Expected: FAIL — `AttributeError: module 'server.reocr_ops' has no attribute '_write_ocr_file'`

- [ ] **Step 3: Lisa `_write_ocr_file` ja refaktor `poll_reocr_job`**

Lisa `reocr_ops.py`-sse (nt logger'i määramise järele, ~rida 64):

```python
def _write_ocr_file(slug: str, page_filename: str, text: str) -> str:
    """Kirjutab OCR-tulemuse {BASE_DIR}/{slug}/{stem}.ocr failina (püsiv staging). Tagastab tee."""
    stem = os.path.splitext(os.path.basename(page_filename))[0]
    ocr_path = os.path.join(BASE_DIR, slug, stem + ".ocr")
    with open(ocr_path, "w", encoding="utf-8") as f:
        f.write(text)
    return ocr_path
```

Asenda `poll_reocr_job`-is olemasolev `.ocr` kirjutamise plokk (read 262-272):

```python
        # Kirjuta tulemus .ocr failina teose kausta (püsiv backup)
        page_fn = job.get("page_filename", "")
        if page_fn:
            try:
                ocr_path = _write_ocr_file(job["slug"], page_fn, text)
                logger.info(f"Re-OCR {job_id}: .ocr fail kirjutatud → {ocr_path}")
            except Exception as write_err:
                logger.warning(f"Re-OCR {job_id}: .ocr faili kirjutamine ebaõnnestus: {write_err}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_write_ocr_file_kirjutab_stem_ocr -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "refactor(reocr): ekstrakti _write_ocr_file jagatud helper"
```

---

## Task 2: `_build_batch_pages` — autoriteetne per-lehe mapping

**Files:**
- Modify: `server/reocr_ops.py`
- Test: `tests/test_reocr_batch.py`

**Interfaces:**
- Consumes: —
- Produces: `_build_batch_pages(slug: str, pages: List[Tuple[str, Optional[int]]]) -> List[Dict]` — iga kirje: `{page_filename, page_number, stem, remote_img_name, remote_txt_name, status: "uploading", error: None}`. Indeks → `_pg_{i+1:03d}`, säilitab lähtefaili laiendi.

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_reocr_batch.py`-sse:

```python
def test_build_batch_pages_autoriteetne_mapping():
    from server.reocr_ops import _build_batch_pages
    pages = [("a-pg010.jpg", 10), ("b-pg002.png", 2), ("c-pg100.jpg", 100)]
    out = _build_batch_pages("teos", pages)

    assert [e["remote_img_name"] for e in out] == [
        "teos_pg_001.jpg", "teos_pg_002.png", "teos_pg_003.jpg"]
    assert [e["remote_txt_name"] for e in out] == [
        "teos_pg_001.txt", "teos_pg_002.txt", "teos_pg_003.txt"]
    # Kriitiline: iga kirje seob remote-nime ALGSE page_filename-iga
    assert out[1]["page_filename"] == "b-pg002.png"
    assert out[1]["stem"] == "b-pg002"
    assert out[0]["page_number"] == 10
    assert all(e["status"] == "uploading" and e["error"] is None for e in out)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_build_batch_pages_autoriteetne_mapping -v`
Expected: FAIL — `ImportError: cannot import name '_build_batch_pages'`

- [ ] **Step 3: Lisa funktsioon ja imports**

Faili algusesse lisa import (olemasoleva `from datetime import datetime` kõrvale):

```python
from typing import Dict, List, Optional, Tuple
```

Lisa funktsioon (nt `_write_ocr_file` järele):

```python
def _build_batch_pages(slug: str, pages: List[Tuple[str, Optional[int]]]) -> List[Dict]:
    """Ehitab batch-jobi per-lehe kirjed AUTORITEETSE mapping'uga.

    remote_img_name/_txt_name on ainult OCR-serveri nimekonventsioon; tulemuse
    sihtleht loetakse ALATI kirje page_filename väljast, MITTE indeksi järgi.
    """
    result: List[Dict] = []
    for i, (page_filename, page_number) in enumerate(pages):
        ext = os.path.splitext(page_filename)[1] or ".jpg"
        base = f"{slug}_pg_{i + 1:03d}"
        result.append({
            "page_filename": page_filename,
            "page_number": page_number,
            "stem": os.path.splitext(os.path.basename(page_filename))[0],
            "remote_img_name": f"{base}{ext}",
            "remote_txt_name": f"{base}.txt",
            "status": "uploading",
            "error": None,
        })
    return result
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_build_batch_pages_autoriteetne_mapping -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "feat(reocr): _build_batch_pages autoriteetse mapping'uga"
```

---

## Task 3: `start_reocr_batch` + batch-registri ja `get_active_batch_for_work`

**Files:**
- Modify: `server/reocr_ops.py`
- Test: `tests/test_reocr_batch.py`

**Interfaces:**
- Consumes: `_build_batch_pages`, `_sftp_open` (upload_ops, juba imporditud), `generate_nanoid`, `OCR_SERVER_PATH`.
- Produces:
  - Moodulis: `_reocr_batch_jobs: Dict`, `_reocr_batch_jobs_lock`, `REOCR_BATCH_INACTIVITY_TIMEOUT = 1800`.
  - `start_reocr_batch(work_id: str, slug: str, work_path: str, pages: List[Tuple[str, Optional[int]]], material_type: str = "print", username: str = "") -> str` — tagastab `job_id`; loob registrikirje (`kind="batch"`, `status`, `pages`, `last_progress_at`, `remote_staging`, `remote_work`), käivitab upload-threadi mis loeb pildid `work_path`-ist ( EI kustuta originaale).
  - `get_active_batch_for_work(work_id: str) -> Optional[str]` — tagastab aktiivse (uploading/processing) batch-jobi `job_id` selle teose jaoks, muidu `None`.

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_reocr_batch.py`-sse. Fake SFTP, et upload-thread ei pöörduks päris serverisse:

```python
import threading
import time as _time


class _FakeSftp:
    def __init__(self, store):
        self.store = store  # {remote_abs: bytes}
        self.made_dirs = []
    def stat(self, path):
        if path in self.made_dirs:
            return True
        raise FileNotFoundError(path)
    def mkdir(self, path):
        self.made_dirs.append(path)
    def put(self, local, remote):
        with open(local, "rb") as f:
            self.store[remote] = f.read()
    def close(self):
        pass


def _wait_status(job, target, timeout=2.0):
    end = _time.time() + timeout
    while _time.time() < end:
        if job["status"] == target:
            return True
        _time.sleep(0.02)
    return False


def test_start_reocr_batch_loob_registri_ja_laeb_pildid(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    work_dir = tmp_path / "1700-teos"
    work_dir.mkdir()
    (work_dir / "a.jpg").write_bytes(b"IMG-A")
    (work_dir / "b.jpg").write_bytes(b"IMG-B")

    store = {}
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _FakeSftp(store))
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/srv")

    job_id = reocr_ops.start_reocr_batch(
        "w1", "1700-teos", str(work_dir),
        [("a.jpg", 1), ("b.jpg", 2)], material_type="print", username="admin")

    job = reocr_ops._reocr_batch_jobs[job_id]
    assert _wait_status(job, "processing")
    assert job["kind"] == "batch" and job["material_type"] == "print"
    assert len(job["pages"]) == 2
    # Pildid laeti remote staging'usse, originaalid alles
    assert (work_dir / "a.jpg").exists()
    assert store["/srv/AUTO-OCR/print/%s/1700-teos/1700-teos_pg_001.jpg" % job_id] == b"IMG-A"
    # Aktiivse batchi otsing
    assert reocr_ops.get_active_batch_for_work("w1") == job_id
    assert reocr_ops.get_active_batch_for_work("w2") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_start_reocr_batch_loob_registri_ja_laeb_pildid -v`
Expected: FAIL — `AttributeError: module 'server.reocr_ops' has no attribute 'start_reocr_batch'`

- [ ] **Step 3: Lisa registri, konstandi ja funktsioonid**

Lisa konstantide juurde (nt `REOCR_PROCESSING_TIMEOUT` järele, ~rida 70):

```python
REOCR_BATCH_INACTIVITY_TIMEOUT = 1800  # Batch error, kui X s pole ühegi lehe kohta uut .txt

_reocr_batch_jobs: Dict = {}  # {job_id: batch-job dict}
_reocr_batch_jobs_lock = threading.Lock()
```

Lisa funktsioonid (nt `_build_batch_pages` järele):

```python
def get_active_batch_for_work(work_id: str) -> Optional[str]:
    """Aktiivse (uploading/processing) batch-jobi job_id selle teose jaoks, muidu None."""
    with _reocr_batch_jobs_lock:
        for jid, j in _reocr_batch_jobs.items():
            if j["work_id"] == work_id and j["status"] in ("uploading", "processing"):
                return jid
    return None


def start_reocr_batch(work_id: str, slug: str, work_path: str,
                      pages: List[Tuple[str, Optional[int]]],
                      material_type: str = "print", username: str = "") -> str:
    """Alustab mitme lehe batch re-OCR tööd: laeb KÕIK pildid ühte staging-kausta.
    Loeb pildid otse work_path-ist (EI kustuta originaale). Tagastab job_id."""
    if material_type not in ("print", "hand"):
        material_type = "print"
    job_id = generate_nanoid()
    remote_staging = f"AUTO-OCR/{material_type}/{job_id}"
    remote_work = f"AUTO-OCR/{material_type}/{job_id}/{slug}"
    page_entries = _build_batch_pages(slug, pages)
    now = datetime.now().timestamp()

    job = {
        "kind": "batch",
        "work_id": work_id,
        "slug": slug,
        "username": username,
        "material_type": material_type,
        "status": "uploading",
        "started_at": now,
        "finished_at": None,
        "last_progress_at": now,
        "remote_staging": remote_staging,
        "remote_work": remote_work,
        "pages": page_entries,
    }
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs[job_id] = job

    def _upload():
        try:
            sftp = _sftp_open(job_id)
            staging_abs = f"{OCR_SERVER_PATH}/{remote_staging}"
            work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
            for d in (staging_abs, work_abs):
                try:
                    sftp.stat(d)
                except FileNotFoundError:
                    sftp.mkdir(d)
            for entry in page_entries:
                src = os.path.join(work_path, entry["page_filename"])
                sftp.put(src, f"{work_abs}/{entry['remote_img_name']}")
                entry["status"] = "processing"
            sftp.close()
            job["status"] = "processing"
            logger.info(f"Re-OCR batch {job_id}: {len(page_entries)} pilti edastatud ({slug})")
        except Exception as e:
            logger.error(f"Re-OCR batch {job_id} upload viga: {e}")
            for entry in page_entries:
                if entry["status"] in ("uploading", "processing"):
                    entry["status"] = "error"
                    entry["error"] = str(e)
            job["status"] = "error"
            job["finished_at"] = datetime.now().timestamp()

    threading.Thread(target=_upload, daemon=True, name=f"reocr-batch-{job_id}").start()
    return job_id
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_start_reocr_batch_loob_registri_ja_laeb_pildid -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "feat(reocr): start_reocr_batch + batch-registri + get_active_batch_for_work"
```

---

## Task 4: Batch-poll — autoriteetne resolveerimine + inactivity-timeout

**Files:**
- Modify: `server/reocr_ops.py`
- Test: `tests/test_reocr_batch.py`

**Interfaces:**
- Consumes: `_reocr_batch_jobs`, `_write_ocr_file`, `_sftp_open`, `close_ssh`, `OCR_SERVER_PATH`, `REOCR_BATCH_INACTIVITY_TIMEOUT`.
- Produces:
  - `_download_txt_if_ready(sftp, txt_abs: str) -> Optional[str]` — `None` kui txt puudub, muidu dekodeeritud sisu.
  - `_batch_inactive(job: Dict, now: float, timeout: int) -> bool`.
  - `_poll_batch_job(job_id: str) -> None` — iga ootel-lehe kohta laeb selle OMA `remote_txt_name`, kirjutab `.ocr` selle kirje `page_filename`-ile, märgib `ready`, uuendab `last_progress_at`.
  - `_finalize_batch_if_complete(job: Dict) -> None` — kui kõik `ready`/`error` → `status="done"`, `finished_at`.

- [ ] **Step 1: Write the failing tests**

Lisa `tests/test_reocr_batch.py`-sse. Fake SFTP, mis tagastab txt-d **vales järjekorras** (pg_002 enne pg_001):

```python
class _FakePollSftp:
    """Tagastab ainult valitud remote_txt-d (simuleerib OCR-i edenemist)."""
    def __init__(self, ready_txts):
        self.ready = dict(ready_txts)  # {txt_abs: text}
        self.removed = []
    def stat(self, path):
        if path in self.ready:
            return True
        raise FileNotFoundError(path)
    def getfo(self, path, buf):
        buf.write(self.ready[path].encode("utf-8"))
    def remove(self, path):
        self.removed.append(path)
    def rmdir(self, path):
        pass
    def close(self):
        pass


def test_poll_batch_mapping_on_autoriteetne_mitte_jarjekorra_pohine(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/srv")
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    work_dir = tmp_path / "teos"
    work_dir.mkdir()

    # Job: leht "esimene.jpg"→pg_001, "teine.jpg"→pg_002
    job_id = "JOB1"
    pages = reocr_ops._build_batch_pages("teos", [("esimene.jpg", 1), ("teine.jpg", 2)])
    for e in pages:
        e["status"] = "processing"
    reocr_ops._reocr_batch_jobs[job_id] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "processing",
        "started_at": 0, "finished_at": None, "last_progress_at": 0,
        "remote_work": "AUTO-OCR/print/JOB1/teos", "pages": pages,
    }

    # Ainult pg_002 valmis (teine.jpg sisu) — pg_001 veel pole
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _FakePollSftp(
        {"/srv/AUTO-OCR/print/JOB1/teos/teos_pg_002.txt": "TEISE LEHE TEKST"}))

    reocr_ops._poll_batch_job(job_id)

    # KRIITILINE: tulemus läks teine.jpg-le (kirje järgi), mitte esimese lehe .ocr-i
    assert (work_dir / "teine.ocr").read_text(encoding="utf-8") == "TEISE LEHE TEKST"
    assert not (work_dir / "esimene.ocr").exists()
    assert pages[1]["status"] == "ready" and pages[0]["status"] == "processing"
    assert reocr_ops._reocr_batch_jobs[job_id]["last_progress_at"] > 0
    del reocr_ops._reocr_batch_jobs[job_id]


def test_batch_inactive_ja_finalize():
    from server.reocr_ops import _batch_inactive, _finalize_batch_if_complete
    job = {"started_at": 0, "last_progress_at": 100, "status": "processing",
           "pages": [{"status": "ready"}, {"status": "error"}], "finished_at": None}
    assert _batch_inactive(job, now=100 + 1801, timeout=1800) is True
    assert _batch_inactive(job, now=100 + 10, timeout=1800) is False
    _finalize_batch_if_complete(job)
    assert job["status"] == "done" and job["finished_at"] is not None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -k "poll_batch_mapping or inactive_ja_finalize" -v`
Expected: FAIL — `AttributeError: ... '_poll_batch_job'` / `'_batch_inactive'`

- [ ] **Step 3: Lisa poll-funktsioonid ja daemon-loop**

Lisa funktsioonid (nt `start_reocr_batch` järele):

```python
def _download_txt_if_ready(sftp, txt_abs: str) -> Optional[str]:
    """Tagastab .txt sisu kui fail eksisteerib, muidu None."""
    try:
        sftp.stat(txt_abs)
    except FileNotFoundError:
        return None
    buf = io.BytesIO()
    sftp.getfo(txt_abs, buf)
    return buf.getvalue().decode("utf-8", errors="replace")


def _batch_inactive(job: Dict, now: float, timeout: int) -> bool:
    """Kas batch on liiga kaua ilma edenemiseta (viimasest ready-st)."""
    return (now - job.get("last_progress_at", job["started_at"])) > timeout


def _finalize_batch_if_complete(job: Dict) -> None:
    """Kui kõik lehed ready/error → märgi job done."""
    if all(e["status"] in ("ready", "error") for e in job["pages"]):
        if job["status"] != "done":
            job["status"] = "done"
            job["finished_at"] = datetime.now().timestamp()


def _poll_batch_job(job_id: str) -> None:
    """Laeb iga ootel-lehe valmis .txt alla → .ocr fail (AUTORITEETNE mapping kirjest)."""
    job = _reocr_batch_jobs.get(job_id)
    if not job or job["status"] != "processing":
        return
    pending = [e for e in job["pages"] if e["status"] == "processing"]
    if not pending:
        _finalize_batch_if_complete(job)
        return
    try:
        sftp = _sftp_open(job_id)
    except Exception as e:
        logger.warning(f"Re-OCR batch {job_id} poll sftp viga: {e}")
        return
    work_abs = f"{OCR_SERVER_PATH}/{job['remote_work']}"
    try:
        for entry in pending:
            txt_abs = f"{work_abs}/{entry['remote_txt_name']}"
            try:
                text = _download_txt_if_ready(sftp, txt_abs)
            except Exception as e:
                logger.warning(f"Re-OCR batch {job_id} {entry['page_filename']} laadimisviga: {e}")
                continue
            if text is None:
                continue
            # AUTORITEETNE: kirje page_filename määrab sihtkoha
            try:
                _write_ocr_file(job["slug"], entry["page_filename"], text)
                entry["status"] = "ready"
                job["last_progress_at"] = datetime.now().timestamp()
            except Exception as e:
                entry["status"] = "error"
                entry["error"] = str(e)
            # Ko(rista remote pilt+txt
            for f in (txt_abs, f"{work_abs}/{entry['remote_img_name']}"):
                try:
                    sftp.remove(f)
                except Exception:
                    pass
    finally:
        try:
            sftp.close()
        except Exception:
            pass
    close_ssh(job_id)
    _finalize_batch_if_complete(job)


def _reocr_batch_poll_loop():
    """Daemon: kontrollib batch-töid iga 10s; inactivity-timeout märgib lahendamata lehed error-iks."""
    import time
    while True:
        time.sleep(10)
        now = datetime.now().timestamp()
        with _reocr_batch_jobs_lock:
            active = [(jid, j) for jid, j in _reocr_batch_jobs.items() if j["status"] == "processing"]
            # TTL: eemalda vanad done jobid
            stale = [jid for jid, j in _reocr_batch_jobs.items()
                     if j["status"] in ("done", "error")
                     and (j.get("finished_at") or 0) < now - REOCR_JOB_TTL]
            for jid in stale:
                del _reocr_batch_jobs[jid]
        for jid, job in active:
            if _batch_inactive(job, now, REOCR_BATCH_INACTIVITY_TIMEOUT):
                with _reocr_batch_jobs_lock:
                    for e in job["pages"]:
                        if e["status"] in ("uploading", "processing"):
                            e["status"] = "error"
                            e["error"] = "Aegumine: OCR ei edenenud määratud aja jooksul."
                    job["status"] = "done"
                    job["finished_at"] = now
                logger.warning(f"Re-OCR batch {jid}: inactivity-timeout")
                continue
            try:
                _poll_batch_job(jid)
            except Exception as e:
                logger.warning(f"Re-OCR batch {jid} poll viga: {e}")


threading.Thread(target=_reocr_batch_poll_loop, daemon=True, name="reocr-batch-poll").start()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -k "poll_batch_mapping or inactive_ja_finalize" -v`
Expected: PASS

Paranda ka kommentaari-trükiviga real `# Ko(rista remote` → `# Korista remote`.

- [ ] **Step 5: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "feat(reocr): batch-poll autoriteetne resolveerimine + inactivity-timeout"
```

---

## Task 5: `build_reocr_status` — koond-staatus (active / ocr_ready / errors / progress)

**Files:**
- Modify: `server/reocr_ops.py`
- Test: `tests/test_reocr_batch.py`

**Interfaces:**
- Consumes: `_reocr_batch_jobs`.
- Produces: `build_reocr_status(work_id: str, work_path: str) -> Dict` →
  `{"active": Dict[str,str], "ocr_ready": List[str] (stems), "errors": Dict[str,str], "progress": Optional[Dict]}`.
  `active`/`errors` võtmestatud **image-failinime** järgi; `ocr_ready` on **stem'id** (kaustast skannitud `.ocr`).

- [ ] **Step 1: Write the failing test**

```python
def test_build_reocr_status_agregeerib(tmp_path, monkeypatch):
    from server import reocr_ops
    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    (work_dir / "x.ocr").write_text("valmis", encoding="utf-8")  # ocr_ready stem
    (work_dir / "x.jpg").write_bytes(b"i")

    reocr_ops._reocr_batch_jobs["JB"] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "processing",
        "started_at": 0, "finished_at": None, "last_progress_at": 0,
        "remote_work": "r", "pages": [
            {"page_filename": "a.jpg", "status": "processing", "error": None},
            {"page_filename": "b.jpg", "status": "ready", "error": None},
            {"page_filename": "c.jpg", "status": "error", "error": "läks viltu"},
        ],
    }
    try:
        st = reocr_ops.build_reocr_status("w", str(work_dir))
        assert st["active"] == {"a.jpg": "processing"}
        assert st["errors"] == {"c.jpg": "läks viltu"}
        assert "x" in st["ocr_ready"]
        assert st["progress"] == {"total": 3, "ready": 1, "errors": 1, "active": True}
        # Teine teos → tühi/None progress
        st2 = reocr_ops.build_reocr_status("muu", str(work_dir))
        assert st2["active"] == {} and st2["progress"] is None
    finally:
        del reocr_ops._reocr_batch_jobs["JB"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_build_reocr_status_agregeerib -v`
Expected: FAIL — `AttributeError: ... 'build_reocr_status'`

- [ ] **Step 3: Lisa funktsioon**

```python
def build_reocr_status(work_id: str, work_path: str) -> Dict:
    """Koondab teose re-OCR staatuse manage-lehe jaoks. Hoiab kolm mõistet lahus:
    active (OCR töötab), ocr_ready (.ocr ootel, stem'id), errors. progress = aktiivse
    batchi kokkuvõte."""
    active: Dict[str, str] = {}
    errors: Dict[str, str] = {}
    progress: Optional[Dict] = None
    with _reocr_batch_jobs_lock:
        for j in _reocr_batch_jobs.values():
            if j["work_id"] != work_id:
                continue
            is_active = j["status"] in ("uploading", "processing")
            for e in j["pages"]:
                if e["status"] in ("uploading", "processing"):
                    active[e["page_filename"]] = e["status"]
                elif e["status"] == "error" and e.get("error"):
                    errors[e["page_filename"]] = e["error"]
            summary = {
                "total": len(j["pages"]),
                "ready": sum(1 for e in j["pages"] if e["status"] == "ready"),
                "errors": sum(1 for e in j["pages"] if e["status"] == "error"),
                "active": is_active,
            }
            # Eelista aktiivset batchi; muidu viimast nähtut
            if is_active or progress is None:
                progress = summary
    ocr_ready: List[str] = []
    try:
        for fn in os.listdir(work_path):
            if fn.endswith(".ocr"):
                ocr_ready.append(os.path.splitext(fn)[0])
    except FileNotFoundError:
        pass
    return {"active": active, "ocr_ready": ocr_ready, "errors": errors, "progress": progress}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py::test_build_reocr_status_agregeerib -v`
Expected: PASS

- [ ] **Step 5: Run all backend reocr tests + commit**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -v`
Expected: kõik PASS

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "feat(reocr): build_reocr_status koondstaatus manage-lehele"
```

---

## Task 6: Endpointid — `POST /reocr-batch` + `GET /reocr-status`

**Files:**
- Modify: `server/main.py` (lisa `delete_page_ocr` endpointi järele, ~rida 1545; uuenda import read 38-41)
- Test: `tests/test_reocr_batch.py`

**Interfaces:**
- Consumes: `start_reocr_batch`, `get_active_batch_for_work`, `build_reocr_status`, `find_directory_by_id`.
- Produces:
  - `POST /admin/work/{work_id}/reocr-batch` body `{"page_filenames": List[str], "material_type": "print"|"hand"}` → `{"status": "accepted", "job_id": str}`. Vead: 404 (teos), 400 (tühi list / tundmatu fail), 409 (juba aktiivne batch sellel teosel).
  - `GET /admin/work/{work_id}/reocr-status` → `{"status": "success", **build_reocr_status(...)}`.

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_reocr_batch.py`-sse (TestClient + fixture nagu `test_transform_page.py`):

```python
def _admin_client(tmp_path, monkeypatch):
    """TestClient admin-tokeniga + üks testtöö."""
    import server.main as main
    from fastapi.testclient import TestClient
    work = tmp_path / "1700-teos"
    work.mkdir()
    (work / "a.jpg").write_bytes(b"IMG")
    monkeypatch.setattr(main, "find_directory_by_id",
                        lambda w: str(work) if w == "w1" else None)
    # Auth möödaviik: asenda require_role tagastama admin-kasutaja
    from server import auth
    monkeypatch.setattr(main, "require_role", lambda role: (lambda: {"username": "admin", "role": "admin"}))
    return TestClient(main.app), work


def test_reocr_batch_endpoint_validatsioon(tmp_path, monkeypatch):
    from server import reocr_ops
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: None)  # upload-thread ei jõua kaugele
    client, work = _admin_client(tmp_path, monkeypatch)

    # Tundmatu teos → 404
    assert client.post("/admin/work/zzz/reocr-batch",
                       json={"page_filenames": ["a.jpg"]}).status_code == 404
    # Tühi list → 400
    assert client.post("/admin/work/w1/reocr-batch",
                       json={"page_filenames": []}).status_code == 400
    # Tundmatu fail → 400
    assert client.post("/admin/work/w1/reocr-batch",
                       json={"page_filenames": ["puudub.jpg"]}).status_code == 400


def test_reocr_status_endpoint_tagastab_kuju(tmp_path, monkeypatch):
    client, work = _admin_client(tmp_path, monkeypatch)
    r = client.get("/admin/work/w1/reocr-status")
    assert r.status_code == 200
    body = r.json()
    assert set(body) >= {"active", "ocr_ready", "errors", "progress"}
```

> NB: kui `require_role` monkeypatch ei sobi olemasoleva auth-mustriga, vaata `tests/test_delete_pages_endpoint.py` eeskuju ja kasuta sama auth-seadistust. Eesmärk: admin-päringud lähevad läbi.

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -k "endpoint" -v`
Expected: FAIL — 404/405 (endpoint puudub)

- [ ] **Step 3: Uuenda import ja lisa endpointid**

`main.py` read 38-41 — lisa importi uued nimed:

```python
from .reocr_ops import (
    start_reocr_job, poll_reocr_job, list_reocr_jobs,
    get_active_reocr_count, REOCR_MAX_CONCURRENT, get_reocr_log,
    start_reocr_batch, get_active_batch_for_work, build_reocr_status,
)
```

Lisa endpointid `delete_page_ocr` järele (~rida 1545):

```python
@app.post("/admin/work/{work_id}/reocr-batch")
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
        if not os.path.isfile(os.path.join(path, fn)):
            raise HTTPException(status_code=400, detail=f"Pilti ei leitud: {fn}")
        pages.append((fn, None))
    job_id = start_reocr_batch(work_id, slug, path, pages,
                               material_type=material_type, username=user['username'])
    return {"status": "accepted", "job_id": job_id}


@app.get("/admin/work/{work_id}/reocr-status")
async def admin_reocr_status_for_work(work_id: str, user=Depends(require_role("admin"))):
    """Teose re-OCR koondstaatus manage-lehele (active/ocr_ready/errors/progress)."""
    path = find_directory_by_id(work_id)
    if not path:
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", **build_reocr_status(work_id, path)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -k "endpoint" -v`
Expected: PASS

Veendu, et `server/__init__.py` ei re-ekspordi konkreetset reocr-funktsioonide nimekirja, mis vajaks uuendamist (vt mälu [feedback_init_imports]). Kui re-ekspordib, lisa uued nimed.

- [ ] **Step 5: Run full backend suite + commit**

Run: `.venv/bin/python -m pytest tests/test_reocr_batch.py -v`
Expected: kõik PASS

```bash
git add server/main.py tests/test_reocr_batch.py
git commit -m "feat(reocr): POST /reocr-batch + GET /reocr-status endpointid"
```

---

## Task 7: Frontend util `reocrStatus.ts` + vitest

**Files:**
- Create: `src/utils/reocrStatus.ts`
- Test: `src/utils/__tests__/reocrStatus.test.ts`

**Interfaces:**
- Produces:
  - `type ReocrState = 'processing' | 'ocr_ready' | 'error' | undefined`
  - `interface ReocrStatusResponse { active: Record<string,string>; ocr_ready: string[]; errors: Record<string,string>; progress: { total: number; ready: number; errors: number; active: boolean } | null }`
  - `mapReocrState(filename: string, status: ReocrStatusResponse | null): ReocrState`
  - `selectableNoTextFiles(pages: { filename: string; has_text: boolean }[], status: ReocrStatusResponse | null): string[]`

- [ ] **Step 1: Write the failing test**

Loo `src/utils/__tests__/reocrStatus.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapReocrState, selectableNoTextFiles, ReocrStatusResponse } from '../reocrStatus';

const status: ReocrStatusResponse = {
  active: { 'a.jpg': 'processing' },
  ocr_ready: ['b'],            // stem → b.jpg
  errors: { 'c.jpg': 'viga' },
  progress: { total: 3, ready: 1, errors: 1, active: true },
};

describe('mapReocrState', () => {
  it('eristab kolm mõistet failinime/stem järgi', () => {
    expect(mapReocrState('a.jpg', status)).toBe('processing');
    expect(mapReocrState('b.jpg', status)).toBe('ocr_ready');
    expect(mapReocrState('c.jpg', status)).toBe('error');
    expect(mapReocrState('d.jpg', status)).toBeUndefined();
    expect(mapReocrState('a.jpg', null)).toBeUndefined();
  });
});

describe('selectableNoTextFiles', () => {
  it('jätab OCR-ootel ja töötavad lehed välja', () => {
    const pages = [
      { filename: 'a.jpg', has_text: false }, // active → välja
      { filename: 'b.jpg', has_text: false }, // ocr_ready → välja
      { filename: 'd.jpg', has_text: false }, // päris tekstita → sisse
      { filename: 'e.jpg', has_text: true },  // tekst olemas → välja
    ];
    expect(selectableNoTextFiles(pages, status)).toEqual(['d.jpg']);
  });
  it('ilma staatuseta võtab kõik tekstita', () => {
    const pages = [{ filename: 'a.jpg', has_text: false }, { filename: 'e.jpg', has_text: true }];
    expect(selectableNoTextFiles(pages, null)).toEqual(['a.jpg']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- reocrStatus`
Expected: FAIL — `Cannot find module '../reocrStatus'`

- [ ] **Step 3: Loo util**

Loo `src/utils/reocrStatus.ts`:

```typescript
// Re-OCR koondstaatuse abifunktsioonid manage-lehele.
// Kolm SÕLTUMATUT mõistet: OCR töötab (active), .ocr ootel (ocr_ready, stem'id),
// viga (errors). has_text on eraldi (lehe päris .txt) — siin EI käsitleta.

export type ReocrState = 'processing' | 'ocr_ready' | 'error' | undefined;

export interface ReocrStatusResponse {
  active: Record<string, string>;
  ocr_ready: string[]; // stem'id (ilma laiendita)
  errors: Record<string, string>;
  progress: { total: number; ready: number; errors: number; active: boolean } | null;
}

const stripExt = (fn: string): string => fn.replace(/\.[^.]+$/, '');

/** Lehe re-OCR olek failinime järgi. ocr_ready võrreldakse stem'i järgi. */
export function mapReocrState(filename: string, status: ReocrStatusResponse | null): ReocrState {
  if (!status) return undefined;
  if (status.active[filename]) return 'processing';
  if (status.errors[filename]) return 'error';
  if (status.ocr_ready.includes(stripExt(filename))) return 'ocr_ready';
  return undefined;
}

/** "Vali tekstita": has_text===false JA mitte OCR-ootel JA mitte töötav. */
export function selectableNoTextFiles(
  pages: { filename: string; has_text: boolean }[],
  status: ReocrStatusResponse | null,
): string[] {
  return pages
    .filter((p) => !p.has_text)
    .filter((p) => {
      if (!status) return true;
      if (status.active[p.filename]) return false;
      if (status.ocr_ready.includes(stripExt(p.filename))) return false;
      return true;
    })
    .map((p) => p.filename);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- reocrStatus`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/reocrStatus.ts src/utils/__tests__/reocrStatus.test.ts
git commit -m "feat(manage): reocrStatus util — mapReocrState + selectableNoTextFiles"
```

---

## Task 8: PageCard — `hasText` "tekstita" + `reocrState` märgid

**Files:**
- Modify: `src/pages/manage/PageCard.tsx`

**Interfaces:**
- Consumes: `ReocrState` (`src/utils/reocrStatus.ts`).
- Produces: `PageCardProps` lisaväljad `hasText: boolean`, `reocrState?: ReocrState`.

- [ ] **Step 1: Lisa propid ja import**

`PageCard.tsx` — uuenda import ja `PageCardProps`:

```typescript
import { Scissors, ChevronUp, ChevronDown, Check, Loader2, FileCheck2, AlertCircle } from 'lucide-react';
import PageThumb from './PageThumb';
import { IMAGE_BASE_URL } from '../../config';
import { ReocrState } from '../../utils/reocrStatus';
```

Lisa `PageCardProps`-i (`status: string;` järele):

```typescript
  hasText: boolean;
  reocrState?: ReocrState;
```

- [ ] **Step 2: Lisa visuaalsed märgid**

`PageCard.tsx` — pisipildi `div` sees (peale valiku-märkeruutu, enne `<PageThumb>`), lisa "tekstita" märk ülal paremal ja re-OCR märk:

```tsx
        {/* Tekstita märk — üleval paremal (eraldi reocr-märgist) */}
        {!p.hasText && p.reocrState !== 'ocr_ready' && (
          <span
            className="absolute top-1 right-1 z-10 px-1 py-0.5 rounded text-[10px] leading-none bg-amber-100 text-amber-700 border border-amber-300 shadow-sm"
            title={t('manage.reocr.badge.noText')}
          >
            {t('manage.reocr.badge.noText')}
          </span>
        )}
        {/* Re-OCR olek — üleval paremal, märgib sõltumatult has_text-st.
            "ocr_ready" tähendab "OCR valmis ülevaatamiseks", MITTE "leht korras". */}
        {p.reocrState === 'processing' && (
          <span className="absolute top-1 right-1 z-10 p-1 rounded bg-white/90 border border-gray-300 shadow-sm"
            title={t('manage.reocr.badge.processing')}>
            <Loader2 size={12} className="animate-spin text-gray-600" />
          </span>
        )}
        {p.reocrState === 'ocr_ready' && (
          <span className="absolute top-1 right-1 z-10 flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] leading-none bg-green-100 text-green-700 border border-green-300 shadow-sm"
            title={t('manage.reocr.badge.ready')}>
            <FileCheck2 size={11} /> {t('manage.reocr.badge.ready')}
          </span>
        )}
        {p.reocrState === 'error' && (
          <span className="absolute top-1 right-1 z-10 p-1 rounded bg-red-100 border border-red-300 shadow-sm"
            title={t('manage.reocr.badge.error')}>
            <AlertCircle size={12} className="text-red-600" />
          </span>
        )}
```

- [ ] **Step 3: Verifitseeri build**

Run: `npm run build`
Expected: õnnestub ilma TS-vigadeta. (PageCard `hasText` on nüüd kohustuslik prop — WorkManage uuendatakse Task 9-s; kui build kurdab puuduva propi üle WorkManage-is, see on oodatud ja lahendatakse Task 9-s. Selle taski võib commitida koos Task 9-ga, kui build nõuab mõlemat. Eelista: tee Step 4 commit alles kui Task 9 build õnnestub.)

- [ ] **Step 4: Commit (koos Task 9-ga kui build seda nõuab)**

```bash
git add src/pages/manage/PageCard.tsx
git commit -m "feat(manage): PageCard tekstita + reocr-olek märgid"
```

---

## Task 9: WorkManage — re-OCR sektsioon, "Vali tekstita", batch-käivitus, staatuse-poll + i18n

**Files:**
- Modify: `src/pages/WorkManage.tsx`
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json`

**Interfaces:**
- Consumes: `mapReocrState`, `selectableNoTextFiles`, `ReocrStatusResponse` (`src/utils/reocrStatus.ts`); endpointid `POST /admin/work/{id}/reocr-batch`, `GET /admin/work/{id}/reocr-status`.

- [ ] **Step 1: Lisa i18n võtmed**

`src/locales/et/workspace.json` — `manage` ploki sisse (nt `bulkDelete` järele) lisa:

```json
    "reocr": {
      "section": "Transkriptsioon",
      "selectNoText": "Vali tekstita",
      "button": "Tee transkriptsioon ({{count}})",
      "model": { "label": "Mudel", "print": "Trükitekst", "hand": "Käsikiri" },
      "progress": "OCR: {{ready}}/{{total}} valmis, {{errors}} veaga",
      "confirm": {
        "line1": "{{count}} lehte saadetakse uuesti OCR-i.",
        "line2": "Olemasolev tekst ei muutu enne, kui rakendad tulemuse Workspace'is.",
        "withText": "({{count}} valitud lehel on juba tekst — re-OCR teeb uue versiooni ülevaatuseks, vana jääb alles kuni rakendamiseni.)",
        "go": "Saada OCR-i",
        "cancel": "Tühista"
      },
      "started": "Batch re-OCR alustatud.",
      "error": "Re-OCR alustamine ebaõnnestus.",
      "badge": { "noText": "tekstita", "processing": "OCR töötab", "ready": "OCR valmis ülevaatamiseks", "error": "OCR ebaõnnestus" }
    }
```

`src/locales/en/workspace.json` — sama `manage.reocr` plokk:

```json
    "reocr": {
      "section": "Transcription",
      "selectNoText": "Select untranscribed",
      "button": "Transcribe ({{count}})",
      "model": { "label": "Model", "print": "Print", "hand": "Handwriting" },
      "progress": "OCR: {{ready}}/{{total}} done, {{errors}} failed",
      "confirm": {
        "line1": "{{count}} pages will be re-sent to OCR.",
        "line2": "Existing text will not change until you apply the result in the Workspace.",
        "withText": "({{count}} selected pages already have text — re-OCR creates a new version for review; the old one stays until you apply it.)",
        "go": "Send to OCR",
        "cancel": "Cancel"
      },
      "started": "Batch re-OCR started.",
      "error": "Failed to start re-OCR.",
      "badge": { "noText": "no text", "processing": "OCR running", "ready": "OCR ready for review", "error": "OCR failed" }
    }
```

- [ ] **Step 2: Lisa state, import ja staatuse-poll WorkManage-isse**

`WorkManage.tsx` — lisa import (PageCard impordi kõrvale):

```typescript
import { mapReocrState, selectableNoTextFiles, ReocrStatusResponse } from '../utils/reocrStatus';
```

Lisa state (nt `bulkDeleteError` lähedusse):

```typescript
  const [reocrStatus, setReocrStatus] = useState<ReocrStatusResponse | null>(null);
  const [ocrModel, setOcrModel] = useState<'print' | 'hand'>('print');
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [reocrPollNonce, setReocrPollNonce] = useState(0); // batch-käivitusel taaskäivitab poll-effecti
```

Lisa staatuse-fetch + poll (uus `useEffect`, töötab ühe korra laadimisel + intervall ainult kui aktiivne):

```typescript
  // Re-OCR koondstaatus: laeb korra (näitab .ocr-ootel märke), pollib ainult aktiivse batchi ajal.
  useEffect(() => {
    if (!workId || !authToken) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetchWithTimeout(
          `${FILE_API_URL}/admin/work/${workId}/reocr-status`,
          { headers: getAuthHeaders(authToken), timeout: 8000 },
        );
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setReocrStatus(data);
          if (!cancelled && data.progress && data.progress.active) {
            timer = setTimeout(tick, 4000);
          }
        }
      } catch {
        if (!cancelled) timer = setTimeout(tick, 6000);
      }
    };
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [workId, authToken, reocrPollNonce]);
```

- [ ] **Step 3: Lisa handlerid**

`WorkManage.tsx` — lisa `handleSelectAll` lähedusse:

```typescript
  const handleSelectNoText = () =>
    setSelectedFiles(new Set(selectableNoTextFiles(pages, reocrStatus)));

  const selectedWithTextCount = Array.from(selectedFiles)
    .filter((fn) => pages.find((p) => p.filename === fn)?.has_text).length;

  const handleBatchReocr = async () => {
    if (!workId || !authToken || selectedFiles.size === 0) return;
    setBatchError(null);
    try {
      const res = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${workId}/reocr-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
        body: JSON.stringify({ page_filenames: Array.from(selectedFiles), material_type: ocrModel }),
        timeout: 30000,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || t('manage.reocr.error'));
      }
      setBatchConfirm(false);
      handleClearSelection();
      // Käivita poll kohe (status fetch uuesti)
      const st = await fetchWithTimeout(`${FILE_API_URL}/admin/work/${workId}/reocr-status`,
        { headers: getAuthHeaders(authToken), timeout: 8000 });
      if (st.ok) setReocrStatus(await st.json());
      setReocrPollNonce((n) => n + 1); // taaskäivitab poll-effecti (alustab pollimist)
    } catch (e: any) {
      setBatchError(e.message || t('manage.reocr.error'));
    }
  };
```

- [ ] **Step 4: Lisa re-OCR sektsioon UI-sse (heleroheline, valikuriba sees)**

`WorkManage.tsx` — valiku-riba `div` sees (read ~641-672), peale "Liiguta/Kustuta" rida, lisa re-OCR alamsektsioon. Lisa valikuribasse, OLEMASOLEVA sisu lõppu (enne sulgevat `</div>`, mis lõpetab `bg-primary-50` ploki — VÕI eraldi blokina selle järel). Eraldi blokk on selgem:

Asenda valiku-riba sulgemise järel (peale rida 672 `)}`) lisa uus blokk:

```tsx
                {/* Re-OCR sektsioon — eraldi, heleroheline, et mitte konkureerida liiguta/kustuta nuppudega */}
                {selectedFiles.size > 0 && (
                  <div className="mx-4 mb-1 p-3 bg-green-50 border border-green-200 rounded-lg flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-sm font-medium text-green-800">{t('manage.reocr.section')}</span>
                    <label className="text-sm text-gray-600">{t('manage.reocr.model.label')}:</label>
                    <select value={ocrModel} onChange={(e) => setOcrModel(e.target.value as 'print' | 'hand')}
                      className="text-sm border border-gray-300 rounded px-1.5 py-0.5">
                      <option value="print">{t('manage.reocr.model.print')}</option>
                      <option value="hand">{t('manage.reocr.model.hand')}</option>
                    </select>
                    <button onClick={() => setBatchConfirm(true)} disabled={hasReorderChanges}
                      title={hasReorderChanges ? t('manage.bulkDelete.draftBlocked') : ''}
                      className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded">
                      {t('manage.reocr.button', { count: selectedFiles.size })}
                    </button>
                  </div>
                )}

                {/* Re-OCR kinnitus */}
                {batchConfirm && (
                  <div className="mx-4 mb-2 p-3 bg-green-50 border border-green-300 rounded-lg flex flex-col gap-2">
                    <span className="text-sm text-green-900">{t('manage.reocr.confirm.line1', { count: selectedFiles.size })} {t('manage.reocr.confirm.line2')}</span>
                    {selectedWithTextCount > 0 && (
                      <span className="text-xs text-green-700">{t('manage.reocr.confirm.withText', { count: selectedWithTextCount })}</span>
                    )}
                    <div className="flex items-center gap-3">
                      <button onClick={handleBatchReocr}
                        className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded">
                        {t('manage.reocr.confirm.go')}
                      </button>
                      <button onClick={() => setBatchConfirm(false)}
                        className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                        {t('manage.reocr.confirm.cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {batchError && (
                  <div className="mx-4 mb-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{batchError}</div>
                )}

                {/* Progress-kokkuvõte */}
                {reocrStatus?.progress && reocrStatus.progress.total > 0 && (
                  <div className="mx-4 mb-2 text-sm text-green-700">
                    {t('manage.reocr.progress', {
                      ready: reocrStatus.progress.ready,
                      total: reocrStatus.progress.total,
                      errors: reocrStatus.progress.errors,
                    })}
                  </div>
                )}
```

Lisa "Vali tekstita" nupp olemasoleva "Vali kõik" kõrvale (read ~616-621):

```tsx
                {pages.length > 0 && (
                  <button onClick={handleSelectNoText}
                    className="px-2 py-1 text-xs border border-amber-300 text-amber-700 rounded hover:bg-amber-50">
                    {t('manage.reocr.selectNoText')}
                  </button>
                )}
```

- [ ] **Step 5: Anna `hasText` + `reocrState` PageCard-ile**

`WorkManage.tsx` — `<PageCard ... />` (read ~695-710), lisa propid:

```tsx
                        status={page.status}
                        hasText={page.has_text}
                        reocrState={mapReocrState(page.filename, reocrStatus)}
```

- [ ] **Step 6: Verifitseeri build + lint**

Run: `npm run build`
Expected: õnnestub ilma TS-vigadeta.

Run: `npm test -- reocrStatus`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/pages/WorkManage.tsx src/pages/manage/PageCard.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat(manage): batch re-OCR sektsioon + tekstita ülevaade + staatuse-poll"
```

---

## Task 10: Täis-suite + manuaalne server-verifitseerimine

**Files:** —

- [ ] **Step 1: Backend täis-suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: kõik PASS (uued `test_reocr_batch.py` + olemasolevad regressioonita).

- [ ] **Step 2: Frontend testid + build**

Run: `npm test`
Run: `npm run build`
Expected: PASS + edukas build.

- [ ] **Step 3: Deploy + manuaalne server-test**

Vt mälu deploy-juhised:
- Backend: `git pull && docker compose build --no-cache backend && docker compose up -d backend` (serveris; `--no-cache` kohustuslik).
- Frontend: `npm run build` lokaalselt + `rsync -avz dist/ vutt:~/VUTT/dist/`.

Manuaalne test serveris:
1. Manage-leht: vahelelaaditud lehed näitavad "tekstita" märki.
2. "Vali tekstita" → valib õiged lehed (mitte juba OCR-ootel olevaid).
3. Vali 2–3 lehte → "Tee transkriptsioon" → kinnitus → saada.
4. Pisipiltidel ilmub spinner → roheline "OCR valmis ülevaatamiseks"; progress-rida loeb "OCR: n/N valmis".
5. Klõps lehel → Workspace → `useReOcr` näitab "rakenda" nuppu olemasolevast `.ocr`-st.
6. Veendu logist: `docker logs vutt-backend | grep "Re-OCR batch"`.

- [ ] **Step 4: Lõpeta haru**

REQUIRED SUB-SKILL: Use superpowers:finishing-a-development-branch.

---

## Self-Review (täidetud plaani kirjutamisel)

**Spec coverage:**
- A (staatuse-ülevaade + "Vali tekstita") → Task 7 (util), 8 (PageCard märgid), 9 (nupp + wiring). ✓
- B (käivitaja, eraldi heleroheline sektsioon, kinnitusdialoog üle-kirjutamise hoiatusega, print/hand) → Task 9. ✓
- C (üks multi-image job, autoriteetne mapping, jagatud helperid) → Task 1, 2, 3, 4. ✓
- D (reocr-status active/ocr_ready/errors/progress, poll ainult aktiivse ajal, kolm mõistet lahus, "OCR valmis ülevaatamiseks") → Task 5, 6, 9; märgid Task 8. ✓
- Inactivity-timeout (mitte üks fikseeritud limiit; ainult lahendamata lehed error) → Task 4. ✓
- E (skoobist väljas — admin monitor) → ei plaanita, õigesti. ✓

**Placeholder scan:** Kõik sammud sisaldavad täielikku koodi/käske. Üks teadlik tingimuslik koht: Task 6 Step 1 märkus auth-monkeypatch'i kohta (viide olemasolevale test-mustrile) — vajalik, sest auth-seadistus sõltub repo konventsioonist.

**Type consistency:** `ReocrStatusResponse` / `ReocrState` / `mapReocrState` / `selectableNoTextFiles` ühtsed Task 7→8→9. Backend `build_reocr_status` võtmed (`active`/`ocr_ready`/`errors`/`progress`) ühtivad frontend `ReocrStatusResponse`-iga. `ocr_ready` = stem'id mõlemal pool (backend `splitext`, frontend `stripExt`). ✓
