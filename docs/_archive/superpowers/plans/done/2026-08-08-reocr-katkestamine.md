# Re-OCR töö katkestamine — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab käimasoleva re-OCR töö (üksik või batch) katkestada nii, et seis on võimalikult lähedal seisule enne töö käivitamist ja teos vabaneb kohe lukust.

**Architecture:** Katkestamine on kaheastmeline CAS-üleminek (`aktiivne → cancelling → cancelled`), mis persisteeritakse enne koristust. Töö-põhine üleslaadimislõim peatatakse `threading.Event` + `join`-iga; jagatud poll-lõimi ei saa peatada, seega neid vaigistab sama CAS luku all. Tulemuste omand on jälgitav (`produced_pages`) ja ülekirjutatud `.ocr` failid varundatakse, et katkestamine ei hävitaks varasemat ootel tulemust.

**Tech Stack:** Python 3.9 (FastAPI, threading, paramiko SFTP), pytest; React 19 + TypeScript + i18next.

**Spekk:** `docs/superpowers/specs/2026-08-08-reocr-katkestamine-design.md`
**Issue:** #217 · **Haru:** `feat/reocr-katkestamine`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[dict]`, mitte `dict | None`.
- **Koodikommentaarid eesti keeles.**
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — kas sync `def` route või `run_in_threadpool`.
- **i18n:** uus võti läheb **mõlemasse keelde korraga** (`fallbackLng` väljas, ADR 0011), nimeruum `src/locales/{et,en}/`.
- **Uus endpoint läheb routerisse** (`server/routers/reocr.py`), MITTE `main.py`-sse.
- **Kõik prosopo-/reocr-teed tulevad `server/config.py`-st.**
- **Varukoopiad EI TOHI minna teose kausta:** `data/.gitignore` ignoreerib `*.ocr`, aga `*.ocr.bak.*` ei vastaks mustrile ja ilmuks `git status`-isse. Koht on `state/reocr_backups/{job_id}/`.
- **Väravad enne igat commitit:** `.venv/bin/pytest tests/ -q`. Frontendi taskides lisaks `npm run typecheck` ja `npm test`.

---

### Task 1: Tulemuse omand — `produced_pages` ja ülekirjutamise varundus

**Files:**
- Modify: `server/config.py` (uus konstant), `server/reocr_ops.py:73-79` (`_write_ocr_file`)
- Test: `tests/test_reocr_ownership.py` (uus)

**Interfaces:**
- Produces:
  - `config.REOCR_BACKUPS_DIR: str` — `state/reocr_backups`
  - `reocr_ops._backup_dir(job_id: str) -> str`
  - `reocr_ops._write_ocr_file(slug: str, page_filename: str, text: str, job_id: str) -> str` (**job_id on uus, kohustuslik**)
  - `reocr_ops._restore_backups(job_id: str) -> int` — tagastab taastatud failide arvu
  - `reocr_ops._drop_backups(job_id: str) -> None`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_ownership.py`:

```python
"""Re-OCR tulemuse omand: kes kirjutas, see kustutab (#217).

Plaanitud lehtede nimekiri EI OLE omandi tõend — katkestatud töö ei pruukinud
jõuda kõiki plaanitud lehti puutuda.
"""
import os

import pytest

from server import reocr_ops


@pytest.fixture
def work_dir(tmp_path, monkeypatch):
    """Teose kaust + eraldatud varukoopiate juur."""
    slug = "1650-test-abc123"
    d = tmp_path / slug
    d.mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    return slug, d


def test_kirjutamine_loob_ocr_faili(work_dir):
    slug, d = work_dir
    path = reocr_ops._write_ocr_file(slug, "001.jpg", "tekst", "job1")
    assert os.path.basename(path) == "001.ocr"
    assert open(path, encoding="utf-8").read() == "tekst"


def test_olemasolev_ocr_varundatakse_enne_ylekirjutamist(work_dir):
    """Vana ootel tulemus ei tohi jäljetult kaduda."""
    slug, d = work_dir
    (d / "017.ocr").write_text("VANA ootel tulemus", encoding="utf-8")

    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS tulemus", "job1")

    assert (d / "017.ocr").read_text(encoding="utf-8") == "UUS tulemus"
    backup = os.path.join(reocr_ops._backup_dir("job1"), "017.ocr")
    assert open(backup, encoding="utf-8").read() == "VANA ootel tulemus"


def test_varundust_ei_tehta_kui_faili_polnud(work_dir):
    slug, d = work_dir
    reocr_ops._write_ocr_file(slug, "002.jpg", "tekst", "job1")
    assert not os.path.exists(os.path.join(reocr_ops._backup_dir("job1"), "002.ocr"))


def test_taastamine_toob_vana_sisu_tagasi(work_dir):
    slug, d = work_dir
    (d / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "job1")

    restored = reocr_ops._restore_backups("job1")

    assert restored == 1
    assert (d / "017.ocr").read_text(encoding="utf-8") == "VANA"
    assert not os.path.isdir(reocr_ops._backup_dir("job1"))


def test_varukoopiate_kustutamine_ei_puutu_teose_faile(work_dir):
    slug, d = work_dir
    (d / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "job1")

    reocr_ops._drop_backups("job1")

    assert (d / "017.ocr").read_text(encoding="utf-8") == "UUS"
    assert not os.path.isdir(reocr_ops._backup_dir("job1"))


def test_varukoopia_tee_on_state_all_mitte_teose_kaustas(work_dir):
    """data/.gitignore ignoreerib *.ocr, aga mitte *.ocr.bak.* — varukoopia
    teose kaustas ilmuks git status'isse."""
    slug, d = work_dir
    assert "backups" in reocr_ops._backup_dir("job1")
    assert slug not in reocr_ops._backup_dir("job1")
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_ownership.py -v`
Expected: FAIL — `_write_ocr_file() takes 3 positional arguments but 4 were given` ja `AttributeError: _backup_dir`.

- [ ] **Step 3: Lisa konstant**

`server/config.py`, `USER_SETTINGS_DIR` / `NOTIFICATIONS_DIR` kõrvale:

```python
# Re-OCR ülekirjutatud .ocr tulemuste varukoopiad (katkestamisel taastatakse).
# EI TOHI olla teose kaustas: data/.gitignore ignoreerib *.ocr, aga varukoopia
# nimi ei vastaks mustrile ja ilmuks git status'isse (#217).
REOCR_BACKUPS_DIR = os.path.join(_STATE_DIR, "reocr_backups")
```

- [ ] **Step 4: Teosta varundusloogika**

`server/reocr_ops.py` — impordi konstant real 11 (`from .config import ...` nimekirja lisa `REOCR_BACKUPS_DIR`), seejärel asenda `_write_ocr_file`:

```python
def _backup_dir(job_id: str) -> str:
    """Selle töö ülekirjutatud .ocr failide varukoopiad."""
    return os.path.join(REOCR_BACKUPS_DIR, job_id)


