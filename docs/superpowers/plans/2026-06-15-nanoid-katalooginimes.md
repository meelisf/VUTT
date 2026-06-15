# Teose nanoid katalooginimes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iga uue üleslaadimise kaust saab kuju `{slug}-{work_id}`, kus `work_id` on teose kanooniline nanoid.

**Architecture:** `work_id` genereeritakse kohe `create_upload`-is ja küpsetatakse slug'i sisse (`meta.slug` + uus `meta.work_id`). Ühine abifunktsioon `_page_base_name(slug, work_id, pn)` arvutab lehekülje failinime tüve nii uue (slug sisaldab work_id'd) kui vana (eraldi lisatav) konventsiooni jaoks. Edasine import-protsess jääb sisuliselt samaks; uue uploadi failinimed on identsed tänasega.

**Tech Stack:** Python (FastAPI backend), pytest; React/TypeScript frontend (Vite).

**Spec:** `docs/superpowers/specs/2026-06-15-nanoid-katalooginimes-design.md`

**NB testikäsk:** kasuta alati `.venv/bin/python -m pytest` (host venv).

---

### Task 1: `_page_base_name` abifunktsioon

**Files:**
- Modify: `server/upload_ops.py` (lisa funktsioon `sanitize_slug` järele, ~rida 230)
- Test: `tests/test_backend_smoke.py` (lisa lõppu)

- [ ] **Step 1: Write the failing tests**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
def test_page_base_name_new_convention():
    """Slug juba sisaldab work_id'd → seda ei lisata uuesti."""
    from server.upload_ops import _page_base_name
    assert _page_base_name("adam-koljo-kiri-pcdm0f", "pcdm0f", 1) == "adam-koljo-kiri-pcdm0f-001"


def test_page_base_name_old_convention():
    """Vana kaust ilma work_id'ta → work_id lisatakse failinimme."""
    from server.upload_ops import _page_base_name
    assert _page_base_name("kirjad", "ab12cd", 7) == "kirjad-ab12cd-007"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py::test_page_base_name_new_convention tests/test_backend_smoke.py::test_page_base_name_old_convention -v`
Expected: FAIL with `ImportError: cannot import name '_page_base_name'`

- [ ] **Step 3: Implement the helper**

Lisa `server/upload_ops.py`-sse otse `sanitize_slug` funktsiooni järele (peale rida 230):

```python
def _page_base_name(slug: str, work_id: str, pn: int) -> str:
    """Lehekülje failinime tüvi (ilma laiendita).

    Uus konventsioon: kaust = {slug}, kus slug juba sisaldab work_id'd → {slug}-{pn}.
    Vana konventsioon: kaust = {slug} ilma work_id'ta → {slug}-{work_id}-{pn}.
    """
    if slug.endswith(f"-{work_id}"):
        return f"{slug}-{pn:03d}"
    return f"{slug}-{work_id}-{pn:03d}"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py::test_page_base_name_new_convention tests/test_backend_smoke.py::test_page_base_name_old_convention -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add server/upload_ops.py tests/test_backend_smoke.py
git commit -m "feat: _page_base_name abifunktsioon (uus/vana kausta konventsioon)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `create_upload` küpsetab work_id slug'i

