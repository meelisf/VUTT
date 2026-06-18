# Lehe pildiredaktor (pööra, kärbi, poolita — navigeeritav) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada admin lehekülgede haldusse ühte navigeeritavasse modaali koondatud pildiredaktor, mis pöörab (90° + deskew), kärbib ja poolitab lehepilte ilma modaali sulgemata, et terve dokument saaks ühe seansiga läbi töödelda.

**Architecture:** Klient saadab teisendus-**parameetrid** (nurk + normaliseeritud kärpe-ristkülik), server rakendab Pillow'ga täisresolutsioonis originaalile (nagu olemasolev `split_page`). Pildimuutus on kohapealne (failinimi/tekst/JSON/sequence säilivad), taaskasutab `replace-image` varundus-/thumbnail-mustrit, varundab **enne** ülekirjutust ja kasutab atomaarset `os.replace`-i. Frontend hoiab geomeetria (pööratud bounding-box) ja navigatsiooni-ankru loogika puhastes util-funktsioonides (vitest), React-komponent ainult traagib.

**Tech Stack:** Python 3.9 + FastAPI + Pillow (backend); React 19 + TypeScript + Tailwind + lucide-react (frontend); pytest (backend testid); vitest (frontend util-testid).

## Global Constraints

- Python 3.9 ühilduvus: kasuta `Optional[dict]`, MITTE `dict | None`.
- Koodikommentaarid eesti keeles; UI tekst i18n kaudu (et + en).
- Pildid EI ole git-tracked → pildimuudatusel git-commiti pole.
- `data/config/`/`state/` elavad ainult serveril; testid kasutavad `tmp_path` + `monkeypatch`.
- Failinime-põhine transform-endpoint (mitte `page_num` — habras pärast mutatsioone).
- Backend ops-funktsioonid tagastavad `{"found": False}` tundmatu töö/faili korral (endpoint → 404), `raise ValueError` vigaste parameetrite korral (endpoint → 400) — sama muster kui `split_page`.
- Konstandid: `ANGLE_EPS = 1e-4` (no-op lävi), `MIN_CROP_PX = 8` (min kärbe pärast klampimist).
- Pöörde märgi-konventsioon: frontend saadab nurga **CSS-kraadides (positiivne = päripäeva)**; server teeb `img.rotate(-angle, expand=True)` (Pillow pöörab vastupäeva). Lukustatud Task 1 aktseptantsitestiga.

---

## Failistruktuur

| Fail | Vastutus |
|------|----------|
| `server/admin_page_ops.py` (muuda) | Uus `transform_page_image()` + abifn `_compute_crop_box()`; `replace-image` originals-koristus abifn `clear_original_backup()` |
| `server/main.py` (muuda) | Uus endpoint `POST /admin/work/{work_id}/page-image/{filename}/transform`; `replace-image` endpoint kutsub `clear_original_backup()` |
| `tests/test_transform_page.py` (uus) | `transform_page_image` + endpoint + path-traversal + originals testid |
| `src/utils/imageTransformGeometry.ts` (uus) | Puhas geomeetria: `degToRad`, `expandedBoundingBox` |
| `src/utils/__tests__/imageTransformGeometry.test.ts` (uus) | Geomeetria testid |
| `src/utils/pageNavAnchor.ts` (uus) | Puhas ankur-reegel: `computeNextAnchor` |
| `src/utils/__tests__/pageNavAnchor.test.ts` (uus) | Ankur-reegli testid |
| `src/components/PageImageEditorModal.tsx` (uus) | Ühendatud navigeeritav modaal (pööra/kärbi + poolita tabid) |
| `src/services/pageService.ts` (muuda) | `transformPageImage()` API-kutse |
| `src/pages/WorkManage.tsx` (muuda) | Overflow-menüü (`⋮`); ava uus modaal; eemalda vana eraldi split-nupp |
| `src/components/SplitPageModal.tsx` (eemalda lõpus) | Loogika kolib modaali poolitamis-tabi alla |
| `src/locales/{et,en}/workspace.json` (muuda) | Uued `manage.editor.*` tõlkevõtmed |

---

## Task 1: Backend `transform_page_image()` + abifunktsioon

**Files:**
- Modify: `server/admin_page_ops.py` (lisa funktsioonid faili lõppu; lisa importe ülal)
- Test: `tests/test_transform_page.py` (uus)

**Interfaces:**
- Consumes: olemasolevad `find_directory_by_id`, `get_sorted_images`, `BASE_DIR` (`admin_page_ops`); `generate_thumbnail` (`server.image_server`, laetakse lazy).
- Produces:
  - `_compute_crop_box(crop: Optional[dict], w: int, h: int) -> Optional[tuple]` — tagastab klampitud `(left, top, right, bottom)` või `None`; `raise ValueError` kui pärast klampimist `< MIN_CROP_PX`.
  - `transform_page_image(work_id: str, filename: str, angle: float = 0.0, crop: Optional[dict] = None, username: str = "admin") -> dict` — tagastab `{"success": True, "changed": False, "reason": "no_transform"}` VÕI `{"success": True, "changed": True, "filename": str, "size": [W, H], "thumbnail_warning": bool}` VÕI `{"found": False}`; `raise ValueError` vigaste parameetrite korral.
  - Mooduli-konstandid: `ANGLE_EPS = 1e-4`, `MIN_CROP_PX = 8`.

