# Batch re-OCR hulgi-vastuvõtmine — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage-lehel saab terve batch re-OCR tulemuse ühe klikiga vastu võtta (või tagasi lükata), selle asemel et iga lehte Workspace'is eraldi kinnitada.

**Architecture:** Backend saab hulgi-endpointi, mis loeb ootel `.ocr` staging-failid, kirjutab need `.txt` failidesse ja teeb kogu partii kohta **ühe** git-commiti ning **ühe** Meilisearch-sünki. Rakendatavate lehtede loend arvutatakse kliendis (viimase batch-töö lehed) ja saadetakse serverile selgesõnaliselt, nii et server rakendab täpselt seda, mida kasutajale näidati.

**Tech Stack:** FastAPI (Python 3.9 ühilduvus), pytest; React 19 + TypeScript + Tailwind, vitest, i18next.

Spets: `docs/superpowers/specs/2026-08-07-reocr-hulgi-vastuvott-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles.** UI-tekstid nii eesti kui inglise keeles.
- **Python 3.9 ühilduvus:** `Optional[dict]`, `List[str]`, mitte `dict | None` ega `list[str]`.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — failitöö läheb `run_in_threadpool`-i.
- **i18n `fallbackLng` on VÄLJAS** (ADR 0011) — iga uus võti lisada **korraga** nii `src/locales/et/workspace.json` kui `src/locales/en/workspace.json`. Vastasel juhul katkeb `localeParity.test.ts` ja build.
- **Marginaalia normaliseerimine käib KÕIGIS kirjutusteedes** — `normalize_marginalia_tags()` iga teksti peale, mis kettale kirjutatakse.
- **Meili sünk teose kaupa**, mitte lehe kaupa (ADR 0013).
- Testid alati projekti venv-iga: `.venv/bin/pytest`, mitte süsteemi `python3`.
- Väravad enne iga commiti (frontend-taskidel): `npm run typecheck` ja `npm test`. `npm run build` üksi EI püüa tüübivigu.
- Töö käib harus `feat/reocr-bulk-apply` (juba olemas, spets committitud).

## Failistruktuur

| Fail | Vastutus |
|---|---|
| `server/reocr_apply.py` (uus) | `.ocr` staging → `.txt` + üks git-commit; `.ocr` kustutus. Ainuke koht, kus rakendusloogika elab. |
| `tests/test_reocr_apply.py` (uus) | `reocr_apply` üksustestid päris ajutise git-repoga. |
| `server/reocr_ops.py:431` (muuta) | `build_reocr_status` annab lisaks `batch_ready` + `batch_known`. |
| `tests/test_reocr_batch.py` (muuta) | `build_reocr_status` uute väljade testid. |
| `server/routers/reocr.py` (muuta) | Kaks uut endpointi: `/reocr-apply`, `/reocr-discard`. |
| `tests/test_reocr_router.py` (muuta) | Endpointide valideerimis- ja turvategressioonid. |
| `src/utils/reocrStatus.ts` (muuta) | `applicableReocrPages()` — puhas funktsioon, mis otsustab, millised lehed on rakendatavad. |
| `src/utils/__tests__/reocrStatus.test.ts` (muuta) | Selle funktsiooni testid. |
| `src/services/workApi.ts` (muuta) | `applyReocrResults()`, `discardReocrResults()`. |
| `src/locales/{et,en}/workspace.json` (muuta) | Uued `manage.reocr.*` võtmed mõlemas keeles. |
| `src/pages/WorkManage.tsx` (muuta) | Tegevusriba ootel tulemuste jaoks + olekud ja käitlejad. |

---

### Task 1: `reocr_apply` moodul — staging → tekst + üks commit

**Files:**
- Create: `server/reocr_apply.py`
- Test: `tests/test_reocr_apply.py`

**Interfaces:**
- Consumes: `server.git_ops.save_with_git(filepath, content, username, message=None, additional_files=None) -> dict` (tagastab `{"success": bool, "commit_hash": str, ...}`; kirjutab failid ise `atomic_write_text`-iga LUKU sees, ka siis kui commit hiljem ebaõnnestub). `server.marginalia_normalize.normalize_marginalia_tags(text) -> str`.
- Produces:
  - `apply_ocr_results(work_path: str, page_filenames: List[str], username: str) -> Dict` → `{"applied": List[str], "failed": List[Dict[str, str]], "commit_hash": str, "git_committed": bool}`
  - `discard_ocr_results(work_path: str, page_filenames: List[str]) -> Dict` → `{"discarded": List[str], "failed": List[Dict[str, str]]}`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_reocr_apply.py`:

