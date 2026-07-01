# OCR Recovery Hardening (Faas 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Taastatud re-OCR kirjed saavad `page_number`-i (link + "lk N" ilmuvad) ja batch-orvud muutuvad automaatselt taastatavaks püsiva mapping-faili kaudu.

**Architecture:** Batch-jobi lehe-mapping (`remote_txt_name → page_filename`) kirjutatakse batch ALGUSES püsivasse faili (`state/reocr_batch_maps/{job_id}.json`), kustutatakse koristusel — restart/error/crash-kindel. Reaper kasutab mapping-faili olemasolu deterministliku single/batch-eristajana; puuduv → üksik-tee (`reocr_log`). Frontend link-tingimust lõdvendatakse: `work_id` olemas → alati link.

**Tech Stack:** Python 3.9 (FastAPI, Dockeris), pytest; React 19 + TS.

## Global Constraints

- **Python 3.9 compat:** `Optional[X]`, `Dict[...]`, `List[...]` — MITTE `X | None` / `dict[...]`.
- **Testid:** `.venv/bin/python -m pytest tests/ -q`. Frontend gate: `npm run typecheck`.
- **`slow` on lipp, mitte staatus** (eelmisest featuurist); `status ∈ {uploading,processing,done,error}`.
- **Recovery-eristaja deterministlik:** batch-mapping fail olemas → batch; puudub → üksik. MITTE `_pg_NNN`-loenduse heuristika.
- **Reaper puutub ainult mitte-aktiivseid** töid (`_reocr_jobs` EGA `_reocr_batch_jobs`-is pole `uploading`/`processing`).
- **`reocr_log` cap jääb 500** (batch ei floodi logi — mapping eraldi failis).
- **Commit-lõpp:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## File Structure

| Fail | Vastutus | Muudatus |
|------|----------|----------|
| `server/reocr_state.py` | + batch-mapping püsivus (persist/load/remove/list) | Lisa funktsioonid |
| `server/reocr_ops.py` | `start_reocr_batch` kirjutab mapping'u; `_poll_batch_job` kustutab koristusel | Kirurgiline edit |
| `server/reocr_recovery.py` | `_resolve_job_meta`+page_number; batch-taaste mapping'ust; aktiivsuse-check mõlemast dict'ist; skip-müra | Edit |
| `src/pages/Review.tsx` | Link `work_id` olemasolul (leht kui page_number, muidu teos) | 2 kohta |
| `tests/test_reocr_state.py` | batch-mapping testid | Lisa |
| `tests/test_reocr_recovery.py` | page_number, batch-taaste, skip-live-batch, mapping-remove | Lisa |

---

## Task 1: Batch-mapping püsivus (`reocr_state.py`)

**Files:**
- Modify: `server/reocr_state.py` (lisa funktsioonid faili lõppu)
- Test: `tests/test_reocr_state.py` (lisa)

**Interfaces:**
- Produces:
  - `persist_batch_mapping(job_id: str, work_id, slug: str, pages: Dict[str, dict]) -> None` — kirjutab `state/reocr_batch_maps/{job_id}.json` = `{"work_id", "slug", "pages"}`, kus `pages = {remote_txt_name: {"page_filename", "page_number"}}`. Atomaarne.
  - `load_batch_mapping(job_id: str) -> Optional[dict]` — dict või None (puuduv/vigane).
  - `remove_batch_mapping(job_id: str) -> None` — kustutab faili (best-effort).
  - `BATCH_MAPS_DIR: str` — kausta absoluuttee.

- [x] **Step 1: Write the failing test** (lisa `tests/test_reocr_state.py` lõppu)

