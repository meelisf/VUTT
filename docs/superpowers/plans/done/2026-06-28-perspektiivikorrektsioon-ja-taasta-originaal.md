# Perspektiivikorrektsioon + "Taasta originaal" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada lehe pildiredaktorisse (`PageImageEditorModal`) perspektiivikorrektsioon (`Image.QUAD`) integreeritud "Muuda"-tabi lülitina ning per-faili "Taasta originaal", kusjuures poolitamine teeb topeltlehe kummaltki poolelt taastatavaks.

**Architecture:** Server laiendab olemasolevat `transform_page_image`-t valikulise `quad`-parameetriga (asendab kärpe `Image.QUAD` sirgestusega), lisab `restore_original_page_image` funktsiooni (taastab `._originals` pristine pildi) ja `split_page` populeerib mõlema poole `._originals` poolituseelse topeltlehega. Frontend lisab "Muuda"-tabi perspektiivi-lüliti (4 vaba nurka SVG-overlay'l) ja päise "Taasta originaal" nupu. Kogu varundus/atomaarsus/thumbnail infrastruktuur on taaskasutatud.

**Tech Stack:** Python 3.12 + Pillow (backend), FastAPI (endpointid), React 19 + TypeScript + Tailwind (frontend), pytest (backend testid), vitest (frontend testid).

## Global Constraints

- **Backend testid:** `.venv/bin/python -m pytest <path> -v` (host venv, MITTE Docker).
- **Frontend gate:** `npm run typecheck` PEAB läbima (Vite build ei typecheck'i).
- **Frontend testid:** `npx vitest run <path>`.
- **Python 3.9 compat EI ole nõutav** siin (server jookseb 3.12), aga väldi uusi sõltuvusi — kasuta `math` stdlib.
- **Pillow `Image.QUAD` `data` konventsioon:** 8-tuple järjekorras UL, LL, LR, UR (ülemine-vasak, alumine-vasak, alumine-parem, ülemine-parem) → mapitakse väljundristküliku vastavatesse nurkadesse.
- **Quad sisendformaat:** 4 punkti normaliseeritud `[0..1]`, frontend järjekord **TL, TR, BR, BL**, JSON-is `[{x,y}, ...]`.
- **`quad` ja `crop` on vastastikku välistavad** — mõlemad korraga → `ValueError`.
- **Restore puudutab AINULT `.jpg`-faili** — `.txt`/`.json`/sequence/failinimi muutumatud.
- **`._originals` EI kustutata restore'l** → leht alati taastatav.
- **Töö toimub harul `feat/perspective-correction`** (spec juba commititud sinna).
- **Spec:** `docs/superpowers/specs/2026-06-28-perspektiivikorrektsioon-ja-taasta-originaal-design.md`.

---

## File Structure

| Fail | Vastutus |
|------|----------|
| `server/admin_page_ops.py` | `dist`, `_validate_quad`, konstandid; `transform_page_image` + `quad`; uus `restore_original_page_image`; `split_page` populeerib `._originals` |
| `server/routers/pages.py` | transform-endpoint loeb `quad`; uus restore-original endpoint |
| `src/utils/perspectiveQuad.ts` | UUS — quad normaliseeri/denormaliseeri, vaikenelinurk, cropRect→quad, clamp |
| `src/services/pageService.ts` | `transformPageImage` + valikuline `quad`; uus `restoreOriginalPageImage` |
| `src/components/PageImageEditorModal.tsx` | perspektiivi lüliti + quad overlay + apply-haru; "Taasta originaal" nupp + kinnitus |
| `src/locales/{et,en}/workspace.json` | uued i18n võtmed |
| `tests/test_transform_page.py` | quad + validate testid (laienda olemasolevat) |
| `tests/test_restore_original.py` | UUS — restore testid |
| `tests/test_split_page.py` | `._originals` populeerimise test (laienda) |
| `src/utils/__tests__/perspectiveQuad.test.ts` | UUS — util testid |

---

## Task 1: Backend abifunktsioonid — `dist`, `_validate_quad`, konstandid

**Files:**
- Modify: `server/admin_page_ops.py` (lisa `import math` rida 6 lähedusse; lisa konstandid `ANGLE_EPS` lähedusse rida 446; lisa `dist` + `_validate_quad` enne `transform_page_image` rida 475)
- Test: `tests/test_transform_page.py` (lisa testid faili lõppu)

**Interfaces:**
- Produces:
  - `QUAD_MIN_EDGE = 0.02` (min serva pikkus normaliseeritult)
  - `QUAD_MIN_OUT_PX = 8` (min väljundmõõt pikslites)
  - `dist(a: tuple, b: tuple) -> float` — eukleidiline kaugus
  - `_validate_quad(quad) -> list[tuple[float, float]]` — valideerib ja tagastab 4 `(x,y)` tuple'it; `raise ValueError` vigaste korral

- [ ] **Step 1: Write the failing tests**

Lisa `tests/test_transform_page.py` lõppu:

```python
def test_validate_quad_accepts_valid_square():
    from server.admin_page_ops import _validate_quad
    pts = _validate_quad([{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                          {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])
    assert pts == [(0.1, 0.1), (0.9, 0.1), (0.9, 0.9), (0.1, 0.9)]


def test_validate_quad_wrong_count():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1}, {"x": 0.9, "y": 0.9}])


def test_validate_quad_out_of_range():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": -0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])


def test_validate_quad_too_short_edge():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": 0.5, "y": 0.5}, {"x": 0.505, "y": 0.5},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])


def test_validate_quad_bowtie_rejected():
    from server.admin_page_ops import _validate_quad
    # Bow-tie: TL, TR vahetatud BR, BL-ga ristumiseks (mittekumer)
    with pytest.raises(ValueError):
        _validate_quad([{"x": 0.1, "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.9}])


def test_validate_quad_nan_rejected():
    from server.admin_page_ops import _validate_quad
    with pytest.raises(ValueError):
        _validate_quad([{"x": float("nan"), "y": 0.1}, {"x": 0.9, "y": 0.1},
                        {"x": 0.9, "y": 0.9}, {"x": 0.1, "y": 0.9}])


def test_dist_euclidean():
    from server.admin_page_ops import dist
    assert dist((0.0, 0.0), (3.0, 4.0)) == 5.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -k "validate_quad or dist" -v`
Expected: FAIL — `ImportError: cannot import name '_validate_quad'` / `dist`.

- [ ] **Step 3: Add `import math`**

`server/admin_page_ops.py` rida 6 lähedal (teiste `import` ridade juurde):

```python
import math
```

- [ ] **Step 4: Add konstandid ja abifunktsioonid**

`server/admin_page_ops.py`-s, kohe pärast olemasolevat rida `MIN_CROP_PX = 8` (rida ~447):

```python
QUAD_MIN_EDGE = 0.02   # minimaalne quad serva pikkus (normaliseeritud)
QUAD_MIN_OUT_PX = 8    # minimaalne perspektiivi väljundmõõt pikslites


def dist(a, b) -> float:
    """Eukleidiline kaugus kahe (x,y) punkti vahel."""
    return math.hypot(b[0] - a[0], b[1] - a[1])


def _validate_quad(quad):
    """Valideerib perspektiivi nelinurga ja tagastab 4 (x,y) tuple'it [0..1].

    Nõuded: täpselt 4 punkti; lõplikud arvud; [0,1]; iga serv ≥ QUAD_MIN_EDGE;
    kumer (mitte bow-tie/concave). Raise ValueError igal rikkumisel.
    """
    if not isinstance(quad, (list, tuple)) or len(quad) != 4:
        raise ValueError("quad peab olema täpselt 4 punkti")
    pts = []
    for p in quad:
        if isinstance(p, dict):
            x, y = p.get("x"), p.get("y")
        elif isinstance(p, (list, tuple)) and len(p) == 2:
            x, y = p
        else:
            raise ValueError("quad punkt peab olema {x,y} või [x,y]")
        x, y = float(x), float(y)
        if not (math.isfinite(x) and math.isfinite(y)):
            raise ValueError("quad punkt peab olema lõplik arv")
        if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
            raise ValueError("quad punkt peab olema vahemikus [0,1]")
        pts.append((x, y))
    # Serva pikkused
    for i in range(4):
        if dist(pts[i], pts[(i + 1) % 4]) < QUAD_MIN_EDGE:
            raise ValueError("quad serv on liiga lühike")
    # Kumerus: kõigi ristkorrutiste märk peab olema järjepidev
    sign = 0
    for i in range(4):
        ax, ay = pts[i]
        bx, by = pts[(i + 1) % 4]
        cx, cy = pts[(i + 2) % 4]
        cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
        if abs(cross) < 1e-9:
            continue
        s = 1 if cross > 0 else -1
        if sign == 0:
            sign = s
        elif s != sign:
            raise ValueError("quad peab olema kumer (mitte bow-tie)")
    return pts
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -k "validate_quad or dist" -v`
Expected: PASS (7 testi).

- [ ] **Step 6: Commit**

```bash
git add server/admin_page_ops.py tests/test_transform_page.py
git commit -m "feat: add quad validation helpers for perspective correction"
```

---

## Task 2: `transform_page_image` perspektiivi (`quad`) tugi + endpoint

**Files:**
- Modify: `server/admin_page_ops.py` (`transform_page_image` signatuur + loogika, rida 475–568)
- Modify: `server/routers/pages.py` (`admin_transform_page_image`, rida 360–372)
- Test: `tests/test_transform_page.py`

**Interfaces:**
- Consumes: `dist`, `_validate_quad`, `QUAD_MIN_OUT_PX` (Task 1).
- Produces: `transform_page_image(work_id, filename, angle=0.0, crop=None, quad=None, username="admin")` — `quad` antud korral teeb `Image.QUAD` sirgestuse; tagastab sama kuju dict (`success`/`changed`/`size`/`thumbnail_warning`) nagu praegu.

- [ ] **Step 1: Write the failing tests**

Lisa `tests/test_transform_page.py` lõppu. Esmalt uus fixture värviliste nurkadega:

```python
@pytest.fixture
def quad_work(tmp_path, monkeypatch):
    """Testtöö 100x100 pildiga, mille 4 nurka on erivärvi (mirror/järjekorra test)."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "quadwork1"
    folder = tmp_path / "1700-quad-work"
    folder.mkdir()
    fname = "1700-quad-work-quadwork1-pg001.jpg"
    img = PILImage.new("RGB", (100, 100), color=(0, 0, 0))
    px = img.load()
    px[0, 0] = (255, 0, 0)       # TL = punane
    px[99, 0] = (0, 255, 0)      # TR = roheline
    px[99, 99] = (0, 0, 255)     # BR = sinine
    px[0, 99] = (255, 255, 0)    # BL = kollane
    img.save(str(folder / fname), "JPEG", quality=100)
    (folder / (fname[:-4] + ".txt")).write_text("T.", encoding="utf-8")
    (folder / (fname[:-4] + ".json")).write_text(json.dumps({"sequence": 100}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    return {"folder": folder, "work_id": wid, "filename": fname}


def _corner_colors(im):
    """Tagastab (TL, TR, BR, BL) värvid pildi nurkadest (väikese sissenihkega)."""
    w, h = im.width, im.height
    return (im.getpixel((2, 2)), im.getpixel((w - 3, 2)),
            im.getpixel((w - 3, h - 3)), im.getpixel((2, h - 3)))


def _dominant(c):
    """Lihtsustab RGB domineerivaks sildiks (kompressiooni tolerantsiga)."""
    r, g, b = c[0], c[1], c[2]
    if r > 150 and g > 150:
        return "yellow"
    if r > 150:
        return "red"
    if g > 150:
        return "green"
    if b > 150:
        return "blue"
    return "black"


def test_transform_quad_preserves_corner_orientation(quad_work):
    """Täis-pildi quad (identiteet) → nurgavärvid jäävad õigesse kohta (mirror/järjekord)."""
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    full_quad = [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0},
                 {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    r = transform_page_image(quad_work["work_id"], quad_work["filename"], quad=full_quad, username="admin")
    assert r["success"] and r["changed"]
    with PILImage.open(str(quad_work["folder"] / quad_work["filename"])) as im:
        tl, tr, br, bl = (_dominant(c) for c in _corner_colors(im))
        assert (tl, tr, br, bl) == ("red", "green", "blue", "yellow")


def test_transform_quad_output_dimensions(quad_work):
    """Quad keskmistest servapikkustest → väljundi mõõt."""
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    # Vasak pool: x 0..0.5, y 0..1 → out_w ~50, out_h ~100
    quad = [{"x": 0.0, "y": 0.0}, {"x": 0.5, "y": 0.0},
            {"x": 0.5, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    transform_page_image(quad_work["work_id"], quad_work["filename"], quad=quad, username="admin")
    with PILImage.open(str(quad_work["folder"] / quad_work["filename"])) as im:
        assert abs(im.width - 50) <= 1
        assert abs(im.height - 100) <= 1


def test_transform_quad_and_crop_mutually_exclusive(quad_work):
    from server.admin_page_ops import transform_page_image
    quad = [{"x": 0.0, "y": 0.0}, {"x": 1.0, "y": 0.0},
            {"x": 1.0, "y": 1.0}, {"x": 0.0, "y": 1.0}]
    with pytest.raises(ValueError):
        transform_page_image(quad_work["work_id"], quad_work["filename"],
                             crop={"x": 0, "y": 0, "w": 0.5, "h": 1.0}, quad=quad)


def test_transform_quad_noop_when_all_none(quad_work):
    from server.admin_page_ops import transform_page_image
    r = transform_page_image(quad_work["work_id"], quad_work["filename"],
                             angle=0.0, crop=None, quad=None)
    assert r == {"success": True, "changed": False, "reason": "no_transform"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -k "quad" -v`
Expected: FAIL — `transform_page_image() got an unexpected keyword argument 'quad'`.

- [ ] **Step 3: Update `transform_page_image` signature ja ülemine valideerimine**

`server/admin_page_ops.py` rida 475 — muuda signatuur:

```python
def transform_page_image(work_id, filename, angle=0.0, crop=None, quad=None, username="admin"):
```

Asenda no-op kaitse plokk (rida 481–485):

```python
    angle = float(angle)

    if quad is not None and crop is not None:
        raise ValueError("quad ja crop ei saa olla korraga")
    quad_pts = _validate_quad(quad) if quad is not None else None

    # No-op kaitse (float-tolerantsiga)
    if abs(angle) < ANGLE_EPS and crop is None and quad is None:
        return {"success": True, "changed": False, "reason": "no_transform"}
```

- [ ] **Step 4: Update teisendusplokk (Pillow)**

Asenda olemasolev teisendusplokk (rida 519–530, `with PILImage.open(...)` sees) järgmisega:

```python
        with PILImage.open(img_path) as raw:
            img = ImageOps.exif_transpose(raw)
            is_jpeg = ext_l in ('.jpg', '.jpeg')
            if is_jpeg and img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            fill = (255, 255, 255) if img.mode == 'RGB' else 255
            if abs(angle) >= ANGLE_EPS:
                # CSS positiivne = päripäeva → Pillow vastupäeva → -angle
                img = img.rotate(-angle, expand=True, fillcolor=fill)
            if quad_pts is not None:
                # Perspektiivi sirgestus: quad ([0..1] rotated-raamis) → ristkülik
                W, H = img.width, img.height
                pxs = [(x * W, y * H) for (x, y) in quad_pts]
                TL, TR, BR, BL = pxs
                out_w = round((dist(TL, TR) + dist(BL, BR)) / 2)
                out_h = round((dist(TL, BL) + dist(TR, BR)) / 2)
                if out_w < QUAD_MIN_OUT_PX or out_h < QUAD_MIN_OUT_PX:
                    raise ValueError("quad väljund on liiga väike")
                # Image.QUAD data: UL, LL, LR, UR (Pillow konventsioon)
                data = [TL[0], TL[1], BL[0], BL[1], BR[0], BR[1], TR[0], TR[1]]
                img = img.transform((out_w, out_h), PILImage.QUAD, data,
                                    resample=PILImage.BICUBIC, fillcolor=fill)
            else:
                box = _compute_crop_box(crop, img.width, img.height)
                if box is not None:
                    img = img.crop(box)
            out_w, out_h = img.size
```

NB: kui `_validate_quad` (Step 3) viskab `ValueError`, juhtub see ENNE varundust (rida 504+) — vigane päring ei tekita backupit. Hoia validation Step 3 asukohas (funktsiooni alguses).

- [ ] **Step 5: Update logirida quad'iga**

`server/admin_page_ops.py` rida 558–562, logikirje — lisa quad info:

```python
            lf.write(
                f"{datetime.now().isoformat()} | {username} | {work_id} | {filename} | "
                f"angle={angle} crop={crop} quad={quad} | -> {out_w}x{out_h}\n"
            )
```

- [ ] **Step 6: Update endpoint loeb `quad`**

`server/routers/pages.py` rida 360–372 — `admin_transform_page_image`:

```python
@router.post("/admin/work/{work_id}/page-image/{filename}/transform")
async def admin_transform_page_image(work_id: str, filename: str, request: Request, user=Depends(require_role("admin"))):
    """Pöörab/kärbib/sirgestab lehepilti kohapeal. Body: { angle, crop|null, quad|null }"""
    data = await get_json_data(request)
    angle = data.get("angle", 0.0)
    crop = data.get("crop")
    quad = data.get("quad")
    try:
        result = transform_page_image(work_id, filename, angle=angle, crop=crop, quad=quad, username=user["username"])
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehte ei leitud")
    return result
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -v`
Expected: PASS (kõik, sh olemasolevad pööra/kärbi testid + uued quad testid).

- [ ] **Step 8: Commit**

```bash
git add server/admin_page_ops.py server/routers/pages.py tests/test_transform_page.py
git commit -m "feat: add perspective (quad) correction to transform_page_image"
```

---

## Task 3: `restore_original_page_image` + endpoint

**Files:**
- Modify: `server/admin_page_ops.py` (lisa funktsioon pärast `clear_original_backup`, rida ~578)
- Modify: `server/routers/pages.py` (lisa import rida 10–25 blokki; lisa endpoint pärast transform-endpointi)
- Test: `tests/test_restore_original.py` (UUS)

**Interfaces:**
- Produces: `restore_original_page_image(work_id, filename, username="admin") -> dict`
  - originaali puudumisel: `{"success": True, "restored": False, "reason": "no_original"}`
  - tundmatu töö: `{"found": False}`
  - edu: `{"success": True, "restored": True, "filename": str, "thumbnail_warning": bool}`

- [ ] **Step 1: Write the failing tests**

Loo `tests/test_restore_original.py`:

```python
"""Testid lehe originaali taastamisele (._originals → praegune fail)."""
import sys
import json
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def ro_work(tmp_path, monkeypatch):
    """Testtöö ühe 200x100 lehega."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "rowork1"
    folder = tmp_path / "1700-ro-work"
    folder.mkdir()
    fname = "1700-ro-work-rowork1-pg001.jpg"
    PILImage.new("RGB", (200, 100), color=(180, 90, 40)).save(str(folder / fname), "JPEG", quality=95)
    (folder / (fname[:-4] + ".txt")).write_text("Tekst.", encoding="utf-8")
    (folder / (fname[:-4] + ".json")).write_text(json.dumps({"sequence": 100}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    return {"folder": folder, "work_id": wid, "filename": fname}


def test_restore_no_original_returns_reason(ro_work):
    from server.admin_page_ops import restore_original_page_image
    r = restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    assert r == {"success": True, "restored": False, "reason": "no_original"}


def test_restore_brings_back_pristine(ro_work):
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image, restore_original_page_image
    # Teisenda (90° → 100x200) — see loob ._originals (200x100)
    transform_page_image(ro_work["work_id"], ro_work["filename"], angle=90.0, username="admin")
    with PILImage.open(str(ro_work["folder"] / ro_work["filename"])) as im:
        assert (im.width, im.height) == (100, 200)
    # Taasta → tagasi 200x100
    r = restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    assert r["restored"] is True
    with PILImage.open(str(ro_work["folder"] / ro_work["filename"])) as im:
        assert (im.width, im.height) == (200, 100)


def test_restore_keeps_original_for_repeat(ro_work):
    from server.admin_page_ops import transform_page_image, restore_original_page_image
    transform_page_image(ro_work["work_id"], ro_work["filename"], angle=90.0, username="admin")
    restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    orig = ro_work["folder"].parent / "._originals" / ro_work["work_id"] / ro_work["filename"]
    assert orig.exists()  # ._originals jääb alles → korduvalt taastatav
    # Teine teisendus + taastamine töötab endiselt
    transform_page_image(ro_work["work_id"], ro_work["filename"], angle=90.0, username="admin")
    r = restore_original_page_image(ro_work["work_id"], ro_work["filename"], username="admin")
    assert r["restored"] is True


def test_restore_unknown_work(ro_work):
    from server.admin_page_ops import restore_original_page_image
    assert restore_original_page_image("nope", ro_work["filename"]) == {"found": False}


def test_restore_path_traversal_rejected(ro_work):
    from server.admin_page_ops import restore_original_page_image
    with pytest.raises(ValueError):
        restore_original_page_image(ro_work["work_id"], "../secret.jpg")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_restore_original.py -v`
Expected: FAIL — `ImportError: cannot import name 'restore_original_page_image'`.

- [ ] **Step 3: Implement `restore_original_page_image`**

`server/admin_page_ops.py`-s, pärast `clear_original_backup` funktsiooni (rida ~578):

```python
def restore_original_page_image(work_id, filename, username="admin"):
    """Taastab lehe ._originals pristine pildi praeguse faili kohale (ainult .jpg).

    Tekst/JSON/sequence/failinimi muutumatud. ._originals JÄÄB alles → korduvalt
    taastatav. Tagastab no_original kui originaali pole; found:False tundmatu töö korral.
    """
    # Path-traversal kaitse
    if os.path.basename(filename) != filename or "/" in filename or "\\" in filename:
        raise ValueError("vigane failinimi")

    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}

    orig_backup = os.path.join(BASE_DIR, '._originals', work_id, filename)
    if not os.path.exists(orig_backup):
        return {"success": True, "restored": False, "reason": "no_original"}

    folder_name = os.path.basename(path)
    with work_lock(folder_name, path):
        img_path = os.path.join(path, filename)
        if filename not in get_sorted_images(path):
            return {"found": False}

        base, ext = os.path.splitext(filename)

        # 1) Varunda praegune → trash
        trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'replaced_images')
        os.makedirs(trash_dir, exist_ok=True)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
        if os.path.exists(img_path):
            shutil.copy2(img_path, os.path.join(trash_dir, f"{base}_{timestamp}{ext}"))

        # 2) Kopeeri originaal tmp → atomaarne replace (._originals JÄÄB)
        tmp_path = img_path + '.tmp'
        shutil.copy2(orig_backup, tmp_path)
        os.replace(tmp_path, img_path)
        os.chmod(img_path, 0o644)

        # 3) Regenereeri thumbnail
        thumbnail_warning = False
        try:
            from .image_server import generate_thumbnail
            thumbs_dir = os.path.join(path, '_thumbs')
            os.makedirs(thumbs_dir, exist_ok=True)
            thumb_path = os.path.join(thumbs_dir, f"_thumb_{filename}")
            if os.path.exists(thumb_path):
                os.remove(thumb_path)
            generate_thumbnail(img_path, thumb_path)
        except Exception as e:
            logger.error(f"RESTORE: thumbnaili regen ebaõnnestus {filename}: {e}")
            thumbnail_warning = True

        # 4) Logi
        log_path = os.path.join(BASE_DIR, 'transform_image.log')
        with open(log_path, 'a', encoding='utf-8') as lf:
            lf.write(
                f"{datetime.now().isoformat()} | {username} | {work_id} | {filename} | "
                f"restore_original | -> restored\n"
            )

        logger.info(f"RESTORE: {folder_name}/{filename} ({username})")
        return {
            "success": True, "restored": True, "filename": filename,
            "thumbnail_warning": thumbnail_warning,
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_restore_original.py -v`
Expected: PASS (5 testi).

- [ ] **Step 5: Add restore endpoint**

`server/routers/pages.py` — lisa `restore_original_page_image` importi blokki (rida 10–25, `from ..admin_page_ops import (` sees):

```python
    restore_original_page_image,
```

Lisa endpoint kohe pärast `admin_transform_page_image` funktsiooni:

```python
@router.post("/admin/work/{work_id}/page-image/{filename}/restore-original")
async def admin_restore_original_page_image(work_id: str, filename: str, user=Depends(require_role("admin"))):
    """Taastab lehe pildi ._originals pristine versiooni."""
    try:
        result = restore_original_page_image(work_id, filename, username=user["username"])
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehte ei leitud")
    return result
```

- [ ] **Step 6: Run full backend suite (regressioonikontroll)**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py tests/test_restore_original.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/admin_page_ops.py server/routers/pages.py tests/test_restore_original.py
git commit -m "feat: add restore_original_page_image endpoint and function"
```

---

## Task 4: `split_page` populeerib mõlema poole `._originals`

**Files:**
- Modify: `server/admin_page_ops.py` (`split_page`, lisa `._originals` populeerimine enne originaali trashimist, rida ~393–425)
- Test: `tests/test_split_page.py` (lisa testid)

**Interfaces:**
- Consumes: olemasolev `split_page` ja `restore_original_page_image` (Task 3).
- Produces: pärast `split_page`-i eksisteerivad `._originals/{work_id}/{left}` ja `{right}` = poolituseelne topeltlehekülg (või originaali enda `._originals` kui see oli).

- [ ] **Step 1: Write the failing tests**

Lisa `tests/test_split_page.py` lõppu:

```python
def test_split_populates_originals_for_both_halves(work_dir):
    from PIL import Image as PILImage
    from server.admin_page_ops import split_page, get_sorted_images

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]
    images = get_sorted_images(str(folder))
    orig_dir = folder.parent / "._originals" / work_dir["work_id"]

    for half in images:
        op = orig_dir / half
        assert op.exists(), f"._originals puudub: {half}"
        with PILImage.open(str(op)) as im:
            assert (im.width, im.height) == (200, 100)  # poolituseelne topeltlehekülg


def test_split_half_restore_returns_double_page(work_dir):
    from PIL import Image as PILImage
    from server.admin_page_ops import split_page, restore_original_page_image, get_sorted_images

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]
    images = get_sorted_images(str(folder))
    half = images[0]
    # Pool on 100px lai; restore → 200px topeltlehekülg
    r = restore_original_page_image(work_dir["work_id"], half, username="testadmin")
    assert r["restored"] is True
    with PILImage.open(str(folder / half)) as im:
        assert im.width == 200