```python
"""Batch re-OCR tulemuste rakendamine (.ocr → .txt) päris ajutises git-repos."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops
from git import Repo


@pytest.fixture
def work(tmp_path, monkeypatch):
    """Ajutine git-repo ühe teosekaustaga; pg1-l on juba tekst, pg2-l ei ole."""
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "1690-w1"
    folder.mkdir()
    (folder / "pg1.txt").write_text("vana tekst", encoding="utf-8")
    r.index.add([os.path.relpath(str(folder / "pg1.txt"), str(tmp_path))])
    r.index.commit("init")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "folder": folder}


def test_apply_kirjutab_txt_ja_kustutab_ocr(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    (folder / "pg2.ocr").write_text("uus tekst", encoding="utf-8")

    result = apply_ocr_results(str(folder), ["pg2.jpg"], "admin")

    assert result["applied"] == ["pg2.jpg"]
    assert result["failed"] == []
    assert result["git_committed"] is True
    assert (folder / "pg2.txt").read_text(encoding="utf-8") == "uus tekst"
    assert not (folder / "pg2.ocr").exists()


def test_apply_kirjutab_olemasoleva_teksti_ule(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    (folder / "pg1.ocr").write_text("OCR-i uus versioon", encoding="utf-8")

    apply_ocr_results(str(folder), ["pg1.jpg"], "admin")

    assert (folder / "pg1.txt").read_text(encoding="utf-8") == "OCR-i uus versioon"


def test_apply_normaliseerib_marginaalia(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    # Ristuv <i><m> — normalize_marginalia_tags teeb <m> välimiseks tägiks
    (folder / "pg2.ocr").write_text("<i><m>Ratio 4.</m></i>", encoding="utf-8")

    apply_ocr_results(str(folder), ["pg2.jpg"], "admin")

    assert (folder / "pg2.txt").read_text(encoding="utf-8") == "<m><i>Ratio 4.</i></m>"


def test_apply_mitu_lehte_uks_commit(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    for n in ("pg2", "pg3", "pg4"):
        (folder / f"{n}.ocr").write_text(f"tekst {n}", encoding="utf-8")
    before = len(list(work["repo"].iter_commits()))

    result = apply_ocr_results(str(folder), ["pg2.jpg", "pg3.jpg", "pg4.jpg"], "admin")

    assert len(result["applied"]) == 3
    assert len(list(work["repo"].iter_commits())) == before + 1  # ÜKS commit
    assert (folder / "pg4.txt").read_text(encoding="utf-8") == "tekst pg4"


def test_apply_puuduv_ocr_ei_katkesta_ulejaanuid(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    (folder / "pg2.ocr").write_text("olemas", encoding="utf-8")

    result = apply_ocr_results(str(folder), ["pg2.jpg", "puudub.jpg"], "admin")

    assert result["applied"] == ["pg2.jpg"]
    assert result["failed"] == [{"filename": "puudub.jpg", "error": ".ocr fail puudub"}]
    assert (folder / "pg2.txt").exists()


def test_apply_tuhi_tulemus_ei_commiti(work):
    from server.reocr_apply import apply_ocr_results
    before = len(list(work["repo"].iter_commits()))

    result = apply_ocr_results(str(work["folder"]), ["puudub.jpg"], "admin")

    assert result["applied"] == []
    assert result["git_committed"] is False
    assert len(list(work["repo"].iter_commits())) == before


def test_discard_kustutab_ainult_ocr(work):
    from server.reocr_apply import discard_ocr_results
    folder = work["folder"]
    (folder / "pg1.ocr").write_text("ootel", encoding="utf-8")

    result = discard_ocr_results(str(folder), ["pg1.jpg", "puudub.jpg"])

    assert result["discarded"] == ["pg1.jpg"]
    assert result["failed"] == [{"filename": "puudub.jpg", "error": ".ocr fail puudub"}]
    assert not (folder / "pg1.ocr").exists()
    assert (folder / "pg1.txt").read_text(encoding="utf-8") == "vana tekst"  # puutumata
```

- [ ] **Step 2: Käivita test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_reocr_apply.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.reocr_apply'`

- [ ] **Step 3: Kirjuta moodul**

Loo `server/reocr_apply.py`:

```python
"""Batch re-OCR tulemuste (.ocr staging) rakendamine päris .txt failidesse.

Eraldi moodul, sest reocr_ops.py orkestreerib OCR-serverit (SFTP, pollimine);
siin on hoopis staging → päris fail + versioonihaldus. Vt spets
docs/superpowers/specs/2026-08-07-reocr-hulgi-vastuvott-design.md.
"""
import os
import unicodedata
from typing import Dict, List, Tuple

from .config import get_logger
from .git_ops import save_with_git
from .marginalia_normalize import normalize_marginalia_tags

logger = get_logger(__name__)


def _stem(page_filename: str) -> str:
    return os.path.splitext(os.path.basename(page_filename))[0]


def _ocr_path(work_path: str, page_filename: str) -> str:
    return os.path.join(work_path, _stem(page_filename) + ".ocr")


def _txt_path(work_path: str, page_filename: str) -> str:
    return os.path.join(work_path, _stem(page_filename) + ".txt")


def apply_ocr_results(work_path: str, page_filenames: List[str], username: str) -> Dict:
    """Rakendab ootel .ocr tulemused .txt failidesse ÜHE git-commitina.

    Ühe lehe tõrge ei katkesta ülejäänuid — vigased lehed lähevad 'failed' loendisse.
    Tagastab {"applied", "failed", "commit_hash", "git_committed"}.
    """
    applied: List[str] = []
    failed: List[Dict[str, str]] = []
    writes: List[Tuple[str, str]] = []  # [(txt_path, tekst)]

    for page_filename in page_filenames:
        ocr_path = _ocr_path(work_path, page_filename)
        try:
            with open(ocr_path, "r", encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            failed.append({"filename": page_filename, "error": ".ocr fail puudub"})
            continue
        except OSError as e:
            failed.append({"filename": page_filename, "error": str(e)})
            continue
        # Sama normaliseerimine kui /save teel — marginaalia-tägid kanoonilisele kujule.
        text = normalize_marginalia_tags(unicodedata.normalize("NFC", text))
        writes.append((_txt_path(work_path, page_filename), text))
        applied.append(page_filename)

    if not writes:
        return {"applied": [], "failed": failed, "commit_hash": "", "git_committed": False}

    first_path, first_text = writes[0]
    result = save_with_git(
        first_path,
        first_text,
        username,
        message=f"Batch re-OCR rakendatud: {len(writes)} lehte",
        additional_files=writes[1:],
    )
    git_committed = bool(result.get("success", False))
    if not git_committed:
        logger.warning(
            f"Batch re-OCR: tekst kirjutatud, git-commit ebaõnnestus ({work_path}): "
            f"{result.get('error')}"
        )

    # .ocr koristus ka commiti-tõrke korral: tekst on päris failis juba olemas
    # (save_with_git kirjutab failid enne commiti). Staging'u alles jätmine
    # tekitaks igavesti korduva "ootel" seisu.
    for page_filename in applied:
        try:
            os.remove(_ocr_path(work_path, page_filename))
        except OSError:
            pass

    logger.info(f"Batch re-OCR rakendatud: {len(applied)} lehte, {len(failed)} viga ({work_path})")
    return {
        "applied": applied,
        "failed": failed,
        "commit_hash": (result.get("commit_hash") or "")[:8],
        "git_committed": git_committed,
    }


def discard_ocr_results(work_path: str, page_filenames: List[str]) -> Dict:
    """Kustutab ootel .ocr failid ilma rakendamata.

    Git-commiti ega Meili sünki ei toimu — .ocr on staging, mitte versioonihalduses.
    """
    discarded: List[str] = []
    failed: List[Dict[str, str]] = []
    for page_filename in page_filenames:
        try:
            os.remove(_ocr_path(work_path, page_filename))
            discarded.append(page_filename)
        except FileNotFoundError:
            failed.append({"filename": page_filename, "error": ".ocr fail puudub"})
        except OSError as e:
            failed.append({"filename": page_filename, "error": str(e)})
    logger.info(f"Batch re-OCR tagasi lükatud: {len(discarded)} tulemust ({work_path})")
    return {"discarded": discarded, "failed": failed}
```

