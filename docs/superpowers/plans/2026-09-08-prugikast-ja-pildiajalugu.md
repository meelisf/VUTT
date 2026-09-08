# Prügikast ja pildiajalugu — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prügikast näitab ausalt, mis liiki asi iga kirje on, taastamine töötab kõigil kustutatud lehtedel ega saa poolituse jäägist duplikaati teha, ja muudetud piltide ajalugu on leitav samast kohast.

**Architecture:** Kustutamise commit leitakse **tee** järgi (`git log --diff-filter=D -- {kaust}/{base}.txt`), mitte sõnumi seest; sama commiti sõnum annab liigi (`split` / `deleted` / `unknown`) ühe liigitaja kaudu, mis loeb ajaloolisi prefikseid. Taastamise keeld elab serveris, mitte liideses. Liides on kolm plokki ühes tabis, pisipildid tulevad admin-endpointist, mille cache on versioonitud lähtefaili `mtime_ns`-iga.

**Tech Stack:** FastAPI (Python 3.9 ühilduvus!), GitPython, Pillow, React 19 + TypeScript, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-09-08-prugikast-ja-pildiajalugu-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles** (CLAUDE.md).
- **Python 3.9:** `Optional[str]`, mitte `str | None`.
- **i18n:** `fallbackLng` on VÄLJAS — iga uus võti tuleb lisada **korraga** `src/locales/et/workspace.json` ja `src/locales/en/workspace.json` alla, muidu katkeb build (valvur: `localeParity.test.ts`).
- **Uus endpoint käib `/admin/` all JA kannab `require_role("admin")`** — nginx `/api/files/` proksib kõik backend-teed avalikult (CLAUDE.md).
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — kõik siinsed route'id on sünkroonsed `def`.
- **`get_user` annab nii puuduva tokeni kui liiga madala rolli korral 401** (`server/deps.py:41,45`) — testi oodatav kood on 401, mitte 403.
- **Testide käivitamine:** `.venv/bin/pytest`, mitte süsteemi `python3`.
- **Väravad enne igat commiti:** `.venv/bin/pytest tests/ -q`, `npm run typecheck`, `npx vitest run`, `npm run lint:ci` (lävi `--max-warnings 49`).
- **Avaldamise värav:** ülesanded 1–4 lähevad tootmisse ÜHE partiina. Ülesanne 3 üksi avaks poolituse jääkidele töötava „Taasta" nupu, mida täna ei ole — see suurendaks duplikaadiohtu.

---

### Task 1: Liigitaja (`server/trash_reason.py`)

**Files:**
- Create: `server/trash_reason.py`
- Test: `tests/test_trash_reason.py`