def _write_ocr_file(slug: str, page_filename: str, text: str, job_id: str) -> str:
    """Kirjutab OCR-tulemuse {BASE_DIR}/{slug}/{stem}.ocr failina (püsiv staging).

    Kui sihtkohas on juba ootel tulemus, varundatakse see ENNE ülekirjutamist.
    Katkestamine taastab varukoopia — muidu hävitaks katkestatud töö varasema
    kehtiva tulemuse, mida ta ise ei tootnud (#217).
    """
    stem = os.path.splitext(os.path.basename(page_filename))[0]
    ocr_path = os.path.join(BASE_DIR, slug, stem + ".ocr")

    if os.path.exists(ocr_path):
        bdir = _backup_dir(job_id)
        os.makedirs(bdir, exist_ok=True)
        backup_path = os.path.join(bdir, stem + ".ocr")
        if not os.path.exists(backup_path):
            # Ainult ESIMENE ülekirjutus varundatakse — muidu kirjutaks sama töö
            # kordusjooks varukoopia enda tulemusega üle.
            shutil.copy2(ocr_path, backup_path)

    with open(ocr_path, "w", encoding="utf-8") as f:
        f.write(text)
    return ocr_path


def _restore_backups(job_id: str) -> int:
    """Taastab selle töö ülekirjutatud .ocr failid. Tagastab taastatud arvu."""
    bdir = _backup_dir(job_id)
    if not os.path.isdir(bdir):
        return 0
    restored = 0
    mapping = reocr_state.load_backup_targets(job_id)
    for name in os.listdir(bdir):
        target = mapping.get(name)
        if not target:
            logger.warning(f"Re-OCR {job_id}: varukoopial {name} puudub sihtkoht")
            continue
        try:
            shutil.move(os.path.join(bdir, name), target)
            restored += 1
        except OSError as e:
            logger.warning(f"Re-OCR {job_id}: varukoopia taaste {name}: {e}")
    shutil.rmtree(bdir, ignore_errors=True)
    reocr_state.remove_backup_targets(job_id)
    return restored


def _drop_backups(job_id: str) -> None:
    """Kustutab varukoopiad (töö lõppes normaalselt / rakendati / visati ära)."""
    shutil.rmtree(_backup_dir(job_id), ignore_errors=True)
    reocr_state.remove_backup_targets(job_id)
```

Lisa `import shutil` faili päisesse (`import os` kõrvale).

- [ ] **Step 5: Lisa sihtkohtade register `reocr_state.py`-sse**

Varukoopia failinimi (`017.ocr`) ei ütle, MILLISE teose kausta ta kuulub — taastamine vajab
täisteed. `server/reocr_state.py`, `persist_batch_mapping` kõrvale:

```python
BACKUP_TARGETS_DIR = os.path.join(STATE_DIR, "reocr_backup_targets")


def _backup_targets_path(job_id: str) -> str:
    return os.path.join(BACKUP_TARGETS_DIR, f"{job_id}.json")


def add_backup_target(job_id: str, backup_name: str, target_path: str) -> None:
    """Seob varukoopia failinime tema teose-kausta sihtteega. Atomaarne."""
    with _file_lock:
        os.makedirs(BACKUP_TARGETS_DIR, exist_ok=True)
        path = _backup_targets_path(job_id)
        data = {}
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    data = json.load(f)
            except (OSError, ValueError):
                data = {}
        data[backup_name] = target_path
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)


def load_backup_targets(job_id: str) -> dict:
    """Varukoopia nimi → sihttee. Puuduv fail = tühi dict."""
    with _file_lock:
        try:
            with open(_backup_targets_path(job_id), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}


def remove_backup_targets(job_id: str) -> None:
    with _file_lock:
        try:
            os.remove(_backup_targets_path(job_id))
        except FileNotFoundError:
            pass
```

Kutsu `add_backup_target` `_write_ocr_file`-is kohe pärast `shutil.copy2` rida:

```python
            reocr_state.add_backup_target(job_id, stem + ".ocr", ocr_path)
```

- [ ] **Step 6: Käivita testid**

Run: `.venv/bin/pytest tests/test_reocr_ownership.py -v`
Expected: 6 passed

Run: `.venv/bin/pytest tests/ -q`
Expected: FAIL kahes kohas — `_write_ocr_file` kutsutakse veel kolme argumendiga
(`server/reocr_ops.py` batch-poll ja üksik-poll). Paranda mõlemad kutsed:

```python
                _write_ocr_file(slug, entry["page_filename"], text, job_id)
```

ja üksiku poolel (`~rida 745`):

```python
                    ocr_path = _write_ocr_file(j["slug"], j["page_filename"], text, jid)
```

Seejärel `.venv/bin/pytest tests/ -q` → kõik roheline.

- [ ] **Step 7: Commit**

```bash
git add server/config.py server/reocr_ops.py server/reocr_state.py tests/test_reocr_ownership.py
git commit -m "feat(reocr): varunda ülekirjutatud .ocr tulemus (#217)

Ettevalmistus katkestamiseks: katkestatud töö ei tohi hävitada varasemat ootel
tulemust, mida ta ise ei tootnud. _write_ocr_file varundab olemasoleva faili
state/reocr_backups/{job_id}/ alla ja reocr_state hoiab sihtteede registrit.

Varukoopia EI või minna teose kausta: data/.gitignore ignoreerib *.ocr, aga
varukoopia nimi ei vastaks mustrile ja ilmuks git status'isse."
```

---

### Task 2: `produced_pages` — mida see töö päriselt tootis

**Files:**
- Modify: `server/reocr_ops.py` (batch-poll ~rida 293, üksik-poll ~rida 745, töö loomine ~read 183 ja 613)
- Test: `tests/test_reocr_ownership.py` (lisandub)

**Interfaces:**
- Produces: töö kirjes võti `produced_pages: List[str]` — **stem'id**, mille `.ocr` see töö kirjutas. Katkestamine (Task 4) kustutab AINULT need.

- [ ] **Step 1: Kirjuta kukkuv test**

Lisa `tests/test_reocr_ownership.py` lõppu:

```python
def test_produced_pages_taidetakse_kirjutamise_hetkel(work_dir, monkeypatch):
    """Loend peab kasvama siis, kui .ocr PÄRISELT kirjutatakse — mitte tööd
    käivitades. Plaanitud ≠ toodetud."""
    slug, d = work_dir
    job = {"produced_pages": []}

    reocr_ops._record_produced(job, "017.jpg")
    reocr_ops._record_produced(job, "018.jpg")
    reocr_ops._record_produced(job, "017.jpg")   # kordus ei tohi duplitseerida

    assert job["produced_pages"] == ["017", "018"]


