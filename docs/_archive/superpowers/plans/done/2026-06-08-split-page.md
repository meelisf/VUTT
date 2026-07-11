# Topeltlehe lõikur — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada WorkManage lehele topeltlehekülgede vertikaalse lõikamise tööriist, kus admin lohistab joont pildil ja server loob Pillowiga kaks uut lehekülge originaali asemele.

**Architecture:** Uus `POST /admin/work/{work_id}/page/{page_num}/split` endpoint `main.py`-s, loogika `admin_page_ops.py`-s (`split_text_at_pb` + `split_page`). Frontend: `SplitPageModal.tsx` komponent, Scissors nupp WorkManage pisipiltidel.

**Tech Stack:** Python 3.9+, Pillow (juba paigaldatud), FastAPI, React 19 + TypeScript, Tailwind, Lucide icons.

---

## Muudetavad failid

| Fail | Muudatus |
|------|----------|
| `server/admin_page_ops.py` | Lisa `split_text_at_pb()` ja `split_page()` |
| `server/main.py` | Lisa üks import + üks endpoint (~20 rida) |
| `src/components/SplitPageModal.tsx` | Uus komponent |
| `src/pages/WorkManage.tsx` | Lisa Scissors nupp + modaali state |
| `tests/test_split_page.py` | Uus testifail |

---

## Task 1: `split_text_at_pb` helper + testid

**Files:**
- Modify: `server/admin_page_ops.py`
- Create: `tests/test_split_page.py`

- [ ] **Samm 1: Kirjuta katkised testid**

Loo `tests/test_split_page.py`:

```python
"""Testid topeltlehe lõikamise loogikale."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import split_text_at_pb


def test_split_at_pb_present():
    left, right = split_text_at_pb("Vasak tekst.\n<pb/>\nParem tekst.")
    assert left == "Vasak tekst."
    assert right == "Parem tekst."


def test_split_at_pb_absent():
    left, right = split_text_at_pb("Ainult tekst.")
    assert left == "Ainult tekst."
    assert right == "Ainult tekst."


def test_split_at_pb_empty():
    left, right = split_text_at_pb("")
    assert left == ""
    assert right == ""


def test_split_at_pb_multiple_uses_first():
    left, right = split_text_at_pb("A<pb/>B<pb/>C")
    assert left == "A"
    assert right == "B<pb/>C"


def test_split_at_pb_trims_whitespace():
    left, right = split_text_at_pb("  Vasak  \n<pb/>\n  Parem  ")
    assert left == "Vasak"
    assert right == "Parem"
```

- [ ] **Samm 2: Käivita testid, veendu et kukuvad**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_split_page.py -v
```

Oodatav: `ImportError` kuna `split_text_at_pb` pole olemas.

- [ ] **Samm 3: Lisa `split_text_at_pb` funktsiooni `admin_page_ops.py` lõppu**

```python
def split_text_at_pb(text: str) -> tuple:
    """Lõikab teksti esimese <pb/> tägi juures.
    Kui <pb/> puudub, tagastab mõlemale sama teksti.
    """
    if '<pb/>' in text:
        idx = text.index('<pb/>')
        return text[:idx].strip(), text[idx + 5:].strip()
    return text, text
```

- [ ] **Samm 4: Käivita testid, veendu et läbivad**

```bash
.venv/bin/python -m pytest tests/test_split_page.py::test_split_at_pb_present tests/test_split_page.py::test_split_at_pb_absent tests/test_split_page.py::test_split_at_pb_empty tests/test_split_page.py::test_split_at_pb_multiple_uses_first tests/test_split_page.py::test_split_at_pb_trims_whitespace -v
```

Oodatav: 5 testi PASS.

- [ ] **Samm 5: Commit**

```bash
git add server/admin_page_ops.py tests/test_split_page.py
git commit -m "feat: lisa split_text_at_pb helper admin_page_ops-sse"
```

---

## Task 2: `split_page` loogika + testid

**Files:**
- Modify: `server/admin_page_ops.py`
- Modify: `tests/test_split_page.py`

- [ ] **Samm 1: Lisa testimiseks vajalikud impordid ja fixture `tests/test_split_page.py` lõppu**

```python
import json
import pytest