def test_split_prefers_existing_originals(work_dir):
    """Kui originaalil oli juba ._originals, kasutab seda (pristine eelistus)."""
    from server.admin_page_ops import split_page, get_sorted_images
    import shutil as _sh
    from PIL import Image as PILImage

    folder = work_dir["folder"]
    wid = work_dir["work_id"]
    orig_dir = folder.parent / "._originals" / wid
    orig_dir.mkdir(parents=True, exist_ok=True)
    # Pane pristine ._originals 200x100 PUNASE pildina (eristub töö-pildist)
    orig_name = "1690-test-work-testwork1-pg001.jpg"
    PILImage.new("RGB", (200, 100), color=(255, 0, 0)).save(str(orig_dir / orig_name), "JPEG", quality=95)

    split_page(wid, 1, 0.5, "testadmin")
    images = get_sorted_images(str(folder))
    for half in images:
        with PILImage.open(str(orig_dir / half)) as im:
            # Keskmine piksel peab olema punakas (pärit pristine'ist, mitte töö-pildist 200,100,50)
            r, g, b = im.getpixel((100, 50))
            assert r > 200 and g < 60 and b < 60
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_split_page.py -k "originals or restore or prefers" -v`
Expected: FAIL — `._originals` faile ei eksisteeri.

- [ ] **Step 3: Implement `._originals` populeerimine**

`server/admin_page_ops.py` `split_page`-s, kohe ENNE originaali prügikasti liigutamist (rida ~426, enne `# Liiguta originaali .jpg prügikasti`):

