# Re-OCR "aeglane, aga elav" + orbude taaste + nähtavus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-OCR tööd, mis OCR-serveris kaua võtavad, ei märgita enam ekslikult veaks ega orvuks; kasutaja näeb, et töö elab ja kaua on kestnud.

**Architecture:** 30-min timeout muutub nõuandvaks `slow`-lipuks (töö jääb `processing`, pollib edasi); uus `reocr_state.py` säilitab aktiivsed tööd üle restardi; uus `reocr_recovery.py` skannib OCR-staging'ut ja taastab orvuks jäänud valmis tulemused; `Review.tsx` näitab kulunud aega + "~N ees" + kollast "aeglane" märki. Kogu uus loogika uutesse moodulitesse — `reocr_ops.py` saab ainult kirurgilised editid (issue #65 ei mõjuta).

**Tech Stack:** Python 3.9 (FastAPI backend, Dockeris), paramiko SFTP, pytest; React 19 + TypeScript + Tailwind, i18next.

## Global Constraints

- **Python 3.9 compat:** `Optional[X]` / `Dict[...]`, MITTE `X | None` ega `dict[...]` annotatsioonides.
- **Testid subagentidele:** alati `.venv/bin/python -m pytest tests/ -q`.
- **Frontend gate:** `npm run typecheck` (mitte ainult `build`).
- **`slow` on boolean-lipp, MITTE staatus.** `status ∈ {uploading, processing, done, error}` jääb muutumatuks. Aktiivne = `uploading` või `processing`.
- **Konfig-teed:** `STATE_DIR` (`state/`) runtime-failidele; `OCR_SERVER_PATH` staging-juurele; `UPLOAD_ENABLED` väravaks taustatöödele.
- **Recovery skoop:** reaper taastab AINULT üksik-lehe orvud (`_pg_001.txt`). Batch restardi-jätkamine käib `load_active_jobs` kaudu (resume polling), MITTE reaperi kaudu.
- **reocr_log on mutable JSON array** (loe-append-kärbi-kirjuta), MITTE JSONL. Taaste lisab UUE sündmus-kirje (`recovered=true`), ei muuda vana.
- **Commit-sõnum lõpp:** `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

| Fail | Vastutus | Muudatus |
|------|----------|----------|
| `server/reocr_state.py` | Aktiivsete tööde püsivus (`state/reocr_active.json`): persist/load. | **Uus** |
| `server/reocr_recovery.py` | Reconciliation-reaper: staging-skann + orbude taaste + reaper-loop. | **Uus** |
| `server/reocr_ops.py` | Slow-lipu loogika, absoluutne lagi, persist-wiring, `queue_ahead`, startup-käivitus. | Kirurgiline edit |
| `server/main.py` | Lifespan kutsub `start_reocr_background()`. | 2 rida |
| `src/pages/Review.tsx` | Kulunud aeg, "~N ees", "aeglane" badge. | Edit |
| `src/locales/{et,en}/review.json` | Uued i18n-võtmed. | Edit |
| `tests/test_reocr_state.py` | Persistence testid. | **Uus** |
| `tests/test_reocr_slow_flag.py` | Slow-lipp, absoluutne lagi, `queue_ahead`. | **Uus** |
| `tests/test_reocr_recovery.py` | Reaper: taaste, skip-active, idempotentsus. | **Uus** |

---

## Task 1: `reocr_state.py` — aktiivsete tööde püsivus

**Files:**
- Create: `server/reocr_state.py`
- Test: `tests/test_reocr_state.py`

**Interfaces:**
- Produces:
  - `persist_active_jobs(jobs: Dict[str, dict]) -> None` — kirjutab atomaarselt AINULT aktiivsed (`status in {"uploading","processing"}`) tööd `state/reocr_active.json`-i.
  - `load_active_jobs() -> Dict[str, dict]` — tagastab salvestatud dict'i (`{job_id: job}`), puuduv/vigane fail → `{}`.
  - `REOCR_ACTIVE_FILE: str` — faili absoluuttee.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_reocr_state.py
"""reocr_state.py — aktiivsete re-OCR tööde püsivus."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_persist_filters_to_active_only(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))

    st.persist_active_jobs({
        "a": {"status": "processing", "slug": "w1", "page_filename": "w1_pg_001.txt"},
        "b": {"status": "uploading", "slug": "w2"},
        "c": {"status": "done", "slug": "w3"},
        "d": {"status": "error", "slug": "w4"},
    })
    loaded = st.load_active_jobs()
    assert set(loaded.keys()) == {"a", "b"}          # done/error välja filtreeritud
    assert loaded["a"]["page_filename"] == "w1_pg_001.txt"


def test_load_missing_file_returns_empty(tmp_path, monkeypatch):
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "puudub.json"))
    assert st.load_active_jobs() == {}


def test_load_corrupt_file_returns_empty(tmp_path, monkeypatch):
    import server.reocr_state as st
    p = tmp_path / "reocr_active.json"
    p.write_text("{ vigane json", encoding="utf-8")
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(p))
    assert st.load_active_jobs() == {}


def test_persist_is_atomic_valid_json(tmp_path, monkeypatch):
    import server.reocr_state as st
    target = tmp_path / "reocr_active.json"
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(target))
    st.persist_active_jobs({"a": {"status": "processing", "kind": "batch"}})
    # Fail on täielik, valideeruv JSON; .tmp ei jää maha
    assert json.loads(target.read_text(encoding="utf-8"))["a"]["kind"] == "batch"
    assert not (tmp_path / "reocr_active.json.tmp").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_state.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.reocr_state'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/reocr_state.py
"""Aktiivsete re-OCR tööde püsivus üle serveri restardi.

Salvestab AINULT aktiivsed (uploading/processing) tööd state/reocr_active.json-i.
Roll recovery-hierarhias: RESTARDI-JÄTKAMINE. Ei ole orbude põhi-allikas — see on
reocr_log (vt reocr_recovery.py), sest error/crash'itud tööd on siit juba eemaldatud.
"""
import json
import os
import threading
from typing import Dict

from .config import STATE_DIR, get_logger

logger = get_logger(__name__)

REOCR_ACTIVE_FILE = os.path.join(STATE_DIR, "reocr_active.json")
_ACTIVE_STATUSES = ("uploading", "processing")
_file_lock = threading.Lock()


def persist_active_jobs(jobs: Dict[str, dict]) -> None:
    """Kirjuta aktiivsed tööd atomaarselt (tmp + os.replace). done/error jäetakse välja."""
    active = {jid: j for jid, j in jobs.items() if j.get("status") in _ACTIVE_STATUSES}
    with _file_lock:
        try:
            os.makedirs(os.path.dirname(REOCR_ACTIVE_FILE), exist_ok=True)
            tmp = REOCR_ACTIVE_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(active, f, ensure_ascii=False, indent=2)
            os.replace(tmp, REOCR_ACTIVE_FILE)
        except Exception as e:
            logger.warning(f"reocr_active.json kirjutamine ebaõnnestus: {e}")


def load_active_jobs() -> Dict[str, dict]:
    """Tagasta salvestatud aktiivsed tööd. Puuduv/vigane fail → tühi dict."""
    with _file_lock:
        try:
            if not os.path.exists(REOCR_ACTIVE_FILE):
                return {}
            with open(REOCR_ACTIVE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except Exception as e:
            logger.warning(f"reocr_active.json lugemine ebaõnnestus: {e}")
            return {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_reocr_state.py -q`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add server/reocr_state.py tests/test_reocr_state.py