- [ ] **Step 4: Käivita testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_reocr_apply.py -v`
Expected: PASS (7 testi)

- [ ] **Step 5: Commit**

```bash
git add server/reocr_apply.py tests/test_reocr_apply.py
git commit -m "feat(reocr): .ocr tulemuste rakendamine ühe git-commitina"
```

---

### Task 2: `build_reocr_status` annab viimase batch'i ulatuse

**Files:**
- Modify: `server/reocr_ops.py:431-467` (`build_reocr_status`)
- Test: `tests/test_reocr_batch.py` (lisa uued testid faili lõppu)

**Interfaces:**
- Consumes: moodulisisene `_reocr_batch_jobs` + `_reocr_batch_jobs_lock`, olemasolev `ocr_ready` arvutus.
- Produces: `build_reocr_status(work_id, work_path)` tagastab lisaks senisele veel `{"batch_ready": List[str], "batch_known": bool}`. `batch_ready` on **stem'id** (ilma laiendita), sorteeritud.

**Kriitiline detail:** batch-kirje lehtedel EI PRUUGI olla `stem` välja — `reocr_active.json`-ist elustatud ja vanemad kirjed sisaldavad ainult `page_filename`-i (vt `tests/test_reocr_batch.py:186`). Kasuta `e.get("stem") or os.path.splitext(e["page_filename"])[0]`, muidu tekib KeyError.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_reocr_batch.py` faili lõppu:

```python
def test_build_reocr_status_batch_ready_ainult_viimasest_batchist(tmp_path, monkeypatch):
    """batch_ready = viimase batch-töö lehed, mille .ocr on kettal. Võõras .ocr jääb välja."""
    from server import reocr_ops
    work_dir = tmp_path / "teos"
    work_dir.mkdir()
    for stem in ("a", "b", "voeras"):
        (work_dir / f"{stem}.ocr").write_text("valmis", encoding="utf-8")

    reocr_ops._reocr_batch_jobs["VANA"] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "done",
        "started_at": 100, "finished_at": 200, "last_progress_at": 200,
        "remote_work": "r", "pages": [
            {"page_filename": "z.jpg", "stem": "z", "status": "ready", "error": None},
        ],
    }
    reocr_ops._reocr_batch_jobs["UUS"] = {
        "kind": "batch", "work_id": "w", "slug": "teos", "status": "done",
        "started_at": 300, "finished_at": 400, "last_progress_at": 400,
        "remote_work": "r", "pages": [
            {"page_filename": "a.jpg", "stem": "a", "status": "ready", "error": None},
            {"page_filename": "b.jpg", "stem": "b", "status": "ready", "error": None},
            {"page_filename": "c.jpg", "stem": "c", "status": "error", "error": "x"},
        ],
    }
    try:
        st = reocr_ops.build_reocr_status("w", str(work_dir))
        assert st["batch_known"] is True
        assert st["batch_ready"] == ["a", "b"]   # c-l pole .ocr, "voeras" pole batchist
        assert "voeras" in st["ocr_ready"]        # ocr_ready näitab endiselt kõike
    finally:
        del reocr_ops._reocr_batch_jobs["VANA"]
        del reocr_ops._reocr_batch_jobs["UUS"]


def test_build_reocr_status_ilma_batch_kirjeta(tmp_path):
    """Serveri restart kaotab batch-kirje → batch_known False, batch_ready tühi."""
    from server import reocr_ops
    work_dir = tmp_path / "teos2"
    work_dir.mkdir()
    (work_dir / "a.ocr").write_text("valmis", encoding="utf-8")

    st = reocr_ops.build_reocr_status("tundmatu-teos", str(work_dir))

    assert st["batch_known"] is False
    assert st["batch_ready"] == []
    assert st["ocr_ready"] == ["a"]


def test_build_reocr_status_talub_stem_ita_kirjet(tmp_path):
    """reocr_active.json-ist elustatud kirjel pole 'stem' välja — ei tohi KeyError-it visata."""
    from server import reocr_ops
    work_dir = tmp_path / "teos3"
    work_dir.mkdir()
    (work_dir / "a.ocr").write_text("valmis", encoding="utf-8")

    reocr_ops._reocr_batch_jobs["ELUSTATUD"] = {
        "kind": "batch", "work_id": "w3", "slug": "teos3", "status": "processing",
        "started_at": 1, "finished_at": None, "last_progress_at": 1,
        "remote_work": "r", "pages": [
            {"page_filename": "a.jpg", "status": "ready", "error": None},  # ilma stem-ita
        ],
    }
    try:
        st = reocr_ops.build_reocr_status("w3", str(work_dir))
        assert st["batch_ready"] == ["a"]
    finally:
        del reocr_ops._reocr_batch_jobs["ELUSTATUD"]
```

