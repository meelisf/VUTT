# Isikute lehe kollektsioonifilter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/persons` (PersonsPage) näitab valitud kollektsiooni puhul ainult neid isikuid, kes esinevad mõnes selle kollektsiooni (või alamkollektsiooni) teoses autori, kirjastaja, teose- või lehekülje-märksõnana; nii nimekiri kui facet-loendurid arvestavad valikut.

**Architecture:** Uus püsiv read-model `work_collections_index.json` (`work_id → [teose enda kollektsioonid]`), ehitatud `rebuild_indices()`-s ja uuendatud tingimusteta igal metaandmete salvestusel. Päringuajal arvutatakse valitud kollektsiooni järglased cache'itud konfist ja ristutakse `person_to_works.json`-iga, andes isikute id-de hulga, mida edastatakse olemasolevale `ids` filtrile `list_persons` / `get_person_facets` / `get_person_map_markers`-is.

**Tech Stack:** Python 3.9-ühilduv backend (FastAPI), pytest; React 19 + TypeScript frontend.

**Testikäsk (kohalik):** `.venv/bin/python -m pytest tests/test_work_collections.py -v`

---

### Task 1: Config-konstant + indeksi loader ja uuendaja

**Files:**
- Modify: `server/config.py:96` (lisa konstant `WORKS_CREATORS_INDEX_FILE` järele)
- Modify: `server/prosopography/ops.py:19-25` (import), `:42` (lock), `:99` (loaderi kõrvale)
- Test: `tests/test_work_collections.py` (uus)

- [ ] **Step 1: Write the failing test**

Loo `tests/test_work_collections.py`:

```python
"""Testid: work_collections_index.json haldus ja kollektsioonipõhine isikute filter."""
import importlib
import json
import sys
import unittest.mock as mock
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _ops(tmp_path):
    """Laeb ops.py ja patchib indeksifailide teed tmp_path alla."""
    ops = importlib.import_module("server.prosopography.ops")
    return ops


def test_update_work_collections_writes_entry(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)):
        ops.update_work_collections("w1", ["academia-gustaviana"])
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w1": ["academia-gustaviana"]}


def test_update_work_collections_empty_removes_entry(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    wc_file.write_text(json.dumps({"w1": ["c1"], "w2": ["c2"]}), encoding="utf-8")
    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)):
        ops.update_work_collections("w1", [])
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w2": ["c2"]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'WORK_COLLECTIONS_INDEX_FILE'` / `update_work_collections`.

- [ ] **Step 3: Add the config constant**

`server/config.py`, kohe `WORKS_CREATORS_INDEX_FILE` rea järele (rida 96):

```python
WORK_COLLECTIONS_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "work_collections_index.json")
```

- [ ] **Step 4: Import constant, add lock + loader + updater in ops.py**

`server/prosopography/ops.py` — laienda config-importi (read 19-25):

```python
from ..config import (
    PROSOPOGRAPHY_DIR,
    PROSOPOGRAPHY_IMAGES_DIR,
    PROSOPOGRAPHY_INDEX_FILE,
    PERSON_TO_WORKS_FILE,
    PERSON_ALIASES_FILE,
    WORK_COLLECTIONS_INDEX_FILE,
)
```

Lisa lukk olemasolevate kõrvale (rida 42, `_aliases_lock` järele):

```python
_work_collections_lock = threading.Lock()
```

Lisa loader ja uuendaja `_load_person_to_works` järele (umbes rida 110):

```python
def _load_work_collections() -> dict:
    if os.path.exists(WORK_COLLECTIONS_INDEX_FILE):
        try:
            with open(WORK_COLLECTIONS_INDEX_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def update_work_collections(work_id: str, collections: list) -> None:
    """Uuendab work_collections_index.json üht kirjet teose salvestamisel.

    Salvestab teose ENDA kollektsioonid (mitte esivanematega laiendatud
    hierarhiat) — laiendamine toimub päringuajal cache'itud konfist.
    Peab jooksma TINGIMUSTETA igal metaandmete salvestusel (ka bulk-collection,
    kus call_ptw=False), sest just seal kollektsioonid muutuvad.
    """
    if not work_id:
        return
    with _work_collections_lock:
        data = _load_work_collections()
        if collections:
            data[work_id] = list(collections)
        else:
            data.pop(work_id, None)
        atomic_write_json(WORK_COLLECTIONS_INDEX_FILE, data)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py -v`