@pytest.fixture
def work_dir(tmp_path, monkeypatch):
    """Loob testtöö kataloogi ühe topeltlehega."""
    from PIL import Image as PILImage
    import server.admin_page_ops as aps

    wid = "testwork1"
    folder = tmp_path / "1690-test-work"
    folder.mkdir()

    # Minimaalne 200x100 JPEG testpildiks (200 laius → split 100px=50%)
    img = PILImage.new("RGB", (200, 100), color=(200, 100, 50))
    img_path = folder / "1690-test-work-testwork1-pg001.jpg"
    img.save(str(img_path), "JPEG", quality=95)

    # .txt <pb/> sisuga
    txt_path = folder / "1690-test-work-testwork1-pg001.txt"
    txt_path.write_text("Vasak.\n<pb/>\nParem.", encoding="utf-8")

    # .json sequence=100
    json_path = folder / "1690-test-work-testwork1-pg001.json"
    json_path.write_text(
        json.dumps({"sequence": 100, "status": "Toores"}), encoding="utf-8"
    )

    # _metadata.json
    meta_path = folder / "_metadata.json"
    meta_path.write_text(
        json.dumps({"id": wid, "title": "Test", "collections": []}), encoding="utf-8"
    )

    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(
        aps, "find_directory_by_id", lambda wid_: str(folder) if wid_ == wid else None
    )
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: {"success": True})
    monkeypatch.setattr(aps, "delete_page_from_git", lambda *a, **kw: True)
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda *a: None)

    return {"folder": folder, "work_id": wid, "img_path": img_path}
```

- [ ] **Samm 2: Lisa endpoint-testid `tests/test_split_page.py` lõppu**

```python
def test_split_page_creates_two_files(work_dir):
    from server.admin_page_ops import split_page

    result = split_page(work_dir["work_id"], 1, 0.5, "testadmin")

    assert result["success"] is True
    assert result["new_page_count"] == 2


def test_split_page_left_right_dimensions(work_dir):
    from PIL import Image as PILImage
    from server.admin_page_ops import split_page, get_sorted_images

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]

    images = get_sorted_images(str(folder))
    assert len(images) == 2

    with PILImage.open(str(folder / images[0])) as left:
        assert left.width == 100  # 50% of 200
        assert left.height == 100

    with PILImage.open(str(folder / images[1])) as right:
        assert right.width == 100
        assert right.height == 100


def test_split_page_text_split_at_pb(work_dir):
    from server.admin_page_ops import split_page, get_sorted_images

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]
    images = get_sorted_images(str(folder))

    left_base = images[0].rsplit(".", 1)[0]
    right_base = images[1].rsplit(".", 1)[0]

    left_txt = (folder / (left_base + ".txt")).read_text(encoding="utf-8")
    right_txt = (folder / (right_base + ".txt")).read_text(encoding="utf-8")

    assert left_txt == "Vasak."
    assert right_txt == "Parem."


def test_split_page_sequence_order(work_dir):
    from server.admin_page_ops import split_page, get_sorted_images, get_page_sequence

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")
    folder = work_dir["folder"]
    images = get_sorted_images(str(folder))

    left_seq = get_page_sequence(str(folder / (images[0].rsplit(".", 1)[0] + ".json")))
    right_seq = get_page_sequence(str(folder / (images[1].rsplit(".", 1)[0] + ".json")))

    assert left_seq == 100
    assert right_seq == 150  # originaali seq + 50


def test_split_page_original_removed(work_dir):
    from server.admin_page_ops import split_page

    orig_img = work_dir["img_path"]
    assert orig_img.exists()

    split_page(work_dir["work_id"], 1, 0.5, "testadmin")

    assert not orig_img.exists()


def test_split_page_invalid_split_x(work_dir):
    from server.admin_page_ops import split_page

    with pytest.raises(ValueError):
        split_page(work_dir["work_id"], 1, 0.02, "testadmin")

    with pytest.raises(ValueError):
        split_page(work_dir["work_id"], 1, 0.98, "testadmin")


