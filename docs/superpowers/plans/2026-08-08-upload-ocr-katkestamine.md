# Upload'i OCR-i katkestamine — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab upload'i OCR-jooksu katkestada nii, et poolitusplaan säilib, mudelit saab vahetada ja uus jooks ei saa saastuda vana jooksu tulemustest.

**Architecture:** Iga apply saab oma kaug-run-id (`{upload_id}-{run_id}`), nii et jooksud on kaugserveris isoleeritud. Katkestamine on CAS-üleminek `cancelling`-u kaudu, mis peatab apply-lõime enne koristust. Koristus kustutab ainult **failid** — kataloogi eemaldab hiljem reaper, sest kataloogi kustutamine lennusoleva batchi alt kukutab OCR-teenuse (#225).

**Tech Stack:** Python 3.9 (FastAPI, threading, paramiko SFTP), pytest; React 19 + TypeScript + i18next.

**Spekk:** `docs/superpowers/specs/2026-08-08-upload-ocr-katkestamine-design.md`
**Issue:** #225 (Task 1) · **Haru:** `feat/upload-ocr-katkestamine`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[dict]`, mitte `dict | None`. (`list[dict]` on lubatud — PEP 585 on 3.9-s olemas.)
- **Koodikommentaarid eesti keeles.**
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — sync `def` route või `run_in_threadpool`.
- **Uus endpoint läheb `server/routers/upload.py`-sse**, MITTE `main.py`-sse.
- **Kaugteed loetakse ALATI `state["remote_staging_path"]` / `["remote_work_path"]`-ist** — mitte kunagi ei tuletata kutsekohas. See invariant hoiab lennus olevad upload'id töös.
- **`rm -rf` kaugkataloogile on KEELATUD, kui batch võib olla lennus** (#225) — kustuta failid, kataloog eemaldatakse reaperiga.
- **i18n:** uus võti **mõlemasse keelde korraga** (`fallbackLng` väljas, ADR 0011).
- **Väravad enne igat commitit:** `.venv/bin/pytest tests/ -q`; frontendi taskides lisaks `npm run typecheck` ja `npm test`.

---

### Task 1: #225 — koristus ei kukuta OCR-teenust

**Files:**
- Create: `server/ocr_reaper.py`, `tests/test_ocr_reaper.py`
- Modify: `server/upload/ocr_client.py` (uus `cleanup_run_files`), `server/reocr_ops.py:_cleanup_remote_job`, `server/upload_ops.py:cancel_upload`, `server/config.py`
- Test: `tests/test_reocr_cancel.py` (täiendus)

**Interfaces:**
- Produces:
  - `config.OCR_RUN_REAPS_FILE: str` — `state/ocr_run_reaps.json`
  - `config.RUN_DIR_REAP_GRACE: int` = `600`
  - `ocr_client.cleanup_run_files(sftp, remote_dir: str) -> bool` — kustutab FAILID, kataloog jääb
  - `ocr_reaper.schedule_reap(remote_path: str) -> None`
  - `ocr_reaper.reap_due(rm_rf_func, now: Optional[float] = None) -> int` — tagastab eemaldatud kataloogide arvu

**Taust:** `process_batch` kirjutab `.txt` ilma veakäsitluseta; `main_loop` ei püüa seda; mooduli tasemel on `sys.exit(1)`. Kataloogi kustutamine lennusoleva batchi alt tapab teenuse. Mõõdetud tootmises 2026-08-08 16:26:29.

- [ ] **Step 1: Kirjuta kukkuv test failide-koristusele**

Loo `tests/test_ocr_reaper.py`:

```python
"""Kaugkoristus ei tohi kukutada OCR-teenust (#225).

process_batch kirjutab .txt ilma veakäsitluseta ja main_loop ei püüa seda —
kataloogi kustutamine lennusoleva batchi alt annab FileNotFoundError, mis
propageerub sys.exit(1)-ni. Seepärast: failid kohe, kataloog hiljem.
"""
import pytest

from server import ocr_reaper
from server.upload import ocr_client


class FakeSftp:
    def __init__(self, tree):
        self.tree = dict(tree)      # {kaust: [failinimed]}
        self.removed = []
        self.rmdirs = []

    def listdir(self, path):
        if path not in self.tree:
            raise FileNotFoundError(path)
        return list(self.tree[path])

    def remove(self, path):
        self.removed.append(path)

    def rmdir(self, path):
        self.rmdirs.append(path)


def test_koristus_kustutab_failid():
    sftp = FakeSftp({"/o/run1": ["a.jpg", "a.txt", "b.jpg"]})
    assert ocr_client.cleanup_run_files(sftp, "/o/run1") is True
    assert sorted(sftp.removed) == ["/o/run1/a.jpg", "/o/run1/a.txt", "/o/run1/b.jpg"]


def test_koristus_EI_KUSTUTA_kataloogi():
    """KRIITILINE (#225): rmdir lennusoleva batchi alt kukutab OCR-teenuse."""
    sftp = FakeSftp({"/o/run1": ["a.jpg"]})
    ocr_client.cleanup_run_files(sftp, "/o/run1")
    assert sftp.rmdirs == [], "kataloogi ei tohi siin eemaldada"


def test_puuduv_kataloog_ei_ole_viga():
    """Intsidendi kuju: kaust on juba kadunud."""
    sftp = FakeSftp({})
    assert ocr_client.cleanup_run_files(sftp, "/o/puudub") is True


def test_uksiku_faili_torge_annab_false():
    class Tõrkuv(FakeSftp):
        def remove(self, path):
            raise OSError("permission denied")

    sftp = Tõrkuv({"/o/run1": ["a.jpg"]})
    assert ocr_client.cleanup_run_files(sftp, "/o/run1") is False
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_ocr_reaper.py -q`
Expected: FAIL — `AttributeError: module 'server.upload.ocr_client' has no attribute 'cleanup_run_files'`

- [ ] **Step 3: Teosta `cleanup_run_files`**

`server/upload/ocr_client.py`, `ssh_rm_rf` kõrvale:

```python
def cleanup_run_files(sftp, remote_dir: str) -> bool:
    """Kustutab kaugkataloogi FAILID, jättes kataloogi ise alles. True = õnnestus.

    Kataloogi EI TOHI siin eemaldada (#225): kui katkestamise hetkel on batch
    juba GPU-s, kirjutab OCR-valvur tulemuse `open(txt_path, "w")`-ga ilma
    veakäsitluseta. Kadunud kataloog annab FileNotFoundError, mis propageerub
    main_loop'ist mooduli tasemele, kus on sys.exit(1) — terve teenus sureb.

    Piltide kustutamine peatab GPU-töö endiselt: process_batch väljub enne
    mudeli kutsumist, kui ükski pilt ei avane. Tühja kataloogi eemaldab hiljem
    ocr_reaper, kui ükski batch ei saa enam lennus olla.
    """
    try:
        names = sftp.listdir(remote_dir)
    except FileNotFoundError:
        return True          # juba kadunud — mitte viga
    except Exception as e:
        logger.warning("Kaugkoristus {}: listdir ebaõnnestus: {}".format(remote_dir, e))
        return False

    ok = True
    for name in names:
        try:
            sftp.remove("{}/{}".format(remote_dir, name))
        except Exception as e:
            logger.warning("Kaugkoristus {}/{}: {}".format(remote_dir, name, e))
            ok = False
    return ok
```

- [ ] **Step 4: Kirjuta kukkuv test reaperile**

Lisa `tests/test_ocr_reaper.py` lõppu:

```python
# --- reaper ---

@pytest.fixture(autouse=True)
def reaps_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr_reaper, "OCR_RUN_REAPS_FILE", str(tmp_path / "reaps.json"))


def test_ajastatud_kataloog_eemaldatakse_alles_armuaja_jarel():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)
    kustutatud = []

    # Armuaeg pole täis
    n = ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=1000.0 + 599)
    assert n == 0 and kustutatud == []

    # Armuaeg täis
    n = ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=1000.0 + 601)
    assert n == 1 and kustutatud == ["/o/run1"]


def test_eemaldatud_kataloogi_ei_proovita_uuesti():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)
    ocr_reaper.reap_due(lambda p: None, now=2000.0)
    assert ocr_reaper.reap_due(lambda p: pytest.fail("teist korda ei tohi"), now=3000.0) == 0


def test_torge_jatab_kirje_alles_uueks_katseks():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)

    def _boom(path):
        raise RuntimeError("SSH maas")

    assert ocr_reaper.reap_due(_boom, now=2000.0) == 0
    kustutatud = []
    assert ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=3000.0) == 1
    assert kustutatud == ["/o/run1"]


def test_sama_tee_ei_dubleeru():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)
    ocr_reaper.schedule_reap("/o/run1", now=1010.0)
    kustutatud = []
    ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=5000.0)
    assert kustutatud == ["/o/run1"]
```

- [ ] **Step 5: Teosta reaper**

Lisa `server/config.py`-sse (`REOCR_BACKUPS_DIR` kõrvale):

```python
# OCR-jooksude kaugkataloogide hiline eemaldamine (#225). Koristus kustutab
# failid kohe; kataloog eemaldatakse alles siis, kui ükski batch ei saa enam
# lennus olla — muidu kukub OCR-teenus .txt kirjutamisel.
OCR_RUN_REAPS_FILE = os.path.join(_STATE_DIR, "ocr_run_reaps.json")
RUN_DIR_REAP_GRACE = 600   # s; mõõdetud batch (4 lk) ≈ 100 s, varu on tahtlik
```

Loo `server/ocr_reaper.py`:

```python
"""OCR-jooksude kaugkataloogide hiline eemaldamine (#225).

Katkestamine kustutab kaugkataloogi failid kohe (see peatab GPU-töö), aga
kataloogi ennast EI TOHI kohe eemaldada: lennusolev batch kirjutab sinna oma
.txt-i ja kadunud kataloog kukutaks kogu OCR-teenuse. Siin hoitakse nimekirja
katalooge, mis tuleb eemaldada, kui armuaeg on täis.
"""
import json
import os
import threading
import time
from typing import Callable, Optional

from .config import OCR_RUN_REAPS_FILE, RUN_DIR_REAP_GRACE, get_logger
from .utils import atomic_write_json

logger = get_logger(__name__)

_lock = threading.Lock()


def _load() -> dict:
    try:
        with open(OCR_RUN_REAPS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(data: dict) -> None:
    try:
        os.makedirs(os.path.dirname(OCR_RUN_REAPS_FILE), exist_ok=True)
        atomic_write_json(OCR_RUN_REAPS_FILE, data)
    except Exception as e:
        logger.warning("Reaper-nimekirja kirjutamine ebaõnnestus: {}".format(e))


def schedule_reap(remote_path: str, now: Optional[float] = None) -> None:
    """Märgib kaugkataloogi hilisemaks eemaldamiseks."""
    ts = now if now is not None else time.time()
    with _lock:
        data = _load()
        data.setdefault(remote_path, ts)   # esimene ajatempel jääb kehtima
        _save(data)


def reap_due(rm_rf_func: Callable[[str], None], now: Optional[float] = None) -> int:
    """Eemaldab kataloogid, mille armuaeg on täis. Tagastab eemaldatute arvu.

    Tõrkuv kirje JÄÄB nimekirja — kaugserver võib olla ajutiselt maas.
    """
    ts = now if now is not None else time.time()
    with _lock:
        data = _load()
    due = [p for p, at in data.items() if ts - at >= RUN_DIR_REAP_GRACE]
    if not due:
        return 0

    eemaldatud = []
    for path in due:
        try:
            rm_rf_func(path)
            eemaldatud.append(path)
            logger.info("Reaper: eemaldatud OCR-jooksu kataloog {}".format(path))
        except Exception as e:
            logger.warning("Reaper: {} eemaldamine ebaõnnestus: {}".format(path, e))

    if eemaldatud:
        with _lock:
            data = _load()
            for path in eemaldatud:
                data.pop(path, None)
            _save(data)
    return len(eemaldatud)
```

- [ ] **Step 6: Käivita reaperi testid**

Run: `.venv/bin/pytest tests/test_ocr_reaper.py -q`
Expected: 8 passed

- [ ] **Step 7: Suuna re-OCR koristus uuele mustrile**

`server/reocr_ops.py`, `_cleanup_remote_job` — ASENDA failide-kustutus ja `rmdir`:

```python
    work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
    ok = True
    try:
        # Failid kohe (peatab GPU), kataloog hiljem reaperiga (#225)
        ok = ocr_client.cleanup_run_files(sftp, work_abs)
        ocr_reaper.schedule_reap(work_abs)
        remote_staging = job.get("remote_staging") or ""
        if remote_staging:
            ocr_reaper.schedule_reap(f"{OCR_SERVER_PATH}/{remote_staging}")
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        close_ssh(job_id)
    return ok
```

Lisa importidesse: `from . import ocr_reaper` ja `from .upload.ocr_client import cleanup_run_files, publish_atomic` (või kutsu `ocr_client.cleanup_run_files` — vali sama stiil, mis failis juba on).

- [ ] **Step 8: Suuna upload'i hävitav katkestamine uuele mustrile**

`server/upload_ops.py`, `cancel_upload` — ASENDA `_ssh_rm_rf` kutse:

```python
    if state and state.get('status') not in ('pending', 'error'):
        remote_staging = f"{OCR_SERVER_PATH}/{state['remote_staging_path']}"
        try:
            sftp = _sftp_open(upload_id)
            try:
                # Failid kohe, kataloog hiljem (#225): rm -rf lennusoleva
                # batchi alt kukutab OCR-teenuse.
                _ocr_client.cleanup_run_files(sftp, f"{remote_staging}/{state['meta']['slug']}")
                _ocr_client.cleanup_run_files(sftp, remote_staging)
            finally:
                sftp.close()
            ocr_reaper.schedule_reap(f"{remote_staging}/{state['meta']['slug']}")
            ocr_reaper.schedule_reap(remote_staging)
        except Exception as e:
            logger.warning(f"cancel_upload kaugkoristus ebaõnnestus {upload_id}: {e}")
```

- [ ] **Step 9: Ühenda reaper taustalõimedesse**

`server/upload_ops.py`, `_upload_sync_loop` tsükli sisse (pärast upload'ide pollimist):

```python
        try:
            ocr_reaper.reap_due(lambda p: _ocr_client.ssh_rm_rf("reaper", p))
        except Exception as e:
            logger.warning(f"Reaper viga: {e}")
```

- [ ] **Step 10: Käivita kogu komplekt ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline. Kui `tests/test_reocr_cancel.py` kukub `rmdir` ootuse pärast, on see test, mis kodeeris vana käitumise — paranda test.

```bash
git add -A
git commit -m "fix(ocr): koristus kustutab failid, kataloogi eemaldab reaper (#225)

rm -rf kaugkataloogile kukutas OCR-teenuse, kui katkestamise hetkel oli batch
GPU-s: process_batch kirjutab .txt ilma veakäsitluseta ja viga jõuab
sys.exit(1)-ni. Mõõdetud tootmises 2026-08-08 16:26:29.

Piltide kustutamine peatab GPU endiselt (process_batch väljub enne mudelit),
tühja kataloogi eemaldab ocr_reaper armuaja (600 s) järel."
```

---

### Task 2: Run-isolatsioon — iga apply saab oma kaugtee

**Files:**
- Modify: `server/upload/state.py:200-213` (`try_begin_applying`)
- Test: `tests/test_upload_run_isolation.py` (uus)

**Interfaces:**
- Consumes: `utils.generate_nanoid()`
- Produces: `try_begin_applying(upload_id)` genereerib uue `run_id` ja kirjutab `state["run_id"]`, `state["remote_staging_path"]`, `state["remote_work_path"]`.

**Taust:** kaugtee oli deterministlik, seega katkestamise järel lõi uus apply TÄPSELT sama kataloogi. Vana lennusoleva batchi `.txt` maanduks uue jooksu kataloogi õigete failinimedega ja import loeks selle uue jooksu tulemuseks.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_run_isolation.py`:

```python
"""Iga apply saab oma kaugtee (B-osa spekk).

Ilma selleta kirjutaks katkestamise hetkel lennus olnud batch oma .txt UUE
jooksu kataloogi — õigete failinimedega ja vale mudeliga.
"""
import pytest

from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid,
        "status": "awaiting_split",
        "meta": {"slug": "1650-teos-abc123", "type": {"id": "Q1261026"}},
        "remote_staging_path": "AUTO-OCR/print/u1",
        "remote_work_path": "AUTO-OCR/print/u1/1650-teos-abc123",
    })
    return uid


def test_apply_genereerib_run_id(upload):
    assert upload_state.try_begin_applying(upload) is True
    s = upload_state.read_state(upload)
    assert s["run_id"], "run_id peab olema"
    assert s["run_id"] in s["remote_staging_path"]


def test_kaks_jarjestikust_apply_t_ei_jaga_kaugteed(upload):
    """SEE ON KOGU MÕTE: katkestamise järgne uus jooks peab minema mujale."""
    upload_state.try_begin_applying(upload)
    esimene = upload_state.read_state(upload)["remote_work_path"]

    # katkestamine viib tagasi awaiting_split'i
    upload_state.set_upload_state(upload, status="awaiting_split")
    upload_state.try_begin_applying(upload)
    teine = upload_state.read_state(upload)["remote_work_path"]

    assert esimene != teine, "sama tee lubaks vanal batchil uut jooksu saastada"


def test_slug_jaab_teesse_alles(upload):
    upload_state.try_begin_applying(upload)
    s = upload_state.read_state(upload)
    assert s["remote_work_path"].endswith("/1650-teos-abc123")


def test_mudel_tuleb_teesse_meta_tyybist(upload):
    upload_state.set_upload_state(upload, status="awaiting_split")
    s = upload_state.read_state(upload)
    s["meta"]["type"] = {"id": "Q87167"}          # käsikiri
    upload_state.write_state(upload, s)

    upload_state.try_begin_applying(upload)

    assert "/hand/" in upload_state.read_state(upload)["remote_staging_path"]


def test_ebaonnestunud_CAS_ei_muuda_teid(upload):
    upload_state.set_upload_state(upload, status="processing")
    enne = upload_state.read_state(upload)["remote_work_path"]
    assert upload_state.try_begin_applying(upload) is False
    assert upload_state.read_state(upload)["remote_work_path"] == enne
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_run_isolation.py -q`
Expected: FAIL — `KeyError: 'run_id'` ja `esimene != teine` ei kehti.

- [ ] **Step 3: Teosta**

`server/upload/state.py` — lisa importidesse `from ..utils import generate_nanoid` ja
asenda `try_begin_applying`:

```python
def ocr_model_from_meta(meta: dict) -> str:
    """Materjali tüübist OCR-mudeli nimi. Q87167 = käsikiri."""
    type_id = ((meta or {}).get("type") or {}).get("id")
    return "hand" if type_id == "Q87167" else "print"


def try_begin_applying(upload_id: str) -> bool:
    """CAS: awaiting_split | error → applying. False, kui töö juba käib.

    Genereerib igale jooksule uue `run_id` ja arvutab kaugteed ümber. Ilma
    selleta looks katkestamise järgne apply TÄPSELT sama kataloogi ja
    katkestamise hetkel lennus olnud batch kirjutaks oma .txt uue jooksu
    kataloogi — õigete failinimedega, vale mudeliga (B-osa spekk).
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") not in APPLY_START_STATUSES:
            return False
        run_id = generate_nanoid()
        model = ocr_model_from_meta(s.get("meta") or {})
        slug = (s.get("meta") or {}).get("slug", "")
        s["run_id"] = run_id
        s["remote_staging_path"] = "AUTO-OCR/{}/{}-{}".format(model, upload_id, run_id)
        s["remote_work_path"] = "{}/{}".format(s["remote_staging_path"], slug)
        s["status"] = "applying"
        write_state(upload_id, s)
        return True
```

- [ ] **Step 4: Käivita testid**

Run: `.venv/bin/pytest tests/test_upload_run_isolation.py -q`
Expected: 5 passed

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline. Teed loetakse kõikjal state'ist, seega ükski kutsekoht ei
peaks katki minema — kui mõni test kodeeris vana tee kuju, paranda test.

- [ ] **Step 5: Commit**

```bash
git add server/upload/state.py tests/test_upload_run_isolation.py
git commit -m "feat(upload): iga apply saab oma kaug-run-id

Kaugtee oli deterministlik (model/upload_id/slug), nii et katkestamise järgne
apply lõi sama kataloogi uuesti. ADR 0018 järgi võib kustutamise hetkel kuni
üks LOSS-i batch olla GPU-s — selle .txt maanduks uue jooksu kataloogi õigete
failinimedega ja vale mudeliga.

Tee on nüüd AUTO-OCR/{model}/{upload_id}-{run_id}/{slug}. Lennus olevad
upload'id ei katke: teed loetakse alati state'ist."
```

---

### Task 3: Apply-lõime peatamine ja `cancelling` CAS

**Files:**
- Modify: `server/upload/state.py` (CAS + reset), `server/upload/prepress_apply.py` (Event + registry)
- Test: `tests/test_upload_cancel_state.py` (uus)

**Interfaces:**
- Produces:
  - `state.CANCEL_OCR_STATUSES = ("applying", "processing", "reviewing", "error")`
  - `state.try_begin_cancel_ocr(upload_id) -> bool` — CAS → `cancelling`, kirjutab `cancelling_since`
  - `state.reset_ocr_run_state(upload_id) -> None`
  - `prepress_apply.cancel_event(upload_id) -> threading.Event`
  - `prepress_apply.quiesce_apply(upload_id, timeout: float = 30.0) -> bool`
  - `prepress_apply.forget_cancel_state(upload_id) -> None`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_cancel_state.py`:

```python
"""Upload'i OCR-katkestamise olekumasin ja lõime peatamine (B-osa spekk)."""
import os
import threading
import time

import pytest

from server.upload import prepress_apply
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    (base / "thumbs").mkdir(parents=True)
    (base / "thumbs" / "001.jpg").write_bytes(b"x")
    (base / "preview").mkdir()
    (base / "preview" / "pg_0001.jpg").write_bytes(b"x")
    (base / "source.pdf").write_bytes(b"%PDF")
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid,
        "status": "processing",
        "meta": {"slug": "s", "type": {"id": "Q1261026"}},
        "files": [{"page": 1, "filename": "001.jpg", "has_ocr": False, "deleted": False}],
        "expected_pages": 6,
        "last_progress_at": 123.0,
        "error_message": "vana viga",
        "work_id": "w1",
        "prepress": {"enabled": True, "applied_done": 3, "pages": [{"n": 1}]},
        "remote_staging_path": "AUTO-OCR/print/u1-run1",
        "remote_work_path": "AUTO-OCR/print/u1-run1/s",
    })
    monkeypatch.setattr(prepress_apply, "_cancel_events", {})
    monkeypatch.setattr(prepress_apply, "_apply_threads", {})
    return uid, base