Expected: PASS (2 passed).

- [ ] **Step 6: Commit**

```bash
git add server/config.py server/prosopography/ops.py tests/test_work_collections.py
git commit -m "feat: work_collections_index loader + update_work_collections"
```

---

### Task 2: Ehita work_collections rebuild_indices()-s

**Files:**
- Modify: `server/prosopography/ops.py` `rebuild_indices()` (teoste läbikäik, umbes read 1371-1430)
- Test: `tests/test_work_collections.py`

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_work_collections.py`-sse:

```python
def test_rebuild_indices_builds_work_collections(tmp_path):
    ops = _ops(tmp_path)
    base_dir = tmp_path / "data"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    # Teos kahe kollektsiooniga
    work_dir = base_dir / "teos1"
    work_dir.mkdir(parents=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps({"id": "w1", "title": "T", "collections": ["c-child", "c-other"]}),
        encoding="utf-8",
    )
    wc_file = tmp_path / "work_collections_index.json"

    with mock.patch.object(ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir)), \
         mock.patch.object(ops, "BASE_DIR", str(base_dir)), \
         mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json")), \
         mock.patch.object(ops, "PROSOPOGRAPHY_INDEX_FILE", str(tmp_path / "idx.json")), \
         mock.patch.object(ops, "PERSON_ALIASES_FILE", str(tmp_path / "aliases.json")), \
         mock.patch.object(ops, "build_works_creators_index", lambda: None):
        ops.rebuild_indices()
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w1": ["c-child", "c-other"]}
```

> NB: `BASE_DIR` imporditakse `rebuild_indices` sees lokaalselt (`from ..config import BASE_DIR`). Et `mock.patch.object(ops, "BASE_DIR", ...)` mõjuks, lisa Step 3-s `BASE_DIR` mooduli tasandi impordina ops.py algusesse ja eemalda lokaalne import.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py::test_rebuild_indices_builds_work_collections -v`
Expected: FAIL — `wc_file` ei eksisteeri / `KeyError`.

- [ ] **Step 3: Move BASE_DIR import to module level + collect work_collections**

`server/prosopography/ops.py`: lisa config-importi (Task 1 plokk) `BASE_DIR`:

```python
from ..config import (
    PROSOPOGRAPHY_DIR,
    PROSOPOGRAPHY_IMAGES_DIR,
    PROSOPOGRAPHY_INDEX_FILE,
    PERSON_TO_WORKS_FILE,
    PERSON_ALIASES_FILE,
    WORK_COLLECTIONS_INDEX_FILE,
    BASE_DIR,
)
```

`rebuild_indices()`-s eemalda lokaalne rida `from ..config import BASE_DIR`.

`rebuild_indices()` teoste läbikäigus (`for entry in os.scandir(BASE_DIR):`), kogu kollektsioonid. Lisa enne tsüklit:

```python
    wc: dict[str, list] = {}
```

Tsükli sees, pärast `work_id = meta.get("id") or meta.get("work_id")` ja `if not work_id: continue`, lisa:

```python
            cols = meta.get("collections") or []
            if cols:
                wc[work_id] = list(cols)
```

Pärast `atomic_write_json(PERSON_TO_WORKS_FILE, ptw)` ploki (rida ~1430), lisa:

```python
    with _work_collections_lock:
        atomic_write_json(WORK_COLLECTIONS_INDEX_FILE, wc)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/ops.py tests/test_work_collections.py
git commit -m "feat: build work_collections_index in rebuild_indices"
```