```python
        # Populeeri MÕLEMA poole ._originals poolituseelse topeltlehega, et
        # "Taasta originaal" tooks kummalt poolelt terve topeltlehe tagasi.
        # Eelista originaali enda ._originals-it (pristine enne kõike) kui olemas.
        orig_dir = os.path.join(BASE_DIR, '._originals', work_id)
        os.makedirs(orig_dir, exist_ok=True)
        existing_orig = os.path.join(orig_dir, orig_filename)
        src_original = existing_orig if os.path.exists(existing_orig) else orig_img_path
        for half in (left_filename, right_filename):
            dest = os.path.join(orig_dir, half)
            if not os.path.exists(dest):
                shutil.copy2(src_original, dest)
```

NB: see PEAB jooksma enne `shutil.move(orig_img_path, ...)` (rida ~430), sest `orig_img_path` on allikas kui `existing_orig` puudub.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_split_page.py -v`
Expected: PASS (kõik, sh olemasolevad split-testid + 3 uut).

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_split_page.py
git commit -m "feat: split_page populates ._originals for both halves"
```

---

## Task 5: Frontend util `perspectiveQuad.ts`

**Files:**
- Create: `src/utils/perspectiveQuad.ts`
- Test: `src/utils/__tests__/perspectiveQuad.test.ts` (UUS)