git commit -m "feat: reocr_state.py — aktiivsete re-OCR tööde püsivus üle restardi

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Slow-lipp + absoluutne lagi + queue_ahead (üksik-leht)

**Files:**
- Modify: `server/reocr_ops.py` (konstandid ~103; `_reocr_poll_loop` ~352-379; `poll_reocr_job` done-haru ~517-521; `start_reocr_job` ~419-463; `list_reocr_jobs` ~387-404; imports ~11-13)
- Test: `tests/test_reocr_slow_flag.py`

**Interfaces:**
- Consumes: `reocr_state.persist_active_jobs`, `reocr_state.load_active_jobs` (Task 1).
- Produces:
  - `REOCR_ABSOLUTE_TIMEOUT: int` — env `REOCR_ABSOLUTE_TIMEOUT`, vaikimisi 43200 (12h).
  - `_persist_active_jobs() -> None` — snapshotib `_reocr_jobs` + `_reocr_batch_jobs`, kutsub `reocr_state.persist_active_jobs`.
  - `_mark_slow_if_stale(jid: str, job: dict, now: float) -> bool` — seab `slow=True`+`slow_since` esimest korda kui `now-started_at > REOCR_PROCESSING_TIMEOUT`; tagastab True kui üleminek.
  - `_abs_timeout_reached(job: dict, now: float) -> bool`.
  - `_poll_iteration(now: float) -> None` — üks pollimis-pass (loop kutsub seda).
  - `list_reocr_jobs()` tagastab iga töö juures lisaks `slow: bool`, `slow_since: Optional[float]`, `queue_ahead: int`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_reocr_slow_flag.py
"""Slow-lipp (nõuandev), absoluutne sanity-lagi ja queue_ahead."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server.reocr_ops as reocr_ops


@pytest.fixture(autouse=True)
def _clean(tmp_path, monkeypatch):
    # Ära kirjuta päris state/reocr_active.json-i
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    yield
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()


def _job(started_at, status="processing", **ov):
    j = {"status": status, "started_at": started_at, "slug": "w1",
         "page_filename": "w1_pg_001.txt", "text": None, "error": None,
         "remote_txt": "AUTO-OCR/print/j/w1/w1_pg_001.txt"}
    j.update(ov)
    return j


def test_mark_slow_sets_flag_once():
    now = 10_000.0
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_PROCESSING_TIMEOUT - 5)
    assert reocr_ops._mark_slow_if_stale("j1", reocr_ops._reocr_jobs["j1"], now) is True
    assert reocr_ops._reocr_jobs["j1"]["slow"] is True
    assert reocr_ops._reocr_jobs["j1"]["slow_since"] == now
    # Teine kord: juba slow → ei muuda, tagastab False (debounce)
    assert reocr_ops._mark_slow_if_stale("j1", reocr_ops._reocr_jobs["j1"], now + 10) is False


def test_slow_does_not_change_status():
    now = 10_000.0
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_PROCESSING_TIMEOUT - 5)
    reocr_ops._mark_slow_if_stale("j1", reocr_ops._reocr_jobs["j1"], now)
    assert reocr_ops._reocr_jobs["j1"]["status"] == "processing"   # EI muutu


def test_abs_timeout_marks_error_after_final_check(monkeypatch):
    now = 100_000.0
    # poll ei leia .txt-i (jääb processing)
    monkeypatch.setattr(reocr_ops, "poll_reocr_job", lambda jid: {"status": "processing"})
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_ABSOLUTE_TIMEOUT - 5)
    reocr_ops._poll_iteration(now)
    assert reocr_ops._reocr_jobs["j1"]["status"] == "error"
    assert "absoluutse" in reocr_ops._reocr_jobs["j1"]["error"]


def test_abs_timeout_recovers_if_txt_arrives(monkeypatch):
    now = 100_000.0
    # viimane poll leiab tulemuse → done
    def _poll(jid):
        reocr_ops._reocr_jobs[jid]["status"] = "done"
        return {"status": "done"}
    monkeypatch.setattr(reocr_ops, "poll_reocr_job", _poll)
    reocr_ops._reocr_jobs["j1"] = _job(now - reocr_ops.REOCR_ABSOLUTE_TIMEOUT - 5)
    reocr_ops._poll_iteration(now)
    assert reocr_ops._reocr_jobs["j1"]["status"] == "done"   # EI märgita veaks


def test_list_reocr_jobs_queue_ahead_and_slow():
    reocr_ops._reocr_jobs["a"] = _job(1000.0)
    reocr_ops._reocr_jobs["b"] = _job(1001.0, slow=True, slow_since=2000.0)
    reocr_ops._reocr_jobs["c"] = _job(1002.0)
    by_id = {j["job_id"]: j for j in reocr_ops.list_reocr_jobs()}
    assert by_id["a"]["queue_ahead"] == 0
    assert by_id["b"]["queue_ahead"] == 1
    assert by_id["c"]["queue_ahead"] == 2
    assert by_id["b"]["slow"] is True and by_id["b"]["slow_since"] == 2000.0
    assert by_id["a"]["slow"] is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_slow_flag.py -q`
Expected: FAIL — `AttributeError: module 'server.reocr_ops' has no attribute '_mark_slow_if_stale'`

- [ ] **Step 3: Add import + constant**

`server/reocr_ops.py` — muuda import-plokk (rida ~11-13) lisades `reocr_state`:

```python
from .config import BASE_DIR, OCR_SERVER_PATH, REOCR_LOG_FILE, UPLOAD_ENABLED, get_logger
from .utils import generate_nanoid
from .upload_ops import _sftp_open, close_ssh
from . import reocr_state
```

Lisa konstant `REOCR_PROCESSING_TIMEOUT` (rida ~103) järele:

```python
REOCR_PROCESSING_TIMEOUT = 1800  # 30 min — SLOW-lävi (nõuandev), EI lõpeta tööd
REOCR_ABSOLUTE_TIMEOUT = int(os.getenv("REOCR_ABSOLUTE_TIMEOUT", str(12 * 3600)))
# ^ Sanity cap kogu kliendipoolsele elueale (sh järjekorras ootamine), MITTE OCR-töötluse timeout.
```

- [ ] **Step 4: Add persist helper + slow/timeout helpers + rewrite poll loop**

Asenda `_reocr_poll_loop` (rida ~352-376) ja selle all olev `threading.Thread(...).start()` (rida ~379) järgnevaga:

```python
def _persist_active_jobs() -> None:
    """Snapshot mõlemast dict'ist ja persist reocr_active.json-i (aktiivsed jäävad)."""
    with _reocr_jobs_lock:
        single = dict(_reocr_jobs)
    with _reocr_batch_jobs_lock:
        batch = dict(_reocr_batch_jobs)
    reocr_state.persist_active_jobs({**single, **batch})