---

### Task 3: `_collection_descendants` + `_persons_in_collection`

**Files:**
- Modify: `server/prosopography/ops.py` (lisa funktsioonid `_load_work_collections` järele)
- Test: `tests/test_work_collections.py`

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_work_collections.py`-sse:

```python
COLLECTIONS = {
    "parent": {"name": {"et": "Vanem"}},
    "c-child": {"name": {"et": "Laps"}, "parent": "parent"},
    "c-other": {"name": {"et": "Muu"}},
}


def test_persons_in_collection_roles_and_inheritance(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    ptw_file = tmp_path / "ptw.json"
    # w1 kuulub alamkollektsiooni 'c-child'; w2 kuulub 'c-other'
    wc_file.write_text(json.dumps({"w1": ["c-child"], "w2": ["c-other"]}), encoding="utf-8")
    ptw_file.write_text(json.dumps({
        "vutt:Pauthor":    [{"work_id": "w1", "role": "creator"}],
        "vutt:Pmention":   [{"work_id": "w1", "role": "mentioned"}],
        "vutt:Ppublisher": [{"work_id": "w1", "role": "publisher"}],
        "vutt:Pother":     [{"work_id": "w2", "role": "creator"}],
        "vutt:Pnowork":    [],
    }), encoding="utf-8")

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(ptw_file)), \
         mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS):
        # Valitud vanemkollektsioon → hõlmab alamkollektsiooni w1 isikuid
        result = ops._persons_in_collection("parent")

    assert result == {"vutt:Pauthor", "vutt:Pmention", "vutt:Ppublisher"}
    assert "vutt:Pother" not in result   # teine kollektsioon
    assert "vutt:Pnowork" not in result  # teosteta isik
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py::test_persons_in_collection_roles_and_inheritance -v`
Expected: FAIL — `AttributeError: ... has no attribute '_persons_in_collection'`.

- [ ] **Step 3: Implement the functions**

`server/prosopography/ops.py`, lisa `_load_work_collections` järele:

```python
def _collection_descendants(collection_id: str, collections: dict) -> set:
    """Tagastab {collection_id} ∪ kõik järglased (rekursiivselt) konfi põhjal."""
    target = {collection_id}
    changed = True
    while changed:
        changed = False
        for cid, col in (collections or {}).items():
            if isinstance(col, dict) and col.get("parent") in target and cid not in target:
                target.add(cid)
                changed = True
    return target