```python
def test_batch_mapping_roundtrip(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    pages = {
        "w1_pg_001.txt": {"page_filename": "w1-lk-005.jpg", "page_number": 5},
        "w1_pg_002.txt": {"page_filename": "w1-lk-006.jpg", "page_number": 6},
    }
    st.persist_batch_mapping("b1", "wid", "w1", pages)
    loaded = st.load_batch_mapping("b1")
    assert loaded["work_id"] == "wid"
    assert loaded["slug"] == "w1"
    assert loaded["pages"]["w1_pg_002.txt"]["page_filename"] == "w1-lk-006.jpg"
    assert loaded["pages"]["w1_pg_002.txt"]["page_number"] == 6


def test_batch_mapping_missing_returns_none(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    assert st.load_batch_mapping("puudub") is None


def test_batch_mapping_corrupt_returns_none(tmp_path, monkeypatch):
    import server.reocr_state as st
    d = tmp_path / "reocr_batch_maps"
    d.mkdir()
    (d / "b1.json").write_text("{ vigane", encoding="utf-8")
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(d))
    assert st.load_batch_mapping("b1") is None


def test_batch_mapping_remove(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "reocr_batch_maps"))
    st.persist_batch_mapping("b1", "wid", "w1", {})
    assert st.load_batch_mapping("b1") is not None
    st.remove_batch_mapping("b1")
    assert st.load_batch_mapping("b1") is None
    st.remove_batch_mapping("b1")  # teist korda — ei crash'i
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_state.py -k batch_mapping -q`
Expected: FAIL — `AttributeError: module 'server.reocr_state' has no attribute 'BATCH_MAPS_DIR'`

- [x] **Step 3: Implement** (lisa `server/reocr_state.py` lõppu; `os`/`json`/`STATE_DIR` juba imporditud)

```python
BATCH_MAPS_DIR = os.path.join(STATE_DIR, "reocr_batch_maps")


def _batch_map_path(job_id: str) -> str:
    return os.path.join(BATCH_MAPS_DIR, f"{job_id}.json")


def persist_batch_mapping(job_id: str, work_id, slug: str, pages: Dict[str, dict]) -> None:
    """Kirjuta batch lehe-mapping püsivalt (recovery vundament). Atomaarne."""
    data = {"work_id": work_id, "slug": slug, "pages": pages}
    with _file_lock:
        try:
            os.makedirs(BATCH_MAPS_DIR, exist_ok=True)
            path = _batch_map_path(job_id)
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, path)
        except Exception as e:
            logger.warning(f"batch-mapping kirjutamine ebaõnnestus ({job_id}): {e}")


def load_batch_mapping(job_id: str) -> Optional[dict]:
    """Batch lehe-mapping või None (puuduv/vigane)."""
    with _file_lock:
        try:
            path = _batch_map_path(job_id)
            if not os.path.exists(path):
                return None
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else None
        except Exception as e:
            logger.warning(f"batch-mapping lugemine ebaõnnestus ({job_id}): {e}")
            return None


def remove_batch_mapping(job_id: str) -> None:
    """Kustuta batch-mapping fail (best-effort, koristusel)."""
    with _file_lock:
        try:
            os.remove(_batch_map_path(job_id))
        except FileNotFoundError:
            pass
        except Exception as e:
            logger.warning(f"batch-mapping kustutamine ebaõnnestus ({job_id}): {e}")


def list_batch_mapping_ids() -> list:
    """job_id-d, millel on batch-mapping fail (reaperile)."""
    try:
        return [os.path.splitext(f)[0] for f in os.listdir(BATCH_MAPS_DIR) if f.endswith(".json")]
    except FileNotFoundError:
        return []
```

Lisa `Optional` importi (fail impordib juba `from typing import Dict`):
```python
from typing import Dict, Optional
```