def _mark_slow_if_stale(jid: str, job: dict, now: float) -> bool:
    """Sea slow=True esimest korda kui üle slow-läve. Debounce: teisel korral False."""
    if now - job.get("started_at", now) <= REOCR_PROCESSING_TIMEOUT:
        return False
    if job.get("slow"):
        return False
    with _reocr_jobs_lock:
        j = _reocr_jobs.get(jid)
        if j and j["status"] == "processing" and not j.get("slow"):
            j["slow"] = True
            j["slow_since"] = now
            return True
    return False


def _abs_timeout_reached(job: dict, now: float) -> bool:
    return now - job.get("started_at", now) > REOCR_ABSOLUTE_TIMEOUT


def _poll_iteration(now: float) -> None:
    """Üks pollimis-pass üle 'processing' tööde. Testitav ilma lõputu loopita."""
    with _reocr_jobs_lock:
        processing = [(jid, j) for jid, j in _reocr_jobs.items() if j["status"] == "processing"]
    changed = False
    for jid, job in processing:
        if _abs_timeout_reached(job, now):
            try:
                poll_reocr_job(jid)  # viimane SFTP-kontroll: võib lõpetada done-iga
            except Exception as e:
                logger.warning(f"Re-OCR {jid} viimane kontroll ebaõnnestus: {e}")
            with _reocr_jobs_lock:
                j = _reocr_jobs.get(jid)
                if j and j["status"] == "processing":
                    j["status"] = "error"
                    j["error"] = "Aegumine: OCR-tulemust ei saabunud absoluutse aja jooksul."
                    j["finished_at"] = now
                    _append_to_log(j, jid)
                    changed = True
            continue
        if _mark_slow_if_stale(jid, job, now):
            changed = True
        try:
            poll_reocr_job(jid)
        except Exception as e:
            logger.warning(f"Re-OCR background poll viga ({jid}): {e}")
    if changed:
        _persist_active_jobs()


def _reocr_poll_loop():
    """Daemon-thread: kontrollib 'processing' töid iga 10s. 30 min → slow-lipp (ei loobu);
    absoluutne sanity-lagi → error ALLES pärast viimast SFTP-kontrolli."""
    import time
    while True:
        time.sleep(10)
        try:
            _poll_iteration(datetime.now().timestamp())
        except Exception as e:
            logger.warning(f"Re-OCR poll iteration viga: {e}")


threading.Thread(target=_reocr_poll_loop, daemon=True, name="reocr-poll").start()
```

- [ ] **Step 5: Persist on done + on upload transitions**

`poll_reocr_job` done-harus (rida ~517-521), pärast `_append_to_log(job, job_id)` lisa:

```python
        job["finished_at"] = datetime.now().timestamp()
        logger.info(f"Re-OCR {job_id} valmis ({len(text)} tähemärki)")
        _append_to_log(job, job_id)
        _persist_active_jobs()  # eemalda active.json-ist (done filtreeritakse välja)
```

`start_reocr_job` sees, pärast `_reocr_jobs[job_id] = {...}` bloki (rida ~433) lisa rida:

```python
    _persist_active_jobs()  # 'uploading' → restart teab tööst
```

Ja `_upload()` sees pärast `_reocr_jobs[job_id]["status"] = "processing"` (rida ~448) ja error-haru pärast `_append_to_log(...)` (rida ~455) lisa mõlemasse:

```python
            _persist_active_jobs()
```

- [ ] **Step 6: Add slow/slow_since/queue_ahead to list_reocr_jobs**

Asenda `list_reocr_jobs` (rida ~387-404) järgnevaga:

```python
def list_reocr_jobs() -> list:
    """Tagastab kõigi re-OCR tööde loendi (admin ülevaate jaoks)."""
    with _reocr_jobs_lock:
        items = list(_reocr_jobs.items())
    active = [(jid, j) for jid, j in items if j["status"] in ("uploading", "processing")]

    def _queue_ahead(job: dict) -> int:
        if job["status"] not in ("uploading", "processing"):
            return 0
        st = job.get("started_at", 0) or 0
        # Lokaalne VUTT FIFO-lähend — OCR-serveri päris järjekorda ei teata.
        return sum(1 for _, o in active if (o.get("started_at", 0) or 0) < st)

    return [
        {
            "job_id": jid,
            "work_id": j["work_id"],
            "slug": j["slug"],
            "page_filename": j.get("page_filename", ""),
            "page_number": j.get("page_number"),
            "username": j.get("username", ""),
            "status": j["status"],
            "error": j.get("error"),
            "started_at": j.get("started_at"),
            "finished_at": j.get("finished_at"),
            "slow": bool(j.get("slow", False)),
            "slow_since": j.get("slow_since"),
            "queue_ahead": _queue_ahead(j),
        }
        for jid, j in items
    ]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_slow_flag.py tests/test_reocr_poll.py tests/test_reocr_batch.py -q`
Expected: PASS (uued + olemasolevad, ei regressiooni)

- [ ] **Step 8: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_slow_flag.py
git commit -m "feat: re-OCR 30-min timeout → nõuandev slow-lipp + absoluutne sanity-lagi + queue_ahead

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Batch slow-lipp + absoluutne lagi

**Files:**
- Modify: `server/reocr_ops.py` (`_reocr_batch_poll_loop` ~263-291; `start_reocr_batch` persist ~148, ~165, ~173)
- Test: `tests/test_reocr_slow_flag.py` (lisa)

**Interfaces:**
- Consumes: `_persist_active_jobs`, `_abs_timeout_reached`, `REOCR_ABSOLUTE_TIMEOUT` (Task 2).
- Produces:
  - Batch-job dict saab `slow: bool` + `slow_since` (batch-tasemel); per-lehe import jätkub muutmata; absoluutne lagi märgib allesjäänud pending-lehed veaks alles pärast viimast `_poll_batch_job`-i.

- [ ] **Step 1: Write the failing test** (lisa `tests/test_reocr_slow_flag.py` lõppu)

```python
def _batch_job(started_at, **ov):
    j = {"kind": "batch", "status": "processing", "started_at": started_at,
         "last_progress_at": started_at, "slug": "w1", "work_id": "wid",
         "pages": [{"page_filename": "w1-a.jpg", "status": "processing", "error": None}]}
    j.update(ov)
    return j