# --- CAS ---

@pytest.mark.parametrize("status", ["applying", "processing", "reviewing", "error"])
def test_katkestatavad_staatused(upload, status):
    uid, _ = upload
    upload_state.set_upload_state(uid, status=status)
    assert upload_state.try_begin_cancel_ocr(uid) is True
    s = upload_state.read_state(uid)
    assert s["status"] == "cancelling"
    assert s["cancelling_since"] > 0


@pytest.mark.parametrize("status", ["awaiting_split", "prepping", "pending", "imported"])
def test_mittekatkestatavad_staatused(upload, status):
    uid, _ = upload
    upload_state.set_upload_state(uid, status=status)
    assert upload_state.try_begin_cancel_ocr(uid) is False
    assert upload_state.read_state(uid)["status"] == status


def test_cancelling_saab_jatkata(upload):
    """503 järel ei tohi endpoint lukustuda — kordus jätkab."""
    uid, _ = upload
    upload_state.set_upload_state(uid, status="cancelling")
    assert upload_state.try_begin_cancel_ocr(uid) is True


def test_ainult_uks_loim_voidab(upload):
    uid, _ = upload
    voitjad = []
    lukk = threading.Lock()

    def proovi():
        if upload_state.try_begin_cancel_ocr(uid):
            with lukk:
                voitjad.append(1)

    ts = [threading.Thread(target=proovi) for _ in range(20)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert len(voitjad) == 1


# --- reset ---

def test_reset_puhastab_jooksu_valjad_aga_jatab_plaani(upload):
    uid, base = upload
    upload_state.reset_ocr_run_state(uid)
    s = upload_state.read_state(uid)

    assert s["files"] == []
    assert s["expected_pages"] is None
    assert s.get("error_message") is None
    assert s["prepress"]["applied_done"] == 0
    assert not os.path.exists(str(base / "thumbs" / "001.jpg"))

    # Need PEAVAD säilima — kogu funktsiooni mõte
    assert s["prepress"]["pages"] == [{"n": 1}]
    assert s["meta"]["slug"] == "s"
    assert s["work_id"] == "w1"
    assert os.path.exists(str(base / "source.pdf"))
    assert os.path.exists(str(base / "preview" / "pg_0001.jpg"))


# --- lõime peatamine ---

def test_quiesce_ootab_loime_lopetamiseni():
    ev = threading.Event()
    prepress_apply._cancel_events["u1"] = ev
    tehtud = []

    def töö():
        for i in range(100):
            if ev.is_set():
                return
            tehtud.append(i)
            time.sleep(0.01)

    t = threading.Thread(target=töö)
    prepress_apply._apply_threads["u1"] = t
    t.start()
    time.sleep(0.05)

    assert prepress_apply.quiesce_apply("u1", timeout=5.0) is True
    assert not t.is_alive()


def test_quiesce_annab_false_kui_loim_ei_peatu():
    prepress_apply._cancel_events["u1"] = threading.Event()
    stop = threading.Event()
    t = threading.Thread(target=lambda: stop.wait(10), daemon=True)
    prepress_apply._apply_threads["u1"] = t
    t.start()
    assert prepress_apply.quiesce_apply("u1", timeout=0.2) is False
    stop.set()


def test_quiesce_ilma_loimeta_on_ohutu():
    """processing/reviewing puhul on apply-lõim tavaliselt juba lõpetanud."""
    assert prepress_apply.quiesce_apply("puudub", timeout=0.1) is True
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_cancel_state.py -q`
Expected: FAIL — `AttributeError: try_begin_cancel_ocr`

- [ ] **Step 3: Teosta CAS ja reset**

`server/upload/state.py`, `try_begin_applying` kõrvale:

```python
CANCEL_OCR_STATUSES = ("applying", "processing", "reviewing", "error", "cancelling")


def try_begin_cancel_ocr(upload_id: str) -> bool:
    """CAS: aktiivne OCR-jooks → cancelling. False, kui katkestada ei saa.

    `cancelling` on nimekirjas SEES: kui join aegus ja endpoint andis 503, peab
    kordus saama pooleli katkestamist jätkata. Muidu oleks endpoint pärast
    omaenda ebaõnnestumist kasutajale lukus (B-osa spekk).
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") not in CANCEL_OCR_STATUSES:
            return False
        if s.get("status") != "cancelling":
            s["cancelling_since"] = datetime.now().timestamp()
        s["status"] = "cancelling"
        write_state(upload_id, s)
        return True


def reset_ocr_run_state(upload_id: str) -> None:
    """Lähtestab KÕIK jooksu-ulatusega väljad ja kustutab pisipildid.

    Kanooniline — väljade käsitsi nullimine mitmes kohas lahkneb. `work_id`
    JÄÄB: see on teose tulevane identiteet, mitte jooksu oma. Plaan, lähtefail
    ja eelvaade jäävad puutumata; see on kogu funktsiooni mõte.
    """
    import shutil

    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s:
            return
        s["files"] = []
        s["expected_pages"] = None
        s["last_progress_at"] = None
        s["error_message"] = None
        plan = s.get("prepress")
        if isinstance(plan, dict):
            plan["applied_done"] = 0
        write_state(upload_id, s)

    shutil.rmtree(os.path.join(upload_dir(upload_id), "thumbs"), ignore_errors=True)
```

- [ ] **Step 4: Teosta lõime peatamine**

`server/upload/prepress_apply.py`, `start_apply` kohale:

```python
# Töö-põhised katkestuslipud ja apply-lõimed (B-osa spekk).
_cancel_events: Dict[str, threading.Event] = {}
_apply_threads: Dict[str, threading.Thread] = {}


def cancel_event(upload_id: str) -> threading.Event:
    """Selle upload'i katkestuslipp (loob vajadusel)."""
    ev = _cancel_events.get(upload_id)
    if ev is None:
        ev = threading.Event()
        _cancel_events[upload_id] = ev
    return ev


def quiesce_apply(upload_id: str, timeout: float = 30.0) -> bool:
    """Seab lipu ja OOTAB apply-lõime lõpetamist. False = lõim ei peatunud.

    `processing`/`reviewing` puhul on lõim tavaliselt juba lõpetanud — siis
    tagastatakse kohe True. Koristust EI TOHI alustada, kui see annab False:
    pooleliolev SFTP kirjutaks failid tagasi kataloogi, mille just puhastasime.
    """
    cancel_event(upload_id).set()
    t = _apply_threads.get(upload_id)
    if t is None or not t.is_alive():
        return True
    t.join(timeout)
    return not t.is_alive()


def forget_cancel_state(upload_id: str) -> None:
    _cancel_events.pop(upload_id, None)
    _apply_threads.pop(upload_id, None)
```

Lisa `from typing import Dict` importidesse, kui puudub.

- [ ] **Step 5: Ühenda lipp ülekandetsüklisse**

`_transfer_pages`, `for n in range(1, count + 1):` algusesse:

```python
        for n in range(1, count + 1):
            if cancel_event(upload_id).is_set():
                logger.info("Prepress apply {}: katkestatud".format(upload_id))
                return out_index
```

`start_apply` — pane lõim registrisse:

```python
    _t = threading.Thread(
        target=apply_and_transfer, args=(upload_id,),
        daemon=True, name="prepress-apply-{}".format(upload_id),
    )
    _apply_threads[upload_id] = _t
    _t.start()
    return True
```

- [ ] **Step 6: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/upload/state.py server/upload/prepress_apply.py tests/test_upload_cancel_state.py
git commit -m "feat(upload): cancelling-CAS, reset_ocr_run_state ja apply-lõime peatamine

cancelling on CANCEL_OCR_STATUSES sees, et 503 järel saaks katkestamist
jätkata. reset_ocr_run_state on kanooniline — work_id jääb, sest see on teose
tulevane identiteet, mitte jooksu oma."
```

---

### Task 4: `cancel_upload_ocr()` ja endpoint

**Files:**
- Modify: `server/upload_ops.py` (uus funktsioon), `server/routers/upload.py` (endpoint)
- Test: `tests/test_upload_cancel_ocr.py` (uus)

**Interfaces:**
- Consumes: Task 1–3 (`cleanup_run_files`, `schedule_reap`, `try_begin_cancel_ocr`, `reset_ocr_run_state`, `quiesce_apply`)
- Produces:
  - `upload_ops.cancel_upload_ocr(upload_id: str) -> dict` — `{"status": "awaiting_split", "remote_cleanup": "ok"|"failed"}`; `KeyError` tundmatu, `ValueError` mittekatkestatav, `RuntimeError` kirjutaja ei peatunud
  - `POST /admin/upload/{upload_id}/cancel-ocr`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_cancel_ocr.py`:

```python
"""cancel_upload_ocr: jooks kaob, plaan jääb (B-osa spekk)."""
import pytest

from server import upload_ops
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    (base / "thumbs").mkdir(parents=True)
    (base / "source.pdf").write_bytes(b"%PDF")
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(upload_ops._upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "processing",
        "meta": {"slug": "s", "type": {"id": "Q1261026"}},
        "files": [{"page": 1, "filename": "001.jpg"}],
        "expected_pages": 6,
        "prepress": {"enabled": True, "applied_done": 3, "pages": [{"n": 1}]},
        "remote_staging_path": "AUTO-OCR/print/u1-run1",
        "remote_work_path": "AUTO-OCR/print/u1-run1/s",
    })
    koristatud = []
    ajastatud = []
    monkeypatch.setattr(upload_ops, "_cleanup_upload_run", lambda uid_, s: koristatud.append(uid_) or True)
    monkeypatch.setattr(upload_ops.ocr_reaper, "schedule_reap", lambda p, **kw: ajastatud.append(p))
    return uid, base, koristatud, ajastatud