- [x] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_state.py -q`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add server/reocr_state.py tests/test_reocr_state.py
git commit -m "feat: reocr_state batch-mapping püsivus (recovery vundament)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Batch mapping wiring (`reocr_ops.py`)

**Files:**
- Modify: `server/reocr_ops.py` (`start_reocr_batch` ~130-148; `_poll_batch_job` all_resolved ~283-290)
- Test: `tests/test_reocr_slow_flag.py` (lisa)

**Interfaces:**
- Consumes: `reocr_state.persist_batch_mapping`, `reocr_state.remove_batch_mapping` (Task 1).
- Produces: batch-mapping fail eksisteerib batch algusest kuni täieliku koristuseni.

- [x] **Step 1: Write the failing test** (lisa `tests/test_reocr_slow_flag.py` lõppu)

```python
def test_start_reocr_batch_persists_mapping(tmp_path, monkeypatch):
    import server.reocr_ops as r
    import server.reocr_state as st
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "maps"))
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "active.json"))
    # Ära ava päris SFTP-d — upload-thread ebaõnnestub vaikselt, mapping on juba kirjutatud
    monkeypatch.setattr(r, "_sftp_open", lambda jid: (_ for _ in ()).throw(RuntimeError("no ssh")))
    work_dir = tmp_path / "w1"; work_dir.mkdir()
    (work_dir / "w1-a.jpg").write_bytes(b"x")
    monkeypatch.setattr(r, "BASE_DIR", str(tmp_path))

    job_id = r.start_reocr_batch("wid", "w1", str(work_dir),
                                 [("w1-a.jpg", 7)], material_type="print", username="u")
    mapping = st.load_batch_mapping(job_id)
    assert mapping is not None
    assert mapping["slug"] == "w1" and mapping["work_id"] == "wid"
    # remote_txt_name → page_filename + page_number
    names = list(mapping["pages"].values())
    assert names[0]["page_filename"] == "w1-a.jpg"
    assert names[0]["page_number"] == 7
    assert "w1_pg_001.txt" in mapping["pages"]
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()
```

- [x] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_slow_flag.py::test_start_reocr_batch_persists_mapping -q`
Expected: FAIL — `load_batch_mapping` returns None (mapping veel ei kirjutata)

- [x] **Step 3: Persist mapping at batch start**

`server/reocr_ops.py` `start_reocr_batch`-is, pärast `page_entries = _build_batch_pages(slug, pages)` (rida ~130) ja ENNE `_reocr_batch_jobs[job_id] = job` bloki, lisa mapping-ehitus; pärast `_persist_active_jobs()` (rida ~148) lisa mapping-persist:

```python
    page_entries = _build_batch_pages(slug, pages)
    now = datetime.now().timestamp()
    _batch_map_pages = {
        e["remote_txt_name"]: {"page_filename": e["page_filename"], "page_number": e["page_number"]}
        for e in page_entries
    }
```

Ja pärast olemasolevat `_persist_active_jobs()` kutset (rida ~148):

```python
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs[job_id] = job
    _persist_active_jobs()
    reocr_state.persist_batch_mapping(job_id, work_id, slug, _batch_map_pages)
```

- [x] **Step 4: Remove mapping after full cleanup**

`_poll_batch_job`-is, `all_resolved` blokis (rida ~283-290), pärast staging rmdir'i lisa mapping-remove:

```python
        all_resolved = all(e["status"] in ("ready", "error") for e in job["pages"])
        if all_resolved:
            staging_abs = f"{OCR_SERVER_PATH}/{job['remote_staging']}"
            for d in (work_abs, staging_abs):
                try:
                    sftp.rmdir(d)
                except Exception:
                    pass
            reocr_state.remove_batch_mapping(job_id)
```