- [ ] **Step 2: Käivita testid, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_reocr_batch.py -k "batch_ready or ilma_batch_kirjeta or stem_ita" -v`
Expected: FAIL — `KeyError: 'batch_known'`

- [ ] **Step 3: Laienda `build_reocr_status`**

`server/reocr_ops.py` — muuda funktsiooni lõppu (praegu rida ~455-467). Asenda plokk alates `ocr_ready: List[str] = []` kuni `return`-ini:

```python
    ocr_ready: List[str] = []
    try:
        for fn in os.listdir(work_path):
            if fn.endswith(".ocr"):
                ocr_ready.append(os.path.splitext(fn)[0])
    except FileNotFoundError:
        pass
    ocr_ready.sort()  # Deterministlik järjekord

    # Hulgi-rakenduse ulatus: AINULT selle teose viimase batch-töö lehed, et
    # kellegi teise üksik ootel tulemus samas teoses jääks puutumata.
    # NB: elustatud kirjel võib 'stem' puududa → tuletame page_filename-ist.
    batch_stems: List[str] = []
    batch_known = False
    latest_started = float("-inf")
    with _reocr_batch_jobs_lock:
        for j in _reocr_batch_jobs.values():
            if j["work_id"] != work_id:
                continue
            started = j.get("started_at") or 0
            if started >= latest_started:
                latest_started = started
                batch_stems = [
                    e.get("stem") or os.path.splitext(e["page_filename"])[0]
                    for e in j.get("pages", [])
                ]
                batch_known = True
    ready_set = set(ocr_ready)
    batch_ready = sorted(s for s in batch_stems if s in ready_set)

    return {
        "active": active,
        "ocr_ready": ocr_ready,
        "errors": errors,
        "progress": progress,
        "batch_ready": batch_ready,
        "batch_known": batch_known,
    }
```

- [ ] **Step 4: Käivita testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_reocr_batch.py -v`
Expected: PASS (kõik, sh olemasolev `test_build_reocr_status_agregeerib`)

- [ ] **Step 5: Commit**

```bash
git add server/reocr_ops.py tests/test_reocr_batch.py
git commit -m "feat(reocr): staatus annab viimase batchi rakendatavad lehed"
```

---

### Task 3: Endpointid `/reocr-apply` ja `/reocr-discard`

**Files:**
- Modify: `server/routers/reocr.py`
- Test: `tests/test_reocr_router.py`