def test_katkestamine_viib_awaiting_split_i(upload):
    uid, _b, _k, _a = upload
    r = upload_ops.cancel_upload_ocr(uid)
    assert r["status"] == "awaiting_split"
    assert upload_state.read_state(uid)["status"] == "awaiting_split"


def test_plaan_ja_lahtefail_sailivad(upload):
    uid, base, _k, _a = upload
    upload_ops.cancel_upload_ocr(uid)
    s = upload_state.read_state(uid)
    assert s["prepress"]["pages"] == [{"n": 1}]
    assert s["prepress"]["applied_done"] == 0
    assert s["files"] == []
    assert (base / "source.pdf").exists()


def test_kirjutaja_ei_peatu_ei_korista(upload, monkeypatch):
    uid, _b, koristatud, _a = upload
    monkeypatch.setattr(upload_ops.prepress_apply, "quiesce_apply",
                        lambda uid_, timeout=30.0: False)
    with pytest.raises(RuntimeError):
        upload_ops.cancel_upload_ocr(uid)
    assert koristatud == []
    assert upload_state.read_state(uid)["status"] == "cancelling"


def test_imported_ei_ole_katkestatav(upload):
    uid, _b, _k, _a = upload
    upload_state.set_upload_state(uid, status="imported")
    with pytest.raises(ValueError):
        upload_ops.cancel_upload_ocr(uid)