def test_uus_too_algab_tuhja_produced_pages_iga():
    job = {}
    reocr_ops._record_produced(job, "001.jpg")
    assert job["produced_pages"] == ["001"]
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_ownership.py -k produced -v`
Expected: FAIL — `AttributeError: module 'server.reocr_ops' has no attribute '_record_produced'`

- [ ] **Step 3: Teosta**

`server/reocr_ops.py`, `_write_ocr_file` kõrvale:

```python
def _record_produced(job: dict, page_filename: str) -> None:
    """Märgib, et SEE töö kirjutas selle lehe .ocr faili.

    Katkestamine kustutab ainult siit loendist tulevad lehed. Plaanitud lehtede
    nimekiri (batch mapping) EI OLE omandi tõend — töö võib olla katkestatud
    enne, kui ta plaani lõpuni jõudis (#217).
    """
    stem = os.path.splitext(os.path.basename(page_filename))[0]
    produced = job.setdefault("produced_pages", [])
    if stem not in produced:
        produced.append(stem)
```

- [ ] **Step 4: Kutsu seda mõlemal kirjutamisteel**

Batch-poll (`_poll_batch_job`, kohe pärast `_write_ocr_file` õnnestumist, sama
`with _reocr_batch_jobs_lock:` ploki sees, kus `cur_entry["status"] = "ready"`):

```python
                        _record_produced(current, entry["page_filename"])
```

Üksik-poll (`_poll_iteration`, samas kohas kus `.ocr` kirjutatakse ja `j["status"]`
muudetakse):

```python
                    _record_produced(j, j["page_filename"])
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/reocr_ops.py tests/test_reocr_ownership.py
git commit -m "feat(reocr): jälgi, millised lehed töö päriselt tootis (#217)

produced_pages täidetakse .ocr kirjutamise hetkel, mitte tööd käivitades.
Katkestamine kustutab ainult need — plaanitud lehtede nimekiri ei ole omandi
tõend, sest töö võidi katkestada enne plaani lõppu."
```

---

### Task 3: `cancelling` olek ja vastastikku välistavad terminalüleminekud

**Files:**
- Modify: `server/reocr_ops.py` (uus funktsioon + poll-valvurid)
- Test: `tests/test_reocr_cancel_state.py` (uus)

**Interfaces:**
- Produces:
  - `reocr_ops.CANCELLABLE_STATUSES: tuple` — `("uploading", "processing", "slow")`
  - `reocr_ops._try_begin_cancel(job_id: str) -> Optional[str]` — CAS `aktiivne → cancelling`. Tagastab `"single"` / `"batch"` (kumb register) või `None`, kui ei õnnestunud (töö puudub, on juba terminalis või juba `cancelling`).

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_cancel_state.py`:

```python
"""Katkestamise olekumasin: aktiivne → cancelling → cancelled (#217).

Terminalüleminekud peavad olema vastastikku välistavad — vastasel juhul võib
poller märkida töö `done`-ks samal ajal kui DELETE märgib `cancelled`.
"""
import threading

import pytest

from server import reocr_ops


@pytest.fixture(autouse=True)
def puhas_register(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_reocr_jobs", {})
    monkeypatch.setattr(reocr_ops, "_reocr_batch_jobs", {})
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)


def test_aktiivne_too_laheb_cancelling_olekusse():
    reocr_ops._reocr_jobs["j1"] = {"status": "processing"}
    assert reocr_ops._try_begin_cancel("j1") == "single"
    assert reocr_ops._reocr_jobs["j1"]["status"] == "cancelling"


def test_batch_register_leitakse_sama_endpointiga():
    reocr_ops._reocr_batch_jobs["b1"] = {"status": "uploading"}
    assert reocr_ops._try_begin_cancel("b1") == "batch"
    assert reocr_ops._reocr_batch_jobs["b1"]["status"] == "cancelling"


def test_slow_too_on_katkestatav():
    reocr_ops._reocr_jobs["j1"] = {"status": "slow"}
    assert reocr_ops._try_begin_cancel("j1") == "single"


@pytest.mark.parametrize("status", ["done", "error", "cancelling"])
def test_terminal_ja_juba_katkestatav_too_ei_alga_uuesti(status):
    reocr_ops._reocr_jobs["j1"] = {"status": status}
    assert reocr_ops._try_begin_cancel("j1") is None
    assert reocr_ops._reocr_jobs["j1"]["status"] == status


def test_tundmatu_id_annab_none():
    assert reocr_ops._try_begin_cancel("puudub") is None


def test_sama_id_moelmas_registris_on_invariandi_rikkumine():
    """job_id nimeruum on registrite vahel globaalne (sama generate_nanoid)."""
    reocr_ops._reocr_jobs["x"] = {"status": "processing"}
    reocr_ops._reocr_batch_jobs["x"] = {"status": "processing"}
    with pytest.raises(RuntimeError):
        reocr_ops._try_begin_cancel("x")


def test_ainult_uks_lõim_voidab_CAS_i():
    """20 lõime üritavad korraga katkestada — täpselt üks saab loa."""
    reocr_ops._reocr_jobs["j1"] = {"status": "processing"}
    voitjad = []
    lukk = threading.Lock()

    def proovi():
        r = reocr_ops._try_begin_cancel("j1")
        if r:
            with lukk:
                voitjad.append(r)

    threads = [threading.Thread(target=proovi) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(voitjad) == 1
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_cancel_state.py -v`
Expected: FAIL — `AttributeError: _try_begin_cancel`

- [ ] **Step 3: Teosta CAS**

`server/reocr_ops.py`, `_persist_active_jobs` järele:

```python
CANCELLABLE_STATUSES = ("uploading", "processing", "slow")


def _try_begin_cancel(job_id: str) -> Optional[str]:
    """CAS: aktiivne → cancelling. Tagastab "single"/"batch" või None.

    See on ainus koht, kus katkestamine algab. `cancelling` on vaheolek, mis
    vastab küsimusele „kes võitis": poller ei tohi pärast seda enam ühtki
    tulemust kirjutada ega tööd `done`-ks märkida (#217).
    """
    in_single = job_id in _reocr_jobs
    in_batch = job_id in _reocr_batch_jobs
    if in_single and in_batch:
        # job_id nimeruum on registrite vahel globaalne — sama generate_nanoid().
        # Kokkulangevus on invariandi rikkumine; ära arva, kumb oli mõeldud.
        raise RuntimeError(f"job_id {job_id} esineb mõlemas registris")

    if in_single:
        with _reocr_jobs_lock:
            job = _reocr_jobs.get(job_id)
            if not job or job.get("status") not in CANCELLABLE_STATUSES:
                return None
            job["status"] = "cancelling"
        _persist_active_jobs()
        return "single"

    if in_batch:
        with _reocr_batch_jobs_lock:
            job = _reocr_batch_jobs.get(job_id)
            if not job or job.get("status") not in CANCELLABLE_STATUSES:
                return None
            job["status"] = "cancelling"
        _persist_active_jobs()
        return "batch"

    return None
```

- [ ] **Step 4: Vaigista poll-lõimed sama CAS-iga**