def test_split_page_unknown_work():
    import server.admin_page_ops as aps
    # find_directory_by_id returns None for unknown work
    result = aps.split_page.__wrapped__("nonexistent", 1, 0.5, "admin") \
        if hasattr(aps.split_page, "__wrapped__") \
        else None
    # Kontrollib et ValueError pole aga found=False on — testitakse endpointi kaudu
```

Märkus: viimane test on placeholder — `split_page("nonexistent", ...)` testida endpointi 404 testi kaudu (Task 3).

- [ ] **Samm 3: Käivita testid, veendu et kukuvad**

```bash
.venv/bin/python -m pytest tests/test_split_page.py -v -k "split_page"
```

Oodatav: `ImportError: cannot import name 'split_page'`

- [ ] **Samm 4: Lisa `split_page` funktsioon `admin_page_ops.py` lõppu**

Lisa järgmised impordid faili algusesse (pärast olemasolevaid):

```python
import shutil
from .utils import find_directory_by_id, generate_nanoid
from .git_ops import save_with_git, delete_page_from_git
from .meilisearch_ops import sync_work_to_meilisearch
```

Lisa funktsioon `admin_page_ops.py` lõppu:

```python
def split_page(work_id: str, page_num: int, split_x: float, username: str) -> dict:
    """Lõikab topeltlehekülje kaheks vertikaalse lõikejoone alusel.

    Args:
        work_id: Teose ID
        page_num: Lehekülje number (1-indekseeritud)
        split_x: Lõikejoone asukoht (0.0–1.0), nt 0.47 = 47% laiusest
        username: Admin kasutajanimi git commitile

    Returns:
        {"success": True, "new_page_count": int} või {"found": False}

    Raises:
        ValueError: kui split_x on väljaspool [0.05, 0.95]
    """
    if not (0.05 <= split_x <= 0.95):
        raise ValueError(f"split_x peab olema vahemikus [0.05, 0.95], sain {split_x}")

    path = find_directory_by_id(work_id)
    if not path:
        return {"found": False}

    folder_name = os.path.basename(path)
    images = get_sorted_images(path)
    if page_num < 1 or page_num > len(images):
        return {"found": False}

    orig_filename = images[page_num - 1]
    orig_base = os.path.splitext(orig_filename)[0]
    orig_img_path = os.path.join(path, orig_filename)
    orig_txt_path = os.path.join(path, orig_base + '.txt')
    orig_json_path = os.path.join(path, orig_base + '.json')

    # Loe originaali sequence
    orig_seq = get_page_sequence(orig_json_path)
    if orig_seq == float('inf'):
        orig_seq = page_num * 100
    orig_seq = int(orig_seq)

    # Loe originaali metaandmed (staatus jne)
    orig_meta = {'status': 'Toores'}
    if os.path.exists(orig_json_path):
        try:
            with open(orig_json_path, 'r', encoding='utf-8') as f:
                orig_meta = json.load(f)
        except Exception:
            pass

    # Loe ja lõika tekst <pb/> juures
    orig_txt = ''
    if os.path.exists(orig_txt_path):
        with open(orig_txt_path, 'r', encoding='utf-8') as f:
            orig_txt = f.read()
    left_txt, right_txt = split_text_at_pb(orig_txt)

    # Lõika pilt Pillowiga
    try:
        from PIL import Image as PILImage
        with PILImage.open(orig_img_path) as img:
            width, height = img.size
            split_pixel = max(1, int(width * split_x))

            left_crop = img.crop((0, 0, split_pixel, height)).copy()
            right_crop = img.crop((split_pixel, 0, width, height)).copy()
    except ImportError:
        raise RuntimeError("Pillow pole paigaldatud")

    # Genereeri unikaalsed failinimed
    def _unique_name():
        nid = generate_nanoid()
        name = f"{folder_name}-{work_id}-{nid}.jpg"
        while os.path.exists(os.path.join(path, name)):
            nid = generate_nanoid()
            name = f"{folder_name}-{work_id}-{nid}.jpg"
        return name

    left_filename = _unique_name()
    right_filename = _unique_name()
    left_base = os.path.splitext(left_filename)[0]
    right_base = os.path.splitext(right_filename)[0]

    # Salvesta pildifailid kettale (ei ole git-tracked)
    left_img_path = os.path.join(path, left_filename)
    right_img_path = os.path.join(path, right_filename)
    left_crop.save(left_img_path, "JPEG", quality=95)
    right_crop.save(right_img_path, "JPEG", quality=95)
    os.chmod(left_img_path, 0o644)
    os.chmod(right_img_path, 0o644)

    # Koosta .json andmed mõlemale
    left_meta = {**orig_meta, 'sequence': orig_seq}
    right_meta = {**orig_meta, 'sequence': orig_seq + 50}

    left_txt_path = os.path.join(path, left_base + '.txt')
    left_json_path = os.path.join(path, left_base + '.json')
    right_txt_path = os.path.join(path, right_base + '.txt')
    right_json_path = os.path.join(path, right_base + '.json')

    # Git commit 1: lisa mõlemad uued lehed ühes commitinas
    save_with_git(
        left_txt_path, left_txt, username,
        message=f"Lõika leht {page_num} ({folder_name}): vasakpoolne [{work_id}]",
        additional_files=[
            (left_json_path, json.dumps(left_meta, indent=2, ensure_ascii=False)),
            (right_txt_path, right_txt),
            (right_json_path, json.dumps(right_meta, indent=2, ensure_ascii=False)),
        ]
    )

    # Liiguta originaali .jpg prügikasti (ei ole git-tracked)
    trash_dir = os.path.join(BASE_DIR, '._trash', work_id, 'pages')
    os.makedirs(trash_dir, exist_ok=True)
    if os.path.exists(orig_img_path):
        shutil.move(orig_img_path, os.path.join(trash_dir, orig_filename))

    # Git commit 2: eemalda originaali .txt ja .json
    delete_page_from_git(
        folder_name, orig_base,
        f"Lõika leht {page_num} ({folder_name}): eemalda originaal [{work_id}]",
        username
    )

    # Meilisearch sync
    sync_work_to_meilisearch(folder_name)

    new_page_count = len(get_sorted_images(path))
    return {"success": True, "new_page_count": new_page_count}