- [x] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_slow_flag.py tests/test_reocr_batch.py -q`
Expected: PASS (uus + olemasolevad batch-testid)

- [x] **Step 6: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_slow_flag.py
git commit -m "feat: batch mapping kirjutatakse algul, kustutatakse koristusel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Reaper — page_number (1a) + batch-taaste + aktiivsuse-check

**Files:**
- Modify: `server/reocr_recovery.py` (`_resolve_job_meta` ~32-42; `_is_actively_tracked` ~45-48; `_recover_one` ~83-123)
- Test: `tests/test_reocr_recovery.py` (lisa + kohanda olemasolevaid)

**Interfaces:**
- Consumes: `reocr_state.load_batch_mapping`, `reocr_state.remove_batch_mapping`, `reocr_ops._reocr_batch_jobs`, `reocr_ops._reocr_batch_jobs_lock`.
- Produces: reaper taastab batch-orvud mapping'ust; recovery-kirjed sisaldavad `page_number`; skip-müra dedupe.

- [x] **Step 1: Write the failing tests** (lisa `tests/test_reocr_recovery.py` lõppu)

```python
def test_resolve_job_meta_includes_page_number(monkeypatch, tmp_path):
    monkeypatch.setattr(reocr_ops, "REOCR_LOG_FILE", str(tmp_path / "log.json"))
    reocr_ops._append_to_log(
        {"work_id": "wid", "slug": "w1", "page_filename": "w1-lk-7.jpg",
         "page_number": 7, "status": "error", "started_at": 1.0, "finished_at": 2.0}, "j1")
    meta = rec._resolve_job_meta("j1")
    assert meta["page_filename"] == "w1-lk-7.jpg"
    assert meta["page_number"] == 7


def test_batch_orphan_recovered_via_mapping(monkeypatch, tmp_path):
    import server.reocr_state as st
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(rec, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_LOG_FILE", str(tmp_path / "log.json"))
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "maps"))
    (tmp_path / "w1").mkdir()
    st.persist_batch_mapping("borb", "wid", "w1", {
        "w1_pg_001.txt": {"page_filename": "w1-lk-1.jpg", "page_number": 1},
        "w1_pg_002.txt": {"page_filename": "w1-lk-2.jpg", "page_number": 2},
    })
    tree = {"/OCR/AUTO-OCR/print": ["borb"], "/OCR/AUTO-OCR/hand": [],
            "/OCR/AUTO-OCR/print/borb": ["w1"],
            "/OCR/AUTO-OCR/print/borb/w1": ["w1_pg_001.txt", "w1_pg_002.txt"]}
    files = {"/OCR/AUTO-OCR/print/borb/w1/w1_pg_001.txt": b"tekst1",
             "/OCR/AUTO-OCR/print/borb/w1/w1_pg_002.txt": b"tekst2"}
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    rec._recovering.clear()

    result = rec.scan_and_recover()

    assert "borb" in result["recovered"]
    assert (tmp_path / "w1" / "w1-lk-1.ocr").read_text(encoding="utf-8") == "tekst1"
    assert (tmp_path / "w1" / "w1-lk-2.ocr").read_text(encoding="utf-8") == "tekst2"
    # Logi recovery-kirjed page_number-iga
    entries = reocr_ops.get_reocr_log(0, 100)["entries"]
    recs = [e for e in entries if e.get("recovered")]
    assert {e["page_number"] for e in recs} == {1, 2}
    # Mapping kustutatud pärast taastet
    assert st.load_batch_mapping("borb") is None


def test_reaper_skips_live_batch_job(monkeypatch, tmp_path):
    import server.reocr_state as st
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(rec, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(st, "BATCH_MAPS_DIR", str(tmp_path / "maps"))
    st.persist_batch_mapping("borb", "wid", "w1", {
        "w1_pg_001.txt": {"page_filename": "w1-lk-1.jpg", "page_number": 1}})
    tree = {"/OCR/AUTO-OCR/print": ["borb"], "/OCR/AUTO-OCR/hand": [],
            "/OCR/AUTO-OCR/print/borb": ["w1"],
            "/OCR/AUTO-OCR/print/borb/w1": ["w1_pg_001.txt"]}
    sftp = _FakeSftp(tree, {"/OCR/AUTO-OCR/print/borb/w1/w1_pg_001.txt": b"x"})
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: sftp)
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
        reocr_ops._reocr_batch_jobs["borb"] = {"status": "processing", "kind": "batch"}
    rec._recovering.clear()

    result = rec.scan_and_recover()

    assert result["recovered"] == []
    assert sftp.removed == []
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
```

**NB:** `_FakeSftp` (olemasolev testis) vajab, et `listdir` toetaks vahepealseid katalooge (`/borb/w1`). Kontrolli, et `_env` fixture ei sega `BATCH_MAPS_DIR`-i — kui vaja, lisa `monkeypatch.setattr(st, "BATCH_MAPS_DIR", ...)` ka `_env`-i.

- [x] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_reocr_recovery.py -k "batch_orphan or job_meta_includes or skips_live_batch" -q`
Expected: FAIL — `_resolve_job_meta` ei tagasta `page_number`; batch-taastet pole.