Poll on **jagatud singleton-lõim** — teda ei saa peatada. Selle asemel peab iga
tulemuse kirjutamine kontrollima olekut luku all.

`_poll_batch_job` alguses on juba kontroll `job["status"] != "processing"` → see katab
`cancelling` juhtumi automaatselt. **Aga** allalaadimise ja kirjutamise vahel võib olek
muutuda, seega lisa `_write_ocr_file` kutse ette (batch-poll, `for entry in pending:`
tsüklis, kohe pärast `if text is None: continue`):

```python
            # Olek võis vahepeal muutuda (DELETE käib teises lõimes). Kirjutamine
            # pärast `cancelling` algust jätaks ghost-tulemuse pärast koristust.
            with _reocr_batch_jobs_lock:
                cur = _reocr_batch_jobs.get(job_id)
                if not cur or cur.get("status") != "processing":
                    return
```

Sama kontroll üksik-polli kirjutamiskohta (`_poll_iteration`), `_write_ocr_file` ette:

```python
                with _reocr_jobs_lock:
                    cur = _reocr_jobs.get(jid)
                    if not cur or cur.get("status") != "processing":
                        continue
```

- [ ] **Step 5: Kirjuta võistlustest**

Lisa `tests/test_reocr_cancel_state.py` lõppu:

```python
def test_katkestamine_ja_done_ei_saa_moelmad_voita():
    """Poller tahab `done`, DELETE tahab `cancelling` — täpselt üks võidab."""
    reocr_ops._reocr_jobs["j1"] = {"status": "processing"}
    tulemused = []
    start = threading.Barrier(2)

    def katkesta():
        start.wait()
        tulemused.append(("cancel", reocr_ops._try_begin_cancel("j1")))

    def lopeta():
        start.wait()
        with reocr_ops._reocr_jobs_lock:
            job = reocr_ops._reocr_jobs.get("j1")
            ok = bool(job) and job.get("status") == "processing"
            if ok:
                job["status"] = "done"
        tulemused.append(("done", ok))

    t1, t2 = threading.Thread(target=katkesta), threading.Thread(target=lopeta)
    t1.start(); t2.start(); t1.join(); t2.join()

    lopp = reocr_ops._reocr_jobs["j1"]["status"]
    assert lopp in ("cancelling", "done")
    edukad = [nimi for nimi, ok in tulemused if ok]
    assert len(edukad) == 1, "täpselt üks terminalüleminek peab õnnestuma"
```

- [ ] **Step 6: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/test_reocr_cancel_state.py tests/ -q`
Expected: kõik roheline.

```bash
git add server/reocr_ops.py tests/test_reocr_cancel_state.py
git commit -m "feat(reocr): cancelling-vaheolek ja välistavad terminalüleminekud (#217)

_try_begin_cancel on CAS aktiivne → cancelling. Poll-lõimed on JAGATUD
singletonid, mida ei saa peatada — nad vaigistatakse sama luku all tehtava
olekukontrolliga enne iga .ocr kirjutamist."
```

---

### Task 4: Üleslaadimislõime peatamine (`Event` + `join`)

**Files:**
- Modify: `server/reocr_ops.py` (`_upload()` mõlemas käivitajas, uus register)
- Test: `tests/test_reocr_cancel_worker.py` (uus)

**Interfaces:**
- Produces:
  - `reocr_ops._cancel_events: Dict[str, threading.Event]`
  - `reocr_ops._upload_threads: Dict[str, threading.Thread]`
  - `reocr_ops._quiesce_upload(job_id: str, timeout: float = 30.0) -> bool` — `True`, kui lõim on lõpetanud

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_cancel_worker.py`:

```python
"""Üleslaadimislõime peatamine enne kaugkoristust (#217).

Koostööline lipp üksi ei piisa: lipu seadmine ei tähenda, et lõim on lõpetanud.
Kui koristus algab enne lõime väljumist, kirjutab pooleliolev sftp.put() pildid
tagasi kataloogi, mille just eemaldasime.
"""
import threading
import time

import pytest

from server import reocr_ops


@pytest.fixture(autouse=True)
def puhas(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_cancel_events", {})
    monkeypatch.setattr(reocr_ops, "_upload_threads", {})


def test_quiesce_ootab_loime_lopetamiseni():
    laetud = []
    ev = threading.Event()
    reocr_ops._cancel_events["j1"] = ev

    def upload():
        for i in range(100):
            if ev.is_set():
                return
            laetud.append(i)
            time.sleep(0.01)

    t = threading.Thread(target=upload)
    reocr_ops._upload_threads["j1"] = t
    t.start()
    time.sleep(0.05)

    assert reocr_ops._quiesce_upload("j1", timeout=5.0) is True
    assert not t.is_alive(), "lõim peab olema lõpetanud ENNE tagastamist"
    enne = len(laetud)
    time.sleep(0.05)
    assert len(laetud) == enne, "lõim ei tohi pärast quiesce'i midagi juurde teha"


def test_quiesce_annab_false_kui_loim_ei_peatu():
    """Ajalõpp: koristust EI TOHI alustada, kui kirjutaja on veel elus."""
    ev = threading.Event()
    reocr_ops._cancel_events["j1"] = ev
    stop = threading.Event()

    t = threading.Thread(target=lambda: stop.wait(10), daemon=True)
    reocr_ops._upload_threads["j1"] = t
    t.start()

    assert reocr_ops._quiesce_upload("j1", timeout=0.2) is False
    stop.set()


def test_quiesce_tundmatu_too_on_ohutu():
    """Lõim võis juba lõppeda — see ei ole viga."""
    assert reocr_ops._quiesce_upload("puudub", timeout=0.1) is True
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_cancel_worker.py -v`
Expected: FAIL — `AttributeError: _cancel_events`

- [ ] **Step 3: Teosta**

`server/reocr_ops.py`, `_try_begin_cancel` kõrvale:

```python
# Töö-põhised katkestuslipud ja üleslaadimislõimed. Poll-lõimi siin EI OLE —
# need on jagatud singletonid ja neid vaigistab CAS (vt _try_begin_cancel).
_cancel_events: Dict[str, threading.Event] = {}
_upload_threads: Dict[str, threading.Thread] = {}


def _cancel_event(job_id: str) -> threading.Event:
    """Töö katkestuslipp (loob vajadusel)."""
    ev = _cancel_events.get(job_id)
    if ev is None:
        ev = threading.Event()
        _cancel_events[job_id] = ev
    return ev


def _quiesce_upload(job_id: str, timeout: float = 30.0) -> bool:
    """Seab katkestuslipu ja OOTAB üleslaadimislõime lõpetamist.

    Tagastab False, kui lõim ei peatunud. Sel juhul EI TOHI kaugkoristust teha:
    pooleliolev sftp.put() kirjutaks pildid tagasi kataloogi, mille kustutasime.
    Jääk kaugserveris on parem kui võistlus.
    """
    _cancel_event(job_id).set()
    t = _upload_threads.get(job_id)
    if t is None or not t.is_alive():
        return True
    t.join(timeout)
    return not t.is_alive()


def _forget_cancel_state(job_id: str) -> None:
    """Koristab katkestamise abistruktuurid."""
    _cancel_events.pop(job_id, None)
    _upload_threads.pop(job_id, None)
```