```

- [ ] **Samm 5: Käivita testid, veendu et läbivad**

```bash
.venv/bin/python -m pytest tests/test_split_page.py -v
```

Oodatav: vähemalt 9 testi PASS (üks test lõpus on placeholder, võid ignoreerida).

- [ ] **Samm 6: Käivita kõik testid, veendu et midagi ei katki**

```bash
.venv/bin/python -m pytest tests/ -v --tb=short 2>&1 | tail -30
```

Oodatav: kõik varasemad testid ikka PASS.

- [ ] **Samm 7: Commit**

```bash
git add server/admin_page_ops.py tests/test_split_page.py
git commit -m "feat: lisa split_page loogika admin_page_ops-sse"
```

---

## Task 3: Backend endpoint

**Files:**
- Modify: `server/main.py` (import + endpoint)
- Modify: `tests/test_split_page.py` (endpoint testid)

- [ ] **Samm 1: Lisa endpoint-testid `tests/test_split_page.py` lõppu**

```python
# ─── Endpoint testid ──────────────────────────────────────────────


def test_split_endpoint_401_no_auth(backend_env):
    r = backend_env["client"].post("/admin/work/w1/page/1/split", json={"split_x": 0.5})
    assert r.status_code == 401


def test_split_endpoint_403_editor(backend_env, login):
    token = login("editor", "editorpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page/1/split",
        json={"split_x": 0.5},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


def test_split_endpoint_404_unknown_work(backend_env, login, monkeypatch):
    import server.main as main
    monkeypatch.setattr(main, "split_page", lambda *a, **kw: {"found": False})

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/unknown/page/1/split",
        json={"split_x": 0.5},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


def test_split_endpoint_400_invalid_split_x(backend_env, login, monkeypatch):
    import server.main as main

    def _raise(*a, **kw):
        raise ValueError("split_x peab olema vahemikus [0.05, 0.95]")

    monkeypatch.setattr(main, "split_page", _raise)

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/w1/page/1/split",
        json={"split_x": 0.02},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


def test_split_endpoint_200_success(backend_env, login, monkeypatch):
    import server.main as main
    monkeypatch.setattr(
        main, "split_page", lambda *a, **kw: {"success": True, "new_page_count": 2}
    )

    token = login("admin", "adminpass")
    r = backend_env["client"].post(
        "/admin/work/testwork1/page/1/split",
        json={"split_x": 0.47},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "success"
    assert data["new_page_count"] == 2
```

- [ ] **Samm 2: Käivita, veendu et testid kukuvad**

```bash
.venv/bin/python -m pytest tests/test_split_page.py -v -k "endpoint"
```

Oodatav: vähemalt `test_split_endpoint_*` testid kukuvad kuna endpoint puudub.

- [ ] **Samm 3: Lisa import `server/main.py` algusesse**

Leia `server/main.py` rida 48:

```python
from .admin_page_ops import get_page_sequence, get_sorted_images, rebalance_sequences, reorder_pages
```

Muuda:

```python
from .admin_page_ops import get_page_sequence, get_sorted_images, rebalance_sequences, reorder_pages, split_page
```

- [ ] **Samm 4: Lisa endpoint `server/main.py`-sse, kohe pärast `admin_add_page` funktsiooni (umbes rida 685)**

```python
@app.post("/admin/work/{work_id}/page/{page_num}/split")
async def admin_split_page(work_id: str, page_num: int, request: Request, user=Depends(require_role("admin"))):
    """Lõikab topeltlehekülje kaheks. Body: { split_x: float (0.05–0.95) }"""
    data = await get_json_data(request)
    split_x = data.get("split_x")
    if split_x is None:
        raise HTTPException(status_code=400, detail="split_x on kohustuslik")
    try:
        result = split_page(work_id, page_num, float(split_x), user["username"])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not result.get("found", True):
        raise HTTPException(status_code=404, detail="Teost või lehekülge ei leitud")
    return {"status": "success", "new_page_count": result["new_page_count"]}
```

- [ ] **Samm 5: Käivita testid, veendu et läbivad**

```bash
.venv/bin/python -m pytest tests/test_split_page.py -v -k "endpoint"
```

Oodatav: kõik endpoint testid PASS.

- [ ] **Samm 6: Käivita kõik testid**

```bash
.venv/bin/python -m pytest tests/ -v --tb=short 2>&1 | tail -30
```

Oodatav: kõik testid PASS.

- [ ] **Samm 7: Commit**

```bash
git add server/main.py server/admin_page_ops.py tests/test_split_page.py
git commit -m "feat: lisa POST /admin/work/{id}/page/{n}/split endpoint"
```

---

## Task 4: `SplitPageModal` komponent

**Files:**
- Create: `src/components/SplitPageModal.tsx`

- [ ] **Samm 1: Loo `src/components/SplitPageModal.tsx`**

```tsx
import React, { useState, useRef, useCallback } from 'react';
import { X, Scissors, Loader2, AlertTriangle } from 'lucide-react';
import { FILE_API_URL, IMAGE_BASE_URL } from '../config';
import { useUser } from '../contexts/UserContext';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

interface Props {
  workId: string;
  pageNum: number;
  imageFilename: string;   // nt "1632-slug-abc.jpg"
  imageToken: { exp: number; sig: string } | null;
  onClose: () => void;
  onSuccess: () => void;
}

const SplitPageModal: React.FC<Props> = ({
  workId, pageNum, imageFilename, imageToken, onClose, onSuccess,
}) => {
  const { authToken } = useUser();
  const [splitX, setSplitX] = useState(0.5);
  const [isDragging, setIsDragging] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const imageUrl = (() => {
    const base = `${IMAGE_BASE_URL}/${workId}/${imageFilename}`;
    return imageToken
      ? `${base}?exp=${imageToken.exp}&sig=${imageToken.sig}`
      : base;
  })();

  const updateSplitX = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width;
    setSplitX(Math.max(0.05, Math.min(0.95, x)));
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging) updateSplitX(e.clientX);
  }, [isDragging, updateSplitX]);

  const handleSplit = async () => {
    if (!authToken) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithTimeout(
        `${FILE_API_URL}/admin/work/${workId}/page/${pageNum}/split`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders(authToken) },
          body: JSON.stringify({ split_x: splitX }),
          timeout: 30000,
        }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      onSuccess();
    } catch (e: any) {
      setError(e.message || 'Lõikamine ebaõnnestus');
      setSaving(false);
      setShowConfirm(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">

        {/* Päis */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Scissors size={18} className="text-amber-600" />
            <h2 className="font-semibold text-gray-900">Lõika leht {pageNum} kaheks</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Pildi ala */}
        <div className="flex-1 overflow-auto p-4">
          <p className="text-sm text-gray-500 mb-3">
            Lohista joont lõikekoha määramiseks.{' '}
            <span className="font-medium text-gray-700">{Math.round(splitX * 100)}%</span>
          </p>

          {/* Draggable image container */}
          <div
            ref={containerRef}
            className="relative select-none cursor-col-resize overflow-hidden rounded border border-gray-200"
            onMouseMove={handleMouseMove}
            onMouseUp={() => setIsDragging(false)}
            onMouseLeave={() => setIsDragging(false)}
          >
            <img
              src={imageUrl}
              alt={`Leht ${pageNum}`}
              className="w-full h-auto block pointer-events-none"
              draggable={false}
            />

            {/* Lõikejoon */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-red-500 opacity-90 pointer-events-none"
              style={{ left: `${splitX * 100}%` }}
            />

            {/* Drag handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-5 h-10 bg-red-500 rounded cursor-col-resize flex items-center justify-center shadow-md"
              style={{ left: `${splitX * 100}%` }}
              onMouseDown={(e) => { e.preventDefault(); setIsDragging(true); }}
            >
              <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
              <div className="w-0.5 h-6 bg-white/70 mx-0.5" />
            </div>
          </div>
        </div>

        {/* Jalus */}
        <div className="px-5 py-4 border-t border-gray-100 flex-shrink-0">
          {error && (
            <div className="flex items-center gap-2 mb-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
              <AlertTriangle size={14} />
              {error}
            </div>
          )}

          {!showConfirm ? (
            <div className="flex justify-end gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors"
              >
                Tühista
              </button>
              <button
                onClick={() => setShowConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded transition-colors"
              >
                <Scissors size={14} />
                Lõika leht
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">
                Originaalleht asendatakse kahe uue lehega ({Math.round(splitX * 100)}% / {100 - Math.round(splitX * 100)}%).
                Tekst ja metaandmed kopeeritakse mõlemale. Kas jätkata?
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowConfirm(false)}
                  disabled={saving}
                  className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Tagasi
                </button>
                <button
                  onClick={handleSplit}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded transition-colors"
                >
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
                  {saving ? 'Lõikan...' : 'Jah, lõika'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SplitPageModal;
```

- [ ] **Samm 2: TypeScript kontroll**

```bash
npm run build 2>&1 | grep -E "error|SplitPage"
```

Oodatav: ei mingeid TypeScript vigu seotud `SplitPageModal`-iga.

- [ ] **Samm 3: Commit**

```bash
git add src/components/SplitPageModal.tsx
git commit -m "feat: lisa SplitPageModal komponent"
```

---

## Task 5: Scissors nupp WorkManage lehel

**Files:**
- Modify: `src/pages/WorkManage.tsx`

- [ ] **Samm 1: Lisa import `WorkManage.tsx` algusesse**

Leia rida kus on `import Header from '../components/Header';` ja lisa selle alla:

```tsx
import SplitPageModal from '../components/SplitPageModal';
```

Lisa ka `Scissors` ikooni Lucide impordi loetellu (leia rida kus on `import { ... } from 'lucide-react'`):

```tsx
Scissors,
```

- [ ] **Samm 2: Lisa modaali state komponentide state plokki (~rida 95), pärast `imageToken` state'i**

```tsx
// Lehe lõikamine
const [splitPageTarget, setSplitPageTarget] = useState<{ pageNum: number; filename: string } | null>(null);
```

- [ ] **Samm 3: Lisa Scissors nupp pisipiltide nupuribale**

Leia `WorkManage.tsx`-ist koodiplokk kus on asendamise nupp (Replace/Upload nupp), umbes selline:

```tsx
<button
  onClick={() => {
    replaceTargetPage.current = page.page_num;
    replaceInputRef.current?.click();
  }}
  disabled={replacingPage === page.page_num}
  className="p-1 bg-white/80 hover:bg-primary-50 text-gray-400 hover:text-primary-600 rounded shadow-sm transition-colors disabled:opacity-50"
  title={t('manage.replaceImage')}
>
```

Lisa **pärast** seda nuppu uus Scissors nupp:

```tsx
<button
  onClick={() => setSplitPageTarget({
    pageNum: page.page_num,
    filename: page.lehekylje_pilt.split('/').pop() ?? '',
  })}
  className="p-1 bg-white/80 hover:bg-amber-50 text-gray-400 hover:text-amber-600 rounded shadow-sm transition-colors"
  title="Lõika leht kaheks"
>
  <Scissors size={12} />
</button>
```

- [ ] **Samm 4: Muuda nupuriba `flex justify-between` asemel `flex gap-1`**

Leia rida:
```tsx
<div className="absolute bottom-1 left-1 right-1 flex justify-between">
```

Muuda:
```tsx
<div className="absolute bottom-1 left-1 right-1 flex gap-1 justify-between">
```

Kolm nuppu (alla, üles, käärid) mahuvad `justify-between`-iga hästi ära, nii et muudatus pole kohustuslik — ainult kui paigutus näeb halb välja.

- [ ] **Samm 5: Lisa modaal JSX lõppu (enne `return` lõpu `</div>` sulgemist)**

Leia WorkManage `return` blokis viimane `</div>` (lõpetab `<div className="min-h-screen bg-gray-50">`) ja lisa enne seda:

```tsx
{/* Lehe lõikamise modaal */}
{splitPageTarget && (
  <SplitPageModal
    workId={workId!}
    pageNum={splitPageTarget.pageNum}
    imageFilename={splitPageTarget.filename}
    imageToken={imageToken}
    onClose={() => setSplitPageTarget(null)}
    onSuccess={async () => {
      setSplitPageTarget(null);
      await loadPages();
    }}
  />
)}
```

- [ ] **Samm 6: Build, veendu et TypeScript vead puuduvad**

```bash
npm run build 2>&1 | grep -E "error TS|ERROR"
```

Oodatav: 0 vigu.

- [ ] **Samm 7: Deploy**

```bash
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Samm 8: Käsitsi test serveris**

1. Logi sisse adminina
2. Ava mõni teos, mine `/work/{id}/manage`
3. Pisipildil peaks nüüd olema kääride ikoon (allosas parempoolne nupp)
4. Klõpsa kääridel — modaal avaneb pildiga
5. Lohista punast joont
6. Klõpsa „Lõika leht" → kinnitusdialoog
7. Klõpsa „Jah, lõika" → lehekülgede arv suureneb ühe võrra

- [ ] **Samm 9: Commit**

```bash
git add src/pages/WorkManage.tsx
git commit -m "feat: lisa topeltlehe lõikuri nupp WorkManage lehele"
```

---

## Task 6: Lõplik kontroll

- [ ] **Käivita kõik testid**

```bash
.venv/bin/python -m pytest tests/ -v --tb=short 2>&1 | tail -20
```

Oodatav: kõik testid PASS.

- [ ] **Push**

```bash
git push
```