def test_batch_inactivity_sets_slow_not_error(monkeypatch):
    import server.reocr_ops as r
    monkeypatch.setattr(r, "_poll_batch_job", lambda jid: None)
    now = 50_000.0
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()
        r._reocr_batch_jobs["b1"] = _batch_job(now - r.REOCR_BATCH_INACTIVITY_TIMEOUT - 5)
    r._batch_poll_iteration(now)
    j = r._reocr_batch_jobs["b1"]
    assert j["status"] == "processing"   # EI lõpe
    assert j["slow"] is True
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()


def test_batch_absolute_timeout_errors_remaining_after_final_poll(monkeypatch):
    import server.reocr_ops as r
    monkeypatch.setattr(r, "_poll_batch_job", lambda jid: None)  # ei edene
    now = 200_000.0
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()
        r._reocr_batch_jobs["b1"] = _batch_job(now - r.REOCR_ABSOLUTE_TIMEOUT - 5)
    r._batch_poll_iteration(now)
    j = r._reocr_batch_jobs["b1"]
    assert j["status"] == "done"                       # batch lõpetatud
    assert j["pages"][0]["status"] == "error"          # allesjäänud pending → error
    with r._reocr_batch_jobs_lock:
        r._reocr_batch_jobs.clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_slow_flag.py -k batch -q`
Expected: FAIL — `AttributeError: ... '_batch_poll_iteration'`

- [ ] **Step 3: Rewrite batch poll loop**

Asenda `_reocr_batch_poll_loop` (rida ~263-291) ja selle all olev `threading.Thread(...).start()` (rida ~294) järgnevaga:

```python
def _batch_poll_iteration(now: float) -> None:
    """Üks batch-pollimis-pass. slow batch-tasemel; absoluutne lagi märgib allesjäänud
    pending-lehed veaks ALLES pärast viimast _poll_batch_job-i. Osaliselt valmis jäävad.
    Säilitab olemasoleva TTL-puhastuse (vanad done/error batch'id)."""
    with _reocr_batch_jobs_lock:
        active = [(jid, j) for jid, j in _reocr_batch_jobs.items() if j["status"] == "processing"]
        # TTL: eemalda vanad done/error batch-jobid (nagu varem)
        stale = [jid for jid, j in _reocr_batch_jobs.items()
                 if j["status"] in ("done", "error")
                 and (j.get("finished_at") or 0) < now - REOCR_JOB_TTL]
        for jid in stale:
            del _reocr_batch_jobs[jid]
    changed = False
    for jid, job in active:
        # Absoluutne sanity-lagi: viimane kontroll, siis allesjäänud pending → error
        if _abs_timeout_reached(job, now):
            try:
                _poll_batch_job(jid)  # viimane kontroll: valmis lehed lähevad ready-ks
            except Exception as e:
                logger.warning(f"Re-OCR batch {jid} viimane kontroll ebaõnnestus: {e}")
            with _reocr_batch_jobs_lock:
                j = _reocr_batch_jobs.get(jid)
                if j and j["status"] == "processing":
                    for e in j["pages"]:
                        if e["status"] in ("uploading", "processing"):
                            e["status"] = "error"
                            e["error"] = "Aegumine: OCR-tulemust ei saabunud absoluutse aja jooksul."
                    j["status"] = "done"
                    j["finished_at"] = now
                    changed = True
            continue
        # Nõuandev slow-lipp (batch-tasemel), kui pole edenemist üle inactivity-läve
        if _batch_inactive(job, now, REOCR_BATCH_INACTIVITY_TIMEOUT) and not job.get("slow"):
            with _reocr_batch_jobs_lock:
                j = _reocr_batch_jobs.get(jid)
                if j and j["status"] == "processing" and not j.get("slow"):
                    j["slow"] = True
                    j["slow_since"] = now
                    changed = True
        try:
            _poll_batch_job(jid)
        except Exception as e:
            logger.warning(f"Re-OCR batch {jid} poll viga: {e}")
    if changed:
        _persist_active_jobs()


def _reocr_batch_poll_loop():
    import time
    while True:
        time.sleep(10)
        try:
            _batch_poll_iteration(datetime.now().timestamp())
        except Exception as e:
            logger.warning(f"Re-OCR batch poll iteration viga: {e}")


threading.Thread(target=_reocr_batch_poll_loop, daemon=True, name="reocr-batch-poll").start()
```

**NB:** `_batch_inactive` (olemasolev, rida ~191) võtab `(job, now, timeout)` ja kasutab `last_progress_at`. Ära muuda seda — `_poll_batch_job` uuendab `last_progress_at`, seega elav-aga-aeglane batch ei flag'i valesti.

- [ ] **Step 4: Persist batch transitions**

`start_reocr_batch` sees: pärast `_reocr_batch_jobs[job_id] = job` (rida ~148) ja `_upload()` sees pärast `job["status"] = "processing"` (rida ~165) ja error-haru pärast `job["status"] = "error"` (rida ~173) lisa igasse:

```python
    _persist_active_jobs()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_slow_flag.py tests/test_reocr_batch.py -q`
Expected: PASS (uued batch-testid + olemasolevad batch-testid)

- [ ] **Step 6: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_slow_flag.py
git commit -m "feat: re-OCR batch inactivity → slow-lipp, absoluutne lagi säilitab valmis lehed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `reocr_recovery.py` — reconciliation-reaper

**Files:**
- Create: `server/reocr_recovery.py`
- Modify: `server/reocr_ops.py` (`_append_to_log` ~19-46 — passi läbi recovery-märgistus)
- Test: `tests/test_reocr_recovery.py`

**Interfaces:**
- Consumes: `reocr_ops._reocr_jobs`, `reocr_ops._reocr_jobs_lock`, `reocr_ops._sftp_open`, `reocr_ops.close_ssh`, `reocr_ops._write_ocr_file`, `reocr_ops._append_to_log`, `reocr_ops.get_reocr_log`, `reocr_ops.REOCR_LOG_MAX`, `reocr_state.load_active_jobs`, `config.OCR_SERVER_PATH`.
- Produces:
  - `scan_and_recover() -> Dict[str, list]` — `{"recovered": [job_id...], "skipped": [job_id...]}`.
  - `start_reaper_loop() -> None` — käivitab daemon-threadi (`REOCR_REAPER_INTERVAL`, env, vaikimisi 300).
  - `_resolve_job_meta(job_id: str) -> Optional[dict]` — `{"page_filename", "work_id"}` või None (log → active.json).

- [ ] **Step 1: Extend `_append_to_log` to carry recovery markers**

`server/reocr_ops.py` `_append_to_log` (rida ~21-32), pärast `entry = {...}` bloki lisa enne `with _log_lock:`:

```python
    for _k in ("recovered", "original_status", "recovered_at"):
        if _k in job:
            entry[_k] = job[_k]
