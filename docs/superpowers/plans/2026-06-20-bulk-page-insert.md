# Bulk-lehtede lisamine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/work/{id}/manage` "Lisa leht" vorm võtab vastu mitu pildifaili korraga ja lisab need nimejärgi sorteerituna valitud positsioonile, töötades robustselt ka 200+ faili korral.

**Architecture:** Backend-loogika `server/admin_page_ops.py`-s testitavate funktsioonidena (nagu `split_page`), õhukesed FastAPI-endpointid `server/main.py`-s. Frontend tükeldab suure valiku väikesteks partiideks ja saadab need järjest. Jagatud loomulik-sort utiliit mõlemas otsas.

**Tech Stack:** Python 3.9 / FastAPI / Pillow / GitPython (backend); React 19 / TypeScript / Vite / vitest (frontend); pytest (backend testid).

**Spec:** `docs/superpowers/specs/2026-06-20-bulk-page-insert-design.md`

## Global Constraints

- **Code comments: Eesti keeles.** UI tekstid: i18n `et` + `en` (mõlemad).
- **Python 3.9 compat:** `Optional[X]` / `Tuple[...]` `typing`-ust, MITTE `X | None` ega `tuple[...]` annotatsioonides (vt `MEMORY.md` python39_compat). NB: olemasolev `admin_page_ops.py` kasutab `list[str]` — uutes funktsioonides kasuta `typing` vorme ohutuse mõttes.
- **Testid:** pytest, `testpaths = tests`, `python_files = test_*.py`. Käivita lokaalselt `.venv/bin/python -m pytest`. Subagendid: ALATI `.venv/bin/python -m pytest`.
- **Limiidid (fikseeritud):** `MAX_FILES_PER_REQUEST = 20`, `MAX_REQUEST_BYTES = 200 * 1024 * 1024`, `MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024`, `MAX_DIMENSION = 10000`. Frontend: `CHUNK_MAX_FILES = 20`, `CHUNK_MAX_BYTES = 200 * 1024 * 1024`.
- **`after_page_num` semantika:** `-1` = lõppu, `0` = algusesse, `1..page_count` = selle lehe järele.
- **Behavior-preserving checkpoint:** vana single `add-page` peab pärast refaktorit käituma TÄPSELT nagu enne (sh leebe `after_page_num >= page_count` → lõppu).
- **Test-mockid (admin_page_ops):** `monkeypatch.setattr(aps, "BASE_DIR", ...)`, `aps.find_directory_by_id`, `aps.save_with_git` (→ `{"success": True}`), `aps.sync_work_to_meilisearch`.

---

## File Structure

| Fail | Vastutus |
|------|----------|
| `server/admin_page_ops.py` (modify) | `detect_and_convert_image`, `write_new_page`, `natural_sort_key`, `allocate_sequences`, `add_pages`, `work_lock` |
| `server/main.py` (modify) | `add-pages` endpoint; `add-page` ümberkirjutus helperitele; work-lock kõigil mutleerivatel endpointidel |
| `src/utils/naturalSort.ts` (create) | `naturalSortKey` + `naturalCompare` (jagatud, testitud) |
| `src/utils/bulkAddChunks.ts` (create) | `planChunks` puhas tükeldusfunktsioon (testitav) |
| `src/pages/WorkManage.tsx` (modify) | `multiple` väli, kärbitud eelvaade, chunk-upload, progress, lukustus, osaline viga |
| `src/locales/{et,en}/workspace.json` (modify) | uued i18n võtmed |
| `tests/test_detect_convert_image.py` (create) | detect/convert testid |
| `tests/test_write_new_page.py` (create) | write_new_page testid |
| `tests/test_allocate_sequences.py` (create) | allocate_sequences testid |
| `tests/test_natural_sort.py` (create) | natural_sort_key testid |
| `tests/test_add_pages.py` (create) | add_pages integ-testid (mock git/meili) |
| `tests/test_work_lock.py` (create) | work_lock serialiseerimine |
| `src/utils/__tests__/naturalSort.test.ts` (create) | sort-pariteet |
| `src/utils/__tests__/bulkAddChunks.test.ts` (create) | chunk-aritmeetika |

---

## Task 1: `detect_and_convert_image` helper

**Files:**
- Modify: `server/admin_page_ops.py` (lisa funktsioon + moodulitasandi konstandid)
- Test: `tests/test_detect_convert_image.py` (create)

**Interfaces:**
- Produces: `detect_and_convert_image(content: bytes, filename: str = "") -> Tuple[bytes, str]` — tagastab `(jpeg_bytes, ".jpg")`. JPG → sisu muutmata; PNG → JPEG (läbipaistvus valgele taustale). Raises `ValueError` toetamata formaadi / liiga suure pildi korral.
- Konstandid: `MAX_DIMENSION = 10000`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_detect_convert_image.py
"""Testid pildituvastusele ja PNG→JPG teisendusele."""
import io
import sys
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
from server.admin_page_ops import detect_and_convert_image