def test_tundmatu_upload_annab_keyerror(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(tmp_path / "puudub"))
    with pytest.raises(KeyError):
        upload_ops.cancel_upload_ocr("puudub")


def test_koristuse_torge_ei_takista_katkestamist(upload, monkeypatch):
    uid, _b, _k, _a = upload
    monkeypatch.setattr(upload_ops, "_cleanup_upload_run", lambda uid_, s: False)
    r = upload_ops.cancel_upload_ocr(uid)
    assert r["remote_cleanup"] == "failed"
    assert upload_state.read_state(uid)["status"] == "awaiting_split"
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_cancel_ocr.py -q`
Expected: FAIL — `AttributeError: cancel_upload_ocr`

- [ ] **Step 3: Teosta**

`server/upload_ops.py`, `cancel_upload` kõrvale:

```python
def _cleanup_upload_run(upload_id: str, state: dict) -> bool:
    """Kustutab selle jooksu kaugfailid ja ajastab kataloogid eemaldamiseks (#225)."""
    staging = state.get("remote_staging_path")
    work = state.get("remote_work_path")
    if not staging:
        return True
    staging_abs = f"{OCR_SERVER_PATH}/{staging}"
    work_abs = f"{OCR_SERVER_PATH}/{work}" if work else None
    try:
        sftp = _sftp_open(upload_id)
    except Exception as e:
        logger.warning(f"cancel-ocr {upload_id}: SFTP viga: {e}")
        return False
    ok = True
    try:
        if work_abs:
            ok = _ocr_client.cleanup_run_files(sftp, work_abs) and ok
        ok = _ocr_client.cleanup_run_files(sftp, staging_abs) and ok
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        close_ssh(upload_id)
    if work_abs:
        ocr_reaper.schedule_reap(work_abs)
    ocr_reaper.schedule_reap(staging_abs)
    return ok