**Interfaces:**
- Consumes: `server.reocr_apply.apply_ocr_results`, `server.reocr_apply.discard_ocr_results` (Task 1); `server.meilisearch_ops.sync_work_to_meilisearch_async(slug)`; `find_directory_by_id`, `get_json_data`, `require_role`.
- Produces:
  - `POST /admin/work/{work_id}/reocr-apply`, body `{"page_filenames": [...]}` → `{"status": "success", "applied": [...], "failed": [...], "commit_hash": "...", "git_committed": bool}`
  - `POST /admin/work/{work_id}/reocr-discard`, body `{"page_filenames": [...]}` → `{"status": "success", "discarded": [...], "failed": [...]}`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_reocr_router.py` faili lõppu:

```python
def _apply_setup(tmp_path, monkeypatch):
    """Ühine seadistus: teosekaust olemas, find_directory_by_id suunab sinna."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "1690-w1"
    work_dir.mkdir(parents=True)
    monkeypatch.setattr(
        reocr_router, "find_directory_by_id",
        lambda work_id: str(work_dir) if work_id == "wid" else None,
    )
    return reocr_router, work_dir


def test_reocr_apply_rejects_path_traversal(client, login, tmp_path, monkeypatch):
    """Hulgi-rakendus peab aktsepteerima ainult bare failinimesid."""
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    called = []
    monkeypatch.setattr(reocr_router, "apply_ocr_results", lambda *a, **kw: called.append(a))

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["ok.jpg", "../../state/users.json"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400
    assert called == []  # midagi ei rakendatud


def test_reocr_apply_rejects_empty_list(client, login, tmp_path, monkeypatch):
    _apply_setup(tmp_path, monkeypatch)
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400


def test_reocr_apply_unknown_work_404(client, login, tmp_path, monkeypatch):
    _apply_setup(tmp_path, monkeypatch)
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/puudub/reocr-apply",
        json={"page_filenames": ["a.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


def test_reocr_apply_sunkib_meili_uks_kord(client, login, tmp_path, monkeypatch):
    """Õnnestunud rakendus → täpselt üks Meili sünk teose kohta, mitte lehe kohta."""
    reocr_router, work_dir = _apply_setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        reocr_router, "apply_ocr_results",
        lambda path, filenames, username: {
            "applied": list(filenames), "failed": [],
            "commit_hash": "abc12345", "git_committed": True,
        },
    )
    synced = []
    monkeypatch.setattr(reocr_router, "sync_work_to_meilisearch_async", lambda slug: synced.append(slug))

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["a.jpg", "b.jpg", "c.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["applied"] == ["a.jpg", "b.jpg", "c.jpg"]
    assert synced == ["1690-w1"]  # ÜKS sünk, slug (kaustanimi)


def test_reocr_apply_ilma_rakendatuta_ei_sungi(client, login, tmp_path, monkeypatch):
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        reocr_router, "apply_ocr_results",
        lambda path, filenames, username: {
            "applied": [], "failed": [{"filename": "a.jpg", "error": ".ocr fail puudub"}],
            "commit_hash": "", "git_committed": False,
        },
    )
    synced = []
    monkeypatch.setattr(reocr_router, "sync_work_to_meilisearch_async", lambda slug: synced.append(slug))

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["a.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert synced == []


def test_reocr_discard_kutsub_discard_ops(client, login, tmp_path, monkeypatch):
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        reocr_router, "discard_ocr_results",
        lambda path, filenames: {"discarded": list(filenames), "failed": []},
    )
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-discard",
        json={"page_filenames": ["a.jpg", "b.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["discarded"] == ["a.jpg", "b.jpg"]


def test_reocr_discard_rejects_path_traversal(client, login, tmp_path, monkeypatch):
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    called = []
    monkeypatch.setattr(reocr_router, "discard_ocr_results", lambda *a: called.append(a))
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-discard",
        json={"page_filenames": ["../../state/users.json"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert called == []


def test_reocr_apply_noab_admin_rolli(client, login, tmp_path, monkeypatch):
    _apply_setup(tmp_path, monkeypatch)
    token = login("editor", "editorpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["a.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 403
```

`conftest.py` defineerib kaks kasutajat: `admin`/`adminpass` (roll `admin`) ja `editor`/`editorpass` (roll `editor`) — viimane on rollikontrolli testis kasutusel.

- [ ] **Step 2: Käivita testid, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_reocr_router.py -v`
Expected: FAIL — 404 (endpointi pole registreeritud)

- [ ] **Step 3: Lisa endpointid**

`server/routers/reocr.py` — laienda importe faili päises:

```python
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
```

ja lisa olemasolevate importide juurde:

```python
from ..meilisearch_ops import sync_work_to_meilisearch_async
from ..reocr_apply import apply_ocr_results, discard_ocr_results
```

Lisa faili lõppu:

```python
def _validate_apply_pages(page_filenames) -> list:
    """Ainult mittetühi list bare failinimesid — väldi path traversal'i.
    Sama kaitse nagu _validate_batch_pages, aga ilma kettakontrollita (puuduv
    .ocr ei ole viga, see läheb 'failed' loendisse)."""
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

    Lehtede loend tuleb kliendilt, mitte serveri 'võta kõik' loogikast — nii
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
```

- [ ] **Step 4: Käivita kogu backend-testikomplekt**

Run: `.venv/bin/pytest tests/test_reocr_router.py tests/test_reocr_apply.py tests/test_reocr_batch.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/routers/reocr.py tests/test_reocr_router.py
git commit -m "feat(reocr): /reocr-apply ja /reocr-discard endpointid"
```

---

### Task 4: Rakendatavate lehtede arvutus (puhas funktsioon)

**Files:**
- Modify: `src/utils/reocrStatus.ts`
- Test: `src/utils/__tests__/reocrStatus.test.ts`

**Interfaces:**
- Consumes: `ReocrStatusResponse` (laieneb Task 2 backend-väljadega), `WorkPageInfo`-laadne `{ filename, has_text }`.
- Produces:
  ```ts
  export interface ApplicableReocr {
    filenames: string[];    // TÄISfailinimed (nt "a.jpg"), mitte stem'id — need lähevad API-le
    withTextCount: number;  // mitmel neist on juba tekst → ülekirjutuse hoiatus
    isFallback: boolean;    // batch_known !== true → laiendatud ulatus, teistsugune dialoogitekst
  }
  export function applicableReocrPages(
    pages: { filename: string; has_text: boolean }[],
    status: ReocrStatusResponse | null,
  ): ApplicableReocr
  ```

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `src/utils/__tests__/reocrStatus.test.ts` faili lõppu (ja laienda ülemist importi: `import { mapReocrState, selectableNoTextFiles, applicableReocrPages, ReocrStatusResponse } from '../reocrStatus';`):

```ts
describe('applicableReocrPages', () => {
  const pages = [
    { filename: 'a.jpg', has_text: false },
    { filename: 'b.jpg', has_text: true },
    { filename: 'voeras.jpg', has_text: false },
    { filename: 'd.jpg', has_text: false },
  ];

  it('võtab ainult viimase batchi lehed, võõras ootel tulemus jääb välja', () => {
    const st: ReocrStatusResponse = {
      active: {}, errors: {}, progress: null,
      ocr_ready: ['a', 'b', 'voeras'],
      batch_ready: ['a', 'b'],
      batch_known: true,
    };
    const r = applicableReocrPages(pages, st);
    expect(r.filenames).toEqual(['a.jpg', 'b.jpg']);
    expect(r.withTextCount).toBe(1);
    expect(r.isFallback).toBe(false);
  });

  it('ilma batch-infota (server taaskäivitatud) võtab kõik ootel tulemused', () => {
    const st: ReocrStatusResponse = {
      active: {}, errors: {}, progress: null,
      ocr_ready: ['a', 'b', 'voeras'],
      batch_ready: [],
      batch_known: false,
    };
    const r = applicableReocrPages(pages, st);
    expect(r.filenames).toEqual(['a.jpg', 'b.jpg', 'voeras.jpg']);
    expect(r.withTextCount).toBe(1);
    expect(r.isFallback).toBe(true);
  });

  it('jätab välja lehe, millel käib parasjagu uus OCR', () => {
    const st: ReocrStatusResponse = {
      active: { 'a.jpg': 'processing' }, errors: {}, progress: null,
      ocr_ready: ['a', 'b'],
      batch_ready: ['a', 'b'],
      batch_known: true,
    };
    expect(applicableReocrPages(pages, st).filenames).toEqual(['b.jpg']);
  });

  it('vanad backendid ilma uute väljadeta ei kuku kokku', () => {
    const st = {
      active: {}, errors: {}, progress: null, ocr_ready: ['a'],
    } as ReocrStatusResponse;
    const r = applicableReocrPages(pages, st);
    expect(r.filenames).toEqual(['a.jpg']);
    expect(r.isFallback).toBe(true);
  });

  it('ilma staatuseta ei paku midagi', () => {
    expect(applicableReocrPages(pages, null)).toEqual({
      filenames: [], withTextCount: 0, isFallback: false,
    });
  });
});
```

- [ ] **Step 2: Käivita test, veendu et kukub**

Run: `npx vitest run src/utils/__tests__/reocrStatus.test.ts`
Expected: FAIL — `applicableReocrPages is not a function`

- [ ] **Step 3: Laienda `src/utils/reocrStatus.ts`**

Lisa `ReocrStatusResponse` liidesele kaks välja (valikulised — vana backend ei pruugi neid saata):

```ts
export interface ReocrStatusResponse {
  active: Record<string, string>;
  ocr_ready: string[]; // stem'id (ilma laiendita)
  errors: Record<string, string>;
  progress: { total: number; ready: number; errors: number; active: boolean } | null;
  /** Viimase batch-töö lehed, mille .ocr on kettal (stem'id). Puudub vanas backendis. */
  batch_ready?: string[];
  /** Kas batch-kirje leiti. False = server taaskäivitati → varuvariant. */
  batch_known?: boolean;
}
```

ja lisa faili lõppu:

```ts
export interface ApplicableReocr {
  /** Täisfailinimed API-le (mitte stem'id). */
  filenames: string[];
  /** Mitmel rakendataval lehel on juba tekst → ülekirjutuse hoiatus dialoogis. */
  withTextCount: number;
  /** Batch-infot ei ole (serveri restart) → ulatus on KÕIK ootel tulemused. */
  isFallback: boolean;
}

/**
 * Millised lehed lähevad hulgi-rakendusse.
 *
 * Vaikimisi AINULT selle teose viimase batch-töö lehed, et kellegi teise üksik
 * ootel tulemus samas teoses jääks puutumata. Kui batch-kirjet ei ole (server
 * taaskäivitati), langeme tagasi kõigile ootel tulemustele ja UI ütleb selle välja.
 * Leht, millel käib parasjagu uus OCR, jäetakse välja — vana tulemuse rakendamine
 * poolelioleva töö ajal oleks segadust tekitav.
 */
export function applicableReocrPages(
  pages: { filename: string; has_text: boolean }[],
  status: ReocrStatusResponse | null,
): ApplicableReocr {
  if (!status) return { filenames: [], withTextCount: 0, isFallback: false };
  const isFallback = status.batch_known !== true;
  const stems = new Set(isFallback ? status.ocr_ready : (status.batch_ready ?? []));
  const applicable = pages.filter(
    (p) => stems.has(stripExt(p.filename)) && !status.active[p.filename],
  );
  return {
    filenames: applicable.map((p) => p.filename),
    withTextCount: applicable.filter((p) => p.has_text).length,
    isFallback,
  };
}
```

- [ ] **Step 4: Käivita testid + typecheck**

Run: `npx vitest run src/utils/__tests__/reocrStatus.test.ts && npm run typecheck`
Expected: PASS mõlemad

- [ ] **Step 5: Commit**

```bash
git add src/utils/reocrStatus.ts src/utils/__tests__/reocrStatus.test.ts
git commit -m "feat(reocr): applicableReocrPages — hulgi-rakenduse ulatus"
```

---

### Task 5: Manage-lehe tegevusriba (API, tõlked, UI)

**Files:**
- Modify: `src/services/workApi.ts` (re-OCR funktsioonide juurde, rida ~128-138)
- Modify: `src/locales/et/workspace.json` ja `src/locales/en/workspace.json` (`manage.reocr` objekt)
- Modify: `src/pages/WorkManage.tsx` (importid, olek ~113-118, käitlejad ~345, UI ~688)

**Interfaces:**
- Consumes: `applicableReocrPages`, `ApplicableReocr` (Task 4); endpointid `/reocr-apply`, `/reocr-discard` (Task 3); olemasolevad `pages` (`WorkPageInfo[]`), `reocrStatus`, `setReocrPollNonce`, `loadPages`.
- Produces: kasutajale nähtav tegevusriba. Väliseid liideseid teistele taskidele ei teki.

- [ ] **Step 1: Lisa API-funktsioonid**

`src/services/workApi.ts` — lisa `startReocrBatch` funktsiooni järele:

```ts
export interface ReocrFailure {
  filename: string;
  error: string;
}

export interface ReocrApplyResponse extends ApiStatusResponse {
  applied?: string[];
  failed?: ReocrFailure[];
  commit_hash?: string;
  git_committed?: boolean;
}

export interface ReocrDiscardResponse extends ApiStatusResponse {
  discarded?: string[];
  failed?: ReocrFailure[];
}

export function applyReocrResults(
  workId: string,
  token: string,
  pageFilenames: string[],
): Promise<ReocrApplyResponse> {
  // Pikk timeout: suure teose puhul kirjutatakse sadu faile + üks git-commit.
  return apiPost<ReocrApplyResponse>(
    `/admin/work/${workId}/reocr-apply`,
    { page_filenames: pageFilenames },
    authJson(token, { timeout: 120000 }),
  );
}

export function discardReocrResults(
  workId: string,
  token: string,
  pageFilenames: string[],
): Promise<ReocrDiscardResponse> {
  return apiPost<ReocrDiscardResponse>(
    `/admin/work/${workId}/reocr-discard`,
    { page_filenames: pageFilenames },
    authJson(token, { timeout: 30000 }),
  );
}
```

- [ ] **Step 2: Lisa tõlkevõtmed MÕLEMASSE keelde**

`src/locales/et/workspace.json` — `manage.reocr` objekti sisse (olemasolevate `badge` jt kõrvale):

```json
"pending": {
  "count": "{{count}} re-OCR tulemust ootel",
  "applyAll": "Rakenda kõik",
  "discardAll": "Lükka kõik tagasi",
  "confirmApply": "Rakendan {{count}} lehe re-OCR tulemused.",
  "confirmApplyWithText": "{{count}} lehel on juba tekst — see kirjutatakse üle. Vana versioon jääb git-ajalukku ja on taastatav Workspace'i „Ajalugu\" tabist.",
  "confirmFallback": "Batch'i info ei ole enam teada (server taaskäivitati) — rakendatakse KÕIK selle teose ootel tulemused, ka need, mis ei pruugi olla sinu omad.",
  "confirmDiscard": "Kustutan {{count}} ootel re-OCR tulemust. Lehtede tekst ei muutu.",
  "applyGo": "Rakenda",
  "discardGo": "Kustuta",
  "applied": "{{count}} lehte rakendatud",
  "appliedPartial": "{{applied}} lehte rakendatud, {{failed}} ebaõnnestus",
  "gitWarning": "Tekst salvestati, aga Git-commit ebaõnnestus.",
  "discarded": "{{count}} tulemust kustutatud",
  "applyError": "Rakendamine ebaõnnestus.",
  "discardError": "Kustutamine ebaõnnestus."
}
```

`src/locales/en/workspace.json` — sama struktuur, sama võtmestik:

```json
"pending": {
  "count": "{{count}} re-OCR results pending",
  "applyAll": "Apply all",
  "discardAll": "Discard all",
  "confirmApply": "Applying re-OCR results for {{count}} pages.",
  "confirmApplyWithText": "{{count}} pages already have text — it will be overwritten. The previous version stays in the Git history and can be restored from the Workspace \"History\" tab.",
  "confirmFallback": "Batch information is no longer available (the server restarted) — ALL pending results for this work will be applied, including any that may not be yours.",
  "confirmDiscard": "Deleting {{count}} pending re-OCR results. Page text will not change.",
  "applyGo": "Apply",
  "discardGo": "Delete",
  "applied": "{{count}} pages applied",
  "appliedPartial": "{{applied}} pages applied, {{failed}} failed",
  "gitWarning": "Text was saved, but the Git commit failed.",
  "discarded": "{{count}} results deleted",
  "applyError": "Applying failed.",
  "discardError": "Deleting failed."
}
```

- [ ] **Step 3: Kontrolli, et võtmestikud on identsed**

Run: `npx vitest run src/locales/__tests__/localeParity.test.ts`
Expected: PASS. Kui FAIL — üks võti on ainult ühes keeles, paranda.

(Kui testi tee erineb, leia see: `ls src/**/localeParity.test.ts`.)

- [ ] **Step 4: Lisa WorkManage'i olek ja käitlejad**

`src/pages/WorkManage.tsx`:

Laienda importe:

```ts
import { mapReocrState, selectableNoTextFiles, applicableReocrPages, ReocrStatusResponse } from '../utils/reocrStatus';
```

ja `workApi` importi juurde `applyReocrResults, discardReocrResults`.

Lisa olek `reocrStatus` oleku juurde (~rida 113):

```ts
  // Ootel re-OCR tulemuste hulgi-tegevused (kinnitus avaneb inline, nagu bulkDelete)
  const [pendingConfirm, setPendingConfirm] = useState<'apply' | 'discard' | null>(null);
  const [pendingBusy, setPendingBusy] = useState(false);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
```

Lisa `handleBatchReocr` järele (~rida 358):

```ts
  // Rakendatavad lehed: viimase batchi ootel tulemused (vt applicableReocrPages)
  const applicable = applicableReocrPages(pages, reocrStatus);

  const handleApplyAll = async () => {
    if (!workId || !authToken || applicable.filenames.length === 0) return;
    setPendingBusy(true);
    setPendingError(null);
    try {
      const res = await applyReocrResults(workId, authToken, applicable.filenames);
      const applied = res.applied?.length ?? 0;
      const failed = res.failed?.length ?? 0;
      let msg = failed > 0
        ? t('manage.reocr.pending.appliedPartial', { applied, failed })
        : t('manage.reocr.pending.applied', { count: applied });
      if (res.git_committed === false) msg += ` ${t('manage.reocr.pending.gitWarning')}`;
      setPendingResult(msg);
      setPendingConfirm(null);
      await loadPages();                 // has_text uueneb
      setReocrPollNonce((n) => n + 1);   // staatus uueneb (ootel loend tühjeneb)
    } catch (e: any) {
      setPendingError(e.message || t('manage.reocr.pending.applyError'));
    } finally {
      setPendingBusy(false);
    }
  };

  const handleDiscardAll = async () => {
    if (!workId || !authToken || applicable.filenames.length === 0) return;
    setPendingBusy(true);
    setPendingError(null);
    try {
      const res = await discardReocrResults(workId, authToken, applicable.filenames);
      setPendingResult(t('manage.reocr.pending.discarded', { count: res.discarded?.length ?? 0 }));
      setPendingConfirm(null);
      setReocrPollNonce((n) => n + 1);
    } catch (e: any) {
      setPendingError(e.message || t('manage.reocr.pending.discardError'));
    } finally {
      setPendingBusy(false);
    }
  };
```

`loadPages` on defineeritud `WorkManage.tsx:141` (`async (): Promise<string[]>`) ja seda kasutab juba `handleBulkDelete` (rida 442) — kasuta sama, ära leiuta uut laadimisteed.

- [ ] **Step 5: Lisa UI-plokk**

`src/pages/WorkManage.tsx` — kohe olemasoleva progress-kokkuvõtte JÄRELE (~rida 688-697, plokk `{reocrStatus?.progress && …}`):

```tsx
                {/* Ootel re-OCR tulemused: hulgi-rakendus / hulgi-tagasilükkamine.
                    Teose tasemel tegevus → siin, mitte valikupõhises PageActionBar-is. */}
                {applicable.filenames.length > 0 && (
                  <div className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-amber-900">
                        {t('manage.reocr.pending.count', { count: applicable.filenames.length })}
                      </span>
                      <button
                        onClick={() => { setPendingConfirm('apply'); setPendingResult(null); }}
                        disabled={pendingBusy}
                        className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded"
                      >
                        {t('manage.reocr.pending.applyAll')}
                      </button>
                      <button
                        onClick={() => { setPendingConfirm('discard'); setPendingResult(null); }}
                        disabled={pendingBusy}
                        className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-white disabled:opacity-50"
                      >
                        {t('manage.reocr.pending.discardAll')}
                      </button>
                    </div>

                    {pendingConfirm === 'apply' && (
                      <div className="mt-2 border-t border-amber-200 pt-2 text-sm text-amber-900">
                        <p>{t('manage.reocr.pending.confirmApply', { count: applicable.filenames.length })}</p>
                        {applicable.withTextCount > 0 && (
                          <p className="mt-1">
                            {t('manage.reocr.pending.confirmApplyWithText', { count: applicable.withTextCount })}
                          </p>
                        )}
                        {applicable.isFallback && (
                          <p className="mt-1 font-medium">{t('manage.reocr.pending.confirmFallback')}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={handleApplyAll} disabled={pendingBusy}
                            className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded">
                            {pendingBusy ? <Loader2 size={13} className="animate-spin inline" /> : t('manage.reocr.pending.applyGo')}
                          </button>
                          <button onClick={() => setPendingConfirm(null)} disabled={pendingBusy}
                            className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-white">
                            {t('common:buttons.cancel')}
                          </button>
                        </div>
                      </div>
                    )}

                    {pendingConfirm === 'discard' && (
                      <div className="mt-2 border-t border-amber-200 pt-2 text-sm text-amber-900">
                        <p>{t('manage.reocr.pending.confirmDiscard', { count: applicable.filenames.length })}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={handleDiscardAll} disabled={pendingBusy}
                            className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded">
                            {pendingBusy ? <Loader2 size={13} className="animate-spin inline" /> : t('manage.reocr.pending.discardGo')}
                          </button>
                          <button onClick={() => setPendingConfirm(null)} disabled={pendingBusy}
                            className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-white">
                            {t('common:buttons.cancel')}
                          </button>
                        </div>
                      </div>
                    )}

                    {pendingError && <p className="mt-2 text-sm text-red-700">{pendingError}</p>}
                  </div>
                )}

                {pendingResult && (
                  <div className="mx-4 mb-2 text-sm text-green-700">{pendingResult}</div>
                )}
```

**NB:** `Loader2` on failis juba imporditud (kasutatakse laadimisindikaatoris). Kontrolli, et `common:buttons.cancel` võti eksisteerib — `PageActionBar` kasutab seda kujul `t('common:buttons.cancel', 'Tühista')`.

- [ ] **Step 6: Käivita väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: kõik PASS. `lint:ci` lävi on `--max-warnings 55` — kui arv kasvab, paranda uued hoiatused (nt `useEffect` sõltuvused), ära tõsta läve.

- [ ] **Step 7: Commit**

```bash
git add src/services/workApi.ts src/locales/et/workspace.json src/locales/en/workspace.json src/pages/WorkManage.tsx
git commit -m "feat(reocr): manage-lehel ootel tulemuste hulgi-rakendus ja tagasilükkamine"
```

---

### Task 6: Terviklik kontroll ja ADR

**Files:**
- Create: `docs/decisions/00NN-reocr-hulgi-vastuvott.md` (järjekorranumber = suurim olemasolev + 1)

- [ ] **Step 1: Käivita kogu testikomplekt**

Run: `.venv/bin/pytest tests/ -q && npm run typecheck && npm test && npm run lint:ci`
Expected: kõik PASS. Kui midagi kukub, paranda enne edasiminekut.

- [ ] **Step 2: Kirjuta ADR**

Vaata `ls docs/decisions/` ja järgi seal olevat vormingut. Sisu peab katma:

- **Kontekst:** batch re-OCR tulemused olid rakendatavad ainult lehthaaval Workspace'is.
- **Otsus:** hulgi-rakendus manage-lehel; ulatus = viimase batch-töö lehed; server rakendab kliendi saadetud loendit, mitte oma „võta kõik" arvutust.
- **Invariandid, mille rikkumine teeb haiget:**
  - Hulgi-rakendus = **ÜKS** git-commit ja **ÜKS** Meili sünk kogu partii kohta. Lehe kaupa commitimine ja sünkimine ujutaks ajaloo üle ja koormaks Meilit (sama põhimõte nagu kommentaaride taaste, ADR 0008-järgne muster).
  - Rakendatavate lehtede loend tuleb **kliendilt**; server valideerib bare failinime (path traversal), aga ei laienda ulatust ise.
  - `.ocr` kustutatakse ka siis, kui git-commit ebaõnnestus — tekst on päris failis olemas ja alles jätmine tekitaks igavesti korduva „ootel" seisu.
  - Batch-kirje **ei ela üle backendi restardi** (`state/reocr_batch_maps/` mapping kustutatakse batch'i lõppedes, mälukirje kaob restardiga) → `batch_known: false` varuvariant on tahtlik, mitte viga.
- **Alternatiivid:** kliendipoolne `/save` tsükkel (lükati tagasi: N commiti, N sünki, poolik seis katkemisel).

- [ ] **Step 3: Commit ja PR**

```bash
git add docs/decisions/
git commit -m "docs(adr): batch re-OCR hulgi-vastuvõtmine"
git push -u origin feat/reocr-bulk-apply
gh pr create --base main --title "feat(reocr): batch-tulemuste hulgi-vastuvõtmine manage-lehel" --body "$(cat <<'EOF'
## Mis muutus

Manage-lehel saab terve batch re-OCR tulemuse ühe klikiga vastu võtta või tagasi
lükata. Varem tuli iga leht eraldi Workspace'is kinnitada.

- Uus `server/reocr_apply.py`: `.ocr` → `.txt`, ÜKS git-commit kogu partii kohta
- Uued endpointid `/admin/work/{work_id}/reocr-apply` ja `.../reocr-discard` (admin-only)
- `build_reocr_status` annab `batch_ready` + `batch_known` → ulatus = viimase batchi lehed
- Manage-lehele tegevusriba ootel tulemuste jaoks (kinnitus nimetab ülekirjutatavate lehtede arvu)

## Testitud

`.venv/bin/pytest tests/` · `npm run typecheck` · `npm test` · `npm run lint:ci`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Deploy pärast merge'i**

Backend on Python-muudatus → `--no-cache` on kohustuslik:

```bash
ssh vutt
cd ~/VUTT && ./scripts/server_update.sh --no-cache
```

Frontend lokaalselt:

```bash
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

Käsitsi suitsutest tootmises: käivita väikesele teosele (2-3 lehte) batch re-OCR, oota valmimist, vajuta „Rakenda kõik", kontrolli et lehtede tekst uuenes, ootel loend tühjenes ja Workspace'i „Ajalugu" tabis on **üks** commit kogu partii kohta.