**Interfaces:**
- Produces:
  - `interface QuadPt { x: number; y: number }`
  - `type Quad4 = [QuadPt, QuadPt, QuadPt, QuadPt]` (TL, TR, BR, BL, normaliseeritud `[0..1]`)
  - `defaultQuad(inset?: number): Quad4`
  - `quadFromCropRect(r: { x: number; y: number; w: number; h: number }): Quad4`
  - `quadToDisplayPx(quad: Quad4, displayW: number, displayH: number): QuadPt[]`
  - `quadPtFromDisplayPx(x: number, y: number, displayW: number, displayH: number): QuadPt` (klambitud `[0..1]`)

- [ ] **Step 1: Write the failing tests**

Loo `src/utils/__tests__/perspectiveQuad.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  defaultQuad, quadFromCropRect, quadToDisplayPx, quadPtFromDisplayPx, Quad4,
} from '../perspectiveQuad';

describe('perspectiveQuad', () => {
  it('defaultQuad on inset servadest, järjekord TL,TR,BR,BL', () => {
    const q = defaultQuad(0.05);
    expect(q).toEqual([
      { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
      { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 },
    ]);
  });

  it('quadFromCropRect annab ristküliku 4 nurka TL,TR,BR,BL', () => {
    const q = quadFromCropRect({ x: 0.1, y: 0.2, w: 0.4, h: 0.3 });
    expect(q).toEqual([
      { x: 0.1, y: 0.2 }, { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 },
    ]);
  });

  it('quadToDisplayPx skaleerib display-mõõtudesse', () => {
    const q: Quad4 = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    expect(quadToDisplayPx(q, 200, 100)).toEqual([
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
    ]);
  });

  it('quadPtFromDisplayPx normaliseerib ja klambib [0,1]', () => {
    expect(quadPtFromDisplayPx(100, 50, 200, 100)).toEqual({ x: 0.5, y: 0.5 });
    expect(quadPtFromDisplayPx(-10, 200, 200, 100)).toEqual({ x: 0, y: 1 });
  });

  it('ümarsõit display→norm→display säilitab punktid', () => {
    const q: Quad4 = [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.15 },
                      { x: 0.85, y: 0.9 }, { x: 0.12, y: 0.88 }];
    const px = quadToDisplayPx(q, 400, 300);
    const back = px.map((p) => quadPtFromDisplayPx(p.x, p.y, 400, 300));
    back.forEach((p, i) => {
      expect(p.x).toBeCloseTo(q[i].x, 6);
      expect(p.y).toBeCloseTo(q[i].y, 6);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/utils/__tests__/perspectiveQuad.test.ts`