```

- [ ] **Step 2: Write the failing test**

```python
# tests/test_reocr_recovery.py
"""Reconciliation-reaper: taastab OCR-staging'usse orvuks jäänud üksik-lehe tulemused."""
import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server.reocr_ops as reocr_ops
import server.reocr_recovery as rec


class _FakeSftp:
    """Mockib OCR-serveri staging'ut. tree: {abs_dir: [names]}, files: {abs_path: bytes}."""
    def __init__(self, tree, files):
        self.tree = tree
        self.files = files
        self.removed = []
        self.rmdired = []
    def listdir(self, path):
        if path in self.tree:
            return list(self.tree[path])
        raise FileNotFoundError(path)
    def stat(self, path):
        if path in self.files or path in self.tree:
            return None
        raise FileNotFoundError(path)
    def getfo(self, path, buf):
        buf.write(self.files[path])
    def remove(self, path):
        self.removed.append(path)
    def rmdir(self, path):
        self.rmdired.append(path)
    def close(self):
        pass


@pytest.fixture(autouse=True)
def _env(tmp_path, monkeypatch):
    monkeypatch.setattr(reocr_ops, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(rec, "OCR_SERVER_PATH", "/OCR")
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_LOG_FILE", str(tmp_path / "reocr_log.json"))
    import server.reocr_state as st
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    (tmp_path / "w1").mkdir()
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    rec._recovering.clear()
    yield
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()


def _staging_with_result(text=b"Taastatud tekst"):
    """print/hand puu ühe valmis üksik-lehe orvuga job_id='orb', slug='w1'."""
    tree = {
        "/OCR/AUTO-OCR/print": ["orb"],
        "/OCR/AUTO-OCR/hand": [],
        "/OCR/AUTO-OCR/print/orb": ["w1"],
    }
    files = {"/OCR/AUTO-OCR/print/orb/w1/w1_pg_001.txt": text}
    return tree, files


def test_recovers_orphan_from_log(monkeypatch):
    # Logis on error-kirje, mis annab page_filename mapping'u
    reocr_ops._append_to_log(
        {"work_id": "wid", "slug": "w1", "page_filename": "w1-lk-007.jpg",
         "page_number": 7, "username": "u", "status": "error",
         "error": "Aegumine", "started_at": 1.0, "finished_at": 2.0}, "orb")
    tree, files = _staging_with_result()
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)

    result = rec.scan_and_recover()

    assert result["recovered"] == ["orb"]
    ocr_file = Path(reocr_ops.BASE_DIR) / "w1" / "w1-lk-007.ocr"
    assert ocr_file.read_text(encoding="utf-8") == "Taastatud tekst"
    # Logisse lisati recovery-sündmus
    entries = reocr_ops.get_reocr_log(0, 100)["entries"]
    assert any(e.get("recovered") and e["job_id"] == "orb" for e in entries)


def test_skips_active_job(monkeypatch):
    reocr_ops._reocr_jobs["orb"] = {"status": "processing", "slug": "w1",
                                    "page_filename": "w1-lk-007.jpg"}
    tree, files = _staging_with_result()
    sftp = _FakeSftp(tree, files)
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: sftp)
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)

    result = rec.scan_and_recover()

    assert result["recovered"] == []
    assert sftp.removed == []   # aktiivset ei koristata


@pytest.mark.parametrize("active_status", ["uploading", "processing"])
def test_skips_active_uploading_or_processing(monkeypatch, active_status):
    reocr_ops._reocr_jobs["orb"] = {"status": active_status, "slug": "w1",
                                    "page_filename": "w1-lk-007.jpg"}
    tree, files = _staging_with_result()
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    assert rec.scan_and_recover()["recovered"] == []


def test_skips_unmapped_orphan(monkeypatch):
    # .txt olemas, aga EI logis EGA active.json-is → skip (ei arva lehte)
    tree, files = _staging_with_result()
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: _FakeSftp(tree, files))
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    result = rec.scan_and_recover()
    assert result["recovered"] == []
    assert result["skipped"] == ["orb"]


def test_idempotent_when_claimed(monkeypatch):
    # Kui job_id on juba _recovering set'is → ei töötle uuesti
    reocr_ops._append_to_log(
        {"work_id": "wid", "slug": "w1", "page_filename": "w1-lk-007.jpg",
         "status": "error", "started_at": 1.0, "finished_at": 2.0}, "orb")
    rec._recovering.add("orb")
    tree, files = _staging_with_result()
    sftp = _FakeSftp(tree, files)
    monkeypatch.setattr(rec.reocr_ops, "_sftp_open", lambda cid: sftp)
    monkeypatch.setattr(rec.reocr_ops, "close_ssh", lambda cid: None)
    result = rec.scan_and_recover()
    assert result["recovered"] == []       # claimitud → vahele jäetud
    assert sftp.removed == []
```

- [ ] **Step 3: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_recovery.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.reocr_recovery'`

- [ ] **Step 4: Write the implementation**