- [ ] **Step 4: Ühenda lipp üleslaadimistsüklitesse**

Batch (`start_reocr_batch._upload`), `for entry in page_entries:` tsükli algusesse:

```python
            for entry in page_entries:
                if _cancel_event(job_id).is_set():
                    logger.info(f"Re-OCR batch {job_id}: üleslaadimine katkestatud")
                    return
```

Üksik (`start_reocr._upload`), kohe pärast `sftp = _sftp_open(job_id)`:

```python
            if _cancel_event(job_id).is_set():
                logger.info(f"Re-OCR {job_id}: üleslaadimine katkestatud")
                return
```

Mõlemas käivitajas asenda lõime start nii, et lõim jääks registrisse. Batch (rida ~234):

```python
    _t = threading.Thread(target=_upload, daemon=True, name=f"reocr-batch-{job_id}")
    _upload_threads[job_id] = _t
    _t.start()
```

Üksik (rida ~675):

```python
    _t = threading.Thread(target=_upload, daemon=True, name=f"reocr-{job_id}")
    _upload_threads[job_id] = _t
    _t.start()
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/reocr_ops.py tests/test_reocr_cancel_worker.py
git commit -m "feat(reocr): peata üleslaadimislõim enne koristust (#217)

_quiesce_upload seab lipu JA ootab lõime lõpetamist. Ajalõpu korral tagastab
False — koristust ei tohi siis alustada, sest pooleliolev sftp.put() kirjutaks
pildid tagasi kustutatud kataloogi."
```

---

### Task 5: `cancel_reocr_job()` — koristuse orkestreerimine

**Files:**
- Modify: `server/reocr_ops.py` (uus avalik funktsioon), `server/reocr_ops.py:22-40` (`_append_to_log`)
- Test: `tests/test_reocr_cancel.py` (uus)

**Interfaces:**
- Consumes: `_try_begin_cancel`, `_quiesce_upload`, `_restore_backups`, `_drop_backups`, `_record_produced` (Task 1–4)
- Produces: `reocr_ops.cancel_reocr_job(job_id: str) -> dict` — `{"status": "cancelled", "remote_cleanup": "ok"|"failed", "deleted_ocr": int, "restored_ocr": int}`. Tõstab `KeyError` tundmatu töö korral ja `ValueError`, kui töö ei ole katkestatav.

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_cancel.py`:

```python
"""cancel_reocr_job: „tööd ei olnud" semantika (#217)."""
import os

import pytest

from server import reocr_ops


@pytest.fixture
def keskkond(tmp_path, monkeypatch):
    slug = "1650-test-abc123"
    work = tmp_path / slug
    work.mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(reocr_ops, "_reocr_jobs", {})
    monkeypatch.setattr(reocr_ops, "_reocr_batch_jobs", {})
    monkeypatch.setattr(reocr_ops, "_cancel_events", {})
    monkeypatch.setattr(reocr_ops, "_upload_threads", {})
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: None)
    monkeypatch.setattr(reocr_ops.reocr_state, "remove_batch_mapping", lambda jid: None)
    koristatud = []
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job",
                        lambda jid, job: koristatud.append(jid) or True)
    return slug, work, koristatud


def test_kustutab_ainult_toodetud_lehed(keskkond):
    """REGRESSIOON: plaanitud lehtede järgi kustutamine hävitaks varasema
    ootel tulemuse lehel, mida katkestatud töö ei puutunud."""
    slug, work, _ = keskkond
    (work / "001.ocr").write_text("selle töö tulemus", encoding="utf-8")
    (work / "017.ocr").write_text("VARASEM ootel tulemus", encoding="utf-8")
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug,
        "produced_pages": ["001"],           # 017 EI OLE siin
        "pages": [{"page_filename": "001.jpg"}, {"page_filename": "017.jpg"}],
    }

    result = reocr_ops.cancel_reocr_job("b1")

    assert result["deleted_ocr"] == 1
    assert not (work / "001.ocr").exists()
    assert (work / "017.ocr").read_text(encoding="utf-8") == "VARASEM ootel tulemus"


def test_taastab_ylekirjutatud_tulemuse(keskkond):
    slug, work, _ = keskkond
    (work / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "b1")
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": ["017"], "pages": [],
    }

    result = reocr_ops.cancel_reocr_job("b1")

    assert result["restored_ocr"] == 1
    assert (work / "017.ocr").read_text(encoding="utf-8") == "VANA"


def test_eemaldab_too_registrist(keskkond):
    slug, _work, _ = keskkond
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": [], "pages": [],
    }
    reocr_ops.cancel_reocr_job("b1")
    assert "b1" not in reocr_ops._reocr_batch_jobs


def test_sftp_torge_ei_takista_lokaalset_katkestamist(keskkond, monkeypatch):
    """Intsidendi kuju: VUTT rippus, LOSS oli edasi läinud."""
    slug, _work, _ = keskkond
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: False)
    reocr_ops._reocr_batch_jobs["b1"] = {
        "status": "processing", "slug": slug, "produced_pages": [], "pages": [],
    }

    result = reocr_ops.cancel_reocr_job("b1")

    assert result["status"] == "cancelled"
    assert result["remote_cleanup"] == "failed"
    assert "b1" not in reocr_ops._reocr_batch_jobs


def test_valmis_too_ei_ole_katkestatav(keskkond):
    slug, _work, _ = keskkond
    reocr_ops._reocr_jobs["j1"] = {"status": "done", "slug": slug}
    with pytest.raises(ValueError):
        reocr_ops.cancel_reocr_job("j1")


def test_tundmatu_too_annab_keyerror(keskkond):
    with pytest.raises(KeyError):
        reocr_ops.cancel_reocr_job("puudub")
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_cancel.py -v`
Expected: FAIL — `AttributeError: cancel_reocr_job`

- [ ] **Step 3: Teosta kaugkoristus**

`server/reocr_ops.py`:

```python
def _cleanup_remote_job(job_id: str, job: dict) -> bool:
    """Kustutab OCR-serverist selle töö pildid ja .txt-d. True = õnnestus.

    Piltide kustutamine ON peatamismehhanism: process_batch väljub enne mudeli
    kutsumist, kui ükski pilt ei avane. Kuni üks lennusolev batch (BATCH_SIZE=4)
    jõuab siiski lõpuni — see on teadlik piir, vt spekki.
    """
    remote_work = job.get("remote_work")
    if not remote_work:
        return True
    try:
        sftp = _sftp_open(job_id)
    except Exception as e:
        logger.warning(f"Re-OCR {job_id} koristuse SFTP viga: {e}")
        return False

    work_abs = f"{OCR_SERVER_PATH}/{remote_work}"
    ok = True
    try:
        try:
            for name in sftp.listdir(work_abs):
                try:
                    sftp.remove(f"{work_abs}/{name}")
                except Exception as e:
                    logger.warning(f"Re-OCR {job_id} {name} kustutus: {e}")
                    ok = False
        except FileNotFoundError:
            pass          # kaust on juba kadunud — intsidendi kuju, mitte viga
        for d in (work_abs, f"{OCR_SERVER_PATH}/{job.get('remote_staging', '')}"):
            try:
                sftp.rmdir(d)
            except Exception:
                pass      # mitte-tühi või puuduv kaust ei ole katkestamise viga
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        close_ssh(job_id)
    return ok