Expected: FAIL — moodulit `../perspectiveQuad` pole.

- [ ] **Step 3: Implement `perspectiveQuad.ts`**

Loo `src/utils/perspectiveQuad.ts`:

```typescript
// Perspektiivi nelinurga abifunktsioonid. Quad = 4 nurka normaliseeritud [0..1]
// rotated-display-raamis, järjekord TL, TR, BR, BL. Serverile saadetakse samas raamis.

export interface QuadPt { x: number; y: number }
export type Quad4 = [QuadPt, QuadPt, QuadPt, QuadPt];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Vaikenelinurk veidi servadest sissepoole (kõik sangad kohe haaratavad). */
export function defaultQuad(inset = 0.05): Quad4 {
  const a = clamp01(inset);
  const b = clamp01(1 - inset);
  return [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
}

/** Ristkülikust (normaliseeritud) 4 nurka TL, TR, BR, BL. */
export function quadFromCropRect(r: { x: number; y: number; w: number; h: number }): Quad4 {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Normaliseeritud quad → display-pikslid. */
export function quadToDisplayPx(quad: Quad4, displayW: number, displayH: number): QuadPt[] {
  return quad.map((p) => ({ x: p.x * displayW, y: p.y * displayH }));
}

/** Display-piksel → normaliseeritud punkt, klambitud [0,1]. */
export function quadPtFromDisplayPx(x: number, y: number, displayW: number, displayH: number): QuadPt {
  return { x: clamp01(x / displayW), y: clamp01(y / displayH) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/utils/__tests__/perspectiveQuad.test.ts`