- [ ] **Step 1: Write the failing test (abifn + 90° pööre + varundus enne)**

Lisa `tests/test_transform_page.py`:

```python
"""Testid lehe pildi teisendusele (pööra/kärbi)."""
import sys
import json
import pytest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def tf_work(tmp_path, monkeypatch):
    """Testtöö ühe 200x100 JPEG lehega."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "tfwork1"
    folder = tmp_path / "1700-tf-work"
    folder.mkdir()
    fname = "1700-tf-work-tfwork1-pg001.jpg"
    PILImage.new("RGB", (200, 100), color=(180, 90, 40)).save(str(folder / fname), "JPEG", quality=95)
    (folder / (fname[:-4] + ".txt")).write_text("Tekst.", encoding="utf-8")
    (folder / (fname[:-4] + ".json")).write_text(json.dumps({"sequence": 100, "status": "Toores"}), encoding="utf-8")

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    return {"folder": folder, "work_id": wid, "filename": fname}


def test_compute_crop_box_clamps_and_validates():
    from server.admin_page_ops import _compute_crop_box
    # Normaalne kärbe
    assert _compute_crop_box({"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0}, 200, 100) == (0, 0, 100, 100)
    # None → None
    assert _compute_crop_box(None, 200, 100) is None
    # Liiga väike pärast klampimist → ValueError
    with pytest.raises(ValueError):
        _compute_crop_box({"x": 0.0, "y": 0.0, "w": 0.001, "h": 1.0}, 200, 100)


def test_transform_rotate_90_changes_dimensions(tf_work):
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    r = transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    assert r["success"] is True and r["changed"] is True
    with PILImage.open(str(tf_work["folder"] / tf_work["filename"])) as im:
        # 200x100 → 90° → 100x200 (expand=True)
        assert (im.width, im.height) == (100, 200)


def test_transform_backup_is_old_image_before_overwrite(tf_work):
    from PIL import Image as PILImage
    from server.admin_page_ops import transform_page_image
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    trash = tf_work["folder"].parent / "._trash" / tf_work["work_id"] / "replaced_images"
    backups = list(trash.glob("*"))
    assert len(backups) == 1
    with PILImage.open(str(backups[0])) as im:
        assert (im.width, im.height) == (200, 100)  # VANA pilt, mitte uus


def test_transform_writes_pristine_original_once(tf_work):
    from server.admin_page_ops import transform_page_image
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    orig = tf_work["folder"].parent / "._originals" / tf_work["work_id"] / tf_work["filename"]
    assert orig.exists()
    mtime1 = orig.stat().st_mtime_ns
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    assert orig.stat().st_mtime_ns == mtime1  # EI kirjutatud teist korda üle


def test_transform_noop_returns_unchanged(tf_work):
    from server.admin_page_ops import transform_page_image
    r = transform_page_image(tf_work["work_id"], tf_work["filename"], angle=0.0, crop=None, username="admin")
    assert r == {"success": True, "changed": False, "reason": "no_transform"}


def test_transform_unknown_work_returns_found_false(tf_work):
    from server.admin_page_ops import transform_page_image
    assert transform_page_image("nope", tf_work["filename"], angle=90.0) == {"found": False}


def test_transform_path_traversal_rejected(tf_work):
    from server.admin_page_ops import transform_page_image
    with pytest.raises(ValueError):
        transform_page_image(tf_work["work_id"], "../secret.jpg", angle=90.0)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -v`
Expected: FAIL — `ImportError` / `cannot import name '_compute_crop_box'`.

- [ ] **Step 3: Implement `_compute_crop_box` ja `transform_page_image`**

Lisa `server/admin_page_ops.py` algusesse importide juurde (kui puudu):

```python
from datetime import datetime
```

Lisa faili lõppu:

```python
ANGLE_EPS = 1e-4   # alla selle nurka käsitleme nullina (float-müra slidersist)
MIN_CROP_PX = 8    # minimaalne kärpe-mõõde pärast klampimist


def _compute_crop_box(crop, w: int, h: int):
    """Teisendab normaliseeritud kärpe (0–1) klampitud pikslikastiks (left,top,right,bottom).

    Tagastab None kui crop puudub. Raise ValueError kui pärast klampimist liiga väike.
    """
    if crop is None:
        return None
    for k in ("x", "y", "w", "h"):
        if k not in crop:
            raise ValueError(f"crop väli '{k}' puudub")
        if not (0.0 <= float(crop[k]) <= 1.0):
            raise ValueError(f"crop '{k}' peab olema vahemikus [0,1]")
    if float(crop["w"]) <= 0 or float(crop["h"]) <= 0:
        raise ValueError("crop w,h peavad olema > 0")

    left = max(0, min(w, int(round(float(crop["x"]) * w))))
    top = max(0, min(h, int(round(float(crop["y"]) * h))))
    right = max(0, min(w, int(round((float(crop["x"]) + float(crop["w"])) * w))))
    bottom = max(0, min(h, int(round((float(crop["y"]) + float(crop["h"])) * h))))

    if (right - left) < MIN_CROP_PX or (bottom - top) < MIN_CROP_PX:
        raise ValueError("kärbe on pärast klampimist liiga väike")
    return (left, top, right, bottom)


def transform_page_image(work_id, filename, angle=0.0, crop=None, username="admin"):
    """Pöörab ja/või kärbib lehepilti kohapeal (failinimi/tekst/JSON/sequence säilivad).

    Varundab ENNE ülekirjutust (trash + esmane ._originals), kasutab atomaarset os.replace'i.
    Tagastab no-op / changed / found:False sõnastiku; raise ValueError vigaste parameetrite korral.
    """
    angle = float(angle)

    # No-op kaitse (float-tolerantsiga)
    if abs(angle) < ANGLE_EPS and crop is None:
        return {"success": True, "changed": False, "reason": "no_transform"}

    # Path-traversal kaitse
    if os.path.basename(filename) != filename or "/" in filename or "\\" in filename:
        raise ValueError("vigane failinimi")

    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}
    if filename not in get_sorted_images(path):
        return {"found": False}

    img_path = os.path.join(path, filename)
    base, ext = os.path.splitext(filename)
    ext_l = ext.lower()

    # 1) Varunda ENNE muutmist — trash
    trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'replaced_images')
    os.makedirs(trash_dir, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    shutil.copy2(img_path, os.path.join(trash_dir, f"{base}_{timestamp}{ext}"))

    # 2) Pristine originaal — ainult esimesel korral
    orig_dir = os.path.join(BASE_DIR, '._originals', work_id)
    os.makedirs(orig_dir, exist_ok=True)
    orig_backup = os.path.join(orig_dir, filename)
    if not os.path.exists(orig_backup):
        shutil.copy2(img_path, orig_backup)  # enne exif_transpose'i → 100% muutumatu

    # 3) Teisendus Pillow'ga
    from PIL import Image as PILImage, ImageOps
    with PILImage.open(img_path) as raw:
        img = ImageOps.exif_transpose(raw)
        is_jpeg = ext_l in ('.jpg', '.jpeg')
        if is_jpeg and img.mode in ('RGBA', 'LA', 'P'):
            img = img.convert('RGB')
        if abs(angle) >= ANGLE_EPS:
            # CSS positiivne = päripäeva → Pillow vastupäeva → -angle
            fill = (255, 255, 255) if img.mode == 'RGB' else 255
            img = img.rotate(-angle, expand=True, fillcolor=fill)
        box = _compute_crop_box(crop, img.width, img.height)
        if box is not None:
            img = img.crop(box)
        out_w, out_h = img.size

        # 4) Salvesta tmp-faili SAMAS kaustas (EXDEV kaitse), siis atomaarne replace
        tmp_path = img_path + '.tmp'
        if is_jpeg:
            img.save(tmp_path, "JPEG", quality=95)
        else:
            img.save(tmp_path, "PNG")
    os.replace(tmp_path, img_path)
    os.chmod(img_path, 0o644)

    # 5) Regenereeri thumbnail — vea korral ei rollback'i
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
        logger.error(f"TRANSFORM: thumbnaili regen ebaõnnestus {filename}: {e}")
        thumbnail_warning = True

    # 6) Logi (struktureeritud). NB: Meilit EI sünki — failinimi/tekst/sequence ei muutu.
    log_path = os.path.join(BASE_DIR, 'transform_image.log')
    with open(log_path, 'a', encoding='utf-8') as lf:
        lf.write(
            f"{datetime.now().isoformat()} | {username} | {work_id} | {filename} | "
            f"angle={angle} crop={crop} | -> {out_w}x{out_h}\n"
        )

    logger.info(f"TRANSFORM: {os.path.basename(path)}/{filename} ({username})")
    return {
        "success": True, "changed": True, "filename": filename,
        "size": [out_w, out_h], "thumbnail_warning": thumbnail_warning,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -v`
Expected: PASS (kõik Step 1 testid).

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_transform_page.py
git commit -m "feat(backend): transform_page_image — pööra/kärbi kohapeal, varundus enne ülekirjutust"
```

---

## Task 2: Backend endpoint `/page-image/{filename}/transform`

**Files:**
- Modify: `server/main.py` (lisa endpoint `admin_split_page` järele; lisa `transform_page_image` importi reale 48)
- Test: `tests/test_transform_page.py` (lisa endpoint-testid)

**Interfaces:**
- Consumes: `transform_page_image` (Task 1), `require_role`, `get_json_data`.
- Produces: `POST /admin/work/{work_id}/page-image/{filename}/transform`, body `{ "angle": float, "crop": {x,y,w,h}|null }`.

- [ ] **Step 1: Write the failing endpoint tests**

Lisa `tests/test_transform_page.py` lõppu:

```python
def test_transform_endpoint_401_no_auth(backend_env):
    r = backend_env["client"].post("/admin/work/w1/page-image/a.jpg/transform", json={"angle": 90})
    assert r.status_code == 401