def _png_bytes(mode, size=(10, 10), color=(255, 0, 0, 128)):
    img = Image.new(mode, size, color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _jpg_bytes(size=(10, 10), color=(10, 20, 30)):
    img = Image.new("RGB", size, color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


def test_jpg_passes_through_unchanged():
    data = _jpg_bytes()
    out, ext = detect_and_convert_image(data, "x.jpg")
    assert out == data            # JPG-d ei re-enkodeerita
    assert ext == ".jpg"


def test_png_rgb_converted_to_jpg():
    data = _png_bytes("RGB", color=(10, 20, 30))
    out, ext = detect_and_convert_image(data, "x.png")
    assert ext == ".jpg"
    assert out[:3] == b"\xff\xd8\xff"   # JPEG magic


def test_png_rgba_transparent_flattens_to_white():
    # Täielikult läbipaistev punane RGBA → valge taust (mitte must)
    data = _png_bytes("RGBA", color=(255, 0, 0, 0))
    out, _ = detect_and_convert_image(data, "x.png")
    px = Image.open(io.BytesIO(out)).convert("RGB").getpixel((5, 5))
    assert px == (255, 255, 255)


def test_png_la_mode_flattens_to_white():
    data = _png_bytes("LA", color=(0, 0))   # läbipaistev
    out, _ = detect_and_convert_image(data, "x.png")
    px = Image.open(io.BytesIO(out)).convert("RGB").getpixel((5, 5))
    assert px == (255, 255, 255)


def test_pdf_rejected():
    with pytest.raises(ValueError):
        detect_and_convert_image(b"%PDF-1.4 rest", "x.pdf")


def test_unknown_rejected():
    with pytest.raises(ValueError):
        detect_and_convert_image(b"not an image at all", "x.txt")


def test_oversized_dimension_rejected():
    big = _jpg_bytes(size=(10001, 10))
    with pytest.raises(ValueError):
        detect_and_convert_image(big, "big.jpg")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_detect_convert_image.py -v`
Expected: FAIL — `ImportError: cannot import name 'detect_and_convert_image'`

- [ ] **Step 3: Write minimal implementation**

Lisa `server/admin_page_ops.py`-sse (impordi juurde `import io`; `from PIL import Image` lisa funktsiooni sisse või faili algusesse) ja konstant ning funktsioon pärast importe:

```python
# server/admin_page_ops.py — moodulitasandil (importide järel)
MAX_DIMENSION = 10000  # piltide max laius/kõrgus px (bomb + liiga suure kaitse)


def detect_and_convert_image(content, filename=""):
    """Tuvastab pildi tüübi magic-byte'idega ja tagastab JPEG-baidid.

    JPG → tagastab sisu muutmata. PNG → teisendab JPEG-iks; läbipaistvus
    lamendatakse VALGELE taustale (mitte must, nagu convert('RGB') üksi annaks).
    Tagastab (bytes, '.jpg'). Viskab ValueError toetamata formaadi või liiga
    suure pildi korral.
    """
    import io
    from PIL import Image

    if content[:3] == b'\xff\xd8\xff':
        kind = 'jpg'
    elif content[:8] == b'\x89PNG\r\n\x1a\n':
        kind = 'png'
    elif content[:4] == b'%PDF':
        raise ValueError(f"PDF pole toetatud (kasuta JPG/PNG): {filename}")
    else:
        raise ValueError(f"Toetamata formaat (lubatud JPG/PNG): {filename}")

    # Mõõtmete kontroll (.size loeb päisest, ei dekodeeri kogu pilti)
    with Image.open(io.BytesIO(content)) as probe:
        w, h = probe.size
        if w > MAX_DIMENSION or h > MAX_DIMENSION:
            raise ValueError(
                f"Pilt liiga suur ({w}x{h}px, max {MAX_DIMENSION}px): {filename}"
            )

    if kind == 'jpg':
        return content, '.jpg'

    # PNG → JPG, läbipaistvus valgele taustale
    with Image.open(io.BytesIO(content)) as img:
        if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
            alpha = img.convert('RGBA')
            background = Image.new('RGBA', alpha.size, (255, 255, 255, 255))
            flat = Image.alpha_composite(background, alpha).convert('RGB')
        else:
            flat = img.convert('RGB')
        buf = io.BytesIO()
        flat.save(buf, format='JPEG', quality=95)
        flat.close()
    return buf.getvalue(), '.jpg'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_detect_convert_image.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_detect_convert_image.py
git commit -m "feat(backend): detect_and_convert_image helper (PNG→JPG valge taust, mõõtmekaitse)"
```

---

## Task 2: `write_new_page` helper

**Files:**
- Modify: `server/admin_page_ops.py`
- Test: `tests/test_write_new_page.py` (create)

**Interfaces:**
- Consumes: `generate_nanoid()` (juba imporditud moodulis).
- Produces: `write_new_page(work_dir: str, staging_dir: str, folder_name: str, work_id: str, content: bytes, ext: str, seq: int) -> dict` — kirjutab pildi + tühja `.txt` + minimaalse `.json` kausta `staging_dir`, kontrollib nimekollisiooni `work_dir` suhtes. Tagastab `{"filename", "base", "img_path", "txt_path", "json_path", "json_str", "page_meta"}` (teed `staging_dir`-is). EI committi ega synci.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_write_new_page.py
"""Testid write_new_page helperile."""
import os
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import write_new_page


def test_write_new_page_creates_three_files(tmp_path):
    work = tmp_path / "1690-test-w1"
    work.mkdir()
    res = write_new_page(str(work), str(work), "1690-test-w1", "w1", b"JPEGDATA", ".jpg", 150)

    assert os.path.exists(res["img_path"])
    assert os.path.exists(res["txt_path"])
    assert os.path.exists(res["json_path"])
    with open(res["img_path"], "rb") as f:
        assert f.read() == b"JPEGDATA"
    with open(res["txt_path"], "r") as f:
        assert f.read() == ""
    with open(res["json_path"]) as f:
        d = json.load(f)
    assert d["sequence"] == 150
    assert d["status"] == "Toores"
    assert res["page_meta"]["sequence"] == 150


def test_write_new_page_filename_pattern(tmp_path):
    work = tmp_path / "1690-test-w1"
    work.mkdir()
    res = write_new_page(str(work), str(work), "1690-test-w1", "w1", b"X", ".jpg", 100)
    assert res["filename"].startswith("1690-test-w1-w1-")
    assert res["filename"].endswith(".jpg")


def test_write_new_page_staging_separate_from_workdir(tmp_path):
    work = tmp_path / "1690-test-w1"
    work.mkdir()
    staging = work / ".tmp-bulk-abc"
    staging.mkdir()
    res = write_new_page(str(work), str(staging), "1690-test-w1", "w1", b"X", ".jpg", 100)
    # Failid lähevad staging-kausta
    assert os.path.dirname(res["img_path"]) == str(staging)
    # Kollisioonikontroll käib work_dir suhtes (siin pole kollisiooni)
    assert os.path.exists(res["img_path"])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_write_new_page.py -v`
Expected: FAIL — `ImportError: cannot import name 'write_new_page'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/admin_page_ops.py
def write_new_page(work_dir, staging_dir, folder_name, work_id, content, ext, seq):
    """Kirjutab uue lehe pildi + tühja .txt + minimaalse .json kausta staging_dir.

    Nimekollisiooni kontroll käib work_dir suhtes (lõplik sihtkaust). EI committi.
    """
    new_id = generate_nanoid()
    filename = f"{folder_name}-{work_id}-{new_id}{ext}"
    while os.path.exists(os.path.join(work_dir, filename)) or \
            os.path.exists(os.path.join(staging_dir, filename)):
        new_id = generate_nanoid()
        filename = f"{folder_name}-{work_id}-{new_id}{ext}"

    base = os.path.splitext(filename)[0]
    img_path = os.path.join(staging_dir, filename)
    txt_path = os.path.join(staging_dir, base + '.txt')
    json_path = os.path.join(staging_dir, base + '.json')
    page_meta = {'sequence': seq, 'status': 'Toores'}
    json_str = json.dumps(page_meta, indent=2, ensure_ascii=False)

    with open(img_path, 'wb') as f:
        f.write(content)
    os.chmod(img_path, 0o644)
    with open(txt_path, 'w', encoding='utf-8') as f:
        f.write('')
    os.chmod(txt_path, 0o644)
    with open(json_path, 'w', encoding='utf-8') as f:
        f.write(json_str)
    os.chmod(json_path, 0o644)

    return {
        "filename": filename, "base": base,
        "img_path": img_path, "txt_path": txt_path, "json_path": json_path,
        "json_str": json_str, "page_meta": page_meta,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_write_new_page.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_write_new_page.py
git commit -m "feat(backend): write_new_page helper (staging-teadlik, ei committi)"
```

---

## Task 3: `allocate_sequences` (gap-fit + täielik ümbernummerdamine)

**Files:**
- Modify: `server/admin_page_ops.py`
- Test: `tests/test_allocate_sequences.py` (create)

**Interfaces:**
- Produces: `allocate_sequences(existing_seqs: List[int], after_page_num: int, n: int) -> dict` — `existing_seqs` on olemasolevate lehtede sequence'id sorteeritud järjekorras (pikkus M). Tagastab `{"new_seqs": List[int], "renumber": Optional[List[int]]}`. `new_seqs` (pikkus n) on uute lehtede rangelt kasvavad sequence'id. Kui pesa mahutab → `renumber=None`. Kui ei mahuta → `renumber` (pikkus M) on olemasolevate lehtede uued sequence'id ühendatud järjestuses; `new_seqs` ühilduvad sellega.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_allocate_sequences.py
"""Testid allocate_sequences järjekorranumbrite jaotusele."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import allocate_sequences


def _is_strictly_increasing(xs):
    return all(a < b for a, b in zip(xs, xs[1:]))


def test_insert_middle_fits_gap():
    # Lehed seq 100, 200; lisa 3 lehte pärast 1. lehte (after=1)
    r = allocate_sequences([100, 200], after_page_num=1, n=3)
    assert r["renumber"] is None
    assert len(r["new_seqs"]) == 3
    assert _is_strictly_increasing(r["new_seqs"])
    assert all(100 < s < 200 for s in r["new_seqs"])


def test_insert_at_end():
    r = allocate_sequences([100, 200], after_page_num=-1, n=2)
    assert r["renumber"] is None
    assert r["new_seqs"] == [300, 400]


def test_insert_at_beginning_fits():
    r = allocate_sequences([100, 200], after_page_num=0, n=2)
    assert r["renumber"] is None
    assert _is_strictly_increasing(r["new_seqs"])
    assert all(0 < s < 100 for s in r["new_seqs"])


def test_empty_work():
    r = allocate_sequences([], after_page_num=-1, n=3)
    assert r["renumber"] in (None, [])
    assert r["new_seqs"] == [100, 200, 300]


def test_gap_too_small_triggers_renumber():
    # Lehed seq 100, 101 (vahe 1); lisa 5 lehte vahele (after=1)
    r = allocate_sequences([100, 101], after_page_num=1, n=5)
    assert r["renumber"] is not None
    assert len(r["renumber"]) == 2          # 2 olemasolevat lehte
    assert len(r["new_seqs"]) == 5
    # Ühendatud järjestus: [olemasolev0, 5 uut, olemasolev1] → kõik kasvavad
    merged = [r["renumber"][0]] + r["new_seqs"] + [r["renumber"][1]]
    assert _is_strictly_increasing(merged)
    assert merged == [100, 200, 300, 400, 500, 600, 700]


def test_large_batch_renumber():
    r = allocate_sequences([100, 200], after_page_num=1, n=200)
    assert r["renumber"] is not None
    merged = [r["renumber"][0]] + r["new_seqs"] + [r["renumber"][1]]
    assert _is_strictly_increasing(merged)
    assert len(merged) == 202
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_allocate_sequences.py -v`
Expected: FAIL — `ImportError: cannot import name 'allocate_sequences'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/admin_page_ops.py
def allocate_sequences(existing_seqs, after_page_num, n):
    """Jaotab n uut sequence-väärtust valitud positsioonile.

    existing_seqs: olemasolevate lehtede sequence'id sorteeritud järjekorras (M tk).
    after_page_num: -1=lõppu, 0=algusesse, 1..M=selle lehe järele.
    Tagastab {"new_seqs": [n], "renumber": None|[M]}.
    """
    m = len(existing_seqs)
    # Sisestuspunkt P = mitu olemasolevat lehte jääb ette
    p = m if after_page_num == -1 else after_page_num

    def renumber_all():
        # Ühendatud järjestus: ette p olemasolevat, siis n uut, siis ülejäänud
        existing_new = [(i + 1) * 100 if i < p else (i + 1 + n) * 100
                        for i in range(m)]
        new_seqs = [(p + k) * 100 for k in range(1, n + 1)]
        return {"new_seqs": new_seqs, "renumber": existing_new}

    # Lõppu või tühja teosesse
    if p >= m:
        seq_before = existing_seqs[-1] if m else 0
        return {"new_seqs": [seq_before + 100 * k for k in range(1, n + 1)],
                "renumber": None}

    # Algusesse
    if p == 0:
        seq_after = existing_seqs[0]
        gap = seq_after  # alumine piir 0 (eksklusiivne)
        if gap > n:
            return {"new_seqs": [gap * k // (n + 1) for k in range(1, n + 1)],
                    "renumber": None}
        return renumber_all()

    # Vahele
    seq_before = existing_seqs[p - 1]
    seq_after = existing_seqs[p]
    gap = seq_after - seq_before
    if gap > n:
        return {"new_seqs": [seq_before + gap * k // (n + 1) for k in range(1, n + 1)],
                "renumber": None}
    return renumber_all()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_allocate_sequences.py -v`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_allocate_sequences.py
git commit -m "feat(backend): allocate_sequences (gap-fit + täielik ümbernummerdamine)"
```

---

## Task 4: Refaktor — vana `add-page` kasutab helpereid (behavior unchanged)

**Files:**
- Modify: `server/main.py:564-700` (`admin_add_page`)
- Test: olemasolev käitumine peab säilima (manuaalne + olemasolevad testid)

**Interfaces:**
- Consumes: `detect_and_convert_image`, `write_new_page` (Task 1, 2). Lisa need `server/main.py` importi reale 48 (`from .admin_page_ops import ...`).

- [ ] **Step 1: Lisa impordid**

`server/main.py` real ~48 laienda olemasolevat importi:

```python
from .admin_page_ops import (
    clear_original_backup, get_page_sequence, get_sorted_images,
    rebalance_sequences, reorder_pages, split_page, transform_page_image,
    detect_and_convert_image, write_new_page,
)
```

- [ ] **Step 2: Kirjuta `admin_add_page` failitüübi-tuvastus + kirjutamine ümber**

Asenda `admin_add_page`-s plokk ridadel ~587-684 (alates `# Kontrolli failitüüpi` kuni `.json` kirjutamiseni) järgmisega. **Sequence-arvutus ( read ~610-659) jääb MUUTMATA.** Leebe `after_page_num >= page_count` käitumine säilib.

```python
    # Kontrolli failitüüpi + teisenda (jagatud helper)
    try:
        content, ext = detect_and_convert_image(content, file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # ... (sequence-arvutus new_seq jaoks jääb täpselt samaks) ...

    # Salvesta leht (jagatud helper; single → staging == work dir)
    page = write_new_page(path, path, folder_name, work_id, content, ext, new_seq)
    new_filename = page["filename"]
    base = page["base"]
    txt_path = page["txt_path"]
    json_path = page["json_path"]
    page_meta = page["page_meta"]
```

Veendu, et järgnev `save_with_git(...)` + `sync_work_to_meilisearch(...)` + `return` plokk (read ~686-700) viitab muutujatele `txt_path`, `json_path`, `page_meta`, `base`, `new_filename` — need tulevad nüüd `page`-dictist. Eemalda dubleeritud käsitsi-kirjutamise read (vana `open(new_img_path,'wb')`, `open(txt_path,'w')`, `open(json_path,'w')`).

- [ ] **Step 3: Run existing tests + smoke**

Run: `.venv/bin/python -m pytest tests/test_split_page.py tests/test_transform_page.py tests/test_backend_smoke.py -v`
Expected: PASS (regressiooni pole)

- [ ] **Step 4: Manuaalne kontroll (kirjuta üles)**

Kontrolli koodilugemisel: PNG läbipaistvus annab nüüd VALGE tausta (varem must) — see on teadlik spec-parandus, OK. Kõik muu identne.

- [ ] **Step 5: Commit**

```bash
git add server/main.py
git commit -m "refactor(backend): add-page kasutab jagatud helpereid (detect_and_convert_image, write_new_page)"
```

---

## Task 5: `natural_sort_key` (Python)

**Files:**
- Modify: `server/admin_page_ops.py`
- Test: `tests/test_natural_sort.py` (create)

**Interfaces:**
- Produces: `natural_sort_key(name: str) -> list` — kanooniline loomulik-sort võti. NFC + casefold + numbri/teksti-plokid (numbrid arvuna) + viigi-katkestaja (originaalnimi).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_natural_sort.py
"""Testid natural_sort_key loomulikule sorteerimisele."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import natural_sort_key


def _sorted(names):
    return sorted(names, key=natural_sort_key)


def test_numeric_order_not_lexical():
    assert _sorted(["scan_10.jpg", "scan_2.jpg", "scan_1.jpg"]) == \
        ["scan_1.jpg", "scan_2.jpg", "scan_10.jpg"]


def test_leading_zeros_equal_value_stable():
    # 02 ja 2 sama arv → viigi-katkestaja (originaalnimi) määrab; determinism
    out = _sorted(["scan_02.jpg", "scan_2.jpg"])
    assert out == sorted(out, key=natural_sort_key)  # idempotentne
    assert set(out) == {"scan_02.jpg", "scan_2.jpg"}


def test_case_insensitive_grouping():
    assert _sorted(["Scan_1.jpg", "scan_0.jpg"]) == ["scan_0.jpg", "Scan_1.jpg"]


def test_leading_number_token():
    # "2.jpg" → re.split annab ['', '2', '.jpg']; ei tohi katki minna
    out = _sorted(["10.jpg", "2.jpg", "1.jpg"])
    assert out == ["1.jpg", "2.jpg", "10.jpg"]


def test_mixed_letters_numbers():
    assert _sorted(["a2b", "a10b", "a1b"]) == ["a1b", "a2b", "a10b"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_natural_sort.py -v`
Expected: FAIL — `ImportError: cannot import name 'natural_sort_key'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/admin_page_ops.py  (lisa importide juurde: import re, import unicodedata)
def natural_sort_key(name):
    """Kanooniline loomulik-sort võti (peab JS-poolega kokku langema).

    NFC-normaliseerimine, casefold, numbri/teksti-plokid (numbrid arvuna).
    Viigi-katkestaja: originaalnimi (stabiilne determinism nt '02' vs '2').
    Tokeniseerimine: re.split(r'(\\d+)') → numbrist algav/lõppev string annab
    tühje elemente (nt '2.jpg' → ['', '2', '.jpg']) — JS peab käituma identselt.
    """
    norm = unicodedata.normalize('NFC', name).casefold()
    tokens = re.split(r'(\d+)', norm)
    key = []
    for i, tok in enumerate(tokens):
        if i % 2 == 1:           # paaritu indeks = numbriplokk
            key.append((1, int(tok), ''))
        else:                    # paaris indeks = tekst (sh tühjad)
            key.append((0, 0, tok))
    return (key, name)           # viigi-katkestaja: originaalnimi
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_natural_sort.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_natural_sort.py
git commit -m "feat(backend): natural_sort_key loomulik sorteerimine (NFC+casefold+numbriplokid)"
```

---

## Task 6: `naturalSort.ts` (frontend) + pariteet

**Files:**
- Create: `src/utils/naturalSort.ts`
- Test: `src/utils/__tests__/naturalSort.test.ts` (create)

**Interfaces:**
- Produces: `naturalCompare(a: string, b: string): number` ja `naturalSortKey(name: string)`. Peab andma SAMA järjestuse nagu Python `natural_sort_key` (Task 5).

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/naturalSort.test.ts
import { describe, it, expect } from 'vitest';
import { naturalCompare } from '../naturalSort';

const sortNames = (xs: string[]) => [...xs].sort(naturalCompare);

describe('naturalCompare (peab Python natural_sort_key-ga kokku langema)', () => {
  it('numbriline järjestus, mitte leksikaalne', () => {
    expect(sortNames(['scan_10.jpg', 'scan_2.jpg', 'scan_1.jpg']))
      .toEqual(['scan_1.jpg', 'scan_2.jpg', 'scan_10.jpg']);
  });
  it('juhtnumber-token (2.jpg → tühi esimene token)', () => {
    expect(sortNames(['10.jpg', '2.jpg', '1.jpg']))
      .toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });
  it('case-insensitive grupeerimine', () => {
    expect(sortNames(['Scan_1.jpg', 'scan_0.jpg']))
      .toEqual(['scan_0.jpg', 'Scan_1.jpg']);
  });
  it('tähed ja numbrid segamini', () => {
    expect(sortNames(['a2b', 'a10b', 'a1b'])).toEqual(['a1b', 'a2b', 'a10b']);
  });
  it('idempotentne juhtnullidega', () => {
    const out = sortNames(['scan_02.jpg', 'scan_2.jpg']);
    expect([...out].sort(naturalCompare)).toEqual(out);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/naturalSort.test.ts`
Expected: FAIL — cannot resolve `../naturalSort`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/naturalSort.ts
// Kanooniline loomulik-sort, peab langema kokku Python natural_sort_key-ga
// (NFC + lower + numbri/teksti-plokid, numbrid arvuna; viik → originaalnimi).

type Token = [number, number, string];   // (tüüp, arv, tekst): tekst=(0,..) num=(1,..)

function tokenize(name: string): Token[] {
  const norm = name.normalize('NFC').toLowerCase();
  // re.split(r'(\d+)') ekvivalent: paaris=tekst (sh tühjad), paaritu=number
  const parts = norm.split(/(\d+)/);
  return parts.map((tok, i): Token =>
    i % 2 === 1 ? [1, parseInt(tok, 10), ''] : [0, 0, tok]
  );
}

export function naturalSortKey(name: string): { tokens: Token[]; original: string } {
  return { tokens: tokenize(name), original: name };
}

export function naturalCompare(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.min(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const [t1, n1, s1] = ta[i];
    const [t2, n2, s2] = tb[i];
    if (t1 !== t2) return t1 - t2;          // tekst (0) enne numbrit (1)
    if (t1 === 1) { if (n1 !== n2) return n1 - n2; }
    else { if (s1 !== s2) return s1 < s2 ? -1 : 1; }
  }
  if (ta.length !== tb.length) return ta.length - tb.length;
  return a < b ? -1 : a > b ? 1 : 0;        // viigi-katkestaja: originaalnimi
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/naturalSort.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/naturalSort.ts src/utils/__tests__/naturalSort.test.ts
git commit -m "feat(frontend): naturalSort utiliit (pariteet Python natural_sort_key-ga)"
```

---

## Task 7: `add_pages` core-funktsioon (valideerimine, staging, üks commit, meili-warning)

**Files:**
- Modify: `server/admin_page_ops.py`
- Test: `tests/test_add_pages.py` (create)

**Interfaces:**
- Consumes: `detect_and_convert_image`, `write_new_page`, `natural_sort_key`, `allocate_sequences`, `get_sorted_images`, `get_page_sequence`, `find_directory_by_id`, `save_with_git`, `sync_work_to_meilisearch`, `BASE_DIR`.
- Produces: `add_pages(work_id: str, files: List[Tuple[str, bytes]], after_page_num: int, username: str) -> dict`. Tagastab `{"found": bool, "new_page_count": int, "inserted": [{"filename","sequence"}], "meili_warning": Optional[str]}`. Raises `ValueError` valideerimisvigade korral (limiidid, vahemik, failitüüp). `found=False` kui teost pole.
- Konstandid (moodulitasandil): `MAX_FILES_PER_REQUEST = 20`, `MAX_REQUEST_BYTES = 200*1024*1024`, `MAX_SINGLE_FILE_BYTES = 50*1024*1024`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_add_pages.py
"""Integratsioonitestid add_pages bulk-loogikale (git/meili mock'itud)."""
import io
import os
import json
import sys
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image
import server.admin_page_ops as aps
from server.admin_page_ops import add_pages, get_sorted_images


def _jpg(color=(1, 2, 3)):
    img = Image.new("RGB", (8, 8), color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    return buf.getvalue()


@pytest.fixture
def work(tmp_path, monkeypatch):
    wid = "w1"
    folder = tmp_path / "1690-test-w1"
    folder.mkdir()
    # Kaks olemasolevat lehte seq 100, 200
    for i, seq in enumerate([100, 200], start=1):
        base = f"1690-test-w1-w1-pg{i:03d}"
        Image.new("RGB", (8, 8), (i, i, i)).save(str(folder / (base + ".jpg")), "JPEG")
        (folder / (base + ".txt")).write_text("", encoding="utf-8")
        (folder / (base + ".json")).write_text(
            json.dumps({"sequence": seq, "status": "Valmis", "extra": "hoia alles"}),
            encoding="utf-8")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id",
                        lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: {"success": True})
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)
    return {"folder": folder, "work_id": wid}


def test_add_two_pages_in_middle_sorted(work):
    files = [("b_scan_2.jpg", _jpg()), ("a_scan_1.jpg", _jpg())]
    res = add_pages(work["work_id"], files, after_page_num=1, username="admin")
    assert res["new_page_count"] == 4
    # Sorditud nimejärgi: a_scan_1 enne b_scan_2 → väiksem sequence esimesele
    seqs = [it["sequence"] for it in res["inserted"]]
    assert seqs[0] < seqs[1]
    imgs = get_sorted_images(str(work["folder"]))
    assert len(imgs) == 4


def test_unsupported_file_rejects_whole_batch(work):
    files = [("ok.jpg", _jpg()), ("bad.pdf", b"%PDF-1.4")]
    before = set(os.listdir(work["folder"]))
    with pytest.raises(ValueError):
        add_pages(work["work_id"], files, after_page_num=-1, username="admin")
    after = set(os.listdir(work["folder"]))
    assert before == after          # midagi ei kirjutatud


def test_after_page_num_out_of_range_rejected(work):
    with pytest.raises(ValueError):
        add_pages(work["work_id"], [("a.jpg", _jpg())], after_page_num=99, username="admin")


def test_too_many_files_rejected(work):
    files = [(f"f{i}.jpg", _jpg()) for i in range(21)]
    with pytest.raises(ValueError):
        add_pages(work["work_id"], files, after_page_num=-1, username="admin")


def test_existing_json_fields_preserved_on_renumber(work):
    # Sunni renumber: täida pesa esmalt — siin lihtsam suure n-iga keskele
    files = [(f"f{i:03d}.jpg", _jpg()) for i in range(150)]
    add_pages(work["work_id"], files, after_page_num=1, username="admin")
    # Olemasolev leht peab säilitama "extra" välja
    import glob
    for jp in glob.glob(str(work["folder"] / "*.json")):
        if jp.endswith("_metadata.json"):
            continue
        d = json.load(open(jp))
        # Vähemalt esialgsed kaks lehte (status Valmis) säilitasid extra
        if d.get("status") == "Valmis":
            assert d.get("extra") == "hoia alles"


def test_work_not_found_returns_found_false(work):
    res = add_pages("missing", [("a.jpg", _jpg())], after_page_num=-1, username="admin")
    assert res.get("found") is False


def test_meili_failure_returns_warning_not_raise(work, monkeypatch):
    def boom(*a):
        raise RuntimeError("meili down")
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", boom)
    res = add_pages(work["work_id"], [("a.jpg", _jpg())], after_page_num=-1, username="admin")
    assert res["meili_warning"] is not None
    assert res["new_page_count"] == 3       # leht ikka lisatud
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_add_pages.py -v`
Expected: FAIL — `ImportError: cannot import name 'add_pages'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/admin_page_ops.py  (importide juurde: import uuid, import shutil — shutil on juba)
MAX_FILES_PER_REQUEST = 20
MAX_REQUEST_BYTES = 200 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024


def add_pages(work_id, files, after_page_num, username):
    """Lisab mitu pildifaili teosele valitud positsioonile (nimejärgi sorteeritud).

    files: list of (filename, bytes). Tagastab dict (vt Interfaces). Viskab
    ValueError valideerimisvigade korral; found=False kui teost pole.
    """
    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}
    folder_name = os.path.basename(path)

    # --- Limiidi-kontroll ---
    if not files:
        raise ValueError("Faile pole")
    if len(files) > MAX_FILES_PER_REQUEST:
        raise ValueError(f"Liiga palju faile (max {MAX_FILES_PER_REQUEST})")
    total = 0
    for name, content in files:
        if len(content) > MAX_SINGLE_FILE_BYTES:
            raise ValueError(f"Fail liiga suur: {name}")
        total += len(content)
    if total > MAX_REQUEST_BYTES:
        raise ValueError("Partii kogumaht liiga suur")

    # --- Vahemikukontroll ---
    images = get_sorted_images(path)
    page_count = len(images)
    if not (after_page_num == -1 or 0 <= after_page_num <= page_count):
        raise ValueError(f"Vigane positsioon: {after_page_num}")

    # --- Valideeri + teisenda KÕIK enne kirjutamist (üks dekodeeritud korraga) ---
    converted = []  # (orig_name, jpeg_bytes, ext)
    for name, content in files:
        jpeg, ext = detect_and_convert_image(content, name)   # ValueError → katki
        converted.append((name, jpeg, ext))

    # --- Sorteeri nimejärgi (backend autoriteetne) ---
    converted.sort(key=lambda t: natural_sort_key(t[0]))
    n = len(converted)

    # --- Jaota sequence'id ---
    existing_seqs = [
        int(get_page_sequence(os.path.join(path, os.path.splitext(im)[0] + '.json')))
        if get_page_sequence(os.path.join(path, os.path.splitext(im)[0] + '.json')) != float('inf')
        else (i + 1) * 100
        for i, im in enumerate(images)
    ]
    alloc = allocate_sequences(existing_seqs, after_page_num, n)
    new_seqs = alloc["new_seqs"]
    renumber = alloc["renumber"]

    # --- Temp-staging ---
    staging = os.path.join(path, f".tmp-bulk-{uuid.uuid4().hex[:8]}")
    os.makedirs(staging, exist_ok=True)
    written_pages = []        # write_new_page dictid (staging-teedega)
    moved_final = []          # lõppasukohta liigutatud teed (cleanup jaoks)
    json_backups = {}         # olemasoleva json_path -> originaalsisu (restore jaoks)

    try:
        # Kirjuta uued lehed staging-kausta
        for (name, jpeg, ext), seq in zip(converted, new_seqs):
            page = write_new_page(path, staging, folder_name, work_id, jpeg, ext, seq)
            written_pages.append(page)

        # Liiguta uued failid (img+txt+json) lõppasukohta (os.replace = atomaarne/FS)
        for page in written_pages:
            for src in (page["img_path"], page["txt_path"], page["json_path"]):
                dst = os.path.join(path, os.path.basename(src))
                os.replace(src, dst)
                moved_final.append(dst)

        # Renumberdamisel: uuenda olemasolevate lehtede json sequence (säilita ülejäänu)
        renumber_files = []   # (json_path, new_content) save_with_git jaoks
        if renumber is not None:
            for im, new_seq in zip(images, renumber):
                jp = os.path.join(path, os.path.splitext(im)[0] + '.json')
                orig = ''
                d = {}
                if os.path.exists(jp):
                    with open(jp, 'r', encoding='utf-8') as f:
                        orig = f.read()
                    try:
                        d = json.loads(orig)
                    except Exception:
                        d = {}
                json_backups[jp] = orig
                if 'meta_content' in d:
                    d['meta_content']['sequence'] = new_seq
                else:
                    d['sequence'] = new_seq
                renumber_files.append((jp, json.dumps(d, indent=2, ensure_ascii=False)))

        # --- ÜKS git-commit ---
        # primary = esimese uue lehe .txt; additional = ülejäänud txt + kõik json
        first = written_pages[0]
        first_txt_final = os.path.join(path, first["base"] + '.txt')
        additional = []
        for page in written_pages:
            base = page["base"]
            if page is not first:
                additional.append((os.path.join(path, base + '.txt'), ''))
            additional.append((os.path.join(path, base + '.json'), page["json_str"]))
        additional.extend(renumber_files)

        res = save_with_git(
            first_txt_final, '', username,
            message=f"Lisa {n} lehte: {folder_name} [after={after_page_num}]",
            additional_files=additional,
        )
        if not res.get("success"):
            raise RuntimeError(f"Git commit ebaõnnestus: {res.get('error')}")
    except Exception:
        _cleanup_bulk(staging, moved_final, json_backups)
        raise
    finally:
        # Eemalda staging-kaust igal juhul (kui veel alles)
        if os.path.isdir(staging):
            try:
                shutil.rmtree(staging, ignore_errors=True)
            except Exception:
                logger.critical(f"Bulk staging cleanup ebaõnnestus: {staging}")

    # --- Meili sync (viga ei tühista juba salvestatut) ---
    meili_warning = None
    try:
        sync_work_to_meilisearch(folder_name)
    except Exception as e:
        meili_warning = str(e)
        logger.error(f"add_pages meili sync ebaõnnestus ({folder_name}): {e}")

    inserted = [{"filename": p["filename"], "sequence": s}
                for p, s in zip(written_pages, new_seqs)]
    return {
        "found": True,
        "new_page_count": len(get_sorted_images(path)),
        "inserted": inserted,
        "meili_warning": meili_warning,
    }


def _cleanup_bulk(staging, moved_final, json_backups):
    """Robustne cleanup: kustuta staging + lõppasukohta liigutatud uued failid,
    taasta olemasolevad .json-id. Cleanup-viga logitakse critical-ina."""
    try:
        if os.path.isdir(staging):
            shutil.rmtree(staging, ignore_errors=True)
    except Exception:
        logger.critical(f"Bulk cleanup: staging eemaldamine ebaõnnestus: {staging}")
    for dst in moved_final:
        try:
            if os.path.exists(dst):
                os.remove(dst)
        except Exception:
            logger.critical(f"Bulk cleanup: uue faili eemaldamine ebaõnnestus: {dst}")
    for jp, orig in json_backups.items():
        try:
            with open(jp, 'w', encoding='utf-8') as f:
                f.write(orig)
        except Exception:
            logger.critical(f"Bulk cleanup: json taastamine ebaõnnestus: {jp}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_add_pages.py -v`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_add_pages.py
git commit -m "feat(backend): add_pages bulk-loogika (valideerimine, staging, üks commit, meili-warning)"
```

---

## Task 8: `POST /admin/work/{id}/add-pages` endpoint

**Files:**
- Modify: `server/main.py` (lisa endpoint `admin_add_page` järele; lisa `add_pages` importi reale 48)
- Test: lisa `tests/test_add_pages.py`-sse kerge TestClient-test (valikuline) VÕI manuaalne kontroll

**Interfaces:**
- Consumes: `add_pages` (Task 7).

- [ ] **Step 1: Lisa import**

`server/main.py` real ~48 lisa importide listi `add_pages`.

- [ ] **Step 2: Write the endpoint**

```python
# server/main.py  (admin_add_page funktsiooni järele)
@app.post("/admin/work/{work_id}/add-pages")
async def admin_add_pages(work_id: str, request: Request, user=Depends(require_role("admin"))):
    """Lisab teosele mitu lehekülge korraga (JPG/PNG), nimejärgi sorteeritud.
    Body: multipart — mitu `file`-välja + after_page_num (int, 0=algusesse, -1=lõppu).
    """
    try:
        form: FormData = await request.form()
        after_page_num = int(form.get('after_page_num', -1))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Vigane vorm: {e}")

    uploads = form.getlist('file')
    if not uploads:
        raise HTTPException(status_code=400, detail="Faile pole")

    files = []
    for up in uploads:
        if not hasattr(up, 'read'):
            continue
        content = await up.read()
        files.append((up.filename or "", content))

    try:
        result = add_pages(work_id, files, after_page_num, user['username'])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost ei leitud")
    return {"status": "success", **result}
```

- [ ] **Step 3: Verify import + app boot (smoke)**

Run: `.venv/bin/python -m pytest tests/test_backend_smoke.py -v`
Expected: PASS (app impordib, endpoint registreeritud)

- [ ] **Step 4: Manuaalne kontroll**

Kontrolli koodilugemisel: `form.getlist('file')` kogub kõik `file`-väljad; `after_page_num` parsitakse; `ValueError → 400`, `found=False → 404`. Vastus sisaldab `inserted`, `new_page_count`, `meili_warning`.

- [ ] **Step 5: Commit**

```bash
git add server/main.py
git commit -m "feat(backend): /admin/work/{id}/add-pages endpoint (multipart, mitu faili)"
```

---

## Task 9: Work-level lukk kõigil mutleerivatel lehe-operatsioonidel

**Files:**
- Modify: `server/admin_page_ops.py` (lisa `work_lock` contextmanager; mähi `add_pages`, `reorder_pages`, `split_page`, `transform_page_image`)
- Modify: `server/main.py` (mähi inline-mutatsioonid: `add-page`, `delete /page/{n}`, `replace-image`)
- Test: `tests/test_work_lock.py` (create)

**Interfaces:**
- Produces: `work_lock(work_id: str, work_dir: str)` — contextmanager. `fcntl.flock` (protsessidevaheline) + `threading.Lock` (lõimedevaheline ühe workeri sees).

- [ ] **Step 1: Write the failing test**

```python
# tests/test_work_lock.py
"""Test: work_lock serialiseerib paralleelsed sama-teose operatsioonid."""
import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import work_lock


def test_work_lock_serializes_same_work(tmp_path):
    folder = tmp_path / "w"
    folder.mkdir()
    order = []

    def worker(tag):
        with work_lock("w1", str(folder)):
            order.append(f"{tag}-start")
            time.sleep(0.05)
            order.append(f"{tag}-end")

    t1 = threading.Thread(target=worker, args=("A",))
    t2 = threading.Thread(target=worker, args=("B",))
    t1.start(); t2.start(); t1.join(); t2.join()

    # Kumbki lõik on jagamatu: start kohe end (mitte A-start, B-start, ...)
    assert order in (
        ["A-start", "A-end", "B-start", "B-end"],
        ["B-start", "B-end", "A-start", "A-end"],
    )


def test_work_lock_different_works_dont_block(tmp_path):
    f1 = tmp_path / "w1"; f1.mkdir()
    f2 = tmp_path / "w2"; f2.mkdir()
    with work_lock("w1", str(f1)):
        # Teine teos ei tohi blokeeruda
        with work_lock("w2", str(f2)):
            assert True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_work_lock.py -v`
Expected: FAIL — `ImportError: cannot import name 'work_lock'`

- [ ] **Step 3: Write minimal implementation**

```python
# server/admin_page_ops.py  (importide juurde: import fcntl, import threading,
#                            from contextlib import contextmanager)
_work_thread_locks = {}
_work_thread_locks_guard = threading.Lock()


def _get_thread_lock(work_id):
    with _work_thread_locks_guard:
        lk = _work_thread_locks.get(work_id)
        if lk is None:
            lk = threading.Lock()
            _work_thread_locks[work_id] = lk
        return lk


@contextmanager
def work_lock(work_id, work_dir):
    """Serialiseerib sama teose mutleerivad operatsioonid.

    threading.Lock = lõimedevaheline (üks worker); fcntl.flock = protsessidevaheline
    (tuleviku gunicorn mitme workeri jaoks). Lukufail {work_dir}/.vutt-lock.
    """
    tlock = _get_thread_lock(work_id)
    tlock.acquire()
    lockpath = os.path.join(work_dir, '.vutt-lock')
    f = open(lockpath, 'w')
    try:
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
        yield
    finally:
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        finally:
            f.close()
            tlock.release()
```

- [ ] **Step 4: Mähi mutleerivad operatsioonid**

`add_pages` (Task 7): mähi peamine keha (pärast `find_directory_by_id`, kus `path` teada) `with work_lock(work_id, path):` sisse. `reorder_pages`, `split_page`, `transform_page_image` (admin_page_ops.py): igaüks võtab `dir_path`/`work_id` — mähi keha `with work_lock(<work_id>, dir_path):` (kasuta olemasolevat dir/work_id muutujat; kui ainult `dir_path`, kasuta `os.path.basename(dir_path)` lock-võtmena — KONSISTENTSELT sama võti kõigis). Vali võtmeks **`os.path.basename(path)`** (folder_name) kõigis kohtades, et endpoint- ja funktsioonipoolsed lukud ühtiks.

`server/main.py` inline-mutatsioonid: `admin_add_page`, `delete /page/{n}` (`@app.delete(".../page/{page_num}")`), `replace-image` — mähi nende keha (kus `path = find_directory_by_id(...)` olemas) `with work_lock(os.path.basename(path), path):` sisse. Impordi `work_lock` reale 48.

**NB järjepidevus:** lock-võti peab olema KÕIKJAL sama — kasuta `os.path.basename(path)` (folder_name). Uuenda ka `add_pages` ja `work_lock` testid kasutama folder_name-võtit, kui muudad (testides on `"w1"` — hoia testid ja prod sama konventsiooniga: kuna test annab suvalise stringi, töötab; prod annab folder_name).

- [ ] **Step 5: Run all backend tests + commit**

Run: `.venv/bin/python -m pytest tests/test_work_lock.py tests/test_add_pages.py tests/test_split_page.py tests/test_transform_page.py -v`
Expected: PASS

```bash
git add server/admin_page_ops.py server/main.py tests/test_work_lock.py
git commit -m "feat(backend): work-level lukk (flock+threading) kõigil mutleerivatel lehe-operatsioonidel"
```

---

## Task 10: `planChunks` puhas tükeldusfunktsioon

**Files:**
- Create: `src/utils/bulkAddChunks.ts`
- Test: `src/utils/__tests__/bulkAddChunks.test.ts` (create)

**Interfaces:**
- Produces: `planChunks(files: File[], afterPageNum: number, maxFiles: number, maxBytes: number): Array<{ files: File[]; afterPageNum: number }>` — tükeldab arvu+mahu järgi; arvutab iga partii `afterPageNum` deterministlikult (P+K loogika; `-1` jääb `-1`).

- [ ] **Step 1: Write the failing test**

```typescript
// src/utils/__tests__/bulkAddChunks.test.ts
import { describe, it, expect } from 'vitest';
import { planChunks } from '../bulkAddChunks';

const f = (name: string, size: number): File =>
  ({ name, size } as File);

describe('planChunks', () => {
  it('üks partii kui mahub', () => {
    const plan = planChunks([f('a', 1), f('b', 1)], 5, 20, 1000);
    expect(plan).toHaveLength(1);
    expect(plan[0].afterPageNum).toBe(5);
    expect(plan[0].files).toHaveLength(2);
  });

  it('tükeldab arvu järgi ja nihutab positsiooni (P+K)', () => {
    const files = Array.from({ length: 5 }, (_, i) => f(`x${i}`, 1));
    const plan = planChunks(files, 10, 2, 1_000_000);
    expect(plan.map((c) => c.files.length)).toEqual([2, 2, 1]);
    // pärast 10: esimene after=10, järgmine 10+2=12, siis 12+2=14
    expect(plan.map((c) => c.afterPageNum)).toEqual([10, 12, 14]);
  });

  it('algusesse (0): nihkub K kaupa', () => {
    const files = Array.from({ length: 4 }, (_, i) => f(`x${i}`, 1));
    const plan = planChunks(files, 0, 2, 1_000_000);
    expect(plan.map((c) => c.afterPageNum)).toEqual([0, 2]);
  });

  it('lõppu (-1): iga partii jääb -1', () => {
    const files = Array.from({ length: 5 }, (_, i) => f(`x${i}`, 1));
    const plan = planChunks(files, -1, 2, 1_000_000);
    expect(plan.map((c) => c.afterPageNum)).toEqual([-1, -1, -1]);
  });

  it('tükeldab mahu järgi', () => {
    const plan = planChunks([f('a', 600), f('b', 600)], 0, 20, 1000);
    expect(plan).toHaveLength(2);   // 600+600 > 1000 → eraldi
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/bulkAddChunks.test.ts`
Expected: FAIL — cannot resolve `../bulkAddChunks`

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/utils/bulkAddChunks.ts
export interface AddChunk {
  files: File[];
  afterPageNum: number;
}

// Tükeldab failid partiideks (arv JA maht) ja arvutab iga partii sihtpositsiooni.
// after=-1 (lõppu): iga partii jääb -1. Muidu: partii lisab K lehte positsiooni P
// järele → järgmine partii after = P+K.
export function planChunks(
  files: File[],
  afterPageNum: number,
  maxFiles: number,
  maxBytes: number,
): AddChunk[] {
  const chunks: AddChunk[] = [];
  let current: File[] = [];
  let currentBytes = 0;
  let pos = afterPageNum;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ files: current, afterPageNum: pos });
    if (afterPageNum !== -1) pos += current.length;   // P+K
    current = [];
    currentBytes = 0;
  };

  for (const file of files) {
    const wouldExceed =
      current.length >= maxFiles ||
      (current.length > 0 && currentBytes + file.size > maxBytes);
    if (wouldExceed) flush();
    current.push(file);
    currentBytes += file.size;
  }
  flush();
  return chunks;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/bulkAddChunks.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/bulkAddChunks.ts src/utils/__tests__/bulkAddChunks.test.ts
git commit -m "feat(frontend): planChunks tükeldusloogika (arv+maht, P+K positsioon)"
```

---

## Task 11: WorkManage UI — multiple, eelvaade, chunk-upload, progress, i18n

**Files:**
- Modify: `src/pages/WorkManage.tsx` (`handleAddPage` plokk + "Lisa leht" vorm ~714-778)
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json`
- Test: manuaalne (UI); loogika on juba kaetud Task 6 + Task 10 testidega

**Interfaces:**
- Consumes: `planChunks` (Task 10), `naturalCompare` (Task 6), olemasolev `FILE_API_URL`, `fetchWithTimeout`, `getAuthHeaders`, `loadPages`.

- [ ] **Step 1: Lisa i18n võtmed**

`src/locales/et/workspace.json` — `manage` objekti lisa:

```json
"addPagesFilesSelected": "{{count}} faili valitud",
"addPagesPreview": "Lisamise järjekord (nimejärgi):",
"addPagesShowAll": "Näita kõiki ({{count}})",
"addPagesShowLess": "Näita vähem",
"addPagesProgress": "Laetud {{done}} / {{total}}",
"addPagesPartialError": "Lisati {{added}} lehte, seejärel tekkis viga: {{error}}",
"addPagesMeiliWarning": "Lehed lisatud, kuid otsinguindeks ei uuenenud kohe.",
"addPagesCancel": "Tühista",
"addPagesSubmitMulti": "Lisa {{count}} lehte"
```

`src/locales/en/workspace.json` — sama `manage` objekti:

```json
"addPagesFilesSelected": "{{count}} files selected",
"addPagesPreview": "Insertion order (by filename):",
"addPagesShowAll": "Show all ({{count}})",
"addPagesShowLess": "Show less",
"addPagesProgress": "Uploaded {{done}} / {{total}}",
"addPagesPartialError": "Added {{added}} pages, then an error occurred: {{error}}",
"addPagesMeiliWarning": "Pages added, but the search index did not update immediately.",
"addPagesCancel": "Cancel",
"addPagesSubmitMulti": "Add {{count}} pages"
```

- [ ] **Step 2: Muuda failiväli `multiple`-ks + state**

`WorkManage.tsx`: muuda `addFile` state mitmuseks ja lisa progress/cancel state. Vana single-state (`addFile: File | null`) asenda:

```tsx
const [addFiles, setAddFiles] = useState<File[]>([]);
const [showAllNames, setShowAllNames] = useState(false);
const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
const cancelRef = useRef(false);
```

Failiväljal (rida ~730):

```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/jpeg,image/png"
  multiple
  onChange={(e) => {
    const list = Array.from(e.target.files || []);
    list.sort((a, b) => naturalCompare(a.name, b.name));
    setAddFiles(list);
    setShowAllNames(false);
  }}
  className="text-sm text-gray-700"
/>
```

Lisa importidesse: `import { naturalCompare } from '../utils/naturalSort';` ja `import { planChunks } from '../utils/bulkAddChunks';`. Lisa konstandid faili algusse: `const CHUNK_MAX_FILES = 20; const CHUNK_MAX_BYTES = 200 * 1024 * 1024;`

- [ ] **Step 3: Lisa kärbitud eelvaade vormi (positsiooni-select'i järele)**

```tsx
{addFiles.length > 1 && (
  <div className="text-xs text-gray-600">
    <p className="font-medium mb-1">{t('manage.addPagesPreview')}</p>
    <ol className="list-decimal list-inside space-y-0.5">
      {(showAllNames ? addFiles : [...addFiles.slice(0, 10), ...addFiles.slice(-5)])
        .map((f, i) => <li key={i} className="truncate">{f.name}</li>)}
    </ol>
    {addFiles.length > 15 && (
      <button
        type="button"
        onClick={() => setShowAllNames((v) => !v)}
        className="mt-1 text-primary-600 hover:underline"
      >
        {showAllNames
          ? t('manage.addPagesShowLess')
          : t('manage.addPagesShowAll', { count: addFiles.length })}
      </button>
    )}
  </div>
)}
```

- [ ] **Step 4: Asenda `handleAddPage` chunk-uploadiga**

```tsx
const handleAddPage = async () => {
  if (!workId || !authToken || addFiles.length === 0) return;
  setAddingPage(true);
  setAddPageError(null);
  cancelRef.current = false;

  const sorted = [...addFiles].sort((a, b) => naturalCompare(a.name, b.name));
  const chunks = planChunks(sorted, addAfterPage, CHUNK_MAX_FILES, CHUNK_MAX_BYTES);
  const total = sorted.length;
  let done = 0;
  let meiliWarned = false;
  setUploadProgress({ done: 0, total });

  try {
    for (const chunk of chunks) {
      if (cancelRef.current) break;
      const formData = new FormData();
      chunk.files.forEach((f) => formData.append('file', f));
      formData.append('after_page_num', String(chunk.afterPageNum));

      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/add-pages`,
        { method: 'POST', headers: getAuthHeaders(authToken), body: formData, timeout: 120000 }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.meili_warning) meiliWarned = true;
      done += chunk.files.length;
      setUploadProgress({ done, total });
    }

    await loadPages();
    if (!cancelRef.current) {
      setShowAddForm(false);
      setAddFiles([]);
      setAddAfterPage(-1);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
    if (meiliWarned) setAddPageError(t('manage.addPagesMeiliWarning'));
  } catch (e: any) {
    await loadPages();   // peegelda osaline tulemus
    setAddPageError(t('manage.addPagesPartialError', { added: done, error: e.message }));
  } finally {
    setUploadProgress(null);
    setAddingPage(false);
  }
};
```

- [ ] **Step 5: Lukusta vorm uploadi ajal + progress + cancel + submit-silt**

Submit-nupp (rida ~761) — silt mitmuse korral, disable uploadi ajal:

```tsx
<button
  onClick={handleAddPage}
  disabled={addFiles.length === 0 || addingPage}
  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white rounded transition-colors"
>
  {addingPage ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
  {addFiles.length > 1
    ? t('manage.addPagesSubmitMulti', { count: addFiles.length })
    : t('manage.addPageSubmit')}
</button>
```

Lisa progress + cancel submit-nupu kõrvale/alla:

```tsx
{uploadProgress && (
  <div className="flex items-center gap-3 text-sm text-gray-600">
    <span>{t('manage.addPagesProgress', uploadProgress)}</span>
    <button
      type="button"
      onClick={() => { cancelRef.current = true; }}
      className="text-red-600 hover:underline"
    >
      {t('manage.addPagesCancel')}
    </button>
  </div>
)}
```

Lukusta failiväli + positsiooni-select uploadi ajal: lisa mõlemale `disabled={addingPage}`.

- [ ] **Step 6: Build + manuaalne kontroll**

Run: `npm run build`
Expected: TypeScript kompileerib veatult.

Manuaalne (lokaalne dev või pärast deploy'd): vali mitu faili `/manage`-l → eelvaade näitab sorditud järjekorda → "Lisa N lehte" → progress → lehed ilmuvad õiges järjekorras õigele positsioonile.

- [ ] **Step 7: Commit**

```bash
git add src/pages/WorkManage.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat(frontend): bulk-lehtede lisamine (multiple, eelvaade, chunk-upload, progress, i18n)"
```

---

## Task 12: Lõplik kontroll + deploy-märkmed

**Files:** ei muuda; kontroll.

- [ ] **Step 1: Käivita kõik backend-testid**

Run: `.venv/bin/python -m pytest tests/ -q`
Expected: PASS (kõik, sh uued ja olemasolevad)

- [ ] **Step 2: Käivita kõik frontend-testid + build**

Run: `npx vitest run && npm run build`
Expected: PASS + edukas build

- [ ] **Step 3: Deploy (kui kasutaja kinnitab)**

Backend (Docker, `--no-cache` KOHUSTUSLIK):
```bash
ssh vutt
cd ~/VUTT
git pull
docker compose build --no-cache backend && docker compose up -d backend
docker logs vutt-backend --tail 30
```

Frontend (lokaalsest masinast):
```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 4: Serveri-verifitseerimine**

Mine `/work/{id}/manage`, lisa korraga 3–5 testpilti keskele → kontrolli järjekord + positsioon. Seejärel proovi suurem partii (nt 25 → tükeldub 2 chunkiks). Kontrolli `docker logs vutt-backend` vigade suhtes.

---

## Self-Review (täidetud plaani kirjutamisel)

**Spec coverage:** Kanooniline sort (T5/T6) ✅; UI multiple+eelvaade (T11) ✅; tükeldamine arv+maht+P+K (T10/T11) ✅; add-pages endpoint (T8) ✅; allocate_sequences + renumber (T3) ✅; write_new_page/detect_convert jagatud helperid (T1/T2/T4) ✅; valideerimis+kirjutus-atomaarsus+staging+cleanup (T7) ✅; work-lukk kõigil endpointidel (T9) ✅; limiidid+MAX_DIMENSION (T1/T7) ✅; meili-warning (T7) ✅; after_page_num range→400 (T7/T8) ✅; testid (kõik taskid) ✅.

**Type consistency:** `add_pages` tagastab `{found, new_page_count, inserted, meili_warning}` — kasutatud T8 endpointis ja T11 frontendis (`data.meili_warning`). `allocate_sequences` → `{new_seqs, renumber}` kasutatud T7-s. `write_new_page` → dict `{filename, base, img_path, txt_path, json_path, json_str, page_meta}` kasutatud T4 + T7. `planChunks` → `{files, afterPageNum}[]` kasutatud T11. `naturalCompare(a,b)` kasutatud T11. Konsistentne.

**Placeholder scan:** kõik sammud sisaldavad konkreetset koodi/käske; "TBD"/"TODO" puudub.