- [x] **Step 3: Add page_number to `_resolve_job_meta`**

`server/reocr_recovery.py` `_resolve_job_meta` (rida ~32-42) — lisa `page_number` mõlemasse harru:

```python
def _resolve_job_meta(job_id: str) -> Optional[dict]:
    """Leia {page_filename, work_id, page_number} logist (põhi) või active.json-ist (varu)."""
    log = reocr_ops.get_reocr_log(0, reocr_ops.REOCR_LOG_MAX).get("entries", [])
    for e in log:
        if e.get("job_id") == job_id and e.get("page_filename"):
            return {"page_filename": e["page_filename"], "work_id": e.get("work_id"),
                    "page_number": e.get("page_number")}
    active = reocr_state.load_active_jobs()
    j = active.get(job_id)
    if j and j.get("page_filename"):
        return {"page_filename": j["page_filename"], "work_id": j.get("work_id"),
                "page_number": j.get("page_number")}
    return None
```

Ja `_recover_one` üksik-harus (rida ~110-117) lisa recovery-sündmusesse `page_number`:

```python
            reocr_ops._append_to_log(
                {"work_id": meta.get("work_id"), "slug": slug,
                 "page_filename": meta["page_filename"],
                 "page_number": meta.get("page_number"),
                 "status": "done", "error": None, "started_at": None,
                 "finished_at": now,
                 "recovered": True, "original_status": "error", "recovered_at": now},
                job_id)
```

- [x] **Step 4: Update active-check + dispatch batch vs single + skip-warn**

Asenda `_is_actively_tracked` (rida ~45-48) ja `_recover_one` (rida ~83-123) järgnevaga (lisa ka `_warned_skips` mooduli-tasandile `_recovering` juurde ja `import server.reocr_state as reocr_state` on juba olemas):