def _persons_in_collection(collection_id: str) -> set:
    """Isikute id-d, kes esinevad mõnes selle kollektsiooni (või
    alamkollektsiooni) teoses ükskõik mis rollis (creator/publisher/
    subject/mentioned)."""
    from ..cache import get_cached_collections
    collections = get_cached_collections() or {}
    target = _collection_descendants(collection_id, collections)
    wc = _load_work_collections()
    ptw = _load_person_to_works()
    return {
        pid for pid, entries in ptw.items()
        if any(target & set(wc.get(e.get("work_id"), ())) for e in entries)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/ops.py tests/test_work_collections.py
git commit -m "feat: _persons_in_collection collection->person resolver"
```

---

### Task 4: `collection` parameeter list_persons / get_person_facets / get_person_map_markers

**Files:**
- Modify: `server/prosopography/ops.py` `list_persons` (read 608-661), `get_person_facets` (read 924-944), `get_person_map_markers` (read 767-803)
- Test: `tests/test_work_collections.py`

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_work_collections.py`-sse:

```python
def test_list_persons_collection_filters(tmp_path):
    ops = _ops(tmp_path)
    wc_file = tmp_path / "work_collections_index.json"
    ptw_file = tmp_path / "ptw.json"
    idx_file = tmp_path / "idx.json"
    wc_file.write_text(json.dumps({"w1": ["c-child"], "w2": ["c-other"]}), encoding="utf-8")
    ptw_file.write_text(json.dumps({
        "vutt:Pin":  [{"work_id": "w1", "role": "creator"}],
        "vutt:Pout": [{"work_id": "w2", "role": "creator"}],
    }), encoding="utf-8")
    idx_file.write_text(json.dumps({"entries": [
        {"id": "vutt:Pin", "label": "Sees", "sort_name": "sees", "record_status": "published"},
        {"id": "vutt:Pout", "label": "Väljas", "sort_name": "valjas", "record_status": "published"},
    ]}), encoding="utf-8")

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(ops, "PERSON_TO_WORKS_FILE", str(ptw_file)), \
         mock.patch.object(ops, "PROSOPOGRAPHY_INDEX_FILE", str(idx_file)), \
         mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS):
        res = ops.list_persons(collection="parent")

    ids = {e["id"] for e in res["results"]}
    assert ids == {"vutt:Pin"}
    assert res["total"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py::test_list_persons_collection_filters -v`
Expected: FAIL — `TypeError: list_persons() got an unexpected keyword argument 'collection'`.

- [ ] **Step 3: Thread collection through the three functions**

`list_persons` (read 608): lisa signatuuri `ids` järele:

```python
    ids: Optional[list] = None,
    collection: Optional[str] = None,
    limit: int = 48,
```

`list_persons` keha alguses, enne `_filter_index_entries` kutset:

```python
    if collection:
        collection_ids = _persons_in_collection(collection)
        if ids is not None:
            ids = [i for i in ids if i in collection_ids]
        else:
            ids = list(collection_ids)
```

`get_person_facets` (read 924): lisa signatuuri `ids` järele `collection: Optional[str] = None,` ja edasta `list_persons`-ile:

```python
def get_person_facets(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    ids: Optional[list] = None,
    collection: Optional[str] = None,
) -> dict:
    ...
    filtered = list_persons(
        q=q,
        gender=gender,
        ids=ids,
        collection=collection,
        limit=10**9,
        offset=0,
    )["results"]
```

`get_person_map_markers` (read 767): lisa signatuuri `related_to` järele `collection: Optional[str] = None,` ja keha alguses (pärast `related_to` ploki, enne `_filter_index_entries`):

```python
    if collection:
        collection_ids = _persons_in_collection(collection)
        if ids is not None:
            ids = [i for i in ids if i in collection_ids]
        else:
            ids = list(collection_ids)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/ops.py tests/test_work_collections.py
git commit -m "feat: collection param in list_persons/facets/map_markers"
```

---

### Task 5: Kutsu update_work_collections salvestus- ja kustutusteedel

**Files:**
- Modify: `server/metadata_ops.py:14` (import), `:88-100` ja `:175-185` (save_work_metadata kaks varianti)
- Modify: `server/upload_ops.py:1085-1090` (import_as_work)
- Modify: `server/main.py:384` (delete endpoint)
- Test: `tests/test_work_collections.py`

- [ ] **Step 1: Write the failing test**

Lisa `tests/test_work_collections.py`-sse (kontrollib, et bulk-collection tee (`call_ptw=False`) uuendab siiski indeksit):

```python
def test_save_work_metadata_updates_collections_even_when_call_ptw_false(tmp_path):
    metadata_ops = importlib.import_module("server.metadata_ops")
    ops = importlib.import_module("server.prosopography.ops")
    work_dir = tmp_path / "teos1"
    work_dir.mkdir()
    meta_path = work_dir / "_metadata.json"
    meta_path.write_text(json.dumps({"id": "w1", "title": "T", "collections": ["c-old"]}), encoding="utf-8")
    wc_file = tmp_path / "work_collections_index.json"

    with mock.patch.object(ops, "WORK_COLLECTIONS_INDEX_FILE", str(wc_file)), \
         mock.patch.object(metadata_ops, "save_with_git", lambda *a, **k: None), \
         mock.patch.object(metadata_ops, "sync_work_to_meilisearch", lambda *a, **k: None):
        metadata_ops.save_work_metadata(
            str(meta_path),
            {"collections": ["c-new"]},
            username="tester",
            git_message="bulk",
            call_ptw=False,
            sync_meili=False,
        )
        data = json.loads(wc_file.read_text(encoding="utf-8"))
    assert data == {"w1": ["c-new"]}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py::test_save_work_metadata_updates_collections_even_when_call_ptw_false -v`
Expected: FAIL — `wc_file` ei eksisteeri (FileNotFoundError) / indeks tühi.

- [ ] **Step 3: Import + unconditional call in save_work_metadata**

`server/metadata_ops.py:14`, laienda importi:

```python
from .prosopography.ops import update_person_to_works, ensure_prosopo_stubs, update_work_collections
```

`save_work_metadata` (teine, kommentaaridega variant, read ~175): pärast `slug = os.path.basename(...)` rida ja ENNE `if call_ptw:` plokki, lisa tingimusteta kutse:

```python
    # Kollektsioonid uuenevad ka bulk-collection teel (call_ptw=False) — tingimusteta
    update_work_collections(meta.get("id"), meta.get("collections") or [])
```

Tee sama esimeses `save_work_metadata` variandis (read ~86-88, pärast `slug = ...`, enne `if call_ptw:`):

```python
    update_work_collections(meta.get("id"), meta.get("collections") or [])
```

> Mõlemad variandid jooksevad sünkroonselt — kirjutus on üks väike fail, background_task pole vajalik.

- [ ] **Step 4: Run save-test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py::test_save_work_metadata_updates_collections_even_when_call_ptw_false -v`
Expected: PASS.

- [ ] **Step 5: Import-time call in upload_ops + delete endpoint**

`server/upload_ops.py` (read ~1085, kus juba `from .prosopography.ops import update_person_to_works`): laienda importi ja lisa kutse `update_person_to_works(...)` kõrvale:

```python
        from .prosopography.ops import update_person_to_works, update_work_collections
        update_person_to_works(
            ... (olemasolevad argumendid muutmata) ...
        )
        update_work_collections(work_id, meta.get("collections") or [])
```

> `work_id` ja `meta` on selles skoobis juba olemas (import loob teose metaandmed). Kui muutuja nimi erineb (nt `metadata`), kasuta kohalikku nime.

`server/main.py:384` delete endpoint — pärast `delete_work_from_meilisearch(work_id)` rida, lisa:

```python
    from .prosopography.ops import update_work_collections
    update_work_collections(work_id, [])
```

- [ ] **Step 6: Run full backend index suite**

Run: `.venv/bin/python -m pytest tests/test_work_collections.py tests/test_prosopography_ops.py tests/test_work_relations_ops.py -v`
Expected: PASS (kõik).

- [ ] **Step 7: Commit**

```bash
git add server/metadata_ops.py server/upload_ops.py server/main.py tests/test_work_collections.py
git commit -m "feat: maintain work_collections_index on save/import/delete"
```

---

### Task 6: Router — `collection` query-parameeter

**Files:**
- Modify: `server/prosopography/router.py` — `prosopography_list` (read 112-155), `prosopography_query` (157-182), `prosopography_map` (184-221), `prosopography_facets` (223-236), `prosopography_facets_post` (238-248)
- Test: `tests/test_work_collections.py` (router smoke, valikuline kui TestClient setup raske — vt allpool)

- [ ] **Step 1: Add collection param to all five endpoints**

`prosopography_list`: lisa signatuuri `ids: str = None,` järele `collection: str = None,` ja `list_persons(...)` kutsesse `collection=collection,` (pärast `ids=id_list,`).

`prosopography_query`: `list_persons(...)` kutsesse lisa `collection=data.get("collection"),`.

`prosopography_map`: lisa signatuuri `related_to: str = None,` järele `collection: str = None,` ja `get_person_map_markers(...)` kutsesse `collection=collection,`.

`prosopography_facets` (GET): lisa signatuuri `ids: str = None,` järele `collection: str = None,` ja `get_person_facets(...)` kutsesse `collection=collection,`.

`prosopography_facets_post` (POST): `get_person_facets(...)` kutsesse lisa `collection=data.get("collection"),`.

- [ ] **Step 2: Verify import sane (no syntax errors)**

Run: `.venv/bin/python -c "import server.prosopography.router"`
Expected: ei väljasta viga.

- [ ] **Step 3: Commit**

```bash
git add server/prosopography/router.py
git commit -m "feat: collection query param on prosopography endpoints"
```

---

### Task 7: Frontend service — `collection` parameeter

**Files:**
- Modify: `src/prosopography/services/prosopographyService.ts` — `listPersons` (read 7-62), `fetchPersonMapMarkers` (64-101), `getPersonFacets` (104+)

- [ ] **Step 1: Add collection to listPersons**

`listPersons` params-tüüpi (read 7) lisa `collection?: string;`. POST-haru (read 26-32) saadab juba kogu `params` JSON-ina — `collection` läheb automaatselt kaasa, kuid backend POST `/query` loeb `data.get("collection")` (Task 6) → OK. GET-harusse lisa `url.searchParams` plokki (pärast `ids` rida 52):

```typescript
  if (params?.collection) url.searchParams.set('collection', params.collection);
```

- [ ] **Step 2: Add collection to fetchPersonMapMarkers**

`fetchPersonMapMarkers` params-tüüpi (read 64) lisa `collection?: string;`. GET searchParams plokki (pärast `related_to` rida 94):

```typescript
  if (params?.collection) url.searchParams.set('collection', params.collection);
```

- [ ] **Step 3: Add collection to getPersonFacets**

`getPersonFacets` params-tüüpi (read 104) lisa `collection?: string;`. POST-haru saadab `params` JSON-ina (collection kaasas). GET-harusse lisa searchParams plokki:

```typescript
  if (params?.collection) url.searchParams.set('collection', params.collection);
```

> NB: kontrolli getPersonFacets keha (read ~104-130) — kui GET-haru kasutab `url.searchParams`, lisa rida sinna; kui ainult POST, piisab tüübist.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: ei väljasta vigu (või ainult eelnevalt eksisteerinud).

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/services/prosopographyService.ts
git commit -m "feat: collection param in prosopography frontend service"
```

---

### Task 8: PersonsPage + PersonsMap — edasta valitud kollektsioon

**Files:**
- Modify: `src/prosopography/pages/PersonsPage.tsx` — import `useCollection`, `fetchPersons` (read 119-149), `fetchFacets` (read 150-167)
- Modify: `src/prosopography/components/PersonsMap.tsx` (read ~100-115, `fetchPersonMapMarkers` kutse)

- [ ] **Step 1: Read useCollection hook signature**

Run: `grep -n "export function useCollection\|selectedCollection" src/contexts/CollectionContext.tsx`
Expected: kinnitab `useCollection()` tagastab `{ selectedCollection, ... }`.

- [ ] **Step 2: Use selectedCollection in PersonsPage**

`src/prosopography/pages/PersonsPage.tsx` — lisa import (muude importide juurde):

```typescript
import { useCollection } from '../../contexts/CollectionContext';
```

> Kontrolli relatiivset teed (`PersonsPage` asub `src/prosopography/pages/`, context `src/contexts/` → `../../contexts/CollectionContext`).

Komponendi sees (muude hookide juures, nt `useTranslation` lähedal):

```typescript
  const { selectedCollection } = useCollection();
```

`fetchPersons` `listPersons({...})` objekti lisa (nt `sort_by` rea järele):

```typescript
      collection: selectedCollection || undefined,
```

`fetchPersons` `useCallback` sõltuvuste massiivi (read ~149) lisa `selectedCollection`.

`fetchFacets` `getPersonFacets({...})` objekti lisa:

```typescript
      collection: selectedCollection || undefined,
```

`fetchFacets` `useCallback` sõltuvuste massiivi (read ~167) lisa `selectedCollection`.

- [ ] **Step 3: Pass collection into PersonsMap**

`src/prosopography/components/PersonsMap.tsx` — kontrolli, kuidas `filters` ehitatakse (read ~100-115). Kui PersonsMap saab filtrid propsina PersonsPage-ilt, lisa `collection: selectedCollection || undefined` PersonsPage poolt edastatavasse filtri-objekti. Kui PersonsMap loeb ise `useCollection`, lisa:

```typescript
import { useCollection } from '../../contexts/CollectionContext';
// komponendis:
const { selectedCollection } = useCollection();
// fetchPersonMapMarkers(filters, token) kutses lisa filtri-objekti:
//   collection: selectedCollection || undefined
```

> Step 1-laadne grep enne: `grep -n "filters\|useCollection\|fetchPersonMapMarkers" src/prosopography/components/PersonsMap.tsx` — vali õige variant (props vs hook).

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: build õnnestub.

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/pages/PersonsPage.tsx src/prosopography/components/PersonsMap.tsx
git commit -m "feat: PersonsPage/Map respect selected collection"
```

---

### Task 9: Indeksi esmane genereerimine serveris (deploy märkus)

**Files:** puuduvad (ainult deploy-toiming, dokumenteeritud siin)

- [ ] **Step 1: Pärast backend deployd genereeri indeks**

`work_collections_index.json` ehitatakse `rebuild_indices()`-ga, mis jookseb serveri stardil background thread-ina (vt MEMORY). Pärast `./scripts/server_update.sh`-i kontrolli, et fail tekkis:

Run (serveris): `ls -la data/config/work_collections_index.json`
Expected: fail eksisteerib ja pole tühi (kui teoseid on).

Kui puudub, taaskäivita backend (`docker compose up -d backend`) — start käivitab `rebuild_indices()`.

- [ ] **Step 2: Käsitsi sanity-check**

Vali UI päises üks kollektsioon ja ava `/persons` — nimekiri ja külgriba loendurid peaksid vähenema ainult selle kollektsiooni isikuteni. "Kõik tööd" → kõik isikud.

---

## Self-Review

**Spec coverage:**
- Sektsioon 1 (uus indeks, own-collections raw) → Task 1 + 2. ✅
- Sektsioon 2.1 (rebuild) → Task 2; 2.2 (update_work_collections) → Task 1; 2.3 (kutsumiskohad, tingimusteta) → Task 5. ✅
- Sektsioon 3 (_collection_descendants + _persons_in_collection, query-aja laiendus) → Task 3. ✅
- Sektsioon 4 (list_persons/facets/map param + router + service + PersonsPage) → Task 4, 6, 7, 8. ✅
- Sektsioon 5 (veapiirid: kollektsioon valimata → param ära; tühi → tühi nimekiri; kustutatud teos; hierarhia muudatus) → kaetud Task 4 loogikaga (`if collection:`) + Task 3 (live descendants) + Task 5 (delete). ✅
- Sektsioon 6 (testid: 6 stsenaariumi + update_work_collections call_ptw=False) → Task 1 (2 testi), Task 2 (1), Task 3 (rollid+inheritance+exclusion, 1 koondtest), Task 4 (list filter), Task 5 (bulk call_ptw). ✅

**Placeholder scan:** Step 3 Task 7/8 sisaldab "kontrolli"-juhiseid, kuid annab konkreetse koodi mõlemaks haruks (props vs hook) — see on tingimuslik tegelik kood, mitte placeholder. Map-vaade võib olla props- või hook-põhine; mõlemad variandid on antud koodiga. Aktsepteeritav.

**Type consistency:** `collection: Optional[str]` (backend) ↔ `collection?: string` (frontend) ↔ query-param `collection`. `update_work_collections(work_id, collections)` ja `_persons_in_collection(collection_id)` nimed ühtsed kõigis taskides. `WORK_COLLECTIONS_INDEX_FILE` ühtne. ✅