```

- [ ] **Step 4: Teosta orkestreerimine**

```python
def cancel_reocr_job(job_id: str) -> dict:
    """Katkestab re-OCR töö. „Tööd ei olnud" — vt spekki.

    Järjekord ei ole vaba: koristus tohib alata alles siis, kui ühtki kirjutajat
    enam ei ole. Vastasel juhul kirjutab pooleliolev üleslaadimine failid tagasi
    kataloogi, mille just eemaldasime.
    """
    registry = _try_begin_cancel(job_id)
    if registry is None:
        if job_id in _reocr_jobs or job_id in _reocr_batch_jobs:
            raise ValueError("Töö ei ole katkestatav")
        raise KeyError(job_id)

    jobs = _reocr_jobs if registry == "single" else _reocr_batch_jobs
    lock = _reocr_jobs_lock if registry == "single" else _reocr_batch_jobs_lock
    with lock:
        job = dict(jobs.get(job_id) or {})

    if not _quiesce_upload(job_id):
        # Kirjutaja on veel elus — jäta töö `cancelling` olekusse, taaste korjab
        # üles. Jääk kaugserveris on parem kui võistlus koristusega.
        logger.error(f"Re-OCR {job_id}: üleslaadimislõim ei peatunud, koristus edasi lükatud")
        raise RuntimeError("Üleslaadimislõim ei peatunud")

    remote_ok = _cleanup_remote_job(job_id, job)

    slug = job.get("slug") or ""
    deleted = 0
    for stem in job.get("produced_pages", []):
        path = os.path.join(BASE_DIR, slug, stem + ".ocr")
        try:
            os.unlink(path)
            deleted += 1
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning(f"Re-OCR {job_id} {stem}.ocr kustutus: {e}")
    restored = _restore_backups(job_id)

    with lock:
        current = jobs.pop(job_id, None)
    if current is not None:
        current["status"] = "cancelled"
        current["finished_at"] = datetime.now().timestamp()
        current["remote_cleanup"] = "ok" if remote_ok else "failed"
        _append_to_log(current, job_id)

    reocr_state.remove_batch_mapping(job_id)
    _forget_cancel_state(job_id)
    _persist_active_jobs()

    logger.info(
        f"Re-OCR {job_id} katkestatud: {deleted} .ocr kustutatud, "
        f"{restored} taastatud, kaugkoristus={'ok' if remote_ok else 'failed'}"
    )
    return {
        "status": "cancelled",
        "remote_cleanup": "ok" if remote_ok else "failed",
        "deleted_ocr": deleted,
        "restored_ocr": restored,
    }
```

- [ ] **Step 5: Lisa `remote_cleanup` logikirjesse**

`_append_to_log` (rida ~35), laienda kopeeritavate võtmete tsüklit:

```python
    for _k in ("recovered", "original_status", "recovered_at", "remote_cleanup"):
```

- [ ] **Step 6: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/reocr_ops.py tests/test_reocr_cancel.py
git commit -m "feat(reocr): cancel_reocr_job — koristus õiges järjekorras (#217)

Kustutab AINULT produced_pages lehed ja taastab ülekirjutatud varukoopiad.
SFTP tõrge ei takista lokaalset katkestamist — logikirjesse jääb
remote_cleanup: failed, sest 200 garanteerib ainult VUTT-i poole."
```

---

### Task 6: `DELETE /admin/reocr/{job_id}`

**Files:**
- Modify: `server/routers/reocr.py` (lõppu)
- Test: `tests/test_reocr_cancel_endpoint.py` (uus)

**Interfaces:**
- Consumes: `reocr_ops.cancel_reocr_job(job_id) -> dict`
- Produces: `DELETE /admin/reocr/{job_id}` → 200 `{"status": "cancelled", ...}`, 409, 404

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_cancel_endpoint.py`:

```python
"""DELETE /admin/reocr/{job_id} (#217)."""
import pytest

from server import reocr_ops