```python
# server/reocr_recovery.py
"""Reconciliation-reaper: leiab OCR-serveri staging'usse orvuks jäänud VALMIS üksik-lehe
re-OCR tulemused ja taastab need (kirjutab .ocr faili, lisab reocr_log-i recovery-sündmuse,
koristab staging'u).

Skoop: AINULT üksik-lehe orvud (AUTO-OCR/{print,hand}/{job_id}/{slug}/{slug}_pg_001.txt).
Batch restardi-jätkamine käib load_active_jobs → resume polling kaudu, MITTE siit.

Mapping-allikad (järjekorras): (1) reocr_log — orbude PÕHI-allikas (error-kirjed);
(2) reocr_active.json — restardi-jätkamise varu.
"""
import io
import os
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional

from .config import OCR_SERVER_PATH, get_logger
from . import reocr_ops
from . import reocr_state

logger = get_logger(__name__)

REOCR_REAPER_INTERVAL = int(os.getenv("REOCR_REAPER_INTERVAL", "300"))
_MATERIAL_TYPES = ("print", "hand")

# Claim-set: kaitseb tavalise polleri ja reaperi võistluse eest (sama .txt topelt-töötlus).
# Kaitstud reocr_ops._reocr_jobs_lock-iga (jagatud lukk, ei loo uut).
_recovering = set()


def _resolve_job_meta(job_id: str) -> Optional[dict]:
    """Leia {page_filename, work_id} logist (põhi) või active.json-ist (varu)."""
    log = reocr_ops.get_reocr_log(0, reocr_ops.REOCR_LOG_MAX).get("entries", [])
    for e in log:
        if e.get("job_id") == job_id and e.get("page_filename"):
            return {"page_filename": e["page_filename"], "work_id": e.get("work_id")}
    active = reocr_state.load_active_jobs()
    j = active.get(job_id)
    if j and j.get("page_filename"):
        return {"page_filename": j["page_filename"], "work_id": j.get("work_id")}
    return None


def _is_actively_tracked(job_id: str) -> bool:
    with reocr_ops._reocr_jobs_lock:
        j = reocr_ops._reocr_jobs.get(job_id)
        return bool(j and j.get("status") in ("uploading", "processing"))


def _claim(job_id: str) -> bool:
    """Proovi claimida job. Tagastab False kui juba claimitud või aktiivne."""
    with reocr_ops._reocr_jobs_lock:
        if job_id in _recovering:
            return False
        j = reocr_ops._reocr_jobs.get(job_id)
        if j and j.get("status") in ("uploading", "processing"):
            return False
        _recovering.add(job_id)
        return True


def _release(job_id: str) -> None:
    with reocr_ops._reocr_jobs_lock:
        _recovering.discard(job_id)


def _cleanup_staging(sftp, job_dir: str, slug: str) -> None:
    """Koristab OCR-serveri staging'u pärast taastamist (best-effort)."""
    work = f"{job_dir}/{slug}"
    for name in (f"{work}/{slug}_pg_001.txt", f"{work}/{slug}_pg_001.jpg"):
        try:
            sftp.remove(name)
        except Exception:
            pass
    for d in (work, job_dir):
        try:
            sftp.rmdir(d)
        except Exception:
            pass


def _recover_one(sftp, base: str, job_id: str, recovered: List[str], skipped: List[str]) -> None:
    if _is_actively_tracked(job_id):
        return
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
                skipped.append(job_id)
                logger.warning(f"Reaper: {job_id} .txt olemas, aga page_filename teadmata → skip")
                return
            buf = io.BytesIO()
            sftp.getfo(txt_abs, buf)
            text = buf.getvalue().decode("utf-8", errors="replace")
            reocr_ops._write_ocr_file(slug, meta["page_filename"], text)
            reocr_ops._append_to_log(
                {"work_id": meta.get("work_id"), "slug": slug,
                 "page_filename": meta["page_filename"], "status": "done",
                 "error": None, "started_at": None,
                 "finished_at": datetime.now().timestamp(),
                 "recovered": True, "original_status": "error",
                 "recovered_at": datetime.now().timestamp()},
                job_id)
            _cleanup_staging(sftp, job_dir, slug)
            recovered.append(job_id)
            logger.info(f"Reaper taastas {job_id} ({slug}/{meta['page_filename']})")
        finally:
            _release(job_id)
        return


def scan_and_recover() -> Dict[str, list]:
    """Skanni print/hand staging, taasta orvuks jäänud üksik-lehe tulemused."""
    recovered: List[str] = []
    skipped: List[str] = []
    for mt in _MATERIAL_TYPES:
        base = f"{OCR_SERVER_PATH}/AUTO-OCR/{mt}"
        cid = f"reaper-{mt}"
        try:
            sftp = reocr_ops._sftp_open(cid)
        except Exception as e:
            logger.warning(f"Reaper: SFTP avamine ebaõnnestus ({mt}): {e}")
            continue
        try:
            try:
                job_ids = sftp.listdir(base)
            except FileNotFoundError:
                continue
            for job_id in job_ids:
                try:
                    _recover_one(sftp, base, job_id, recovered, skipped)
                except Exception as e:
                    logger.warning(f"Reaper: {job_id} taaste viga: {e}")
        finally:
            try:
                sftp.close()
            except Exception:
                pass
            reocr_ops.close_ssh(cid)
    return {"recovered": recovered, "skipped": skipped}


def _reaper_loop():
    while True:
        time.sleep(REOCR_REAPER_INTERVAL)
        try:
            scan_and_recover()
        except Exception as e:
            logger.warning(f"Reaper loop viga: {e}")


def start_reaper_loop() -> None:
    threading.Thread(target=_reaper_loop, daemon=True, name="reocr-reaper").start()
    logger.info(f"Re-OCR reaper käivitatud (intervall {REOCR_REAPER_INTERVAL}s)")
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_recovery.py -q`
Expected: PASS (6 passed)

- [ ] **Step 6: Commit**