def test_transform_endpoint_400_bad_crop(backend_env, login, monkeypatch):
    import server.main as main

    def _raise(*a, **kw):
        raise ValueError("kärbe liiga väike")
    monkeypatch.setattr(main, "transform_page_image", _raise)

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page-image/a.jpg/transform",
        json={"angle": 0, "crop": {"x": 0, "y": 0, "w": 0.001, "h": 1}},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_transform_endpoint_404_unknown(backend_env, login, monkeypatch):
    import server.main as main
    monkeypatch.setattr(main, "transform_page_image", lambda *a, **kw: {"found": False})
    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/x/page-image/a.jpg/transform",
        json={"angle": 90},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_transform_endpoint_200(backend_env, login, monkeypatch):
    import server.main as main
    monkeypatch.setattr(
        main, "transform_page_image",
        lambda *a, **kw: {"success": True, "changed": True, "filename": "a.jpg", "size": [100, 200], "thumbnail_warning": False},
    )
    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page-image/a.jpg/transform",
        json={"angle": 90, "crop": None},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["changed"] is True
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -k endpoint -v`
Expected: FAIL — 404 reeglid puuduvad (endpoint pole olemas → 404/405 vale põhjusega) / `transform_page_image` pole `main`-is.

- [ ] **Step 3: Add import and endpoint**

`server/main.py` real 48 lisa import:

```python
from .admin_page_ops import get_page_sequence, get_sorted_images, rebalance_sequences, reorder_pages, split_page, transform_page_image
```

Lisa `admin_split_page` funktsiooni järele:

```python
@app.post("/admin/work/{work_id}/page-image/{filename}/transform")
async def admin_transform_page_image(work_id: str, filename: str, request: Request, user=Depends(require_role("admin"))):
    """Pöörab/kärbib lehepilti kohapeal. Body: { angle: float, crop: {x,y,w,h}|null }"""
    data = await get_json_data(request)
    angle = data.get("angle", 0.0)
    crop = data.get("crop")
    try:
        result = transform_page_image(work_id, filename, angle=angle, crop=crop, username=user["username"])
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehte ei leitud")
    return result
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -v`
Expected: PASS (kõik, sh endpoint-testid).

- [ ] **Step 5: Commit**

```bash
git add server/main.py tests/test_transform_page.py
git commit -m "feat(backend): /page-image/{filename}/transform endpoint (failinime-põhine)"
```

---

## Task 3: `replace-image` kustutab `._originals` kirje

**Files:**
- Modify: `server/admin_page_ops.py` (lisa `clear_original_backup`)
- Modify: `server/main.py` (`admin_replace_page_image`, ~rida 538 järel; import real 48)
- Test: `tests/test_transform_page.py` (lisa originals-koristuse testid)

**Interfaces:**
- Consumes: `transform_page_image` (Task 1), `BASE_DIR`.
- Produces:
  - `clear_original_backup(work_id: str, filename: str) -> None` (`admin_page_ops.py`) — kustutab `._originals/{work_id}/{filename}` kui olemas.
  - Muudetud `replace-image` käitumine — pärast pildi asendamist kustutatakse vana `._originals` kirje.

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_transform_page.py` lõppu:

```python
def test_clear_original_backup_removes_pristine(tf_work):
    """Pärast transform'i tekib ._originals; clear_original_backup eemaldab selle."""
    from server.admin_page_ops import transform_page_image, clear_original_backup
    transform_page_image(tf_work["work_id"], tf_work["filename"], angle=90.0, username="admin")
    orig = tf_work["folder"].parent / "._originals" / tf_work["work_id"] / tf_work["filename"]
    assert orig.exists()
    clear_original_backup(tf_work["work_id"], tf_work["filename"])
    assert not orig.exists()


def test_clear_original_backup_ignores_traversal(tf_work):
    from server.admin_page_ops import clear_original_backup
    # Ei tohi visata ega midagi kustutada
    clear_original_backup(tf_work["work_id"], "../../etc/passwd")
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -k clear_original_backup -v`
Expected: FAIL — `cannot import name 'clear_original_backup'`.

- [ ] **Step 3a: Implement `clear_original_backup`**

Lisa `server/admin_page_ops.py` lõppu:

```python
def clear_original_backup(work_id, filename):
    """Kustutab pristine originaali (._originals) — kutsub replace-image, sest asendatud
    pilt on lehe uus algolek (vt spec: replace-image ↔ originals loogikaauk)."""
    if os.path.basename(filename) != filename or "/" in filename or "\\" in filename:
        return
    orig_backup = os.path.join(BASE_DIR, '._originals', work_id, filename)
    if os.path.exists(orig_backup):
        os.remove(orig_backup)
```

- [ ] **Step 3b: Wire `clear_original_backup` into replace-image endpoint**

`server/main.py` impordi real 48 lisa `clear_original_backup` (sama `from .admin_page_ops import ...` rida — koos `transform_page_image`-iga).

`admin_replace_page_image`-s, **pärast** uue pildi kirjutamist ja thumbnaili regenereerimist (pärast rida ~548), lisa:

```python
    # Asendatud pilt on lehe uus pristine algolek → eemalda vana ._originals kirje
    clear_original_backup(work_id, img_name)
```

> NB: endpoint-integratsioon (multipart upload) jääb manuaalseks verifitseerimiseks — ops-funktsioon on ülal testitud, täis-multipart-integratsioonitest oleks ebaproportsionaalne.

- [ ] **Step 4: Run full backend suite**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/admin_page_ops.py server/main.py tests/test_transform_page.py
git commit -m "fix(backend): replace-image kustutab vana ._originals (uus pristine algolek)"
```

---

## Task 4: Frontend geomeetria-util (`imageTransformGeometry.ts`)

**Files:**
- Create: `src/utils/imageTransformGeometry.ts`
- Test: `src/utils/__tests__/imageTransformGeometry.test.ts`

**Interfaces:**
- Produces:
  - `degToRad(deg: number): number`
  - `expandedBoundingBox(w: number, h: number, angleDeg: number): { width: number; height: number }` — Pillow `rotate(expand=True)` mõõdud: `W' = |w·cosθ| + |h·sinθ|`, `H' = |w·sinθ| + |h·cosθ|`.

- [ ] **Step 1: Write the failing test**

Loo `src/utils/__tests__/imageTransformGeometry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { degToRad, expandedBoundingBox } from '../imageTransformGeometry';