**Interfaces:**
- Consumes: —
- Produces: `SPLIT_COMMIT_PREFIX: str`, `DELETE_COMMIT_PREFIX: str`, `SPLIT_PREFIXES_AJALUGU: tuple`, `DELETE_PREFIXES_AJALUGU: tuple`, `liigita(commit_sonum: Optional[str]) -> str` (→ `"split" | "deleted" | "unknown"`), `on_taastatav(liik: str) -> bool`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_trash_reason.py
"""Prügikasti kirje liik tuleb kustutamise commiti sõnumist (#325).

Sõnumid on KIRJAS, mitte konstandist koostatud: konstandist koostatud test
kinnitaks ainult iseennast, ja just konstandi ümbernimetamine on see viga,
mille vastu siin kaitseme — git-ajalugu ei muutu tagantjärele.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import trash_reason


def test_poolituse_sonum_ajaloost():
    assert trash_reason.liigita(
        "Lõika leht 1 (1809-musta-hampa-petre-anni-elulugu): eemalda originaal [0nktwa]"
    ) == "split"


def test_kustutamise_sonumid_ajaloost():
    # Kaks kuju, mõlemad tootmise git-ajaloos olemas.
    assert trash_reason.liigita("Kustuta 1 lehte: 1779-diarium [0mqha5]") == "deleted"
    assert trash_reason.liigita("Kustuta leht: 1690-w1/pg1 [page_w1]") == "deleted"


def test_tundmatu_ja_puuduv_sonum():
    assert trash_reason.liigita("Muuda lehekülgede järjekorda: 1632-1 [meelis]") == "unknown"
    assert trash_reason.liigita(None) == "unknown"
    assert trash_reason.liigita("") == "unknown"


def test_ainult_kustutatud_on_taastatav():
    """Tundmatu EI ole taastatav — ettevaatlik suund: tundmatu päritoluga faili
    tagasitoomine võib teha duplikaadi, alles jätmine ei tee midagi."""
    assert trash_reason.on_taastatav("deleted") is True
    assert trash_reason.on_taastatav("split") is False
    assert trash_reason.on_taastatav("unknown") is False


def test_praegune_prefiks_kuulub_ajaloo_nimekirja():
    """Uus sõnastus tuleb LISADA ajaloo nimekirja, mitte asendada vana."""
    assert trash_reason.SPLIT_COMMIT_PREFIX in trash_reason.SPLIT_PREFIXES_AJALUGU
    assert trash_reason.DELETE_COMMIT_PREFIX in trash_reason.DELETE_PREFIXES_AJALUGU
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_trash_reason.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.trash_reason'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/trash_reason.py
"""Prügikasti kirje liik: mis operatsioon selle faili sinna pani (#325).

Liik loetakse kustutamise commiti SÕNUMIST. Sõnumit ei saa tagantjärele muuta,
seega on prefiksid AJALOOLINE FORMAAT: uue sõnastuse kasutuselevõtt tähendab
nimekirja LISAMIST, mitte asendamist.
"""
from typing import Optional

# Sõnumi algus, mida UUED commitid kasutavad.
SPLIT_COMMIT_PREFIX = "Lõika leht"
DELETE_COMMIT_PREFIX = "Kustuta"

# AJALOOLINE FORMAAT — need stringid on juba git-ajaloos. EI TOHI muuta ega
# eemaldada; vastasel korral muutuvad varem tehtud commitid `unknown`-iks ja
# nende lehtede taastamine kaob.
SPLIT_PREFIXES_AJALUGU = (SPLIT_COMMIT_PREFIX,)
DELETE_PREFIXES_AJALUGU = (DELETE_COMMIT_PREFIX,)


def liigita(commit_sonum: Optional[str]) -> str:
    """→ 'split' | 'deleted' | 'unknown'."""
    if not commit_sonum:
        return "unknown"
    sonum = commit_sonum.strip()
    if sonum.startswith(SPLIT_PREFIXES_AJALUGU):
        return "split"
    if sonum.startswith(DELETE_PREFIXES_AJALUGU):
        return "deleted"
    return "unknown"


def on_taastatav(liik: str) -> bool:
    """Ainult päris kustutatud leht on taastatav.

    Poolituse jääk on kahe elava lehe LÄHTEPILT — tema tagasitoomine annaks
    sama sisu kolmandat korda ja kaks lehte sama `sequence`-iga. Tundmatu
    päritolu on sama risk ilma teadmiseta.
    """
    return liik == "deleted"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_trash_reason.py -q`
Expected: PASS (5 testi)

- [ ] **Step 5: Commit**

```bash
git add server/trash_reason.py tests/test_trash_reason.py
git commit -m "feat(trash): kirje liik commiti sõnumist, ajaloolised prefiksid (#325)"
```

---

### Task 2: Sõnumite koostamine läheb konstandi peale

**Files:**
- Modify: `server/admin_page_ops.py` (rida ~420 `split_page` commit 1, ~447 commit 2, ~1029 `delete_pages`)
- Test: `tests/test_trash_reason.py` (lisandub)

**Interfaces:**
- Consumes: `trash_reason.SPLIT_COMMIT_PREFIX`, `trash_reason.DELETE_COMMIT_PREFIX` (Task 1)
- Produces: — (sõnumid, mida Task 3 liigitab)

- [ ] **Step 1: Write the failing test**

```python
# lisa tests/test_trash_reason.py lõppu
def test_split_page_sonum_algab_ajaloolise_prefiksiga():
    """Kirjutaja ja liigitaja peavad kokku käima — dokumentatsioon ei jõusta midagi.

    Loeme lähtekoodist, sest sõnum sünnib f-stringis keset pikka funktsiooni ja
    tema väljakutsumine nõuaks tervet git-repot + Pillow'd.
    """
    juur = Path(__file__).resolve().parents[1]
    kood = (juur / "server" / "admin_page_ops.py").read_text(encoding="utf-8")

    assert 'SPLIT_COMMIT_PREFIX' in kood, (
        "split_page ei impordi prefiksit trash_reason-ist — sõnastus saab lahku triivida")
    assert 'DELETE_COMMIT_PREFIX' in kood, (
        "delete_pages ei impordi prefiksit trash_reason-ist")
    # Kõvakodeeritud vanu sõnumeid ei tohi järele jääda
    assert '"Lõika leht {' not in kood and "f\"Lõika leht" not in kood, (
        "leidus kõvakodeeritud „Lõika leht\" sõnum")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_trash_reason.py -q`
Expected: FAIL — `assert 'SPLIT_COMMIT_PREFIX' in kood`

- [ ] **Step 3: Write minimal implementation**

`server/admin_page_ops.py` importide juurde:

```python
from .trash_reason import SPLIT_COMMIT_PREFIX, DELETE_COMMIT_PREFIX
```

`split_page` commit 1 (praegu `message=f"Lõika leht {page_num} ({folder_name}): vasakpoolne [{work_id}]"`):

```python
            message=f"{SPLIT_COMMIT_PREFIX} {page_num} ({folder_name}): vasakpoolne [{work_id}]",
```

`split_page` commit 2 (praegu `f"Lõika leht {page_num} ({folder_name}): eemalda originaal [{work_id}]"`):

```python
        delete_page_from_git(
            folder_name, orig_base,
            f"{SPLIT_COMMIT_PREFIX} {page_num} ({folder_name}): eemalda originaal [{work_id}]",
            username
        )
```

`delete_pages` (praegu `commit_msg = f"Kustuta {len(base_names)} lehte: {folder_name} [{work_id}]"`):

```python
            commit_msg = f"{DELETE_COMMIT_PREFIX} {len(base_names)} lehte: {folder_name} [{work_id}]"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_trash_reason.py tests/test_split_page.py -q`
Expected: PASS — sh olemasolevad `test_split_page.py` testid muutmata (sõnumi tekst jääb identseks)

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_trash_reason.py
git commit -m "refactor(trash): commit-sõnumid koostatakse jagatud prefiksist (#325)"
```

---

### Task 3: Teepõhine git-jälg + liik loendis

**Files:**
- Modify: `server/trash_ops.py` (`list_deleted_pages` rida 188–228, `restore_deleted_page` rida 230–302)
- Test: `tests/test_trash_ops.py` (lisandub)

**Interfaces:**
- Consumes: `trash_reason.liigita`, `trash_reason.on_taastatav` (Task 1)
- Produces: `leia_kustutamise_commit(repo, folder_name, base) -> tuple` (→ `(commit_hash, sõnum)` või `(None, None)`); `list_deleted_pages` kirje uued võtmed: `reason: str`, `restorable: bool`, `v: int`

- [ ] **Step 1: Write the failing test**

```python
# lisa tests/test_trash_ops.py lõppu
def test_list_deleted_pages_leiab_commiti_ka_ilma_failinimeta_sonumis(trash_repo):
    """Tootmises on 303 kirjet 462-st, mille sõnumis failinime EI OLE.

    Vana `--grep {kaust}/{base}` ei leidnud neid: kustutamise sõnum on
    „Kustuta 2 lehte: {kaust}". Teepõhine otsing leiab.
    """
    repo = trash_repo["repo"]
    base_dir = trash_repo["base_dir"]
    trash_root = trash_repo["trash_root"]
    work_id, folder = "page_w2", "1691-w2"
    folder_path = base_dir / folder
    folder_path.mkdir()
    for pn in ("pg1", "pg2"):
        (folder_path / f"{pn}.txt").write_text(f"{pn}-sisu", encoding="utf-8")
        (folder_path / f"{pn}.json").write_text("{}", encoding="utf-8")
        (folder_path / f"{pn}.jpg").write_bytes(b"\xff\xd8jpg")
    repo.index.add([f"{folder}/{p}.{e}" for p in ("pg1", "pg2") for e in ("txt", "json")])
    repo.index.commit("init")

    trash_pages = trash_root / work_id / "pages"
    trash_pages.mkdir(parents=True)
    import shutil
    shutil.move(str(folder_path / "pg1.jpg"), str(trash_pages / "pg1.jpg"))
    repo.git.rm(f"{folder}/pg1.txt", f"{folder}/pg1.json")
    actor = Actor("kustutaja", "k@vutt.local")
    # Sõnum EI SISALDA failinime — täpselt nagu tootmises
    repo.index.commit(f"Kustuta 1 lehte: {folder} [{work_id}]", author=actor, committer=actor)

    kirjed = trash_ops.list_deleted_pages(work_id, folder)

    assert len(kirjed) == 1
    assert kirjed[0]["commit_hash"], "teepõhine otsing ei leidnud kustutamise commiti"
    assert kirjed[0]["deleted_by"] == "kustutaja"
    assert kirjed[0]["reason"] == "deleted"
    assert kirjed[0]["restorable"] is True
    assert kirjed[0]["v"] > 0, "pisipildi versioon (mtime_ns) puudub"


def test_list_deleted_pages_margib_poolituse_jaagi(trash_repo):
    """Poolituse jääk EI OLE taastatav — tema tagasitoomine annaks duplikaadi."""
    repo = trash_repo["repo"]
    base_dir = trash_repo["base_dir"]
    trash_root = trash_repo["trash_root"]
    work_id, folder = "page_w3", "1692-w3"
    folder_path = base_dir / folder
    folder_path.mkdir()
    (folder_path / "orig.txt").write_text("terve", encoding="utf-8")
    (folder_path / "orig.json").write_text("{}", encoding="utf-8")
    (folder_path / "orig.jpg").write_bytes(b"\xff\xd8jpg")
    repo.index.add([f"{folder}/orig.txt", f"{folder}/orig.json"])
    repo.index.commit("init")

    trash_pages = trash_root / work_id / "pages"
    trash_pages.mkdir(parents=True)
    import shutil
    shutil.move(str(folder_path / "orig.jpg"), str(trash_pages / "orig.jpg"))
    repo.git.rm(f"{folder}/orig.txt", f"{folder}/orig.json")
    actor = Actor("poolitaja", "p@vutt.local")
    repo.index.commit(f"Lõika leht 3 ({folder}): eemalda originaal [{work_id}]",
                      author=actor, committer=actor)

    kirjed = trash_ops.list_deleted_pages(work_id, folder)

    assert kirjed[0]["reason"] == "split"
    assert kirjed[0]["restorable"] is False


def test_list_deleted_pages_jatab_kataloogid_vahele(monkeypatch, tmp_path):
    """`.thumbs` cache elab `pages/` KÕRVAL, aga loendaja peab olema kindel."""
    trash = tmp_path / "._trash" / "w9" / "pages"
    trash.mkdir(parents=True)
    (trash / "alamkaust").mkdir()
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(tmp_path / "._trash"))
    assert trash_ops.list_deleted_pages("w9", "1693-w9") == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_trash_ops.py -q`
Expected: FAIL — `KeyError: 'reason'` ja `assert kirjed[0]["commit_hash"]` (vana `--grep` ei leia)

- [ ] **Step 3: Write minimal implementation**

`server/trash_ops.py` importide juurde:

```python
from .trash_reason import liigita, on_taastatav
```

Uus abifunktsioon (`list_deleted_pages` ette):

```python
def leia_kustutamise_commit(repo, folder_name, base):
    """Viimane commit, mis selle lehe `.txt`-i kustutas. TEE, mitte sõnum.

    Vana `--grep {kaust}/{base}` eeldas, et failinimi on commiti sõnumis. Ei
    ole: hulgikustutus kirjutab „Kustuta 2 lehte: {kaust}" ja poolitus
    „Lõika leht N (…)". Tootmises jäi nii 303 kirjet 462-st ilma kuupäeva,
    autori ja TAASTATAVUSETA (#325).

    `.txt` on ankur: ta on igal lehel olemas ja git-tracked (`.jpg` ei ole).
    """
    try:
        rida = repo.git.log(
            '--all', '--oneline', '--diff-filter=D', '-1',
            '--', f'{folder_name}/{base}.txt'
        ).strip()
    except Exception as e:
        logger.warning(f"TRASH: git log ebaõnnestus {folder_name}/{base}: {e}")
        return None, None
    if not rida:
        return None, None
    commit_hash = rida.split(' ', 1)[0]
    try:
        return commit_hash, repo.commit(commit_hash).message
    except Exception:
        return commit_hash, None
```

`list_deleted_pages` tsükli sisu (asendab senise `--grep` ploki):

```python
    for fname in sorted(os.listdir(trash_pages_dir)):
        tee = os.path.join(trash_pages_dir, fname)
        # Kataloogid (nt `.thumbs` cache) ei ole kirjed.
        if not os.path.isfile(tee):
            continue
        if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        base = os.path.splitext(fname)[0]

        commit_hash, sonum = leia_kustutamise_commit(repo, folder_name, base)
        liik = liigita(sonum)
        item = {
            'filename': fname,
            'base_name': base,
            'deleted_at': None,
            'deleted_by': None,
            'commit_hash': commit_hash,
            'reason': liik,
            # Serveri otsus, mitte kliendi tuletus — sama reegel juhib endpointi.
            'restorable': on_taastatav(liik),
            # Pisipildi versioon: failinimi EI OLE muutumatuse garantii, sest
            # taastatud+muudetud+uuesti kustutatud leht jõuab sama tee peale.
            'v': os.stat(tee).st_mtime_ns,
        }
        if commit_hash:
            try:
                commit = repo.commit(commit_hash)
                item['deleted_at'] = commit.committed_datetime.isoformat()
                item['deleted_by'] = commit.author.name
            except Exception as e:
                logger.warning(f"TRASH: commiti {commit_hash} lugemine ebaõnnestus: {e}")

        pages.append(item)
```

`restore_deleted_page` samm 1 (asendab `--grep` ploki):

```python
    commit_hash, sonum = leia_kustutamise_commit(repo, folder_name, base)
    if not commit_hash:
        return {'ok': False, 'reason': 'unknown',
                'error': 'Kustutamise committi ei leitud — lehte ei saa taastada'}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_trash_ops.py -q`
Expected: PASS — sh olemasolev `test_restore_deleted_page_full_flow` (regressioon: sõnum, mis SISALDAB failinime, peab endiselt toimima)

- [ ] **Step 5: Commit**

```bash
git add server/trash_ops.py tests/test_trash_ops.py
git commit -m "fix(trash): kustutamise commit leitakse tee, mitte sõnumi järgi (#325)"
```

---

### Task 4: Taastamise keeld serveris (409)

**Files:**
- Modify: `server/trash_ops.py` (`restore_deleted_page`)
- Modify: `server/routers/admin.py` (rida ~306–312, `admin_trash_page_restore`)
- Test: `tests/test_trash_ops.py` (lisandub)

**Interfaces:**
- Consumes: `leia_kustutamise_commit` (Task 3), `trash_reason.liigita`, `on_taastatav`
- Produces: `restore_deleted_page` vastus `{'ok': False, 'reason': 'split'|'unknown', 'error': str}`; router → HTTP 409

- [ ] **Step 1: Write the failing test**

```python
# lisa tests/test_trash_ops.py lõppu
def test_restore_keeldub_poolituse_jaagist_ja_ei_puutu_faile(trash_repo):
    """Punkt 3: duplikaat ei tohi tekkida ka otse API kaudu.

    Ainult liideses peitmine jätaks vea endpointi alles — „ainult adminid
    saavad andmeid rikkuda" ei ole kaitse.
    """
    repo = trash_repo["repo"]
    base_dir = trash_repo["base_dir"]
    trash_root = trash_repo["trash_root"]
    work_id, folder = "page_w4", "1694-w4"
    folder_path = base_dir / folder
    folder_path.mkdir()
    (folder_path / "orig.txt").write_text("terve", encoding="utf-8")
    (folder_path / "orig.json").write_text('{"sequence": 300}', encoding="utf-8")
    (folder_path / "orig.jpg").write_bytes(b"\xff\xd8jpg")
    repo.index.add([f"{folder}/orig.txt", f"{folder}/orig.json"])
    repo.index.commit("init")

    trash_pages = trash_root / work_id / "pages"
    trash_pages.mkdir(parents=True)
    import shutil
    shutil.move(str(folder_path / "orig.jpg"), str(trash_pages / "orig.jpg"))
    repo.git.rm(f"{folder}/orig.txt", f"{folder}/orig.json")
    actor = Actor("poolitaja", "p@vutt.local")
    repo.index.commit(f"Lõika leht 3 ({folder}): eemalda originaal [{work_id}]",
                      author=actor, committer=actor)

    res = trash_ops.restore_deleted_page(work_id, folder, "orig.jpg", username="taastaja")

    assert res["ok"] is False
    assert res["reason"] == "split"
    # Ükski fail ei tohi liikuda ega tekkida
    assert (trash_pages / "orig.jpg").exists(), "jääk liigutati prügikastist ära"
    assert not (folder_path / "orig.txt").exists(), "tekst toodi gitist tagasi"
    assert not (folder_path / "orig.jpg").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_trash_ops.py::test_restore_keeldub_poolituse_jaagist_ja_ei_puutu_faile -q`
Expected: FAIL — `res["ok"] is True` ja failid liigutatud (praegu taastab)

- [ ] **Step 3: Write minimal implementation**

`server/trash_ops.py`, `restore_deleted_page` sammu 1 järel, **enne** ühtki failioperatsiooni:

```python
    liik = liigita(sonum)
    if not on_taastatav(liik):
        selgitus = (
            "Poolituse jääk ei ole taastatav: see on kahe praeguse lehe lähtepilt. "
            "Terve topeltlehe saab tagasi kummagi poole pildiredaktorist "
            "(„Taasta originaal\")."
            if liik == "split" else
            "Kirje päritolu ei ole teada — taastamine võib teha duplikaadi."
        )
        return {'ok': False, 'reason': liik, 'error': selgitus}
```

`server/routers/admin.py` restore-route (praegu tagastab `res` otse):

```python
    res = restore_deleted_page(work_id, os.path.basename(path), filename, username=user["username"])
    if not res.get("ok") and res.get("reason") in ("split", "unknown"):
        # 409: päring on korrektne, aga selle kirje liigiga see operatsioon ei käi.
        raise HTTPException(status_code=409, detail=res.get("error"))
    return res
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_trash_ops.py -q`
Expected: PASS (sh `test_restore_deleted_page_full_flow` — keeld ei tohi tabada õiget juhtu)

- [ ] **Step 5: Käivita KÕIK väravad ja commit**

```bash
.venv/bin/pytest tests/ -q && npm run typecheck && npx vitest run && npm run lint:ci
git add server/trash_ops.py server/routers/admin.py tests/test_trash_ops.py
git commit -m "fix(trash): poolituse jääki ja tundmatut kirjet ei taastata (#325)"
```

> **Avaldamise värav:** ülesanded 1–4 moodustavad esimese tootmisse mineva partii. Enne edasiminekut võib selle mergida ja deploy'da; ülesanded 5–8 on liidese osa ja neid saab teha eraldi.

---

### Task 5: Pisipildi-endpoint `._trash` ja `._originals` alt

**Files:**
- Create: `server/history_thumbs.py`
- Modify: `server/routers/admin.py` (uus route)
- Test: `tests/test_history_thumbs.py`

**Interfaces:**
- Consumes: —
- Produces: `ajaloo_pisipilt(work_id: str, kind: str, filename: str) -> Optional[str]` (tagastab cache-faili tee või `None`); route `GET /admin/work/{work_id}/history-thumb/{kind}/{filename}`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_history_thumbs.py
"""Ajaloo-pisipildid: cache versioonitakse lähtefaili järgi (#325).

Failinimi EI OLE muutumatuse garantii: `replace-image` säilitab nime ja kutsub
`clear_original_backup`-i, seega järgmine kärbe loob sama tee alla TEISE pildi.
Ilma versioonita jääks kettale vale pisipilt ja liides näitaks vana.
"""
import os
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import history_thumbs


def _pilt(tee: Path, suurus=(1200, 1600), varv=(10, 20, 30)):
    tee.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", suurus, varv).save(tee, "JPEG", quality=90)


def test_pisipilt_tekib_ja_on_vahendatud(tmp_path, monkeypatch):
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    _pilt(tmp_path / "._trash" / "w1" / "pages" / "leht.jpg")

    tee = history_thumbs.ajaloo_pisipilt("w1", "trash", "leht.jpg")

    assert tee and os.path.isfile(tee)
    with Image.open(tee) as im:
        assert max(im.size) <= history_thumbs.THUMB_MAX_PX


def test_lahtefaili_muutus_annab_uue_pisipildi(tmp_path, monkeypatch):
    """Sama failinimi, uus sisu → uus cache-fail, vana koristatakse."""
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    allikas = tmp_path / "._originals" / "w1" / "leht.jpg"
    _pilt(allikas, varv=(10, 20, 30))
    esimene = history_thumbs.ajaloo_pisipilt("w1", "original", "leht.jpg")

    # Asenda pilt (nagu replace-image + uus kärbe teeb) ja muuda mtime
    _pilt(allikas, varv=(200, 100, 50))
    os.utime(allikas, ns=(os.stat(allikas).st_mtime_ns + 10**9,) * 2)
    teine = history_thumbs.ajaloo_pisipilt("w1", "original", "leht.jpg")

    assert teine != esimene, "cache ei uuenenud lähtefaili muutudes"
    assert not os.path.exists(esimene), "vana pisipilt jäi kettale vedelema"


def test_teekonna_pogenemine_ja_tundmatu_liik(tmp_path, monkeypatch):
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    with pytest.raises(ValueError):
        history_thumbs.ajaloo_pisipilt("w1", "trash", "../../etc/passwd")
    with pytest.raises(ValueError):
        history_thumbs.ajaloo_pisipilt("w1", "muu", "leht.jpg")


def test_puuduv_fail_annab_none(tmp_path, monkeypatch):
    monkeypatch.setattr(history_thumbs, "BASE_DIR", str(tmp_path))
    assert history_thumbs.ajaloo_pisipilt("w1", "trash", "ei-ole.jpg") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_history_thumbs.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.history_thumbs'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/history_thumbs.py
"""Pisipildid prügikasti ja originaalide kaustadest (#325).

Need failid ei ole avalikud, seega pildiserver (port 8001) neid ei serveeri —
tee käib admin-endpointist. Originaal on ~2 MB ja kirjeid on teoses kuni sadu,
seega saadetakse alati vähendatud koopia.
"""
import os
from typing import Optional

from PIL import Image

from .config import BASE_DIR, get_logger

logger = get_logger(__name__)

THUMB_MAX_PX = 400
LIIGID = {
    "trash": ("._trash", "pages"),
    "original": ("._originals", None),
}


def _lahte_kaust(work_id: str, kind: str) -> str:
    if kind not in LIIGID:
        raise ValueError(f"Tundmatu liik: {kind}")
    juur, alam = LIIGID[kind]
    osad = [BASE_DIR, juur, work_id]
    if alam:
        osad.append(alam)
    return os.path.join(*osad)


def ajaloo_pisipilt(work_id: str, kind: str, filename: str) -> Optional[str]:
    """Tagastab pisipildi tee, luues selle vajadusel. None = lähtefaili ei ole."""
    if os.path.basename(filename) != filename or filename.startswith('.'):
        raise ValueError("Vigane failinimi")
    kaust = _lahte_kaust(work_id, kind)
    allikas = os.path.join(kaust, filename)
    if not os.path.isfile(allikas):
        return None

    # Versioon = lähtefaili mtime_ns. Failinimi ei muutu (replace-image
    # säilitab selle), seega ainult sisu muutus eristab variante.
    versioon = os.stat(allikas).st_mtime_ns
    base = os.path.splitext(filename)[0]
    # Cache elab `pages/` KÕRVAL (`._trash/{wid}/.thumbs`), mitte sees — muidu
    # ilmuks pisipilt prügikasti loendisse omaette kirjena.
    cache_juur = os.path.dirname(kaust) if kind == "trash" else kaust
    cache_kaust = os.path.join(cache_juur, ".thumbs")
    os.makedirs(cache_kaust, exist_ok=True)
    siht = os.path.join(cache_kaust, f"{base}_{versioon}.jpg")
    if os.path.isfile(siht):
        return siht

    # Vanad variandid samast lähtefailist ära
    for vana in os.listdir(cache_kaust):
        if vana.startswith(f"{base}_") and vana.endswith(".jpg"):
            try:
                os.remove(os.path.join(cache_kaust, vana))
            except OSError:
                pass

    try:
        with Image.open(allikas) as raw:
            img = raw.convert("RGB")
            img.thumbnail((THUMB_MAX_PX, THUMB_MAX_PX))
            img.save(siht, "JPEG", quality=80)
    except Exception as e:
        logger.warning(f"AJALUGU: pisipildi loomine ebaõnnestus {allikas}: {e}")
        return None
    return siht
```

`server/routers/admin.py` — **`FileResponse` ei ole seal veel imporditud**, lisa
importide juurde:

```python
from fastapi.responses import FileResponse
from ..history_thumbs import ajaloo_pisipilt
```

Ja route:

```python
@router.get("/admin/work/{work_id}/history-thumb/{kind}/{filename}")
def admin_history_thumb(work_id: str, kind: str, filename: str,
                        user=Depends(require_role("admin"))):
    """Pisipilt prügikasti või originaalide kaustast.

    `<img src>` ei saa saata Authorization päist — `get_user` võtab tokeni ka
    query-parameetrist (`deps.py:29`), seega klient lisab `?token=`.
    """
    try:
        tee = ajaloo_pisipilt(work_id, kind, os.path.basename(filename))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not tee:
        raise HTTPException(status_code=404)
    return FileResponse(tee, media_type="image/jpeg", headers={
        "Cache-Control": "private, max-age=86400, immutable",
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_history_thumbs.py -q`
Expected: PASS (4 testi)

- [ ] **Step 5: Lisa endpointi test ja commit**

```python
# lisa tests/test_backend_smoke.py lõppu (kasutab olemasolevat `client` fixture'it)
def test_history_thumb_ilma_tokenita_on_401(client):
    """`get_user` annab NII puuduva tokeni KUI liiga madala rolli korral 401."""
    r = client.get("/admin/work/w1/history-thumb/trash/leht.jpg")
    assert r.status_code == 401
```

```bash
.venv/bin/pytest tests/test_history_thumbs.py tests/test_backend_smoke.py -q
git add server/history_thumbs.py server/routers/admin.py tests/test_history_thumbs.py tests/test_backend_smoke.py
git commit -m "feat(trash): ajaloo-pisipildi endpoint versioonitud cache'iga (#325)"
```

---

### Task 6: Muudetud piltide loend + logi parsimine

**Files:**
- Create: `server/image_history.py`
- Modify: `server/routers/admin.py` (uus route)
- Test: `tests/test_image_history.py`

**Interfaces:**
- Consumes: `server.utils.find_directory_by_id`, `server.admin_page_ops.get_sorted_images`
- Produces: `parsi_logirida(rida: str) -> Optional[dict]` (→ `{"at", "by", "work_id", "filename", "action": list}`); `muudetud_pildid(work_id: str) -> list`; route `GET /admin/work/{work_id}/modified-images`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_image_history.py
"""Muudetud piltide loend ja `transform_image.log` leping (#325).

Logireal on angle/crop/quad ALATI kohal, ka väärtustega 0.0 ja None — tegevus
tuleb tuletada VÄÄRTUSEST, mitte võtme olemasolust. Üks salvestus võib
sisaldada mitut teisendust. `split_page` ei kirjuta siia ridagi.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import image_history


KARBE = ("2026-09-07T12:54:49.150562 | raheltoomik | 9ghbrc | lk_003.jpg | "
         "angle=0.0 crop={'x': 0.49, 'y': 0.01, 'w': 0.5, 'h': 0.97} quad=None | -> 2349x3239")
PUUTUMATA = ("2026-09-04T10:00:00.000000 | meelis | 9ghbrc | lk_004.jpg | "
             "angle=0.0 crop=None quad=None | -> 100x100")
POORE_JA_KARBE = ("2026-09-04T11:00:00.000000 | meelis | 9ghbrc | lk_005.jpg | "
                  "angle=1.5 crop={'x': 0} quad=None | -> 100x100")
TAASTUS = "2026-09-05T09:00:00.000000 | meelis | 9ghbrc | lk_003.jpg | restore_original | -> restored"


def test_karbe_tuvastatakse_vaartusest():
    kirje = image_history.parsi_logirida(KARBE)
    assert kirje["action"] == ["crop"]
    assert kirje["by"] == "raheltoomik"
    assert kirje["filename"] == "lk_003.jpg"


def test_nullvaartused_ei_ole_tegevused():
    """`angle=0.0 crop=None quad=None` = midagi ei tehtud."""
    assert image_history.parsi_logirida(PUUTUMATA)["action"] == []


def test_uks_toiming_mitu_tegevust():
    assert image_history.parsi_logirida(POORE_JA_KARBE)["action"] == ["rotate", "crop"]


def test_taastuse_rida():
    assert image_history.parsi_logirida(TAASTUS)["action"] == ["restore"]


def test_katkine_rida_ei_kuku():
    assert image_history.parsi_logirida("prügi ilma torudeta") is None
    assert image_history.parsi_logirida("") is None


def test_muudetud_pildid_filtreerib_ja_margib_poolituse(tmp_path, monkeypatch):
    """Kolm asja korraga: kadunud fail välja, logita kirje = poolitusest,
    lehekülje number tuleb teose kausta järjekorrast."""
    data = tmp_path
    töö = data / "1700-w1"
    töö.mkdir()
    for nimi in ("a.jpg", "b.jpg"):
        (töö / nimi).write_bytes(b"\xff\xd8jpg")
    originals = data / "._originals" / "w1"
    originals.mkdir(parents=True)
    for nimi in ("a.jpg", "b.jpg", "kadunud.jpg"):
        (originals / nimi).write_bytes(b"\xff\xd8jpg")
    (data / "transform_image.log").write_text(
        "2026-09-07T12:00:00.000000 | meelis | w1 | a.jpg | "
        "angle=0.0 crop={'x': 0.1} quad=None | -> 10x10\n",
        encoding="utf-8")

    monkeypatch.setattr(image_history, "BASE_DIR", str(data))
    monkeypatch.setattr(image_history, "find_directory_by_id", lambda wid: str(töö))

    kirjed = {k["filename"]: k for k in image_history.muudetud_pildid("w1")}

    assert set(kirjed) == {"a.jpg", "b.jpg"}, "kadunud fail ei tohi loendis olla"
    assert kirjed["a.jpg"]["action"] == ["crop"] and kirjed["a.jpg"]["by"] == "meelis"
    assert kirjed["a.jpg"]["page"] == 1 and kirjed["b.jpg"]["page"] == 2
    # Logireata kirje = poolitusest (split_page populeerib ._originals, aga ei logi)
    assert kirjed["b.jpg"]["action"] == ["split"]
    assert kirjed["b.jpg"]["by"] is None and kirjed["b.jpg"]["at"] is None
    assert kirjed["b.jpg"]["v"] > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_image_history.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.image_history'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/image_history.py
"""Muudetud piltide loend teose kohta (#325).

Allikas on `._originals/{work_id}/` (mis lehel ON pristine originaal alles) ja
`data/transform_image.log` (kes, millal, mida tegi). Parsimine käib SIIN, mitte
frontendis: logivorming on serveri asi ja klient saab juba tuletatud väljad.
"""
import os
import re
from typing import Optional

from .config import BASE_DIR, get_logger
from .utils import find_directory_by_id

logger = get_logger(__name__)

LOGI_NIMI = "transform_image.log"

# 5 välja torudega: aeg | kasutaja | work_id | failinimi | parameetrid | -> tulemus
_RIDA = re.compile(r'^([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|(.*)\|([^|]*)$')


def parsi_logirida(rida: str) -> Optional[dict]:
    """Üks logirida → kirje, või None kui rida ei ole loetav.

    Tegevus tuleb VÄÄRTUSEST: `angle=`, `crop=` ja `quad=` on igal teisendusreal
    kohal, ka `0.0` / `None`. Võtme olemasolu järgi otsustamine märgiks iga
    salvestuse kärpeks.
    """
    if not rida or not rida.strip():
        return None
    m = _RIDA.match(rida.strip())
    if not m:
        return None
    aeg, kasutaja, work_id, failinimi, param, _ = (o.strip() for o in m.groups())

    tegevused = []
    if "restore_original" in param:
        tegevused.append("restore")
    else:
        nurk = re.search(r'angle=([-\d.eE+]+)', param)
        if nurk:
            try:
                if abs(float(nurk.group(1))) > 0:
                    tegevused.append("rotate")
            except ValueError:
                pass
        if re.search(r'crop=(?!None)', param):
            tegevused.append("crop")
        if re.search(r'quad=(?!None)', param):
            tegevused.append("quad")
    return {"at": aeg, "by": kasutaja, "work_id": work_id,
            "filename": failinimi, "action": tegevused}


def _viimased_logikirjed(work_id: str) -> dict:
    """failinimi → viimane kirje. Puuduv või katkine logi ei kuku päringut."""
    tee = os.path.join(BASE_DIR, LOGI_NIMI)
    tulemus = {}
    try:
        with open(tee, "r", encoding="utf-8") as f:
            for rida in f:
                kirje = parsi_logirida(rida)
                if kirje and kirje["work_id"] == work_id:
                    tulemus[kirje["filename"]] = kirje
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning(f"AJALUGU: {LOGI_NIMI} lugemine ebaõnnestus: {e}")
    return tulemus


def muudetud_pildid(work_id: str) -> list:
    """Lehed, millel on pristine originaal alles JA mis on veel teoses olemas."""
    from .admin_page_ops import get_sorted_images

    kaust = os.path.join(BASE_DIR, "._originals", work_id)
    if not os.path.isdir(kaust):
        return []
    tee = find_directory_by_id(work_id)
    if not tee:
        return []

    jarjekord = {nimi: i + 1 for i, nimi in enumerate(get_sorted_images(tee))}
    logi = _viimased_logikirjed(work_id)

    kirjed = []
    for nimi in sorted(os.listdir(kaust)):
        allikas = os.path.join(kaust, nimi)
        # `.thumbs` cache ja muu kataloogi-sisu ei ole kirjed.
        if not os.path.isfile(allikas) or not nimi.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        # Kadunud leht: originaal kuulub hiljem kustutatud või poolitatud lehele.
        if nimi not in jarjekord:
            continue
        kirje = logi.get(nimi)
        kirjed.append({
            "filename": nimi,
            "page": jarjekord[nimi],
            # Logireata kirje tuleb poolitusest: `split_page` populeerib
            # ._originals mõlemale poolele, aga ei kirjuta logisse.
            "action": kirje["action"] if kirje else ["split"],
            "at": kirje["at"] if kirje else None,
            "by": kirje["by"] if kirje else None,
            "v": os.stat(allikas).st_mtime_ns,
        })
    return kirjed
```

`server/routers/admin.py` — lisa import `from ..image_history import muudetud_pildid`
ja route:

```python
@router.get("/admin/work/{work_id}/modified-images")
def admin_modified_images(work_id: str, user=Depends(require_role("admin"))):
    """Lehed, mille pilti on muudetud ja mille originaal on alles."""
    return {"status": "success", "images": muudetud_pildid(work_id)}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_image_history.py -q`
Expected: PASS (6 testi)

- [ ] **Step 5: Commit**

```bash
.venv/bin/pytest tests/ -q
git add server/image_history.py server/routers/admin.py tests/test_image_history.py
git commit -m "feat(trash): muudetud piltide loend + logi parsimine serveris (#325)"
```

---

### Task 7: Frontendi andmekiht ja rühmitamine

**Files:**
- Modify: `src/services/workApi.ts` (`DeletedWorkPage` rida 23–29, uus `getModifiedImages`)
- Create: `src/pages/manage/trashGrouping.ts`
- Create: `src/pages/manage/__tests__/trashGrouping.test.ts`
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json`

**Interfaces:**
- Consumes: API väljad `reason`, `restorable`, `v` (Task 3), `modified-images` (Task 6)
- Produces: `export interface ModifiedImage`, `getModifiedImages(workId, token)`, `historyThumbUrl(workId, kind, filename, v, token)`, `ruhmita(pages: DeletedWorkPage[]): { deleted, split }`

- [ ] **Step 1: Write the failing test**

```typescript
// src/pages/manage/__tests__/trashGrouping.test.ts
import { describe, expect, it } from 'vitest';
import { ruhmita, historyThumbUrl } from '../trashGrouping';
import type { DeletedWorkPage } from '../../../services/workApi';

const kirje = (filename: string, reason: string, restorable: boolean): DeletedWorkPage => ({
  filename, base_name: filename.replace('.jpg', ''), deleted_at: null, deleted_by: null,
  commit_hash: null, reason, restorable, v: 1,
});

describe('ruhmita', () => {
  it('kustutatud ja tundmatud on ühes plokis, jäägid teises', () => {
    const out = ruhmita([
      kirje('a.jpg', 'deleted', true),
      kirje('b.jpg', 'split', false),
      kirje('c.jpg', 'unknown', false),
    ]);
    expect(out.deleted.map((k) => k.filename)).toEqual(['a.jpg', 'c.jpg']);
    expect(out.split.map((k) => k.filename)).toEqual(['b.jpg']);
  });

  it('ükski kirje ei kao — ka tundmatu liigiga', () => {
    const sisend = [kirje('a.jpg', 'deleted', true), kirje('b.jpg', 'split', false),
                    kirje('c.jpg', 'unknown', false), kirje('d.jpg', 'midagi_uut', false)];
    const out = ruhmita(sisend);
    expect(out.deleted.length + out.split.length).toBe(sisend.length);
  });

  it('taastatavus tuleb serverist, mitte liigist', () => {
    // Server on ainus, kes otsustab; klient ei tohi reeglit korrata.
    const out = ruhmita([kirje('a.jpg', 'deleted', false)]);
    expect(out.deleted[0].restorable).toBe(false);
  });
});

describe('historyThumbUrl', () => {
  it('kannab versiooni ja tokeni kaasa', () => {
    const url = historyThumbUrl('w1', 'trash', 'a b.jpg', 12345, 'tok');
    expect(url).toContain('/admin/work/w1/history-thumb/trash/a%20b.jpg');
    expect(url).toContain('v=12345');
    expect(url).toContain('token=tok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/manage/__tests__/trashGrouping.test.ts`
Expected: FAIL — `Failed to resolve import "../trashGrouping"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/pages/manage/trashGrouping.ts
import { FILE_API_URL } from '../../config';
import type { DeletedWorkPage } from '../../services/workApi';

/** Prügikasti kirjed kahte plokki. `unknown` läheb kustutatud lehtede juurde
 *  sildiga — fail on kettal olemas ja nähtamatu kirje on halvem kui sildistatud. */
export function ruhmita(pages: DeletedWorkPage[]): {
  deleted: DeletedWorkPage[];
  split: DeletedWorkPage[];
} {
  const deleted: DeletedWorkPage[] = [];
  const split: DeletedWorkPage[] = [];
  for (const p of pages) (p.reason === 'split' ? split : deleted).push(p);
  return { deleted, split };
}

/** `<img src>` ei saa saata Authorization päist → token käib query-parameetris
 *  (server toetab seda `deps.py`-s). `v` on lähtefaili mtime_ns: failinimi ei
 *  muutu, seega ilma selleta näitaks brauser asendatud pildi asemel vana. */
export function historyThumbUrl(
  workId: string, kind: 'trash' | 'original', filename: string,
  v: number, token: string | null,
): string {
  const base = `${FILE_API_URL}/admin/work/${workId}/history-thumb/${kind}/${encodeURIComponent(filename)}`;
  return `${base}?v=${v}&token=${encodeURIComponent(token ?? '')}`;
}
```

`src/services/workApi.ts` — laienda tüüpi ja lisa päring:

```typescript
export interface DeletedWorkPage {
  filename: string;
  base_name: string;
  deleted_at: string | null;
  deleted_by: string | null;
  commit_hash: string | null;
  /** 'deleted' | 'split' | 'unknown' — serveri liigitus commiti sõnumist. */
  reason: string;
  /** Serveri otsus. Klient EI tuleta seda liigist — reegel elab ühes kohas. */
  restorable: boolean;
  /** Lähtefaili mtime_ns pisipildi URL-i jaoks. */
  v: number;
}

export interface ModifiedImage {
  filename: string;
  page: number;
  action: string[];
  at: string | null;
  by: string | null;
  v: number;
}

export interface ModifiedImagesResponse extends ApiStatusResponse {
  images?: ModifiedImage[];
}

export function getModifiedImages(workId: string, token: string | null) {
  return apiGet<ModifiedImagesResponse>(`/admin/work/${workId}/modified-images`, auth(token));
}
```

i18n — **mõlemasse** faili (`fallbackLng` on väljas). Olemas on juba
`manage.trash.{deletedAt, deletedBy, empty, load, loadError, restore, restoreError,
restoreSuccess, restoring}` — need jäävad; `manage.tabTrash` saab uue väärtuse ja
alla lisandub:

```json
"tabTrash": "Prügikast ja pildiajalugu",
"trash": {
  "sectionDeleted": "Kustutatud leheküljed",
  "sectionModified": "Muudetud pildid",
  "sectionSplit": "Poolituse jäägid",
  "showSplit": "Näita",
  "hideSplit": "Peida",
  "badgeUnknown": "Päritolu teadmata",
  "unknownHint": "Ei tea, kas see on kustutatud leht või poolituse jääk — taastamine võib teha duplikaadi.",
  "splitHint": "Need on poolitatud lehtede LÄHTEPILDID, mitte kustutatud leheküljed. Poolituse tagasivõtmiseks: 1) ava vasak pool pildiredaktoris → „Taasta originaal\"; 2) too parema poole tekst vasakusse (<pb/> järele); 3) kustuta parem pool; 4) soovi korral poolita uuesti.",
  "actionCrop": "kärbitud",
  "actionRotate": "pööratud",
  "actionQuad": "sirgestatud",
  "actionRestore": "originaal taastatud",
  "actionSplit": "poolitusest",
  "restoreOriginal": "Taasta originaal",
  "pageLabel": "lk {{page}}"
}
```

Inglise vasted: `"Trash and image history"`, `"Deleted pages"`, `"Modified images"`, `"Split remnants"`, `"Show"`, `"Hide"`, `"Origin unknown"`, `"Cannot tell whether this is a deleted page or a split remnant — restoring it may create a duplicate."`, `"These are the SOURCE images of split pages, not deleted pages. To undo a split: 1) open the left half in the image editor → \"Restore original\"; 2) move the right half's text into the left page (after <pb/>); 3) delete the right half; 4) split again if needed."`, `"cropped"`, `"rotated"`, `"deskewed"`, `"original restored"`, `"from a split"`, `"Restore original"`, `"p. {{page}}"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/manage/__tests__/trashGrouping.test.ts && npm run typecheck && npx vitest run src/locales`
Expected: PASS, sh `localeParity.test.ts` (et/en võtmestik identne)

- [ ] **Step 5: Commit**

```bash
git add src/services/workApi.ts src/pages/manage/trashGrouping.ts src/pages/manage/__tests__/trashGrouping.test.ts src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat(manage): prügikasti rühmitamine, ajaloo API ja tõlked (#325)"
```

---

### Task 8: Kolm plokki liideses

**Files:**
- Create: `src/pages/manage/TrashDeletedPages.tsx`
- Create: `src/pages/manage/TrashModifiedImages.tsx`
- Create: `src/pages/manage/TrashSplitRemnants.tsx`
- Modify: `src/pages/WorkManage.tsx` (tab `trash` sisu, rida ~1082–1170)

**Interfaces:**
- Consumes: `ruhmita`, `historyThumbUrl` (Task 7), `getModifiedImages` (Task 7), `restoreOriginalPageImage` (`src/services/pageService.ts:204`)
- Produces: kolm komponenti, mille propid on allpool; `WorkManage.tsx` jääb koordinaatoriks

- [ ] **Step 1: Kirjuta kolm komponenti**

`src/pages/manage/TrashDeletedPages.tsx` — kõik kirjed, mille `reason !== 'split'`:

```tsx
import React from 'react';
import { Loader2, RotateCcw, HelpCircle } from 'lucide-react';
import type { DeletedWorkPage } from '../../services/workApi';
import { historyThumbUrl } from './trashGrouping';

interface Props {
  pages: DeletedWorkPage[];
  workId: string;
  token: string | null;
  restoringPage: string | null;
  onRestore: (filename: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Kustutatud leheküljed + `unknown` kirjed. Viimased on nähtaval SILDIGA, aga
 *  ilma taastenuputa: fail on kettal olemas, ja nähtamatu kirje on halvem kui
 *  sildistatud (#325). */
const TrashDeletedPages: React.FC<Props> = ({
  pages, workId, token, restoringPage, onRestore, t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
    <div className="px-5 py-4 border-b border-gray-100">
      <h2 className="font-semibold text-gray-800">
        {t('manage.trash.sectionDeleted')} ({pages.length})
      </h2>
    </div>
    {pages.length === 0 ? (
      <p className="p-5 text-sm text-gray-400">{t('manage.trash.empty')}</p>
    ) : (
      <div className="divide-y divide-gray-100">
        {pages.map((p) => (
          <div key={p.filename} className="flex items-center gap-3 px-5 py-3">
            <img
              src={historyThumbUrl(workId, 'trash', p.filename, p.v, token)}
              alt=""
              loading="lazy"
              className="h-16 w-12 flex-shrink-0 rounded border border-gray-200 bg-gray-50 object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700 font-mono truncate">{p.filename}</p>
              {p.deleted_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {t('manage.trash.deletedAt')}: {new Date(p.deleted_at).toLocaleString('et-EE', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {p.deleted_by && ` · ${p.deleted_by}`}
                </p>
              )}
              {!p.restorable && (
                <p className="mt-1 flex items-start gap-1 text-xs text-amber-700">
                  <HelpCircle size={12} className="mt-0.5 shrink-0" />
                  <span>
                    <strong>{t('manage.trash.badgeUnknown')}</strong> — {t('manage.trash.unknownHint')}
                  </span>
                </p>
              )}
            </div>
            {p.restorable && (
              <button
                onClick={() => onRestore(p.filename)}
                disabled={restoringPage === p.filename}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 text-white rounded transition-colors disabled:opacity-50"
              >
                {restoringPage === p.filename ? (
                  <><Loader2 size={13} className="animate-spin" />{t('manage.trash.restoring')}</>
                ) : (
                  <><RotateCcw size={13} />{t('manage.trash.restore')}</>
                )}
              </button>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

export default TrashDeletedPages;
```

`src/pages/manage/TrashModifiedImages.tsx`:

```tsx
import React from 'react';
import { Loader2, RotateCcw } from 'lucide-react';
import type { ModifiedImage } from '../../services/workApi';
import { historyThumbUrl } from './trashGrouping';

interface Props {
  images: ModifiedImage[];
  workId: string;
  token: string | null;
  restoringOriginal: string | null;
  onRestoreOriginal: (filename: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Tegevuse kood → tõlkevõti. Tundmatu kood kuvatakse toorelt, mitte ei kao:
 *  vaikiv väljajätmine peidaks uue backend-välja. */
const TEGEVUSE_VOTI: Record<string, string> = {
  crop: 'manage.trash.actionCrop',
  rotate: 'manage.trash.actionRotate',
  quad: 'manage.trash.actionQuad',
  restore: 'manage.trash.actionRestore',
  split: 'manage.trash.actionSplit',
};

const TrashModifiedImages: React.FC<Props> = ({
  images, workId, token, restoringOriginal, onRestoreOriginal, t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
    <div className="px-5 py-4 border-b border-gray-100">
      <h2 className="font-semibold text-gray-800">
        {t('manage.trash.sectionModified')} ({images.length})
      </h2>
    </div>
    {images.length === 0 ? (
      <p className="p-5 text-sm text-gray-400">{t('manage.trash.empty')}</p>
    ) : (
      <div className="divide-y divide-gray-100">
        {images.map((i) => (
          <div key={i.filename} className="flex items-center gap-3 px-5 py-3">
            <img
              src={historyThumbUrl(workId, 'original', i.filename, i.v, token)}
              alt=""
              loading="lazy"
              className="h-16 w-12 flex-shrink-0 rounded border border-gray-200 bg-gray-50 object-cover"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700">
                {t('manage.trash.pageLabel', { page: i.page })}
                {i.action.length > 0 && (
                  <span className="text-gray-500">
                    {' · '}
                    {i.action.map((a) => (TEGEVUSE_VOTI[a] ? t(TEGEVUSE_VOTI[a]) : a)).join(', ')}
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">{i.filename}</p>
              {i.at && (
                <p className="text-xs text-gray-400">
                  {new Date(i.at).toLocaleString('et-EE', {
                    day: '2-digit', month: '2-digit', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                  {i.by && ` · ${i.by}`}
                </p>
              )}
            </div>
            <button
              onClick={() => onRestoreOriginal(i.filename)}
              disabled={restoringOriginal === i.filename}
              className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-sm border border-primary-600 text-primary-700 hover:bg-primary-50 rounded transition-colors disabled:opacity-50"
            >
              {restoringOriginal === i.filename ? (
                <><Loader2 size={13} className="animate-spin" />{t('manage.trash.restoring')}</>
              ) : (
                <><RotateCcw size={13} />{t('manage.trash.restoreOriginal')}</>
              )}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

export default TrashModifiedImages;
```

`src/pages/manage/TrashSplitRemnants.tsx` — kinni olles EI renderda ühtki `<img>`-i:

```tsx
import React, { useState } from 'react';
import { Info } from 'lucide-react';
import type { DeletedWorkPage } from '../../services/workApi';
import { historyThumbUrl } from './trashGrouping';

interface Props {
  pages: DeletedWorkPage[];
  workId: string;
  token: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

/** Poolituse jäägid: kahe elava lehe LÄHTEPILDID. Taastenuppu ei ole — juhis
 *  on ploki päises ÜKS kord, mitte iga kirje juures (#325). */
const TrashSplitRemnants: React.FC<Props> = ({ pages, workId, token, t }) => {
  const [avatud, setAvatud] = useState(false);
  if (pages.length === 0) return null;
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">
          {t('manage.trash.sectionSplit')} ({pages.length})
        </h2>
        <button
          onClick={() => setAvatud((v) => !v)}
          className="text-xs px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-600"
        >
          {avatud ? t('manage.trash.hideSplit') : t('manage.trash.showSplit')}
        </button>
      </div>
      {avatud && (
        <>
          <div className="m-5 mb-0 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span className="whitespace-pre-line">{t('manage.trash.splitHint')}</span>
          </div>
          <div className="divide-y divide-gray-100 mt-4">
            {pages.map((p) => (
              <div key={p.filename} className="flex items-center gap-3 px-5 py-3">
                <img
                  src={historyThumbUrl(workId, 'trash', p.filename, p.v, token)}
                  alt=""
                  loading="lazy"
                  className="h-16 w-12 flex-shrink-0 rounded border border-gray-200 bg-gray-50 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-700 font-mono truncate">{p.filename}</p>
                  {p.deleted_at && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {new Date(p.deleted_at).toLocaleString('et-EE', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                      {p.deleted_by && ` · ${p.deleted_by}`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default TrashSplitRemnants;
```

- [ ] **Step 2: Ühenda `WorkManage.tsx`-i**

`activeTab === 'trash'` ploki sees senine loend asendub:

```tsx
{(() => {
  const { deleted, split } = ruhmita(trashPages);
  return (
    <>
      <TrashDeletedPages pages={deleted} workId={workId} token={authToken}
        restoringPage={restoringPage} onRestore={handleRestorePage} t={t} />
      <TrashModifiedImages images={modifiedImages} workId={workId} token={authToken}
        restoringOriginal={restoringOriginal} onRestoreOriginal={handleRestoreOriginal} t={t} />
      <TrashSplitRemnants pages={split} workId={workId} token={authToken} t={t} />
    </>
  );
})()}
```

`modifiedImages` laetakse samas `loadTrashPages` funktsioonis (üks nupuvajutus laeb mõlemad):

```tsx
const [modifiedImages, setModifiedImages] = useState<ModifiedImage[]>([]);
// loadTrashPages sees, olemasoleva trash-päringu kõrvale:
const mi = await getModifiedImages(workId, authToken);
setModifiedImages(mi.images ?? []);
```

`handleRestoreOriginal` on uus: `restoreOriginalPageImage(workId, filename, authToken)`
(`src/services/pageService.ts:204`), hoiab `restoringOriginal` olekut ja laeb pärast
õnnestumist `loadTrashPages` uuesti (pisipildi `v` muutub, sest lähtefail muutus).

`handleRestorePage` veaharu peab 409 puhul näitama serveri `detail` teksti (mitte üldist
„taastamine ebaõnnestus") — see on koht, kus kasutaja saab teada, MIKS jääki ei taastata.

- [ ] **Step 3: Käivita väravad**

Run: `npm run typecheck && npx vitest run && npm run lint:ci`
Expected: typecheck puhas, kõik testid rohelised, lint ≤ 49 hoiatust

- [ ] **Step 4: Vaata päris andmete peal üle**

Käivita `npm run dev`, ava teose Halda → „Prügikast ja pildiajalugu". Kontrolli kolme asja:
kustutatud lehtede plokis on pisipildid ja kuupäevad; jääkide plokk on kinni ja avaneb;
„Taasta" jäägil puudub. (Lokaalne `data/` ei peegelda tootmist — kui kirjeid ei ole, tee
testteos ja kustuta seal üks leht.)

- [ ] **Step 5: Commit**

```bash
git add src/pages/manage/ src/pages/WorkManage.tsx
git commit -m "feat(manage): prügikast ja pildiajalugu kolmes plokis (#325)"
```

---

## Lõpetamine

- [ ] **PR + CI.** `gh pr create --base main`; CI jookseb ainult main'i-PR-idel.
- [ ] **Deploy kolm otsa:** backend `ssh vutt && cd ~/VUTT && ./scripts/server_update.sh --no-cache`; frontend `npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/`. nginx muudatust EI OLE.
- [ ] **Kontrolli tootmises:** ava üks teos, kus on poolituse jääke (nt `0mqha5`), ja veendu, et kustutatud lehtede plokis on kuupäevad olemas — see on see, mis täna 66% kirjetest puudu on.
- [ ] **Sulge #325** kommentaariga, mis loetleb lahtiseks jäävad otsad: 320 jäägi (~600 MB) koristus ja 75 kirjet kustutatud teostest.

## Lahtised otsad (EI kuulu sellesse plaani)

- Poolituse jääkide kustutamine kettalt — eraldi otsus, vajab eraldi kuivkäivitust.
- Jäägi viide oma pooltele (millised kaks lehte sellest tulid) — nõuaks commit 1 failide parsimist.
- Teose-tasandi prügikast (`list_deleted_works`) ja 75 orvu kirjet.