def test_katkestamine_annab_200(client_admin_reocr, monkeypatch):
    client, headers = client_admin_reocr
    monkeypatch.setattr(reocr_ops, "cancel_reocr_job",
                        lambda jid: {"status": "cancelled", "remote_cleanup": "ok",
                                     "deleted_ocr": 2, "restored_ocr": 1})
    r = client.delete("/admin/reocr/abc123", headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"
    assert r.json()["deleted_ocr"] == 2


def test_valmis_too_annab_409(client_admin_reocr, monkeypatch):
    client, headers = client_admin_reocr

    def _raise(jid):
        raise ValueError("Töö ei ole katkestatav")

    monkeypatch.setattr(reocr_ops, "cancel_reocr_job", _raise)
    assert client.delete("/admin/reocr/abc123", headers=headers).status_code == 409


def test_tundmatu_too_annab_404(client_admin_reocr, monkeypatch):
    client, headers = client_admin_reocr

    def _raise(jid):
        raise KeyError(jid)

    monkeypatch.setattr(reocr_ops, "cancel_reocr_job", _raise)
    assert client.delete("/admin/reocr/abc123", headers=headers).status_code == 404


def test_korduv_katkestamine_annab_404(client_admin_reocr, monkeypatch):
    """Töö on aktiivregistrist kadunud — katkestamine EI OLE idempotentne."""
    client, headers = client_admin_reocr
    kutsutud = []

    def _once(jid):
        if kutsutud:
            raise KeyError(jid)
        kutsutud.append(jid)
        return {"status": "cancelled", "remote_cleanup": "ok",
                "deleted_ocr": 0, "restored_ocr": 0}

    monkeypatch.setattr(reocr_ops, "cancel_reocr_job", _once)
    assert client.delete("/admin/reocr/abc123", headers=headers).status_code == 200
    assert client.delete("/admin/reocr/abc123", headers=headers).status_code == 404


def test_editor_ei_paase_ligi(client_admin_reocr, login_editor):
    client, _headers = client_admin_reocr
    r = client.delete("/admin/reocr/abc123",
                      headers={"Authorization": f"Bearer {login_editor}"})
    assert r.status_code in (401, 403)


def test_tee_on_admin_all():
    """nginx proksib /api/files/ kaudu KÕIK backend-teed avalikult."""
    from server.routers import reocr as reocr_router
    teed = [r.path for r in reocr_router.router.routes if "reocr" in r.path]
    assert all(p.startswith("/admin/") for p in teed), teed
```

Fixture'id `client_admin_reocr` ja `login_editor` võta olemasolevast
`tests/test_reocr_router.py`-st (sama muster) või `tests/conftest.py`-st, kui need on seal
juba olemas — ära kirjuta uut auth-seadistust.

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_cancel_endpoint.py -v`
Expected: FAIL — 405 Method Not Allowed (endpointi pole).

- [ ] **Step 3: Teosta endpoint**

`server/routers/reocr.py` lõppu:

```python
@router.delete("/admin/reocr/{job_id}")
def admin_reocr_cancel(job_id: str, user=Depends(require_role("admin"))):
    """Katkestab re-OCR töö (üksik või batch).

    Sync def — kogu töö on blokeeriv I/O (SFTP + failisüsteem), ADR 0002.

    200 garanteerib VUTT-i poole katkestamise: pollimist ei ole, teose lukk on
    vaba, tulemust ei rakendata. Kui LOSSi koristus ebaõnnestus, võib
    kaugserveris jääk edasi eksisteerida — vastuses `remote_cleanup: "failed"`.
    """
    try:
        return reocr_ops.cancel_reocr_job(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Tööd ei leitud")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
```

Kontrolli, et failis on `from fastapi import HTTPException` ja `from .. import reocr_ops`
(või vastav import) juba olemas; kui `reocr_ops` imporditakse funktsioonide kaupa, lisa
mooduli import.

- [ ] **Step 4: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/routers/reocr.py tests/test_reocr_cancel_endpoint.py
git commit -m "feat(reocr): DELETE /admin/reocr/{job_id} (#217)

409 = ei ole katkestatav, 404 = tundmatu (ka korduv kutse), 503 = kirjutaja ei
peatunud. Korduv DELETE ei ole idempotentne; ajalugu elab reocr_log.json-is."
```

---

### Task 7: Krahhikindlus — `cancelling` töö lõpetatakse pärast restarti

**Files:**
- Modify: `server/reocr_ops.py:796` (`_startup_recovery_and_reaper`)
- Test: `tests/test_reocr_cancel_recovery.py` (uus)

**Interfaces:**
- Consumes: `cancel_reocr_job`, `_cleanup_remote_job`
- Produces: `reocr_ops._finish_interrupted_cancellations(jobs: dict) -> int` — mitu tööd lõpetati

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_cancel_recovery.py`:

```python
"""Pooleli jäänud katkestamine ei tohi restardi järel tööks tagasi muutuda (#217)."""
import pytest

from server import reocr_ops


@pytest.fixture(autouse=True)
def puhas(monkeypatch, tmp_path):
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: None)
    monkeypatch.setattr(reocr_ops.reocr_state, "remove_batch_mapping", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: True)


def test_cancelling_too_lopetatakse():
    jobs = {"b1": {"status": "cancelling", "slug": "s", "produced_pages": []}}
    lopetatud = reocr_ops._finish_interrupted_cancellations(jobs)
    assert lopetatud == 1
    assert "b1" not in jobs


def test_aktiivseid_toid_ei_puututa():
    jobs = {"b1": {"status": "processing", "slug": "s"}}
    assert reocr_ops._finish_interrupted_cancellations(jobs) == 0
    assert "b1" in jobs


def test_koristuse_torge_ei_jata_tood_aktiivseks(monkeypatch):
    """Isegi kui kaugkoristus ebaõnnestub, ei tohi töö jääda teost lukustama."""
    monkeypatch.setattr(reocr_ops, "_cleanup_remote_job", lambda jid, job: False)
    jobs = {"b1": {"status": "cancelling", "slug": "s", "produced_pages": []}}
    assert reocr_ops._finish_interrupted_cancellations(jobs) == 1
    assert "b1" not in jobs
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_reocr_cancel_recovery.py -v`
Expected: FAIL — `AttributeError: _finish_interrupted_cancellations`

- [ ] **Step 3: Teosta**

`server/reocr_ops.py`:

```python
def _finish_interrupted_cancellations(jobs: dict) -> int:
    """Lõpetab `cancelling` olekusse jäänud tööd (protsess suri koristuse ajal).

    `cancelling` töö EI OLE aktiivne töö — ilma selleta jääks pooleli katkestatud
    töö restardi järel teost lukustama, mis on täpselt see probleem, mille vastu
    kogu see feature tehakse (#217).
    """
    lopetatud = 0
    for job_id in [k for k, v in jobs.items() if v.get("status") == "cancelling"]:
        job = jobs[job_id]
        remote_ok = _cleanup_remote_job(job_id, job)
        slug = job.get("slug") or ""
        for stem in job.get("produced_pages", []):
            try:
                os.unlink(os.path.join(BASE_DIR, slug, stem + ".ocr"))
            except OSError:
                pass
        _restore_backups(job_id)
        job["status"] = "cancelled"
        job["remote_cleanup"] = "ok" if remote_ok else "failed"
        _append_to_log(job, job_id)
        jobs.pop(job_id, None)
        reocr_state.remove_batch_mapping(job_id)
        _forget_cancel_state(job_id)
        lopetatud += 1
        logger.info(f"Re-OCR {job_id}: pooleli jäänud katkestamine lõpetatud")
    return lopetatud
```

- [ ] **Step 4: Ühenda stardi-taastesse**

`_startup_recovery_and_reaper` sees, kohe pärast tööde mällu laadimist (enne
poll-lõimede kasutuselevõttu), lisa mõlema registri jaoks:

```python
    _finish_interrupted_cancellations(_reocr_jobs)
    _finish_interrupted_cancellations(_reocr_batch_jobs)
    _persist_active_jobs()
```

- [ ] **Step 5: Käivita testid ja commit**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik roheline.

```bash
git add server/reocr_ops.py tests/test_reocr_cancel_recovery.py
git commit -m "feat(reocr): lõpeta pooleli jäänud katkestamine restardi järel (#217)

cancelling persisteeritakse enne koristust; stardi-taaste lõpetab selle
best-effort. Ilma selleta muutuks pooleli katkestatud töö restardi järel taas
aktiivseks ja lukustaks teose."
```

---

### Task 8: Frontend — nupp, kinnitus ja `cancelled` kuvamine

**Files:**
- Modify: `src/pages/Review.tsx`, `src/pages/manage/PageActionBar.tsx`, `src/locales/et/*.json`, `src/locales/en/*.json`
- Create: `src/services/reocrService.ts` funktsioon (kui teenusefail on olemas; muidu lisa olemasolevasse API-moodulisse, kus re-OCR kutsed juba elavad)

**Interfaces:**
- Consumes: `DELETE /admin/reocr/{job_id}`
- Produces: `cancelReocrJob(jobId: string, token: string): Promise<{ status: string; remote_cleanup: string; deleted_ocr: number; restored_ocr: number }>`

- [ ] **Step 1: Leia, kus re-OCR API-kutsed juba elavad**

```bash
grep -rn "admin/reocr\|reocr" src/services/*.ts src/pages/Review.tsx | head -20
```

Lisa `cancelReocrJob` SAMASSE moodulisse, kus `startReocr`/`getReocrStatus` on — ära loo
uut teenusefaili ühe funktsiooni jaoks.

- [ ] **Step 2: Lisa API-funktsioon**

```ts
export async function cancelReocrJob(
  jobId: string, token: string,
): Promise<{ status: string; remote_cleanup: string; deleted_ocr: number; restored_ocr: number }> {
  const res = await fetch(`${FILE_API_URL}/admin/reocr/${jobId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Katkestamine ebaõnnestus (${res.status})`);
  }
  return res.json();
}
```

- [ ] **Step 3: Lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/` vastavas nimeruumis (sama, kus re-OCR tekstid juba on):

```json
"cancelJob": "Katkesta töö",
"cancelConfirmTitle": "Katkestada OCR-töö?",
"cancelConfirmBody": "Töö peatatakse ja seni valmis saanud lehtede tulemused visatakse ära. Juba rakendatud tekste see ei puuduta.",
"cancelSuccess": "Töö katkestatud",
"cancelFailed": "Katkestamine ebaõnnestus",
"statusCancelled": "Katkestatud"
```

`src/locales/en/` samasse nimeruumi:

```json
"cancelJob": "Cancel job",
"cancelConfirmTitle": "Cancel the OCR job?",
"cancelConfirmBody": "The job stops and results for pages finished so far are discarded. Already applied text is not affected.",
"cancelSuccess": "Job cancelled",
"cancelFailed": "Cancelling failed",
"statusCancelled": "Cancelled"
```

- [ ] **Step 4: Lisa nupp Review.tsx OCR-tööde loendisse**

Iga aktiivse töö (`uploading`/`processing`/`slow`) real nupp, mis avab kinnituse ja kutsub
`cancelReocrJob`. Õnnestumisel värskenda loendit ja näita toast.

- [ ] **Step 5: Lisa nupp Manage batch-ribale**

`src/pages/manage/PageActionBar.tsx` — sama muster nagu `batchConfirm` juba kasutab.

**NB:** `cancelled` EI OLE Manage'i püsiv staatus. Pärast katkestamist aktiivne töö kaob ja
riba lihtsalt ei kuvata; kasutaja tagasiside on toast. Püsiv `cancelled` on ainult Review
ajaloos (`reocr_log.json`).

- [ ] **Step 6: Käivita väravad ja commit**

```bash
npm run typecheck && npm test && npm run lint:ci
```

Expected: typecheck puhas, testid rohelised (sh `localeParity.test.ts` — kui see kukub, on
võti ainult ühes keeles).

```bash
git add src/ && git commit -m "feat(reocr): katkestamise nupp ja kinnitusdialoog (#217)"
```

---

### Task 9: Dokumentatsioon ja issue

**Files:**
- Modify: `CLAUDE.md` (re-OCR rida, kui seal on staatuste loend), `docs/decisions/` (uus ADR)

- [ ] **Step 1: Kirjuta ADR**

Uus fail `docs/decisions/0018-reocr-katkestamine.md`. Sisu tuum (invariandid, mis peavad
üle elama):

- katkestamine = „tööd ei olnud"; osalisi tulemusi ei säilitata (põhjendus: taustatöö,
  katkestamine ei võida aega, ainult suvalise prefiksi)
- `.ocr` omand: `produced_pages`, mitte plaanitud lehed; ülekirjutamine varundatakse
- `cancelling` on persisteeritud vaheolek; terminalüleminekud on CAS-iga välistavad
- üleslaadimislõim `join`-itakse, poll-lõimi (jagatud singletonid) vaigistab CAS
- `200` garanteerib VUTT-i poole; LOSSis võib jääk edasi eksisteerida
- LOSSi peatamine käib piltide kustutamise kaudu; kuni `BATCH_SIZE = 4` lehte jõuab lõpuni

- [ ] **Step 2: Käivita kõik väravad**

```bash
.venv/bin/pytest tests/ -q && npm run typecheck && npm test && npm run lint:ci
```

- [ ] **Step 3: Commit ja PR**

```bash
git add -A && git commit -m "docs(adr): 0018 — re-OCR töö katkestamine (#217)"
git push -u origin feat/reocr-katkestamine
gh pr create --title "Re-OCR töö katkestamine (#217)" --body "Sulgeb #217. Spekk: docs/superpowers/specs/2026-08-08-reocr-katkestamine-design.md"
```

---

## Self-Review

**Spec coverage:**

| Spekk | Task |
|---|---|
| `.ocr` omand: `produced_pages` | Task 2 |
| Ülekirjutamise varundus + taastamine | Task 1 |
| Varukoopiad `state/` all (gitignore-lõks) | Task 1 Step 3 + test |
| `cancelling` vaheolek | Task 3 |
| Välistavad terminalüleminekud (CAS) | Task 3 |
| Poll-lõime vaigistamine (jagatud singleton) | Task 3 Step 4 |
| Üleslaadimislõime `Event` + `join` | Task 4 |
| `join` aegumine → ei koristata | Task 5 (`RuntimeError` → 503) |
| Kaugkoristus, LOSSi peatamine | Task 5 Step 3 |
| SFTP tõrge → lokaalne katkestamine ikka | Task 5 test |
| `remote_cleanup` logikirjes | Task 5 Step 5 |
| API staatustabel, korduv DELETE → 404 | Task 6 |
| job_id nimeruumi invariant | Task 3 (`RuntimeError`) + test |
| Krahhikindlus | Task 7 |
| Frontend + i18n mõlemas keeles | Task 8 |
| `cancelled` on logi-tasandi staatus | Task 8 Step 5 märkus |

**Placeholder-kontroll:** kõik sammud sisaldavad päris koodi või päris käsku. Kaks
teadlikku „leia üles" sammu (Task 6 Step 1 fixture'id, Task 8 Step 1 teenusemoodul) on
seal, kus koodibaasis on juba olemasolev muster, mida tuleb järgida, mitte dubleerida —
mõlemal on selge juhis, mida otsida ja mida MITTE teha.

**Tüübi-järjepidevus:** `_write_ocr_file(slug, page_filename, text, job_id)` on neljandat
argumenti kasutav kõigis kutsekohtades (Task 1 Step 6). `cancel_reocr_job` tagastusvorm on
sama Task 5-s, Task 6 testides ja Task 8 TS-tüübis (`status`, `remote_cleanup`,
`deleted_ocr`, `restored_ocr`). `_try_begin_cancel` tagastab `"single"`/`"batch"`/`None`
nii teostuses kui testides.