def cancel_upload_ocr(upload_id: str) -> dict:
    """Katkestab upload'i OCR-jooksu ja viib upload'i tagasi poolitamise juurde.

    Plaan, lähtefail ja eelvaade säilivad. Järjekord ei ole vaba: koristus
    tohib alata alles siis, kui apply-lõim on peatunud (B-osa spekk).
    """
    state = _upload_state.read_state(upload_id)
    if not state:
        raise KeyError(upload_id)

    if not _upload_state.try_begin_cancel_ocr(upload_id):
        raise ValueError("Upload ei ole katkestatav")

    if not prepress_apply.quiesce_apply(upload_id):
        logger.error(f"cancel-ocr {upload_id}: apply-lõim ei peatunud, koristus edasi lükatud")
        raise RuntimeError("Apply-lõim ei peatunud")

    state = _upload_state.read_state(upload_id) or state
    remote_ok = _cleanup_upload_run(upload_id, state)

    _upload_state.reset_ocr_run_state(upload_id)
    _upload_state.set_upload_state(upload_id, status="awaiting_split", cancelling_since=None)
    prepress_apply.forget_cancel_state(upload_id)

    logger.info(
        f"Upload {upload_id} OCR katkestatud, kaugkoristus="
        f"{'ok' if remote_ok else 'failed'}"
    )
    return {"status": "awaiting_split", "remote_cleanup": "ok" if remote_ok else "failed"}