**Files:**
- Modify: `server/upload_ops.py:266` (slug genereerimine) ja `:277-289` (state.meta dict)
- Test: `tests/test_backend_smoke.py`

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
def test_create_upload_appends_work_id(backend_env):
    """create_upload genereerib work_id ja küpsetab selle slug'i."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Adam Koljo kiri",
        "year": "",
        "slug": "adam-koljo-kiri",
    })
    meta = state["meta"]
    work_id = meta["work_id"]
    assert len(work_id) == 6
    assert meta["slug"] == f"adam-koljo-kiri-{work_id}"
    assert meta["slug"].endswith(f"-{work_id}")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py::test_create_upload_appends_work_id -v`
Expected: FAIL with `KeyError: 'work_id'` (väli puudub state.meta-s)

- [ ] **Step 3: Implement the change**

`server/upload_ops.py` real 263-266, asenda:

```python
    year = str(meta.get('year', ''))
    # Saniteeri slug alati — see jõuab failiteedesse (data/{slug}/, SFTP) → path traversal kaitse.
    # sanitize_slug on idempotentne: juba korrektne slug ei muutu.
    slug = sanitize_slug(meta.get('slug') or meta.get('title', ''))
```

järgmisega:

```python
    year = str(meta.get('year', ''))
    # Saniteeri slug alati — see jõuab failiteedesse (data/{slug}/, SFTP) → path traversal kaitse.
    # sanitize_slug on idempotentne: juba korrektne slug ei muutu.
    base_slug = sanitize_slug(meta.get('slug') or meta.get('title', ''))
    # Küpseta work_id slug'i → kaust = {slug}-{work_id} (unikaalne, jälgitav).
    work_id = generate_nanoid()
    slug = f"{base_slug}-{work_id}"
```

Seejärel real ~280 lisa state.meta dict-i `"slug": slug,` järele uus rida:

```python
            "slug": slug,
            "work_id": work_id,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py::test_create_upload_appends_work_id -v`
Expected: PASS

- [ ] **Step 5: Run existing create_upload tests (ära midagi lõhu)**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py -k create_upload -v`
Expected: PASS (kõik create_upload testid, sh `type_print/type_hand/type_default`)

- [ ] **Step 6: Commit**

```bash
git add server/upload_ops.py tests/test_backend_smoke.py
git commit -m "feat: create_upload küpsetab work_id slug'i (meta.work_id + slug)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Eemalda konfliktikontroll create endpoint-ist

**Files:**
- Modify: `server/main.py:1313` (eemalda `check_slug_conflict` kutse) ja `:33` (eemalda kasutuks jäänud import)

- [ ] **Step 1: Eemalda konfliktikontrolli rida**

`server/main.py` real 1313, asenda:

```python
    if check_slug_conflict(data.get('year'), slug): return JSONResponse(status_code=409, content={"status": "error", "conflict": True})
    return {"status": "success", "upload": create_upload(data)}
```

järgmisega (work_id slug'is tagab kausta unikaalsuse → konfliktikontroll tarbetu):

```python
    return {"status": "success", "upload": create_upload(data)}
```

- [ ] **Step 2: Eemalda kasutuks jäänud import**

`server/main.py` real 33, asenda:

```python
    sanitize_slug, check_slug_conflict, create_upload, update_upload_meta,
```

järgmisega:

```python
    sanitize_slug, create_upload, update_upload_meta,
```

- [ ] **Step 3: Veendu, et `check_slug_conflict` pole mujal kasutusel**

Run: `grep -rn "check_slug_conflict" server/ | grep -v "def check_slug_conflict"`
Expected: tühi väljund (ainsaks alleliks jääb definitsioon `upload_ops.py`-s)

- [ ] **Step 4: Smoke-test, et main.py impordib puhtalt**

Run: `.venv/bin/python -c "import server.main"`
Expected: vea puudumine (väljund tühi, exit 0)

- [ ] **Step 5: Commit**

```bash
git add server/main.py
git commit -m "refactor: eemalda tarbetu check_slug_conflict create endpoint-ist

work_id slug'is tagab kausta unikaalsuse, juhu-sufiks pole enam vajalik.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `import_as_work` kasutab valmis work_id'd + abifunktsiooni

**Files:**
- Modify: `server/upload_ops.py:982` (work_id allikas) ja `:1021` (base_name)

- [ ] **Step 1: Kasuta meta.work_id'd**

`server/upload_ops.py` real 981-982, asenda:

```python
    # Genereeri work_id (nanoid)
    work_id = generate_nanoid()
```

järgmisega:

```python
    # Kasuta create_upload-is genereeritud work_id'd; vana pooleliolev upload
    # (enne deploy't, ilma meta.work_id'ta) saab uue nanoid'i (vana failinime konventsioon).
    work_id = meta.get('work_id') or generate_nanoid()
```

- [ ] **Step 2: Kasuta abifunktsiooni base_name jaoks**

`server/upload_ops.py` real 1021, asenda:

```python
            base_name = f"{slug}-{work_id}-{pn:03d}"
```

järgmisega:

```python
            base_name = _page_base_name(slug, work_id, pn)
```

- [ ] **Step 3: Kontrolli loogikat käsitsi (read-only)**

Veendu, et:
- uus upload: `meta["work_id"]` olemas, `slug` lõpeb `-{work_id}`-iga → `_page_base_name` → `{slug}-{pn}` = `{base}-{work_id}-{pn}` (identne tänasega).
- `metadata["slug"] = slug` (rida ~1071) ja `commit_new_work_to_git(slug, ...)` (rida ~1103) jäävad muutmata — slug kannab juba work_id'd.

Run: `grep -n "metadata\[.slug.\] = slug\|commit_new_work_to_git(slug" server/upload_ops.py`
Expected: mõlemad read leitud, muutmata.

- [ ] **Step 4: Smoke-test impordi puhtus**

Run: `.venv/bin/python -c "import server.upload_ops"`
Expected: vea puudumine.

- [ ] **Step 5: Commit**

```bash
git add server/upload_ops.py
git commit -m "feat: import_as_work kasutab meta.work_id'd + _page_base_name

Kaust = {slug}-{work_id}; failinimed identsed tänasega.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `replace_work` toetab mõlemat konventsiooni

**Files:**
- Modify: `server/upload_ops.py:1277` (base_name)

- [ ] **Step 1: Kasuta abifunktsiooni**

`server/upload_ops.py` real 1277, asenda:

```python
            base_name = f"{slug}-{work_id}-{pn:03d}"
```

järgmisega:

```python
            base_name = _page_base_name(slug, work_id, pn)
```

(Kontekst: `slug = os.path.basename(work_dir)` real 1199, `work_id = existing_meta.get('id', ...)` real 1205. Uus kaust `kirjad-ab12cd` → `slug` lõpeb `-{work_id}` → `{slug}-{pn}`; vana kaust `kirjad` → `{slug}-{work_id}-{pn}`.)

- [ ] **Step 2: Smoke-test impordi puhtus**

Run: `.venv/bin/python -c "import server.upload_ops"`
Expected: vea puudumine.

- [ ] **Step 3: Jooksuta kogu backend smoke-test komplekt**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py tests/test_security_fixes.py -v`
Expected: PASS (sh sanitize_slug ja create_upload testid)

- [ ] **Step 4: Commit**

```bash
git add server/upload_ops.py
git commit -m "feat: replace_work toetab uut ja vana kausta konventsiooni

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Frontend kuvab reaalse kaustanime

**Files:**
- Modify: `src/pages/Upload.tsx:419-420` (loe tagasi backendi slug)

- [ ] **Step 1: Loe tagasi `d.upload.meta.slug`**

`src/pages/Upload.tsx` real 419-423, asenda:

```tsx
        if (r.ok) {
          if (candidateSlug !== slug) setSlug(candidateSlug); // uuenda nähtavat vihjet
          setUploadId(d.upload.id);
          setStep(2);
          return;
        }
```

järgmisega:

```tsx
        if (r.ok) {
          // Backend küpsetab work_id slug'i → kuva reaalne kaustanimi (data/{slug}-{work_id}/)
          if (d.upload?.meta?.slug) setSlug(d.upload.meta.slug);
          setUploadId(d.upload.id);
          setStep(2);
          return;
        }
```

(Juhu-sufiksi retry-loop jääb alles kahjutuna — backend ei tagasta enam 409 `conflict`, seega haru on surnud, kuid ei sega.)

- [ ] **Step 2: Veendu, et build õnnestub**

Run: `npm run build`
Expected: build õnnestub (väljund "built in ..."), TypeScript vigu pole.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Upload.tsx
git commit -m "feat: upload viisard kuvab reaalse kaustanime (slug + work_id)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Deploy (pärast kõigi taskide valmimist)

Backend (Docker) + frontend. Vt `MEMORY.md`:

```bash
# Lokaalselt: frontend build
npm run build

# Serveris: backend rebuild (--no-cache kohustuslik)
ssh vutt
cd ~/VUTT && git pull && docker compose build --no-cache backend && docker compose up -d backend

# Lokaalselt: frontend rsync
rsync -avz dist/ vutt:~/VUTT/dist/
```

Meilisearch reseed pole vajalik — andmemudel ega indeksiväljad ei muutu, ainult uute teoste kausta/failinimi.

## Verifitseerimine (pärast deploy't)

1. Lisa uus aastata käsikiri `/upload` kaudu (nt "Test käsikiri", tüüp Q87167, aasta tühi).
2. Impordi VUTT-i.
3. Serveris kontrolli kausta: `ssh vutt 'ls -d ~/VUTT/data/test-kasikiri-*/'`
   Oodatav: kaust kujul `test-kasikiri-{6 märki}/`, failinimed `test-kasikiri-{work_id}-001.jpg`.
4. `_metadata.json` `id` == kausta nime viimane segment.