```bash
git add server/reocr_recovery.py server/reocr_ops.py tests/test_reocr_recovery.py
git commit -m "feat: reocr_recovery.py — reconciliation-reaper taastab OCR-staging orvud

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Startup-wiring (load → recovery → reaper)

**Files:**
- Modify: `server/reocr_ops.py` (lisa `start_reocr_background`)
- Modify: `server/main.py` (`lifespan`, ~11, ~48)
- Test: `tests/test_reocr_recovery.py` (lisa startup-järjekorra test)

**Interfaces:**
- Consumes: `reocr_state.load_active_jobs`, `reocr_recovery.scan_and_recover`, `reocr_recovery.start_reaper_loop`, `config.UPLOAD_ENABLED`.
- Produces:
  - `reocr_ops.start_reocr_background() -> None` — JÄRJEKORD: load_active_jobs → täida `_reocr_jobs`/`_reocr_batch_jobs` → `scan_and_recover()` (üks kord) → `start_reaper_loop()`. UPLOAD_ENABLED väravaks.

- [ ] **Step 1: Write the failing test** (lisa `tests/test_reocr_recovery.py` lõppu)

```python
def test_startup_loads_active_before_recovery(monkeypatch, tmp_path):
    """load_active_jobs täidab _reocr_jobs ENNE scan_and_recover-it → aktiivset ei orvustata."""
    import server.reocr_state as st
    import server.reocr_ops as r
    monkeypatch.setattr(r, "UPLOAD_ENABLED", True)
    # active.json sisaldab üht 'processing' tööd
    monkeypatch.setattr(st, "REOCR_ACTIVE_FILE", str(tmp_path / "reocr_active.json"))
    st.persist_active_jobs({"orb": {"status": "processing", "slug": "w1",
                                    "page_filename": "w1-lk-007.jpg"}})
    seen_active = {}

    def _fake_scan():
        # Recovery ajal peab orb olema juba mälus → seda ei orvustata
        seen_active["orb_in_jobs"] = "orb" in r._reocr_jobs
        return {"recovered": [], "skipped": []}

    monkeypatch.setattr(rec, "scan_and_recover", _fake_scan)
    monkeypatch.setattr(rec, "start_reaper_loop", lambda: None)
    with r._reocr_jobs_lock:
        r._reocr_jobs.clear()

    r.start_reocr_background()

    assert seen_active["orb_in_jobs"] is True
    with r._reocr_jobs_lock:
        r._reocr_jobs.clear()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_reocr_recovery.py::test_startup_loads_active_before_recovery -q`
Expected: FAIL — `AttributeError: ... 'start_reocr_background'`

- [ ] **Step 3: Add `start_reocr_background` to reocr_ops.py**

Lisa `reocr_ops.py` lõppu (pärast `list_reocr_jobs` / muude funktsioonide juurde):

```python
def _split_loaded(loaded: dict):
    """Jaga laetud aktiivsed tööd üksik- ja batch-dict'ideks 'kind' järgi."""
    single, batch = {}, {}
    for jid, j in loaded.items():
        if j.get("kind") == "batch":
            batch[jid] = j
        else:
            single[jid] = j
    return single, batch


def start_reocr_background() -> None:
    """Käivita re-OCR restardi-jätkamine + reconciliation. Kutsu AINULT main.py lifespan'ist
    (API-protsess). JÄRJEKORD KRIITILINE: load → recovery → reaper, et aktiivseid töid
    ei peetaks orvuks."""
    if not UPLOAD_ENABLED:
        return
    from . import reocr_recovery
    single, batch = _split_loaded(reocr_state.load_active_jobs())
    with _reocr_jobs_lock:
        _reocr_jobs.update(single)
    with _reocr_batch_jobs_lock:
        _reocr_batch_jobs.update(batch)
    logger.info(f"Re-OCR taastatud mällu: {len(single)} üksik + {len(batch)} batch")
    try:
        result = reocr_recovery.scan_and_recover()
        logger.info(f"Re-OCR startup recovery: taastatud {len(result['recovered'])}, "
                    f"skip {len(result['skipped'])}")
    except Exception as e:
        logger.warning(f"Re-OCR startup recovery viga: {e}")
    reocr_recovery.start_reaper_loop()
```

- [ ] **Step 4: Wire into main.py lifespan**

`server/main.py` — lisa import (rida ~11 juurde):

```python
from .reocr_ops import start_reocr_background
```

Lifespan sees, pärast `start_upload_sync_loop()` (rida ~48):

```python
    start_upload_sync_loop()  # upload taustasünk — AINULT API-protsessis (mitte image_server import)
    start_reocr_background()  # re-OCR restardi-jätkamine + orbude taaste (AINULT API-protsessis)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_reocr_recovery.py tests/test_reocr_slow_flag.py tests/test_reocr_state.py -q`
Expected: PASS

- [ ] **Step 6: Full backend suite (ei regressiooni)**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS (kõik olemasolevad + uued)

- [ ] **Step 7: Commit**

```bash
git add server/reocr_ops.py server/main.py tests/test_reocr_recovery.py
git commit -m "feat: re-OCR startup-wiring — load aktiivsed → recovery → reaper (lifespan)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — kulunud aeg + "~N ees" + "aeglane" märk

**Files:**
- Modify: `src/pages/Review.tsx` (`ReocrJob` interface ~57-69; render ~537-602)
- Modify: `src/locales/et/review.json`, `src/locales/en/review.json` (`reocr` blokk)

**Interfaces:**
- Consumes: backend `list_reocr_jobs` väljad `slow`, `slow_since`, `queue_ahead` (Task 2).
- Produces: UI, mis eristab aeglase-aga-elava (kollane "aeglane") surnust (punane "Viga") ja näitab kulunud aega + "~N ees".

- [ ] **Step 1: Extend ReocrJob type**

`src/pages/Review.tsx` — `ReocrJob` interface (rida ~57-69), lisa väljad `finished_at` järele:

```typescript
interface ReocrJob {
  job_id: string;
  work_id: string;
  slug: string;
  page_filename: string;
  page_number: number | null;
  username: string;
  status: 'uploading' | 'processing' | 'done' | 'error';
  error: string | null;
  started_at: number | null;
  finished_at: number | null;
  slow?: boolean;
  slow_since?: number | null;
  queue_ahead?: number;
}
```

- [ ] **Step 2: Add elapsed-time helper**

Lisa `Review` komponendi sees, enne `return` (nt loadReocrJobs-i lähedale), puhas abifunktsioon:

```typescript
  // Kulunud aeg minutites aktiivsele tööle (elav — uueneb polli-renderdusel iga 4s)
  const formatElapsed = (startedAt: number | null): string => {
    if (!startedAt) return '';
    const mins = Math.floor((Date.now() / 1000 - startedAt) / 60);
    return mins < 1 ? t('reocr.elapsedLtMin') : t('reocr.elapsedMin', { mins });
  };