Expected: PASS (5 testi).

- [ ] **Step 5: Commit**

```bash
git add src/utils/perspectiveQuad.ts src/utils/__tests__/perspectiveQuad.test.ts
git commit -m "feat: add perspectiveQuad util for corner geometry"
```

---

## Task 6: `pageService.ts` — `quad` argument + `restoreOriginalPageImage`

**Files:**
- Modify: `src/services/pageService.ts` (`transformPageImage` rida 170–189; lisa `restoreOriginalPageImage`)

**Interfaces:**
- Consumes: `Quad4` (Task 5).
- Produces:
  - `transformPageImage(workId, filename, angle, crop, token, quad?)` — `quad` antud korral saadab `{ angle, quad }`, muidu `{ angle, crop }`.
  - `restoreOriginalPageImage(workId, filename, token): Promise<{ success: boolean; restored: boolean; reason?: string; thumbnail_warning?: boolean }>`

- [ ] **Step 1: Update `transformPageImage` signatuur ja body**

`src/services/pageService.ts` — lisa import faili algusse (teiste importide juurde):

```typescript
import type { Quad4 } from '../utils/perspectiveQuad';
```

Asenda `transformPageImage` (rida 170–189):

```typescript
export async function transformPageImage(
  workId: string, filename: string, angle: number, crop: CropRect | null, token: string,
  quad?: Quad4,
): Promise<TransformResult> {
  const body = quad ? { angle, quad } : { angle, crop };
  const res = await fetchWithTimeout(
    `${FILE_API_URL}/admin/work/${workId}/page-image/${encodeURIComponent(filename)}/transform`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(body),
      timeout: 30000,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 2: Add `restoreOriginalPageImage`**

Kohe pärast `transformPageImage`:

```typescript
export interface RestoreResult {
  success: boolean;
  restored: boolean;
  reason?: string;
  thumbnail_warning?: boolean;
}