```python
_warned_skips = set()  # job_id-d, mille skip-hoiatust juba logitud (müra vältimine)


def _is_actively_tracked(job_id: str) -> bool:
    with reocr_ops._reocr_jobs_lock:
        j = reocr_ops._reocr_jobs.get(job_id)
        if j and j.get("status") in ("uploading", "processing"):
            return True
    with reocr_ops._reocr_batch_jobs_lock:
        b = reocr_ops._reocr_batch_jobs.get(job_id)
        if b and b.get("status") in ("uploading", "processing"):
            return True
    return False


def _warn_skip_once(job_id: str, msg: str) -> None:
    if job_id not in _warned_skips:
        _warned_skips.add(job_id)
        logger.warning(f"Reaper skip {job_id}: {msg}")


def _recover_one(sftp, base: str, job_id: str, recovered: list, skipped: list) -> None:
    if _is_actively_tracked(job_id):
        return
    mapping = reocr_state.load_batch_mapping(job_id)
    if mapping is not None:
        _recover_batch(sftp, base, job_id, mapping, recovered, skipped)
    else:
        _recover_single(sftp, base, job_id, recovered, skipped)


def _recover_batch(sftp, base: str, job_id: str, mapping: dict, recovered: list, skipped: list) -> None:
    slug = mapping.get("slug")
    work_id = mapping.get("work_id")
    pages = mapping.get("pages", {})
    job_dir = f"{base}/{job_id}"
    work_dir = f"{job_dir}/{slug}"
    try:
        files = sftp.listdir(work_dir)
    except FileNotFoundError:
        reocr_state.remove_batch_mapping(job_id)  # staging kadunud → mapping aegunud
        return
    for fname in files:
        if not fname.endswith(".txt"):
            continue
        info = pages.get(fname)
        if not info:
            _warn_skip_once(job_id, f"{fname} pole mapping'us")
            skipped.append(job_id)
            continue
        key = (job_id, fname)
        if not _claim(key):
            continue
        try:
            buf = io.BytesIO()
            sftp.getfo(f"{work_dir}/{fname}", buf)
            text = buf.getvalue().decode("utf-8", errors="replace")
            reocr_ops._write_ocr_file(slug, info["page_filename"], text)
            now = datetime.now().timestamp()
            reocr_ops._append_to_log(
                {"work_id": work_id, "slug": slug, "page_filename": info["page_filename"],
                 "page_number": info.get("page_number"), "status": "done", "error": None,
                 "started_at": None, "finished_at": now,
                 "recovered": True, "original_status": "error", "recovered_at": now}, job_id)
            try:
                sftp.remove(f"{work_dir}/{fname}")
            except Exception:
                pass
            recovered.append(job_id)
        finally:
            _release(key)
    # Kui rohkem .txt pole, koorista kaust + mapping
    try:
        remaining = [f for f in sftp.listdir(work_dir) if f.endswith(".txt")]
    except FileNotFoundError:
        remaining = []
    if not remaining:
        for d in (work_dir, job_dir):
            try:
                sftp.rmdir(d)
            except Exception:
                pass
        reocr_state.remove_batch_mapping(job_id)


def _recover_single(sftp, base: str, job_id: str, recovered: list, skipped: list) -> None:
    job_dir = f"{base}/{job_id}"
    try:
        slugs = sftp.listdir(job_dir)
    except FileNotFoundError:
        return
    for slug in slugs:
        txt_abs = f"{job_dir}/{slug}/{slug}_pg_001.txt"
        try:
            sftp.stat(txt_abs)
        except FileNotFoundError:
            continue
        if not _claim(job_id):
            return
        try:
            meta = _resolve_job_meta(job_id)
            if not meta:
                _warn_skip_once(job_id, ".txt olemas, aga page_filename teadmata")
                skipped.append(job_id)
                return
            buf = io.BytesIO()
            sftp.getfo(txt_abs, buf)
            text = buf.getvalue().decode("utf-8", errors="replace")
            reocr_ops._write_ocr_file(slug, meta["page_filename"], text)
            now = datetime.now().timestamp()
            reocr_ops._append_to_log(
                {"work_id": meta.get("work_id"), "slug": slug, "page_filename": meta["page_filename"],
                 "page_number": meta.get("page_number"), "status": "done", "error": None,
                 "started_at": None, "finished_at": now,
                 "recovered": True, "original_status": "error", "recovered_at": now}, job_id)
            _cleanup_staging(sftp, job_dir, slug)
            recovered.append(job_id)
        finally:
            _release(job_id)
        return
```

Asenda ka olemasolev `_claim` (rida ~51-60) generic-key versiooniga (töötab nii job_id kui `(job_id, name)` võtmega):

```python
def _claim(key) -> bool:
    """Claim recovery-võti (job_id VÕI (job_id, txt_name)). Tagastab False kui juba claimitud."""
    job_id = key[0] if isinstance(key, tuple) else key
    with reocr_ops._reocr_jobs_lock:
        if key in _recovering:
            return False
        j = reocr_ops._reocr_jobs.get(job_id)
        if j and j.get("status") in ("uploading", "processing"):
            return False
        _recovering.add(key)
        return True


def _release(key) -> None:
    with reocr_ops._reocr_jobs_lock:
        _recovering.discard(key)
```

**NB:** vana `_recover_one` sisaldas otse üksik-loogika + skip'i `skipped.append` sõnumiga "page_filename teadmata" — see kolib nüüd `_recover_single`-i. Veendu, et vana keha on täielikult asendatud (mitte duplikaat).