```

- [ ] **Step 3: Update render — slow-aware styling + elapsed + queue_ahead**

Asenda render-blokk (rida ~537-602) järgnevaga (lisab `isSlow`, kulunud aja aktiivsetele, "~N ees", kollase "aeglane" badge):

```tsx
                    const isActive = job.status === 'uploading' || job.status === 'processing';
                    const isSlow = isActive && !!job.slow;
                    return (
                      <div
                        key={job.job_id}
                        className={`flex items-center gap-4 px-4 py-3 rounded-lg border ${
                          isActive ? 'border-amber-200 bg-amber-50' :
                          job.status === 'done' ? 'border-green-200 bg-green-50' :
                          job.status === 'error' ? 'border-red-200 bg-red-50' :
                          'border-gray-200'
                        }`}
                      >
                        {/* Staatus ikoon */}
                        <div className="shrink-0">
                          {isActive
                            ? <Loader2 size={18} className="animate-spin text-amber-600" />
                            : job.status === 'done'
                              ? <CheckCircle size={18} className="text-green-600" />
                              : <XCircle size={18} className="text-red-500" />
                          }
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-medium text-gray-800 text-sm">{job.slug}</span>
                            {job.page_number && (
                              <span className="text-xs text-gray-500">lk {job.page_number}</span>
                            )}
                            {job.work_id && job.page_number && (
                              <a
                                href={`/work/${job.work_id}/${job.page_number}`}
                                className="text-xs text-primary-600 hover:underline flex items-center gap-0.5"
                                target="_blank"
                                rel="noreferrer"
                              >
                                <ExternalLink size={11} />
                              </a>
                            )}
                            {isActive && !!job.queue_ahead && job.queue_ahead > 0 && (
                              <span className="text-xs text-gray-400">
                                {t('reocr.queueAhead', { count: job.queue_ahead })}
                              </span>
                            )}
                          </div>
                          {job.error && (
                            <p className="text-xs text-red-600 mt-0.5">{job.error}</p>
                          )}
                        </div>

                        {/* Kasutaja + aeg */}
                        <div className="text-xs text-gray-500 text-right shrink-0">
                          <div className="flex items-center gap-1 justify-end">
                            <User size={11} />
                            {job.username}
                          </div>
                          {job.started_at && (
                            <div className="flex items-center gap-1 mt-0.5 justify-end">
                              <Clock size={11} />
                              {isActive
                                ? formatElapsed(job.started_at)
                                : new Date(job.started_at * 1000).toLocaleTimeString('et-EE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          )}
                        </div>

                        {/* Staatus badge */}
                        <div className={`shrink-0 text-xs font-medium px-2 py-1 rounded ${
                          isSlow ? 'bg-amber-100 text-amber-800' :
                          isActive ? 'bg-amber-100 text-amber-700' :
                          job.status === 'done' ? 'bg-green-100 text-green-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {isSlow ? t('reocr.slow') : t(`reocr.status.${job.status}`)}
                        </div>
                      </div>
                    );
```

- [ ] **Step 4: Add i18n keys**

`src/locales/et/review.json` — `reocr` blokis, `status` järele lisa:

```json
    "status": {
      "uploading": "Laadin",
      "processing": "Töötleb",
      "done": "Valmis",
      "error": "Viga"
    },
    "slow": "aeglane, töötab edasi",
    "elapsedMin": "töötab {{mins}} min",
    "elapsedLtMin": "töötab <1 min",
    "queueAhead": "~{{count}} varasemat tööd"
```

`src/locales/en/review.json` — sama koht:

```json
    "status": {
      "uploading": "Uploading",
      "processing": "Processing",
      "done": "Done",
      "error": "Error"
    },
    "slow": "slow, still running",
    "elapsedMin": "running {{mins}} min",
    "elapsedLtMin": "running <1 min",
    "queueAhead": "~{{count}} earlier jobs"
```

**NB:** kontrolli, et `status` bloki järel oleks koma õigesti (lisatud võtmed tulevad `reocr` objekti sisse, `status` järele).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: 0 errorit

- [ ] **Step 6: Commit**

```bash
git add src/pages/Review.tsx src/locales/et/review.json src/locales/en/review.json
git commit -m "feat: Review-leht — re-OCR kulunud aeg, ~N ees, kollane 'aeglane' märk

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy (pärast kõiki taske)

Backend (koodimuudatus → `--no-cache` kohustuslik):
```bash
ssh vutt
cd ~/VUTT && git pull
docker compose build --no-cache backend && docker compose up -d backend
docker logs vutt-backend --tail 50   # kontrolli "Re-OCR reaper käivitatud" + "Re-OCR startup recovery"
```

Frontend (lokaalses masinas):
```bash
npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
```

**Verifitseerimine serveris:** startup recovery peaks korjama praegused orvud (nt
`1650-7-In_salutiferam...`) automaatselt üles — kontrolli `docker logs vutt-backend | grep -i reaper`
ja Review-lehte (töö peaks kaduma error-ist, `.ocr` ilmuma teose kausta Manage-lehel).

## Lahtised parameetrid (env, muudetavad ilma koodita)

| Env | Vaikeväärtus | Tähendus |
|-----|-------------|----------|
| `REOCR_ABSOLUTE_TIMEOUT` | 43200 (12h) | Sanity cap kliendipoolsele elueale |
| `REOCR_REAPER_INTERVAL` | 300 (5 min) | Reaper-skanni intervall |

---

## Self-Review — spec coverage

- ✅ Timeout → slow-lipp (ei loobu): Task 2 `_mark_slow_if_stale`, `_poll_iteration`.
- ✅ slow = boolean-lipp, status muutumatu: Task 2 (test `test_slow_does_not_change_status`).
- ✅ Absoluutne sanity-lagi + viimane kontroll: Task 2 `_abs_timeout_reached` + `_poll_iteration`.
- ✅ Batch eraldi semantika (per-lehe import, lagi pärast viimast kontrolli): Task 3.
- ✅ Reconciliation-reaper, log põhi-allikas: Task 4 `scan_and_recover`, `_resolve_job_meta`.
- ✅ Claim/idempotentsus (poller vs reaper): Task 4 `_claim`/`_release` + `_recovering` (jagatud lukk).
- ✅ Skip KÕIK aktiivsed (ka uploading): Task 4 `_is_actively_tracked` (test parametrized).
- ✅ page_filename puudub → skip: Task 4 `test_skips_unmapped_orphan`.
- ✅ Logi taaste = uus append-sündmus (kärbe-kindel): Task 4 `_append_to_log` extend + recovery event.
- ✅ Kerge püsivus + debounce (ainult üleminekutel): Task 1 + Task 2 `_persist_active_jobs`.
- ✅ Startup-wiring järjekord (load enne scan): Task 5 `start_reocr_background` + test.
- ✅ Nähtavus: kulunud aeg + queue_ahead + slow badge: Task 2 (`queue_ahead`) + Task 6 (UI).
- ✅ queue_ahead ettevaatlik sõnastus + kommentaar: Task 2 kommentaar + Task 6 i18n "~N varasemat tööd".
- ✅ #65 ei mõjuta: kogu uus kood `reocr_*`-s; ainus jagatud sõltuvus `_sftp_open`/`close_ssh`.