// Admin: taastab lehe pildi ._originals pristine versiooni (ainult pilt)
export async function restoreOriginalPageImage(
  workId: string, filename: string, token: string,
): Promise<RestoreResult> {
  const res = await fetchWithTimeout(
    `${FILE_API_URL}/admin/work/${workId}/page-image/${encodeURIComponent(filename)}/restore-original`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      timeout: 30000,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS (eeldab Task 5 `perspectiveQuad.ts` olemasolu).

- [ ] **Step 4: Commit**

```bash
git add src/services/pageService.ts
git commit -m "feat: pageService quad arg + restoreOriginalPageImage"
```

---

## Task 7: Modal — perspektiivi lüliti + quad overlay + apply-haru

**Files:**
- Modify: `src/components/PageImageEditorModal.tsx`

**Interfaces:**
- Consumes: `defaultQuad`, `quadFromCropRect`, `quadToDisplayPx`, `quadPtFromDisplayPx`, `Quad4`, `QuadPt` (Task 5); `transformPageImage` + `quad` (Task 6).
- Produces: töötav perspektiivirežiim "Muuda"-tabis.

**NB:** See task on UI-interaktsioon — pole vitest-testitav. Verifitseerimine: `npm run typecheck` + käsitsi (vt Step 7).

- [ ] **Step 1: Lisa importid ja olek**

`src/components/PageImageEditorModal.tsx` — lisa import (rida 11 lähedusse):

```typescript
import { defaultQuad, quadFromCropRect, quadToDisplayPx, quadPtFromDisplayPx, Quad4 } from '../utils/perspectiveQuad';
```

Lisa `lucide-react` importi `Frame` ikoon (perspektiivi-lülitile), rida 2:

```typescript
// lisa olemasolevasse importi: Frame
```

Lisa olek `splitX` lähedusse (rida ~47):

```typescript
  const [perspective, setPerspective] = useState(false);   // perspektiivirežiim
  const [quad, setQuad] = useState<Quad4 | null>(null);     // 4 nurka [0..1]
```

Laienda `interaction` ref union'it (rida 67–73) lisades:

```typescript
    | { mode: 'corner'; idx: number }
```

- [ ] **Step 2: Lähtesta perspektiiv pildi/teisenduse vahetusel**

`resetTransforms` (rida 91–99) — lisa kaks rida:

```typescript
    setPerspective(false);
    setQuad(null);
```

- [ ] **Step 3: Lüliti-handler + gross-pööre lähtestab quad'i**

Lisa `rotateBy` (rida 271) lähedusse uus handler:

```typescript
  // Perspektiivi lüliti: ON → quad olemasolevast kärpest või vaikenelinurk; OFF → quad=null
  const togglePerspective = () => {
    setPerspective((on) => {
      if (on) { setQuad(null); return false; }
      setQuad(cropRect ? quadFromCropRect(cropRect) : defaultQuad(0.05));
      return true;
    });
  };
```

`rotateBy` (rida 271–277) — lisa quad lähtestus perspektiivirežiimis. Asenda funktsioon:

```typescript
  // Jäme 90°/180° pööre rakendub PILDILE; kärbe/kalle lähtestatakse (display-raam muutub).
  // Perspektiivirežiimis lähtestatakse quad vaikenelinurgaks (me ei teisenda nurki).
  const rotateBy = (delta: number) => {
    setGrossAngle((a) => ((a + delta) % 360 + 360) % 360);
    setCropRect(null);
    setCropDraft(null);
    setBoxAngle(0);
    if (perspective) setQuad(defaultQuad(0.05));
    interaction.current = null;
  };
```

- [ ] **Step 4: Nurga-lohistus (corner mode)**

`onCropDown` (rida 187–208) — lisa perspektiivi haru funktsiooni algusesse, kohe pärast `e.preventDefault();` ja `const p = localPoint(e);`:

```typescript
    if (perspective && quad) {
      const target = e.target as HTMLElement;
      const ci = target.dataset.corner;
      if (ci !== undefined) {
        interaction.current = { mode: 'corner', idx: Number(ci) };
        setDragging(true);
        return;
      }
      // perspektiivirežiimis ei joonista uut kasti — ainult nurki lohistab
      return;
    }
```

`onCropMove` (rida 210–231) — lisa corner-haru (nt enne `if (it.mode === 'draw')`):

```typescript
    if (it.mode === 'corner' && quad) {
      const np = quadPtFromDisplayPx(p.x, p.y, displayW, displayH);
      setQuad(quad.map((q, i) => (i === it.idx ? np : q)) as Quad4);
      return;
    }
```

`onCropMove` esimene rida (rida 212) — luba corner mode ka kui cropRect puudub. Asenda:

```typescript
    if (!it || (it.mode !== 'draw' && it.mode !== 'corner' && !cropRect)) return;
```

- [ ] **Step 5: SVG quad overlay renderdus**

`src/components/PageImageEditorModal.tsx` — kärpe-overlay `<div ref={overlayRef} ...>` sees (rida 587–633), lisa perspektiivi haru. Asenda `{cropOverlay && (...)}` plokk tingimusliku renderdusega: kui `perspective && quad`, näita SVG-d, muidu praegune kärpe-kast.

Lisa SVG kohe `onMouseDown={onCropDown}` div'i sisse, ENNE `{cropOverlay && (...)}`:

```tsx
                  {perspective && quad ? (
                    <svg
                      className="absolute inset-0 w-full h-full overflow-visible"
                      style={{ pointerEvents: 'none' }}
                    >
                      <polygon
                        points={quadToDisplayPx(quad, displayW, displayH).map((p) => `${p.x},${p.y}`).join(' ')}
                        fill="rgba(99,102,241,0.15)"
                        stroke="rgb(99,102,241)"
                        strokeWidth={2}
                      />
                      {quadToDisplayPx(quad, displayW, displayH).map((p, i) => (
                        <circle
                          key={i}
                          data-corner={i}
                          cx={p.x}
                          cy={p.y}
                          r={7}
                          fill="white"
                          stroke="rgb(99,102,241)"
                          strokeWidth={2}
                          style={{ pointerEvents: 'auto', cursor: 'grab' }}
                        />
                      ))}
                    </svg>
                  ) : cropOverlay && (
```

Sulge tingimus: olemasoleva `{cropOverlay && (` rea asemel on nüüd `) : cropOverlay && (`. Veendu, et sulgevad `)}` jäävad korrektseks (üks ternary, kaks haru).

- [ ] **Step 6: Toolbar lüliti + apply-haru + vihjetekst**

Toolbar'i (rida 638–670), lisa perspektiivi-lüliti nupp pärast 180° nuppu (rida 659):

```tsx
                  <button
                    onClick={togglePerspective}
                    title={t('manage.editor.perspective')}
                    className={`p-2 rounded border ${perspective ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white hover:bg-gray-100'}`}
                  >
                    <Frame size={16} />
                  </button>
```

Vihjetekst (rida 562) — tee tingimuslikuks:

```tsx
              <p className="text-xs text-gray-400 flex-shrink-0">
                {perspective ? t('manage.editor.perspectiveHint') : t('manage.editor.cropHint')}
              </p>
```

`doApply` (rida 395–411) `tab === 'edit'` haru — lisa perspektiivi tee. Asenda olemasolev `if (tab === 'edit') { ... }` sisu algus:

```typescript
      if (tab === 'edit') {
        if (perspective && quad) {
          // Perspektiiv: jäme pööre + quad (deskew boxAngle EI kasutata)
          const r = await transformPageImage(workId, currentFilename, grossAngle, null, authToken, quad);
          thumbWarn = !!r.thumbnail_warning;
        } else {
          // Jäme pööre + kasti-kalle → serveri (angle, telg-joondatud crop)
          let sendAngle = grossAngle;
          let sendCrop: CropRect | null = null;
          if (cropRect) {
            const b = rectToCenterPx(cropRect);
            const params = rotatedCropToServerParams(
              { cx: b.cx, cy: b.cy, w: b.w, h: b.h, angleDeg: boxAngle }, displayW, displayH,
            );
            sendAngle = ((grossAngle + params.angle) % 360 + 360) % 360;
            const x = clamp(params.crop.x, 0, 1);
            const y = clamp(params.crop.y, 0, 1);
            sendCrop = { x, y, w: clamp(params.crop.w, 0, 1 - x), h: clamp(params.crop.h, 0, 1 - y) };
          }
          const r = await transformPageImage(workId, currentFilename, sendAngle, sendCrop, authToken);
          thumbWarn = !!r.thumbnail_warning;
        }
      } else {
```

- [ ] **Step 7: "Apply" lubatud perspektiivirežiimis**

`noEditChange` (rida 480) — laienda nii, et perspektiiv lubab Rakenda:

```typescript
  const noEditChange = tab === 'edit' && grossAngle === 0 && cropRect === null && !(perspective && quad);
```

- [ ] **Step 8: Verify typecheck + manuaalne**

Run: `npm run typecheck`
Expected: PASS.

Manuaalne (pärast Task 9 i18n + deploy või `npm run dev`):
- Ava manage-leht → lehe pildiredaktor → "Muuda" tab → klõpsa perspektiivi-nupp (Frame ikoon).
- Ilmub 4-nurga SVG; lohista nurki; "Rakenda" → pilt sirgestub ja lõigatakse.
- Lülita perspektiiv välja → tagasi kärpe-kast.

- [ ] **Step 9: Commit**

```bash
git add src/components/PageImageEditorModal.tsx
git commit -m "feat: perspective correction toggle + quad overlay in editor"
```

---

## Task 8: Modal — "Taasta originaal" nupp + kinnitus

**Files:**
- Modify: `src/components/PageImageEditorModal.tsx`

**Interfaces:**
- Consumes: `restoreOriginalPageImage` (Task 6); olemasolev `onPagesChanged` (bumpib cacheBust parent'is).
- Produces: päise "Taasta originaal" nupp kinnitusega, sõltumatu tabist.

**NB:** UI-task — verifitseerimine `npm run typecheck` + käsitsi.

- [ ] **Step 1: Lisa import + olek**

`src/components/PageImageEditorModal.tsx` — lisa `restoreOriginalPageImage` importi `pageService`-st (rida 7):

```typescript
import { transformPageImage, restoreOriginalPageImage, CropRect } from '../services/pageService';
```

Lisa `Undo2` ikoon lucide-react importi (rida 2).

Lisa olek (rida ~52, `showConfirm` lähedusse):

```typescript
  const [showRestoreConfirm, setShowRestoreConfirm] = useState(false);
  const [restoring, setRestoring] = useState(false);
```

- [ ] **Step 2: Restore-handler**

Lisa `onReplaceFile` (rida 464) lähedusse:

```typescript
  // Taasta lehe ._originals pristine pilt (destruktiivne: kõik pildimuudatused kaovad).
  // Restore puudutab AINULT pilti; tekst/JSON jäävad. Poolitatud poolel → topeltlehekülg.
  const doRestoreOriginal = async () => {
    if (!authToken || !current) return;
    setShowRestoreConfirm(false);
    setRestoring(true);
    setError(null);
    setToast(null);
    try {
      const r = await restoreOriginalPageImage(workId, current.filename, authToken);
      if (!r.restored && r.reason === 'no_original') {
        setToast({ text: t('manage.editor.noOriginal') });
        return;
      }
      await onPagesChanged();   // reload + cacheBust bump → reset-effekt lähtestab teisendused
      setToast({ text: t('manage.editor.restoreDone') });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t('manage.editor.restoreError'));
    } finally {
      setRestoring(false);
    }
  };
```

- [ ] **Step 3: Päise nupp**

Päises, asenda-pildi nupu kõrvale (rida 517 lähedusse, ENNE asenda-pildi nuppu):

```tsx
            <button
              onClick={() => setShowRestoreConfirm(true)}
              disabled={restoring || saving || replacing}
              title={t('manage.editor.restoreOriginal')}
              className="flex items-center gap-1.5 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50 transition-colors"
            >
              {restoring ? <Loader2 size={13} className="animate-spin" /> : <Undo2 size={13} />}
              {t('manage.editor.restoreOriginal')}
            </button>
```

- [ ] **Step 4: Kinnitusdialoog jaluses**

Jaluses, olemasoleva `{showConfirm && (...)}` ploki (rida 727–735) kõrvale lisa:

```tsx
          {showRestoreConfirm && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded space-y-2">
              <p className="text-sm text-amber-800">{t('manage.editor.restoreConfirmBody')}</p>
              <div className="flex gap-2">
                <button
                  onClick={doRestoreOriginal}
                  className="px-3 py-1 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded"
                >
                  {t('manage.editor.restoreOriginal')}
                </button>
                <button
                  onClick={() => setShowRestoreConfirm(false)}
                  className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-100"
                >
                  {t('manage.editor.cancel')}
                </button>
              </div>
            </div>
          )}
```

- [ ] **Step 5: Verify typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/PageImageEditorModal.tsx
git commit -m "feat: restore original button in page image editor"
```

---

## Task 9: i18n võtmed (et + en)

**Files:**
- Modify: `src/locales/et/workspace.json`
- Modify: `src/locales/en/workspace.json`

**Interfaces:**
- Consumes: võtmed, mida Task 7 ja 8 kasutavad (`manage.editor.*`).

- [ ] **Step 1: Leia `manage.editor` blokk mõlemas failis**

Run: `grep -n '"editor"' src/locales/et/workspace.json src/locales/en/workspace.json`
Expected: leiab `manage.editor` objekti mõlemas (kus on juba `cropHint`, `deskew`, `apply` jne).

- [ ] **Step 2: Lisa võtmed `manage.editor` blokki — ET**

`src/locales/et/workspace.json`, `manage.editor` objekti sisse (olemasolevate võtmete kõrvale):

```json
        "perspective": "Perspektiiv",
        "perspectiveHint": "Aseta nurgad lehe nurkadesse. Pilt sirgestatakse ja lõigatakse nelinurga järgi mõõtu.",
        "restoreOriginal": "Taasta originaal",
        "restoreConfirmBody": "Taastatakse lehe esimene algversioon; kõik hilisemad pildimuudatused (pööre, kärbe, perspektiiv) kaovad. Tekst jääb muutmata.",
        "restoreDone": "Originaal taastatud.",
        "noOriginal": "Originaali pole (lehte pole muudetud).",
        "restoreError": "Originaali taastamine ebaõnnestus.",
        "cancel": "Loobu"
```

- [ ] **Step 3: Lisa võtmed `manage.editor` blokki — EN**

`src/locales/en/workspace.json`, `manage.editor` objekti sisse:

```json
        "perspective": "Perspective",
        "perspectiveHint": "Place the corners on the page corners. The image will be straightened and cropped to the quadrilateral.",
        "restoreOriginal": "Restore original",
        "restoreConfirmBody": "The page's first original version will be restored; all later image changes (rotation, crop, perspective) will be lost. Text is unchanged.",
        "restoreDone": "Original restored.",
        "noOriginal": "No original (page has not been edited).",
        "restoreError": "Failed to restore original.",
        "cancel": "Cancel"
```

NB: kui mõni võti (nt `cancel`) on juba olemas `manage.editor`-is, ÄRA dubleeri — jäta vahele.

- [ ] **Step 4: Verify JSON valiidsus + typecheck**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/et/workspace.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/en/workspace.json','utf8')); console.log('OK')"`
Expected: `OK`

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: i18n keys for perspective correction and restore original"
```

---

## Task 10: Lõplik verifitseerimine + build

**Files:** (puuduvad muudatused — ainult kontroll)

- [ ] **Step 1: Kogu backend suite**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py tests/test_restore_original.py tests/test_split_page.py -v`
Expected: PASS (kõik).

- [ ] **Step 2: Frontend testid**

Run: `npx vitest run src/utils/__tests__/perspectiveQuad.test.ts`
Expected: PASS.

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: mõlemad PASS (build → `dist/`).

- [ ] **Step 4: Verifitseeri bundle sisaldab uut stringi**

Run: `grep -rl "restore-original" dist/ | head`
Expected: leiab vähemalt ühe bundle-faili.

- [ ] **Step 5: (Manuaalne, deploy järel) E2E smoke**

Pärast deploy'd (backend `--no-cache` + frontend rsync):
- Perspektiiv: ava redaktor → Muuda → Frame-nupp → nihuta 4 nurka trapets-pildil → Rakenda → kontrolli sirgestust.
- Taasta originaal: pärast teisendust klõpsa "Taasta originaal" → kinnita → pilt tagasi algversioonis.
- Poolitatud leht: poolita topeltlehekülg → ava üks pool → "Taasta originaal" → topeltlehekülg tuleb tagasi.
- Vana (enne muudatust) leht ilma originaalita → "Taasta originaal" → toast "Originaali pole".

---

## Self-Review (täidetud)

**Spec coverage:** Perspektiiv (Task 1,2,5,6,7) ✓; restore (Task 3,6,8) ✓; split→originals (Task 4) ✓; validate (Task 1) ✓; värviline QUAD-test (Task 2) ✓; i18n (Task 9) ✓; gross-rotate lähtestab quad'i (Task 7 Step 3) ✓; restore lähtestab editor-oleku (Task 7 reset + Task 8 onPagesChanged) ✓; "Restore ≠ Undo" kinnitustekst (Task 9) ✓.

**Type consistency:** `Quad4`/`QuadPt` defineeritud Task 5, kasutatud Task 6,7 sama nimega. `transformPageImage(..., quad?)` signatuur ühtne Task 6 ↔ Task 7 kutse. Endpoint `page-image/{filename}/transform` ja `.../restore-original` ühtsed backend (Task 2,3) ↔ frontend (Task 6).

**Märkus spec'ist erinemine:** restore-endpointi tee on `page-image/{filename}/restore-original` (mitte spec'i `page/{filename}/restore-original`) — joondatud OLEMASOLEVA transform-endpointi konventsiooniga (`page-image/{filename}/transform`).