- [x] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_recovery.py -q`
Expected: PASS (uued + olemasolevad; olemasolev `test_skips_unmapped_orphan` peab ikka läbima — üksik-tee)

- [x] **Step 6: Full backend suite**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS

- [x] **Step 7: Commit**

```bash
git add server/reocr_recovery.py tests/test_reocr_recovery.py
git commit -m "feat: reaper taastab batch-orvud mapping'ust + recovery page_number + skip-dedupe

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — link `work_id` olemasolul (leht kui page_number)

**Files:**
- Modify: `src/pages/Review.tsx` (aktiivsete tööde link ~565-574; ajaloo link ~656-661)

**Interfaces:**
- Consumes: `ReocrJob.work_id`, `ReocrJob.page_number` (olemas).
- Produces: iga kirje, millel `work_id`, on klõpsatav (leht kui `page_number`, muidu teos).

- [x] **Step 1: Relax active-jobs link**

`src/pages/Review.tsx` — aktiivsete tööde renderis asenda praegune link-plokk (`{job.work_id && job.page_number && (<a href={`/work/${job.work_id}/${job.page_number}`}...`) järgnevaga:

```tsx
                            {job.work_id && (
                              <a
                                href={job.page_number ? `/work/${job.work_id}/${job.page_number}` : `/work/${job.work_id}`}
                                className="text-xs text-primary-600 hover:underline flex items-center gap-0.5"
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
```

- [x] **Step 2: Relax history-log link**

Sama failis, ajaloo (`reocrLog`) renderis asenda `{entry.work_id && entry.page_number && (<a href={`/work/${entry.work_id}/${entry.page_number}`}...` järgnevaga:

```tsx
                              {entry.work_id && (
                                <a href={entry.page_number ? `/work/${entry.work_id}/${entry.page_number}` : `/work/${entry.work_id}`} target="_blank" rel="noreferrer"
                                  className="text-xs text-primary-600 hover:underline flex items-center gap-0.5">
                                  <ExternalLink size={11} />
                                </a>
                              )}
```

- [x] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: 0 errorit

- [x] **Step 4: Commit**

```bash
git add src/pages/Review.tsx
git commit -m "fix: Review re-OCR link ka ilma page_number-ita (teosele); taastatud kirjed klõpsatavad

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy (pärast kõiki taske)

Backend (`--no-cache`):
```bash
ssh vutt
cd ~/VUTT && git pull
docker compose build --no-cache backend && docker compose up -d backend
docker logs vutt-backend --tail 30 | grep -i reaper
```

Frontend:
```bash
npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
```

**Käsitsi: praegune 5 batch-orvu koristus.** Neil mapping puudub → reaper `skip` (üks hoiatus/protsess). Leia nende `job_id`-d logist ja koorista staging käsitsi, et ei jääks vedelema:
```bash
docker logs vutt-backend 2>&1 | grep "Reaper skip" | grep "page_filename teadmata"
# iga job_id kohta serveris (OCR-host kaudu): vaata AUTO-OCR/{print,hand}/{job_id}/ ja
# kas .txt on väärtuslik — kui jah, käsitsi õigele lehele; kui ei, kustuta staging-kaust
```

## Self-Review — spec coverage

- ✅ 1a page_number: Task 3 `_resolve_job_meta` + recovery event; Task 4 frontend link.
- ✅ 1b püsiv batch-mapping: Task 1 (reocr_state) + Task 2 (wiring start/cleanup).
- ✅ 1c reaper batch-taaste, deterministlik eristaja (mapping olemas → batch): Task 3 `_recover_batch`/`_recover_single`.
- ✅ Reaper skip aktiivsed (mõlemad dict'id): Task 3 `_is_actively_tracked` + `test_reaper_skips_live_batch_job`.
- ✅ Claim per `(job_id, remote_txt_name)`: Task 3 generic `_claim`.
- ✅ 1d skip-müra dedupe: Task 3 `_warned_skips`; praegune 5 käsitsi: Deploy-sektsioon.
- ✅ Mapping kustutamine koristusel: Task 2 (`_poll_batch_job`) + Task 3 (`_recover_batch`).