describe('degToRad', () => {
  it('teisendab kraadid radiaanideks', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
    expect(degToRad(0)).toBe(0);
  });
});

describe('expandedBoundingBox', () => {
  it('0° → samad mõõdud', () => {
    const b = expandedBoundingBox(200, 100, 0);
    expect(b.width).toBeCloseTo(200, 6);
    expect(b.height).toBeCloseTo(100, 6);
  });

  it('90° → vahetab laiuse ja kõrguse', () => {
    const b = expandedBoundingBox(200, 100, 90);
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.height).toBeCloseTo(200, 6);
  });

  it('märk ei mõjuta mõõtu (abs)', () => {
    const a = expandedBoundingBox(200, 100, 30);
    const b = expandedBoundingBox(200, 100, -30);
    expect(a.width).toBeCloseTo(b.width, 6);
    expect(a.height).toBeCloseTo(b.height, 6);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- imageTransformGeometry`
Expected: FAIL — moodulit pole.

- [ ] **Step 3: Implement**

Loo `src/utils/imageTransformGeometry.ts`:

```typescript
// Pildi pööramise geomeetria — peab klappima serveri Pillow rotate(expand=True)-iga.

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Pööratud pildi expand'itud bounding-box (sama valem kui Pillow expand=True). */
export function expandedBoundingBox(w: number, h: number, angleDeg: number): { width: number; height: number } {
  const r = degToRad(angleDeg);
  const cos = Math.abs(Math.cos(r));
  const sin = Math.abs(Math.sin(r));
  return {
    width: w * cos + h * sin,
    height: w * sin + h * cos,
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- imageTransformGeometry`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/imageTransformGeometry.ts src/utils/__tests__/imageTransformGeometry.test.ts
git commit -m "feat(frontend): imageTransformGeometry util (expand bounding-box, kraadid→radiaanid)"
```

---

## Task 5: Frontend navigatsiooni-ankur (`pageNavAnchor.ts`)

**Files:**
- Create: `src/utils/pageNavAnchor.ts`
- Test: `src/utils/__tests__/pageNavAnchor.test.ts`

**Interfaces:**
- Produces:
  - `computeNextAnchor(filenamesBefore: string[], currentFilename: string): string | null` — tagastab praegusele JÄRGNEVA failinime või `null` (kui viimane). Salvestatakse ENNE mutatsiooni.
  - `resolveIndexAfter(filenamesAfter: string[], anchor: string | null, currentFilename: string): { index: number; done: boolean }` — leiab uue indeksi: kui `anchor` leitud → selle indeks; kui `anchor` puudub/null → proovi `currentFilename` (crop/rotate jäi paigale), muidu viimane leht + `done: true`.

- [ ] **Step 1: Write the failing test**

Loo `src/utils/__tests__/pageNavAnchor.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeNextAnchor, resolveIndexAfter } from '../pageNavAnchor';

describe('computeNextAnchor', () => {
  it('tagastab järgmise faili', () => {
    expect(computeNextAnchor(['a.jpg', 'b.jpg', 'c.jpg'], 'b.jpg')).toBe('c.jpg');
  });
  it('viimasel lehel → null', () => {
    expect(computeNextAnchor(['a.jpg', 'b.jpg'], 'b.jpg')).toBe(null);
  });
});

describe('resolveIndexAfter', () => {
  it('crop/rotate: failinimi säilib → sama leht', () => {
    // Nimekiri ei muutunud; ankur oli "b.jpg" ja see on alles
    const r = resolveIndexAfter(['a.jpg', 'b.jpg', 'c.jpg'], 'b.jpg', 'a.jpg');
    expect(r).toEqual({ index: 1, done: false });
  });
  it('split: ankur (järgmine originaal) hüppab üle uute pooolte', () => {
    // Enne: [a,b,c]; poolitati a → [a1,a2,b,c]; ankur oli "b.jpg"
    const r = resolveIndexAfter(['a1.jpg', 'a2.jpg', 'b.jpg', 'c.jpg'], 'b.jpg', 'a.jpg');
    expect(r).toEqual({ index: 2, done: false });
  });
  it('viimane leht (ankur null), praegune kadunud → done viimasel', () => {
    const r = resolveIndexAfter(['a1.jpg', 'a2.jpg'], null, 'a.jpg');
    expect(r).toEqual({ index: 1, done: true });
  });
  it('viimane leht (ankur null), praegune alles → done samal', () => {
    const r = resolveIndexAfter(['a.jpg', 'b.jpg'], null, 'b.jpg');
    expect(r).toEqual({ index: 1, done: true });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -- pageNavAnchor`
Expected: FAIL — moodulit pole.

- [ ] **Step 3: Implement**

Loo `src/utils/pageNavAnchor.ts`:

```typescript
// Navigatsiooni-ankur: positsioneeri end failinime, mitte jäiga indeksi järgi
// (poolitamine muudab lehtede arvu ja indekseid).

/** Praegusele JÄRGNEVA lehe failinimi (salvesta ENNE mutatsiooni), või null kui viimane. */
export function computeNextAnchor(filenamesBefore: string[], currentFilename: string): string | null {
  const i = filenamesBefore.indexOf(currentFilename);
  if (i === -1 || i + 1 >= filenamesBefore.length) return null;
  return filenamesBefore[i + 1];
}

/** Leiab uue indeksi pärast mutatsiooni; done=true kui dokument läbi. */
export function resolveIndexAfter(
  filenamesAfter: string[],
  anchor: string | null,
  currentFilename: string,
): { index: number; done: boolean } {
  if (anchor !== null) {
    const i = filenamesAfter.indexOf(anchor);
    if (i !== -1) return { index: i, done: false };
  }
  // Ankrut polnud (viimane leht) või kadus — proovi praegust (crop/rotate jäi paigale)
  const cur = filenamesAfter.indexOf(currentFilename);
  if (cur !== -1) return { index: cur, done: true };
  // Praegune kadus (nt split viimasel lehel) → viimane leht
  return { index: Math.max(0, filenamesAfter.length - 1), done: true };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -- pageNavAnchor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/pageNavAnchor.ts src/utils/__tests__/pageNavAnchor.test.ts
git commit -m "feat(frontend): pageNavAnchor util (failinime-ankur, split hüppab üle pooolte)"
```

---

## Task 6: API-kutse `transformPageImage` (`pageService.ts`)

**Files:**
- Modify: `src/services/pageService.ts`

**Interfaces:**
- Consumes: `FILE_API_URL`, `getAuthHeaders`, `fetchWithTimeout` (vt olemasolevad importid samas failis).
- Produces: `transformPageImage(workId: string, filename: string, angle: number, crop: CropRect | null, token: string): Promise<TransformResult>`; tüübid `CropRect = { x: number; y: number; w: number; h: number }`, `TransformResult = { success: boolean; changed: boolean; filename?: string; size?: [number, number]; thumbnail_warning?: boolean; reason?: string }`.

- [ ] **Step 1: Add the function (no unit test — võrgukiht, kaetud manuaalse verifitseerimisega Task 7)**

Loe esmalt `src/services/pageService.ts`, et kopeerida olemasolev importide/fetch-muster. Lisa:

```typescript
export interface CropRect { x: number; y: number; w: number; h: number; }
export interface TransformResult {
  success: boolean; changed: boolean; filename?: string;
  size?: [number, number]; thumbnail_warning?: boolean; reason?: string;
}

export async function transformPageImage(
  workId: string, filename: string, angle: number, crop: CropRect | null, token: string,
): Promise<TransformResult> {
  const res = await fetchWithTimeout(
    `${FILE_API_URL}/admin/work/${workId}/page-image/${encodeURIComponent(filename)}/transform`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify({ angle, crop }),
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

> Kui `FILE_API_URL` / `getAuthHeaders` / `fetchWithTimeout` pole failis juba imporditud, lisa importid samast kohast, kust neid mujal kasutatakse (`../config`, `../utils/fetchWithTimeout`).

- [ ] **Step 2: Typecheck**

Run: `npm run build` (või `npx tsc --noEmit`)
Expected: viga puudub.

- [ ] **Step 3: Commit**

```bash
git add src/services/pageService.ts
git commit -m "feat(frontend): transformPageImage API-kutse"
```

---

## Task 7: `PageImageEditorModal` komponent (ühendatud navigeeritav)

**Files:**
- Create: `src/components/PageImageEditorModal.tsx`
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json`

**Interfaces:**
- Consumes: `transformPageImage`, `CropRect` (Task 6); `expandedBoundingBox`, `degToRad` (Task 4); `computeNextAnchor`, `resolveIndexAfter` (Task 5); `FILE_API_URL`, `IMAGE_BASE_URL`, `getAuthHeaders`, `fetchWithTimeout` (split-kutse jaoks); `useUser`.
- Produces: default-export React-komponent.
  ```typescript
  interface PageInfo { filename: string; page_num: number; }
  interface Props {
    workId: string;
    pages: PageInfo[];               // järjestatud
    initialIndex: number;
    initialTab: 'edit' | 'split';
    imageToken: { exp: number; sig: string } | null;
    onClose: () => void;
    onPagesChanged: () => Promise<string[]>;  // laeb pages uuesti, tagastab uue failinimede massiivi
  }
  ```

**Implementatsiooni nõuded (spec'ist — järgi täpselt):**
- Kaks tabi: **"Pööra & kärbi"** (90° nupud ←/→/180° + deskew-slider ±10° + vaba kärpe-ristkülik) ja **"Poolita"** (lõikejoone-drag, port `SplitPageModal`-ist).
- **Geomeetria parity:** kärpe-ristkülik joonistatakse pööratud pildi `expandedBoundingBox`-i suhtes; crop saadetakse normaliseeritud (0–1) **pööratud-pildi** koordinaatides. Pööre eelvaates CSS `transform: rotate(${angle}deg)`.
- **Navigeerimine:** ← → nupud + klaviatuur; **klahvi-kaitse** — ignoreeri nooli kui `document.activeElement` on `INPUT`/slider/kärpe-handle. Päises "Leht X / N".
- **Apply ei sulge:** edukal toimingul kutsu `onPagesChanged()` → saa uus failinimede massiiv → `resolveIndexAfter(after, anchor, currentFilename)` → liigu sinna; `done` korral näita "Kõik lehed läbi töödeldud". Ankur arvuta `computeNextAnchor(before, currentFilename)` ENNE apply'd.
- **Kinnitus batch-sõbralik:** esimene apply küsib kinnitust + linnuke "ära küsi selles aknas uuesti" (`skipConfirmRef`/state, modaali-skoobis).
- **Split-järgne toast:** "Leht poolitatud" + tegevus "Vaata uusi pooli" (positsioneeri kahe uue poole esimesele); crop/rotate'il lihtne õnnestumis-toast. `thumbnail_warning` korral näita hoiatust.

- [ ] **Step 1: Add i18n keys**

`src/locales/et/workspace.json` — lisa `manage` objekti sisse (loe fail, leia `"manage"` blokk):

```json
"editor": {
  "title": "Lehe pildiredaktor",
  "tabEdit": "Pööra & kärbi",
  "tabSplit": "Poolita",
  "rotateLeft": "Pööra vasakule 90°",
  "rotateRight": "Pööra paremale 90°",
  "rotate180": "Pööra 180°",
  "deskew": "Peenhäälestus (kraadid)",
  "apply": "Rakenda",
  "page": "Leht {{cur}} / {{total}}",
  "prev": "Eelmine leht",
  "next": "Järgmine leht",
  "confirmBody": "Vana pilt säilib prügikastis 90 päeva. Tekst ja metaandmed jäävad muutmata.",
  "dontAskAgain": "Ära küsi selles aknas uuesti",
  "allDone": "Kõik lehed läbi töödeldud",
  "splitDone": "Leht poolitatud",
  "viewNewHalves": "Vaata uusi pooli",
  "thumbWarning": "Pilt muudeti, aga pisipildi uuendamine ebaõnnestus."
}
```

`src/locales/en/workspace.json` — sama `manage.editor` blokk inglise keeles:

```json
"editor": {
  "title": "Page image editor",
  "tabEdit": "Rotate & crop",
  "tabSplit": "Split",
  "rotateLeft": "Rotate left 90°",
  "rotateRight": "Rotate right 90°",
  "rotate180": "Rotate 180°",
  "deskew": "Fine-tune (degrees)",
  "apply": "Apply",
  "page": "Page {{cur}} / {{total}}",
  "prev": "Previous page",
  "next": "Next page",
  "confirmBody": "The old image is kept in trash for 90 days. Text and metadata are unchanged.",
  "dontAskAgain": "Don't ask again in this window",
  "allDone": "All pages processed",
  "splitDone": "Page split",
  "viewNewHalves": "View new halves",
  "thumbWarning": "Image was changed, but thumbnail update failed."
}
```

- [ ] **Step 2: Implement the component**

Loo `src/components/PageImageEditorModal.tsx`. Loe enne `src/components/SplitPageModal.tsx` (poolitamis-tabi drag-loogika port) ja kopeeri lõikejoone-muster. Komponent peab:
1. Hoidma `currentIndex`, `tab`, `angle`, `cropRect` (normaliseeritud või null), `splitX`, `skipConfirm`, `toast` state'i.
2. Renderdama pildi `IMAGE_BASE_URL/${workId}/${filename}` + token; CSS `transform: rotate(${angle}deg)`.
3. "Pööra & kärbi" tab: 90° nupud (`angle => (angle ± 90) % 360`), slider `min={-10} max={10} step={0.1}`, kärpe-ristkülik üle pööratud pildi (kasuta `expandedBoundingBox` displai-mõõtude normaliseerimiseks).
4. "Poolita" tab: SplitPageModal lõikejoon + `POST .../page/${page_num}/split` (võta `page_num` `pages[currentIndex].page_num`-ist).
5. Apply-loogika:
   ```typescript
   const before = pages.map(p => p.filename);
   const anchor = computeNextAnchor(before, current.filename);
   // ... POST transform või split ...
   const after = await onPagesChanged();
   const { index, done } = resolveIndexAfter(after, anchor, current.filename);
   setCurrentIndex(index);
   if (done) setToast(t('manage.editor.allDone'));
   ```
6. Klaviatuur: `useEffect` `keydown` listener; navigeeri ainult kui `!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)` ja fookus ei ole slideril/handle'il.
7. Kinnitus: kui `!skipConfirm`, näita kinnitusdialoogi linnukesega; linnukese märkimisel `setSkipConfirm(true)`.

> See on suur komponent — pole vitest-unit-testi (repo muster: React-komponente ei unit-testita; puhas loogika on juba Task 4–5 kaetud). Verifitseerimine manuaalne Step 4.

- [ ] **Step 3: Typecheck**

Run: `npm run build`
Expected: viga puudub.

- [ ] **Step 4: Manual verification (dev-server)**

Run: `npm run dev`, ava admin teose haldus, käivita modaal (pärast Task 8 menüü-traati). Kontrolli: 90° pööre + apply → pilt pöördub; deskew slider; kärpe-ristkülik → server lõikab õigest kohast (±1–2 px); ← → liigub; slideril nooled EI vaheta lehte; split → toast "Vaata uusi pooli"; viimane leht → "Kõik lehed läbi töödeldud".

- [ ] **Step 5: Commit**

```bash
git add src/components/PageImageEditorModal.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat(frontend): PageImageEditorModal — ühendatud navigeeritav pildiredaktor"
```

---

## Task 8: WorkManage overflow-menüü + modaali traat

**Files:**
- Modify: `src/pages/WorkManage.tsx`
- Remove (lõpus): `src/components/SplitPageModal.tsx` import + render (asendatud)

**Interfaces:**
- Consumes: `PageImageEditorModal` (Task 7).
- Produces: pisipildi `⋮` overflow-menüü (Lae alla / Asenda pilt / Pööra-kärbi / Lõika kaheks); avab `PageImageEditorModal` õigel tabil ja indeksil.

- [ ] **Step 1: Replace bottom-row buttons with overflow menu**

`src/pages/WorkManage.tsx`:
1. Lisa import: `import PageImageEditorModal from '../components/PageImageEditorModal';` ja lucide ikoonid `MoreVertical, Crop` (lisa olemasolevasse `from 'lucide-react'` blokki).
2. Lisa state: `const [openMenuPage, setOpenMenuPage] = useState<number | null>(null);` ja `const [editorTarget, setEditorTarget] = useState<{ index: number; tab: 'edit' | 'split' } | null>(null);`.
3. Asenda pisipildi alumise serva 3-nupu plokk (read ~629–670, `<div className="absolute bottom-1 left-1 right-1 ...">`) ühe `⋮` nupuga (`onClick={() => setOpenMenuPage(page.page_num)}`) + tingimuslik popover-menüü (`openMenuPage === page.page_num`), kirjetega:
   - **Lae alla** — olemasolev `<a download>` (kopeeri token-URL loogika reast 632–643).
   - **Asenda pilt** — `replaceTargetPage.current = page.page_num; replaceInputRef.current?.click();`
   - **Pööra / kärbi** — `setEditorTarget({ index: page.page_num - 1, tab: 'edit' }); setOpenMenuPage(null);`
   - **Lõika kaheks** — `setEditorTarget({ index: page.page_num - 1, tab: 'split' }); setOpenMenuPage(null);`
4. Lisa outside-click sulgemine: `useEffect` document-click listener, mis `setOpenMenuPage(null)` kui klõps väljaspool menüüd.

- [ ] **Step 2: Replace SplitPageModal render with PageImageEditorModal**

Asenda `{splitPageTarget && (<SplitPageModal .../>)}` plokk (read ~1000–1012):

```tsx
{editorTarget && (
  <PageImageEditorModal
    workId={workId!}
    pages={pages.map(p => ({ filename: p.lehekylje_pilt.split('/').pop() ?? '', page_num: p.page_num }))}
    initialIndex={editorTarget.index}
    initialTab={editorTarget.tab}
    imageToken={imageToken}
    onClose={() => setEditorTarget(null)}
    onPagesChanged={async () => {
      await loadPages();
      setThumbCacheBust(Date.now());
      return pages.map(p => p.lehekylje_pilt.split('/').pop() ?? '');
    }}
  />
)}
```

Eemalda `import SplitPageModal`, `splitPageTarget` state ja vana split-nupp (kui veel alles).

> NB: `onPagesChanged` peab tagastama **värske** nimekirja. Kuna `loadPages` uuendab `pages` state'i asünkroonselt, kasuta `loadPages`-i varianti, mis tagastab uue massiivi otse (vt järgmine samm), MITTE vananenud `pages` closure'it.

- [ ] **Step 3: Make `loadPages` return the fresh filename list**

Loe `loadPages` (rida ~155). Muuda nii, et see tagastab laetud lehtede failinimede massiivi (nt `return loaded.map(p => p.lehekylje_pilt.split('/').pop() ?? '')`). Uuenda `onPagesChanged` kasutama seda tagastust:

```tsx
onPagesChanged={async () => {
  const fresh = await loadPages();
  setThumbCacheBust(Date.now());
  return fresh;
}}
```

- [ ] **Step 4: Typecheck + manual verification**

Run: `npm run build`
Expected: viga puudub.
Seejärel `npm run dev`: `⋮` menüü avaneb/sulgub; iga kirje töötab; modaal avaneb õigel tabil; navigeerimine ja apply toimivad otsast lõpuni.

- [ ] **Step 5: Commit**

```bash
git add src/pages/WorkManage.tsx
git commit -m "feat(frontend): WorkManage ⋮ overflow-menüü + PageImageEditorModal traat"
```

---

## Task 9: Täis-suite + lõppverifitseerimine

- [ ] **Step 1: Backend testid**

Run: `.venv/bin/python -m pytest tests/test_transform_page.py tests/test_split_page.py -v`
Expected: PASS.

- [ ] **Step 2: Frontend util-testid + build**

Run: `npm run test && npm run build`
Expected: vitest PASS, build õnnestub.

- [ ] **Step 3: Commit (kui parandusi tehtud)**

```bash
git add -A && git commit -m "test: lehe pildiredaktori täis-suite roheline"
```

---

## Deploy märkused (pärast merge'i)

- Backend Python muudatus → serveris: `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
- Frontend → `npm run build` lokaalselt + `rsync -avz dist/ vutt:~/VUTT/dist/`.
- Meilisearch reseed EI ole vajalik (transform ei muuda indekseeritavat; split sünkib endiselt jooksvalt).
- Kontrolli serveris, et `._originals/` ja `._trash/` tekivad `data/`-juures ja EI ilmu lehtede nimekirja.