```

Lisa importidesse: `from . import ocr_reaper`, `from .upload import prepress_apply`,
`from .upload import ocr_client as _ocr_client` (kui puuduvad).

- [ ] **Step 4: Lisa endpoint**

`server/routers/upload.py` lõppu:

```python
@router.post("/admin/upload/{upload_id}/cancel-ocr")
def admin_upload_cancel_ocr(upload_id: str, user=Depends(require_role("admin"))):
    """Katkestab OCR-jooksu ja viib upload'i tagasi poolitamise juurde.

    Sync def — kogu töö on blokeeriv I/O (SFTP + failisüsteem), ADR 0002.
    Poolitusplaan, lähtefail ja eelvaade säilivad.
    """
    try:
        return upload_ops.cancel_upload_ocr(upload_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Uploadi ei leitud")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/upload_ops.py server/routers/upload.py tests/test_upload_cancel_ocr.py
git commit -m "feat(upload): POST /admin/upload/{id}/cancel-ocr

Jooks kaob, plaan jääb. 409 = ei ole katkestatav, 404 = tundmatu,
503 = apply-lõim ei peatunud (upload jääb cancelling, taaste korjab üles)."
```

---

### Task 5: Poller ei kirjuta pärast katkestamise algust

**Files:**
- Modify: `server/upload/thumbs.py:55-66` (varajane väljumine), `thumbs.py:_create_thumbnail` kutsekoht
- Test: `tests/test_upload_cancel_poller.py` (uus)

**Interfaces:**
- Consumes: `upload_state.read_state`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_cancel_poller.py`:

```python
"""Poller ei tohi pisipilti kirjutada pärast katkestamise algust (B-osa spekk).

Varajane väljumine üksi ei piisa: poller võib katkestamise hetkel olla juba
funktsiooni sees, keset allalaadimist.
"""
import pytest

from server.upload import thumbs
from server.upload import state as upload_state


def test_cancelling_upload_valjub_varakult(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {"id": uid, "status": "cancelling", "meta": {"slug": "s"}})

    def _boom(_uid):
        pytest.fail("cancelling upload'i puhul ei tohi SFTP-d avada")

    tulemus = thumbs.poll_and_sync_thumbs(uid, sftp_open_func=_boom)
    assert tulemus["status"] == "cancelling"


def test_pisipilti_ei_kirjutata_kui_olek_muutus_allalaadimise_ajal(tmp_path, monkeypatch):
    """Poller alustas tööd `processing` olekus; katkestamine jõudis vahele."""
    uid = "u1"
    base = tmp_path / uid
    (base / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "processing", "meta": {"slug": "s"},
        "remote_work_path": "AUTO-OCR/print/u1-run1/s", "files": [],
    })

    class Sftp:
        def stat(self, path):
            raise FileNotFoundError(path)

        def listdir(self, path):
            # Simuleeri katkestamist, mis jõudis vahele
            upload_state.set_upload_state(uid, status="cancelling")
            return ["s_pg_001.jpg", "s_pg_001.txt"]

        def get(self, remote, local):
            pytest.fail("cancelling olekus ei tohi pisipilti alla laadida")

        def close(self):
            pass

    thumbs.poll_and_sync_thumbs(uid, sftp_open_func=lambda _uid: Sftp())

    assert not list((base / "thumbs").glob("*.jpg")), "thumbs peab jääma tühjaks"
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_cancel_poller.py -q`
Expected: FAIL — poller avab SFTP ja laeb pisipildi alla.

- [ ] **Step 3: Teosta varajane väljumine**

`server/upload/thumbs.py`, varajase väljumise nimekirja lisa `"cancelling"`:

```python
    if current_status in (
        "pending", "uploading", "error", "imported", "collecting_images", "cancelling",
    ) + upload_state.PREPRESS_IDLE_STATUSES:
```

- [ ] **Step 4: Teosta ülekontroll enne kirjutust**

`poll_and_sync_thumbs`, pisipiltide tsüklis ENNE `_create_thumbnail` kutset:

```python
            # Olek võis allalaadimise ajal muutuda: katkestamine kustutab
            # thumbs/ ja poller looks selle kohe uuesti (B-osa spekk).
            if (upload_state.read_state(upload_id) or {}).get("status") == "cancelling":
                logger.info("Poll {}: katkestamine algas, pisipilte ei kirjutata".format(upload_id))
                break
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/upload/thumbs.py tests/test_upload_cancel_poller.py
git commit -m "fix(upload): poller ei kirjuta pisipilte cancelling ajal

Varajane väljumine üksi ei piisa — poller võib katkestamise hetkel olla juba
funktsiooni sees. Olek kontrollitakse üle vahetult enne iga kirjutust."
```

---

### Task 6: Kinni jäänud `cancelling` taastamine

**Files:**
- Modify: `server/upload_ops.py` (uus funktsioon + sync-loop ühendus), `server/config.py`
- Test: `tests/test_upload_cancel_recovery.py` (uus)

**Interfaces:**
- Produces:
  - `config.CANCEL_STUCK_TIMEOUT: int` = `300`
  - `upload_ops.recover_stuck_cancellations(now: Optional[float] = None) -> int`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_cancel_recovery.py`:

```python
"""Kinni jäänud cancelling ei tohi avaneda elava kirjutaja alt (B-osa spekk)."""
import threading

import pytest

from server import upload_ops
from server.upload import prepress_apply
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(upload_ops._upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(upload_ops, "list_uploads", lambda: [upload_state.read_state(uid)])
    monkeypatch.setattr(upload_ops, "_cleanup_upload_run", lambda uid_, s: True)
    monkeypatch.setattr(prepress_apply, "_apply_threads", {})
    upload_state.write_state(uid, {
        "id": uid, "status": "cancelling", "cancelling_since": 1000.0,
        "meta": {"slug": "s"}, "prepress": {"pages": [{"n": 1}], "applied_done": 2},
        "remote_staging_path": "AUTO-OCR/print/u1-run1",
    })
    return uid


def test_ei_normaliseeri_enne_ajapiiri(upload):
    assert upload_ops.recover_stuck_cancellations(now=1000.0 + 299) == 0
    assert upload_state.read_state(upload)["status"] == "cancelling"


def test_EI_NORMALISEERI_KUI_LOIM_ELAB(upload):
    """KRIITILINE: join-i aegumine tähendab, et lõim VÕIB veel elus olla.
    Ainult aja peale normaliseerimine avaks awaiting_split'i kirjutaja alt."""
    stop = threading.Event()
    t = threading.Thread(target=lambda: stop.wait(10), daemon=True)
    t.start()
    prepress_apply._apply_threads[upload] = t

    assert upload_ops.recover_stuck_cancellations(now=1000.0 + 601) == 0
    assert upload_state.read_state(upload)["status"] == "cancelling"
    stop.set()


def test_normaliseerib_kui_aeg_tais_ja_loim_surnud(upload):
    assert upload_ops.recover_stuck_cancellations(now=1000.0 + 601) == 1
    s = upload_state.read_state(upload)
    assert s["status"] == "awaiting_split"
    assert s["prepress"]["pages"] == [{"n": 1}], "plaan peab säilima"


def test_proovib_kaugkoristust_uuesti(upload, monkeypatch):
    """„Järgmine apply kirjutab üle" EI KEHTI — run-id viib mujale."""
    proovitud = []
    monkeypatch.setattr(upload_ops, "_cleanup_upload_run",
                        lambda uid_, s: proovitud.append(uid_) or True)
    upload_ops.recover_stuck_cancellations(now=1000.0 + 601)
    assert proovitud == [upload]
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_cancel_recovery.py -q`
Expected: FAIL — `AttributeError: recover_stuck_cancellations`

- [ ] **Step 3: Teosta**

`server/config.py`:

```python
# Kui kaua tohib upload jääda `cancelling` olekusse enne taastamist (#225 / B-osa).
CANCEL_STUCK_TIMEOUT = 300
```

`server/upload_ops.py`:

```python
def recover_stuck_cancellations(now: Optional[float] = None) -> int:
    """Lõpetab pooleli jäänud katkestamised. Tagastab taastatud upload'ide arvu.

    Tingimus on KAHEOSALINE: ajapiir JA surnud apply-lõim. Ainult aja peale
    normaliseerimine oleks võistlusolukorra taimer — üks põhjus, miks upload
    `cancelling`-usse jäi, on just see, et join aegus, mis tähendab
    definitsiooni järgi, et lõim VÕIB veel elus olla (B-osa spekk).
    """
    ts = now if now is not None else datetime.now().timestamp()
    taastatud = 0
    for state in list_uploads():
        if state.get("status") != "cancelling":
            continue
        uid = state.get("id")
        since = state.get("cancelling_since") or 0
        if ts - since < CANCEL_STUCK_TIMEOUT:
            continue
        t = prepress_apply._apply_threads.get(uid)
        if t is not None and t.is_alive():
            logger.warning(f"cancel-ocr {uid}: apply-lõim on endiselt elus, ei normaliseeri")
            continue

        # Koristust proovitakse UUESTI: run-id tõttu ei kirjuta järgmine apply
        # vana kataloogi üle, seega „küll järgmine apply parandab" ei kehti.
        _cleanup_upload_run(uid, state)
        _upload_state.reset_ocr_run_state(uid)
        _upload_state.set_upload_state(uid, status="awaiting_split", cancelling_since=None)
        prepress_apply.forget_cancel_state(uid)
        taastatud += 1
        logger.info(f"cancel-ocr {uid}: pooleli jäänud katkestamine lõpetatud")
    return taastatud
```

- [ ] **Step 4: Ühenda sync-loopi**

`_upload_sync_loop` tsüklisse, reaperi kutse kõrvale:

```python
        try:
            recover_stuck_cancellations()
        except Exception as e:
            logger.warning(f"cancel-ocr taastamine ebaõnnestus: {e}")
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/config.py server/upload_ops.py tests/test_upload_cancel_recovery.py
git commit -m "feat(upload): taasta kinni jäänud cancelling (aeg JA surnud lõim)

Ainult ajapiir oleks võistluse taimer: join-i aegumine tähendab, et lõim võib
veel elus olla. Taastamine proovib ka kaugkoristust uuesti — run-id tõttu ei
kirjuta järgmine apply vana kataloogi üle."
```

---

### Task 7: Mudeli vahetus sama luku all

**Files:**
- Modify: `server/upload/state.py` (uus funktsioon), `server/routers/upload.py` (endpoint)
- Test: `tests/test_upload_model_change.py` (uus)

**Interfaces:**
- Produces:
  - `state.try_set_ocr_model(upload_id: str, material_type: str) -> bool` — CAS-i luku all
  - `POST /admin/upload/{upload_id}/model`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_upload_model_change.py`:

```python
"""Mudeli vahetus peab kasutama SAMA lukku mis try_begin_applying (B-osa spekk)."""
import threading

import pytest

from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "awaiting_split",
        "meta": {"slug": "s", "type": {"id": "Q1261026"}},
        "remote_staging_path": "AUTO-OCR/print/u1-run1",
        "remote_work_path": "AUTO-OCR/print/u1-run1/s",
    })
    return uid


def test_mudeli_vahetus_muudab_meta_tyypi(upload):
    assert upload_state.try_set_ocr_model(upload, "hand") is True
    assert upload_state.read_state(upload)["meta"]["type"]["id"] == "Q87167"


def test_vahetus_EI_KIRJUTA_kaugteid_umber(upload):
    """Teed genereeritakse alles järgmisel apply'l — run-isolatsiooni tagajärg."""
    enne = upload_state.read_state(upload)["remote_work_path"]
    upload_state.try_set_ocr_model(upload, "hand")
    assert upload_state.read_state(upload)["remote_work_path"] == enne


def test_jargmine_apply_kasutab_uut_mudelit(upload):
    upload_state.try_set_ocr_model(upload, "hand")
    upload_state.try_begin_applying(upload)
    assert "/hand/" in upload_state.read_state(upload)["remote_staging_path"]


@pytest.mark.parametrize("status", ["applying", "processing", "reviewing", "imported"])
def test_vahetus_pole_lubatud_valel_ajal(upload, status):
    upload_state.set_upload_state(upload, status=status)
    assert upload_state.try_set_ocr_model(upload, "hand") is False


def test_paralleelne_vahetus_ja_apply_ei_saa_moelmad_voita(upload):
    """TOCTOU: mudel ei tohi muutuda töötava ülekande alt."""
    tulemused = []
    start = threading.Barrier(2)

    def vaheta():
        start.wait()
        tulemused.append(("model", upload_state.try_set_ocr_model(upload, "hand")))

    def rakenda():
        start.wait()
        tulemused.append(("apply", upload_state.try_begin_applying(upload)))

    t1, t2 = threading.Thread(target=vaheta), threading.Thread(target=rakenda)
    t1.start(); t2.start(); t1.join(); t2.join()

    edukad = [nimi for nimi, ok in tulemused if ok]
    s = upload_state.read_state(upload)
    if "apply" in edukad:
        # Kui apply võitis, EI TOHI mudel olla vahepeal muutunud
        assert ("model" not in edukad) or s["status"] == "applying"
    assert len(edukad) >= 1
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_upload_model_change.py -q`
Expected: FAIL — `AttributeError: try_set_ocr_model`

- [ ] **Step 3: Teosta**

`server/upload/state.py`:

```python
# Materjali tüübi Q-koodid. Q87167 = käsikiri, muu = trükis.
_TYPE_HAND = {"id": "Q87167", "label": "käsikiri"}
_TYPE_PRINT = {"id": "Q1261026", "label": "trükis"}


def try_set_ocr_model(upload_id: str, material_type: str) -> bool:
    """Vahetab OCR-mudeli. False, kui upload ei ole `awaiting_split` olekus.

    Kasutab SAMA lukku, mida try_begin_applying: kontroll ja kirjutus peavad
    olema jagamatud, muidu jõuab apply vahele ja mudel muutuks töötava
    ülekande alt (B-osa spekk).

    Kaugteid EI kirjutata ümber — need genereeritakse alles järgmisel apply'l.
    """
    if material_type not in ("hand", "print"):
        return False
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") != "awaiting_split":
            return False
        meta = s.setdefault("meta", {})
        meta["type"] = dict(_TYPE_HAND if material_type == "hand" else _TYPE_PRINT)
        write_state(upload_id, s)
        return True
```

- [ ] **Step 4: Lisa endpoint**

`server/routers/upload.py`:

```python
@router.post("/admin/upload/{upload_id}/model")
async def admin_upload_set_model(upload_id: str, request: Request,
                                 user=Depends(require_role("admin"))):
    """Vahetab OCR-mudeli (ainult poolitamise ootel). Keha loeb → async + threadpool."""
    data = await get_json_data(request)
    material_type = data.get("material_type")
    if material_type not in ("hand", "print"):
        raise HTTPException(status_code=400, detail="material_type peab olema hand või print")
    ok = await run_in_threadpool(upload_state.try_set_ocr_model, upload_id, material_type)
    if not ok:
        raise HTTPException(status_code=409, detail="Mudelit saab vahetada ainult poolitamise ootel")
    return {"status": "success", "material_type": material_type}
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/upload/state.py server/routers/upload.py tests/test_upload_model_change.py
git commit -m "feat(upload): POST /admin/upload/{id}/model sama luku all

Kontroll ja kirjutus on jagamatud — naiivne 'kontrolli, siis kirjuta' laseks
apply'l vahele jõuda ja mudel muutuks töötava ülekande alt. Kaugteid ei
kirjutata ümber: need genereeritakse järgmisel apply'l."
```

---

### Task 8: Frontend — mudelivalik ja katkestamisnupp

**Files:**
- Modify: `src/pages/upload/uploadApi.ts`, `src/pages/upload/components/UploadStepSplit.tsx`, `src/pages/upload/components/UploadStepReview.tsx`, `src/pages/upload/UploadPage.tsx`, `src/pages/upload/useUploadWizard.ts`, `src/locales/{et,en}/upload.json`

**Interfaces:**
- Consumes: `POST /admin/upload/{id}/cancel-ocr`, `POST /admin/upload/{id}/model`
- Produces: `cancelUploadOcr(uploadId, token)`, `setUploadModel(uploadId, materialType, token)`

- [ ] **Step 1: Lisa API-funktsioonid**

`src/pages/upload/uploadApi.ts`:

```ts
export function cancelUploadOcr(
  uploadId: string, token: string | null,
): Promise<{ status: string; remote_cleanup: string }> {
  return apiPost(`/admin/upload/${uploadId}/cancel-ocr`, {}, { token, timeout: 60000 });
}

export function setUploadModel(
  uploadId: string, materialType: 'hand' | 'print', token: string | null,
): Promise<{ status: string; material_type: string }> {
  return apiPost(`/admin/upload/${uploadId}/model`, { material_type: materialType },
                 { token, timeout: 10000 });
}
```

Kontrolli, millist abifunktsiooni fail juba kasutab (`apiPost` vs otse `fetch`) ja
järgi sama stiili — ära lisa uut HTTP-kihti.

- [ ] **Step 2: Lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/upload.json`, `step3split` alla:

```json
"model": "OCR-mudel",
"modelPrint": "Trükis",
"modelHand": "Käsikiri",
"modelHint": "Määrab, millisesse OCR-mudelisse leheküljed saadetakse.",
"modelFailed": "Mudeli vahetus ebaõnnestus"
```

`src/locales/et/upload.json`, `step3` (ülevaatuse samm) alla:

```json
"cancelOcr": "Katkesta OCR ja naase poolitamise juurde",
"cancelOcrConfirm": "OCR-i praegune jooks ja selle tulemused kustutatakse. Poolitusplaan ja lähtefail säilivad ning saad valida teise OCR-mudeli.",
"cancelOcrYes": "Jah, katkesta OCR",
"cancelOcrRunning": "Katkestan...",
"cancelOcrFailed": "Katkestamine ebaõnnestus"
```

`src/locales/en/upload.json` samadesse kohtadesse:

```json
"model": "OCR model",
"modelPrint": "Print",
"modelHand": "Handwriting",
"modelHint": "Decides which OCR model the pages are sent to.",
"modelFailed": "Changing the model failed"
```

```json
"cancelOcr": "Cancel OCR and return to splitting",
"cancelOcrConfirm": "The current OCR run and its results are deleted. The split plan and source file are kept, and you can choose a different OCR model.",
"cancelOcrYes": "Yes, cancel OCR",
"cancelOcrRunning": "Cancelling...",
"cancelOcrFailed": "Cancelling failed"
```

- [ ] **Step 3: Nimeta hävitav nupp ümber**

Otsi olemasoleva „Katkesta" nupu võti (`grep -rn "handleCancel" src/pages/upload/UploadPage.tsx`)
ja muuda selle silt mõlemas keeles:

- et: `"cancel": "Loobu üleslaadimisest"`
- en: `"cancel": "Discard this upload"`

Kaks nuppu ei tohi olla terminoloogilised konkurendid.

- [ ] **Step 4: Lisa mudelivalik sammu 3**

`UploadStepSplit.tsx`, plaani kokkuvõtte kõrvale — kaks nuppu (Trükis / Käsikiri),
aktiivne esile tõstetud, klõps kutsub `setUploadModel` ja seejärel `getPrepress`
värskenduse. Vea korral näita `t('step3split.modelFailed')`.

- [ ] **Step 5: Lisa katkestamisnupp sammu 4**

`UploadStepReview.tsx` — nupp koos rea-sisese kinnitusega (sama muster nagu
`batchConfirm` Manage-vaates), nähtav ainult siis, kui `status` on
`applying`/`processing`/`reviewing`/`error`. Õnnestumisel kutsub vanem
`wizard.setStep(3)` ja värskendab plaani.

- [ ] **Step 6: Käivita väravad ja commit**

```bash
npm run typecheck && npm test && npm run lint:ci
```

Expected: typecheck puhas; `localeParity.test.ts` roheline (kui kukub, on võti ainult
ühes keeles).

```bash
git add src/ && git commit -m "feat(upload): mudelivalik sammus 3 ja OCR-i katkestamine sammus 4"
```

---

### Task 9: ADR ja dokumentatsioon

**Files:**
- Create: `docs/decisions/0019-upload-ocr-katkestamine.md`
- Modify: `docs/decisions/0018-reocr-katkestamine.md` (paranda vale väide), `CLAUDE.md`

- [ ] **Step 1: Paranda ADR 0018 vale väide**

ADR 0018 ütleb, et lennusoleva batchi `.txt` „kaob koos kataloogiga". See on **vale** —
kirjutus kukutab OCR-teenuse. Asenda lõik viitega #225-le ja uuele mustrile (failid kohe,
kataloog reaperiga).

- [ ] **Step 2: Kirjuta ADR 0019**

`docs/decisions/0019-upload-ocr-katkestamine.md`, invariandid:

- katkestamine viib `awaiting_split`-i; plaan, lähtefail ja eelvaade säilivad
- **iga apply saab oma `run_id`**; kaugteed loetakse ALATI state'ist, mitte ei tuletata
- koristus kustutab **failid**, kataloogi eemaldab reaper armuaja järel (#225)
- `cancelling` on jätkatav olek; `cancelling_since` on persisteeritud
- taastamine nõuab **aega JA surnud lõime**
- `/model` kasutab sama lukku mis `try_begin_applying`; kaugteid ei kirjuta ümber
- ainult mudel on sammus 3 muudetav — muu metaandmestik on pärast importi redigeeritav

- [ ] **Step 3: Uuenda CLAUDE.md**

Upload-lõiku (`**Upload (admin, `/upload`)**`) lisa lause: OCR-jooksu saab katkestada
ilma poolitusplaani kaotamata; iga jooks saab oma kaug-run-id.

- [ ] **Step 4: Käivita kõik väravad ja commit**

```bash
.venv/bin/pytest tests/ -q && npm run typecheck && npm test && npm run lint:ci
git add -A && git commit -m "docs(adr): 0019 — upload'i OCR-i katkestamine"
```

---

## Self-Review

**Spec coverage:**

| Spekk | Task |
|---|---|
| #225 — failid kohe, kataloog reaperiga | Task 1 |
| Reaper, armuaeg 600 s, orbu ei jäeta | Task 1 |
| Run-isolatsioon (`run_id` igal apply'l) | Task 2 |
| Tahaühilduvus (teed state'ist) | Task 2 Step 4 + Global Constraints |
| `cancelling` CAS, jätkatav | Task 3 |
| `reset_ocr_run_state` + kuju-invariant | Task 3 |
| Apply-lõime `Event` + `join` | Task 3 |
| Endpoint + staatuste tabel + 503 | Task 4 |
| Poller: varajane väljumine JA ülekontroll | Task 5 |
| Taastamine: aeg JA surnud lõim | Task 6 |
| Taastamine proovib koristust uuesti | Task 6 test |
| `/model` sama luku all, TOCTOU | Task 7 |
| Frontend, kaks eristuvat nupusilti | Task 8 |
| ADR 0018 paranduse ja ADR 0019 | Task 9 |

**Placeholder-kontroll:** Task 8 sammud 4–5 kirjeldavad UI-d ilma täieliku JSX-ita —
teadlik, sest mõlemad järgivad koodibaasis juba olemasolevat mustrit (`batchConfirm`
rea-sisene kinnitus, `UploadStepSplit` paanid) ja täieliku JSX-i kordamine plaanis
lahkneks tegelikust komponendist. Iga samm nimetab faili, mustri ja tingimuse.

**Tüübi-järjepidevus:** `cleanup_run_files(sftp, remote_dir) -> bool` on sama Task 1-s,
7-s ja `_cleanup_upload_run`-is. `schedule_reap(remote_path, now=None)` /
`reap_due(rm_rf_func, now=None)` on samad Task 1 testides ja kutsekohtades.
`try_begin_cancel_ocr` / `reset_ocr_run_state` / `quiesce_apply` nimed on Task 3-s
defineeritud ja Task 4, 6 kasutavad täpselt neid.

## Enne käivitamist

**Tootmises jookseb praegu suur töö** (429 lehte, hand-mudel, algus 2026-08-08 17:59,
~83 s/lk → lõpp ~03:30). Taskide 1–9 kirjutamine, review ja merge on ohutud — need ei
puuduta LOSSi. **Elav katkestamise test tuleb teha alles siis, kui järjekord on tühi**,
sest tänane (parandamata) kood kukutab katkestamisel OCR-teenuse ja järjekord kaotaks
ühe batchi + mudeli laadimise aja.
