# Teostest tuletatud isiku-isiku seosed — Implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kuvada `PersonDetailPage`-l sektsioon "Seosed teoste kaudu" — isikud, kellega jagab ühiseid teoseid `creators[]` kaudu. Klõpsatav, rollipaaridega, "Lae veel" toega.

**Architecture:** Uus `works_creators_index.json` indeks (`data/state/`) kirjeldab iga teose osalisi (person_id + rollid). Uus moodul `work_relations_ops.py` ehitab indeksit ja pärib seoseid — O(1) failisüsteemi lugemisel päringu ajal (ainult in-memory indeksid). `router.py` lisab endpointi `GET /prosopography/work-relations/{person_id:path}`. Frontendis uus `WorkRelationsCard.tsx` komponent, `PersonDetailPage.tsx` ise ei suurene (ainult üks import + JSX rida).

**Tech Stack:** Python 3.9+, FastAPI, pytest, React 19 + TypeScript, Tailwind, lucide-react

---

## Failide kaart

| Fail | Muudatus |
|------|----------|
| `server/config.py` | **+1 konstant** `WORKS_CREATORS_INDEX_FILE` |
| `server/prosopography/work_relations_ops.py` | **Uus** — indeksi ehitamine, uuendamine, päring |
| `tests/test_work_relations_ops.py` | **Uus** — TDD testid |
| `server/prosopography/ops.py` | **+2 kutset** — `update_works_creators_index` haakimine |
| `server/prosopography/router.py` | **+1 endpoint** `GET /work-relations/{person_id:path}` |
| `src/prosopography/services/prosopographyService.ts` | **+1 funktsioon** `fetchWorkRelations()` |
| `src/prosopography/components/WorkRelationsCard.tsx` | **Uus** komponent |
| `src/prosopography/pages/PersonDetailPage.tsx` | **+2 rida** import + JSX |

---

## Task 1: Lisa konstant ja kirjuta katkised testid

**Files:**
- Modify: `server/config.py`
- Create: `tests/test_work_relations_ops.py`
- Create: `server/prosopography/work_relations_ops.py` (stub)

- [ ] **Samm 1: Lisa WORKS_CREATORS_INDEX_FILE server/config.py-sse**

Leia rida 94 (`server/config.py`):
```python
PERSON_TO_WORKS_FILE = os.path.join(_DATA_STATE_DIR, "person_to_works.json")
```

Lisa selle järele:
```python
WORKS_CREATORS_INDEX_FILE = os.path.join(_DATA_STATE_DIR, "works_creators_index.json")
```

- [ ] **Samm 2: Loo stub-moodul**

Loo `server/prosopography/work_relations_ops.py`:

```python
"""
Teostest tuletatud isiku-isiku seosed.

Indeks: data/state/works_creators_index.json
  { work_id: { "title": str, "year": int|None, "creators": [{ "person_id": str, "roles": [str] }] } }

Kutsumiskohad:
  build_works_creators_index()      — rebuild_indices() ja serveri start
  update_works_creators_index(...)  — /save ja /update-work-metadata järel (background)
  get_work_relations(...)           — GET /prosopography/work-relations/{person_id}
"""
import json
import os
import threading
from typing import Optional

from ..config import WORKS_CREATORS_INDEX_FILE, PERSON_TO_WORKS_FILE, PROSOPOGRAPHY_INDEX_FILE, BASE_DIR, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)
_creators_lock = threading.Lock()


def build_works_creators_index() -> None:
    raise NotImplementedError


def update_works_creators_index(work_id: str, creators: list, title: str = "", year: Optional[int] = None) -> None:
    raise NotImplementedError


def get_work_relations(person_id: str, limit: int = 10, offset: int = 0) -> list:
    raise NotImplementedError
```

- [ ] **Samm 3: Kirjuta testifail**

Loo `tests/test_work_relations_ops.py`:

```python
"""
Testid: work_relations_ops.py käitumisreeglid.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.work_relations_ops import (
    build_works_creators_index,
    update_works_creators_index,
    get_work_relations,
)

A_ID = "vutt:Paaaaa"
B_ID = "vutt:Pbbbbb"
C_ID = "vutt:Pccccc"


def _write_meta(data_dir: Path, slug: str, work_id: str, creators: list, title: str = "Test", year: int = 1680):
    work_dir = data_dir / slug
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps({"id": work_id, "title": title, "year": year, "creators": creators}),
        encoding="utf-8",
    )


def _write_ptw(state_dir: Path, data: dict):
    (state_dir / "person_to_works.json").write_text(
        json.dumps(data), encoding="utf-8"
    )


def _read_index(state_dir: Path) -> dict:
    p = state_dir / "works_creators_index.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _patch(tmp_path, data_dir=None, state_dir=None):
    data_dir = data_dir or tmp_path / "data"
    state_dir = state_dir or tmp_path / "state"
    state_dir.mkdir(parents=True, exist_ok=True)
    cfg = "server.prosopography.work_relations_ops"
    return (
        patch(f"{cfg}.BASE_DIR", str(data_dir)),
        patch(f"{cfg}.WORKS_CREATORS_INDEX_FILE", str(state_dir / "works_creators_index.json")),
        patch(f"{cfg}.PERSON_TO_WORKS_FILE", str(state_dir / "person_to_works.json")),
        patch(f"{cfg}.PROSOPOGRAPHY_INDEX_FILE", str(state_dir / "prosopography_index.json")),
    )


# ── build_works_creators_index ────────────────────────────────────────────────

def test_build_index_basic(tmp_path):
    """Ehitab indeksi _metadata.json põhjal — kaks isikut ühes teoses."""
    data_dir = tmp_path / "data"
    state_dir = tmp_path / "state"
    _write_meta(data_dir, "teos1", "w1", [
        {"id": A_ID, "role": "praeses"},
        {"id": B_ID, "role": "respondens"},
    ], title="Disputatio", year=1687)
    patches = _patch(tmp_path, data_dir, state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        build_works_creators_index()
    idx = _read_index(state_dir)
    assert "w1" in idx
    assert idx["w1"]["title"] == "Disputatio"
    assert idx["w1"]["year"] == 1687
    creators = {e["person_id"]: e["roles"] for e in idx["w1"]["creators"]}
    assert creators[A_ID] == ["praeses"]
    assert creators[B_ID] == ["respondens"]


def test_build_index_multi_role_same_person(tmp_path):
    """Sama isik mitmes rollis samas teoses — rollid koondatakse massiivi."""
    data_dir = tmp_path / "data"
    state_dir = tmp_path / "state"
    _write_meta(data_dir, "teos1", "w1", [
        {"id": A_ID, "role": "praeses"},
        {"id": A_ID, "role": "autor"},
    ])
    patches = _patch(tmp_path, data_dir, state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        build_works_creators_index()
    idx = _read_index(state_dir)
    creators = {e["person_id"]: e["roles"] for e in idx["w1"]["creators"]}
    assert set(creators[A_ID]) == {"praeses", "autor"}


def test_build_index_ignores_non_vutt(tmp_path):
    """Wikidata/VIAF isikud (ilma vutt:P prefixita) ignoreeritakse."""
    data_dir = tmp_path / "data"
    state_dir = tmp_path / "state"
    _write_meta(data_dir, "teos1", "w1", [
        {"id": "Q12345", "role": "autor"},
        {"id": A_ID, "role": "praeses"},
    ])
    patches = _patch(tmp_path, data_dir, state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        build_works_creators_index()
    idx = _read_index(state_dir)
    creator_ids = [e["person_id"] for e in idx["w1"]["creators"]]
    assert "Q12345" not in creator_ids
    assert A_ID in creator_ids


# ── update_works_creators_index ───────────────────────────────────────────────

def test_update_index_adds_new_work(tmp_path):
    """Uue teose lisamisel uuendatakse indeksit."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        update_works_creators_index("w2", [{"id": A_ID, "role": "autor"}], title="Uus teos", year=1690)
    idx = _read_index(state_dir)
    assert "w2" in idx
    assert idx["w2"]["creators"][0]["person_id"] == A_ID


def test_update_index_removes_empty_work(tmp_path):
    """Kui creators on tühi, eemaldatakse teos indeksist."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    (state_dir / "works_creators_index.json").write_text(
        json.dumps({"w1": {"title": "X", "year": 1680, "creators": [{"person_id": A_ID, "roles": ["praeses"]}]}}),
        encoding="utf-8",
    )
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        update_works_creators_index("w1", [], title="X", year=1680)
    idx = _read_index(state_dir)
    assert "w1" not in idx


# ── get_work_relations ────────────────────────────────────────────────────────

def _setup_relation_data(state_dir: Path):
    """Ühine andmete seadistus: A jagab w1 B-ga (praeses/respondens), w2 C-ga."""
    (state_dir / "works_creators_index.json").write_text(json.dumps({
        "w1": {"title": "Disputatio", "year": 1687, "creators": [
            {"person_id": A_ID, "roles": ["praeses"]},
            {"person_id": B_ID, "roles": ["respondens"]},
        ]},
        "w2": {"title": "Oratio", "year": 1690, "creators": [
            {"person_id": A_ID, "roles": ["autor"]},
            {"person_id": C_ID, "roles": ["pühendaja"]},
        ]},
    }), encoding="utf-8")
    (state_dir / "person_to_works.json").write_text(json.dumps({
        A_ID: [{"work_id": "w1", "role": "praeses"}, {"work_id": "w2", "role": "autor"}],
        B_ID: [{"work_id": "w1", "role": "respondens"}],
        C_ID: [{"work_id": "w2", "role": "pühendaja"}],
    }), encoding="utf-8")
    (state_dir / "prosopography_index.json").write_text(json.dumps({
        "entries": [
            {"id": A_ID, "label": "Andreas Berg"},
            {"id": B_ID, "label": "Johann Müller"},
            {"id": C_ID, "label": "Maria Schmidt"},
        ]
    }), encoding="utf-8")


def test_get_work_relations_basic(tmp_path):
    """A jagab teoseid B ja C-ga — mõlemad tagastatakse."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    person_ids = {r["person_id"] for r in results}
    assert B_ID in person_ids
    assert C_ID in person_ids
    assert A_ID not in person_ids  # ennast ei tagastata


def test_get_work_relations_includes_person_name(tmp_path):
    """Tulemus sisaldab person_name prosopo indeksist."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    b_result = next(r for r in results if r["person_id"] == B_ID)
    assert b_result["person_name"] == "Johann Müller"


def test_get_work_relations_roles_are_arrays(tmp_path):
    """a_roles ja b_roles on massiivid."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    b_result = next(r for r in results if r["person_id"] == B_ID)
    shared = b_result["shared_works"][0]
    assert isinstance(shared["a_roles"], list)
    assert isinstance(shared["b_roles"], list)
    assert "praeses" in shared["a_roles"]
    assert "respondens" in shared["b_roles"]


def test_get_work_relations_sorted_by_count(tmp_path):
    """Sorteeritakse shared_works_count järgi kahanevalt."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    # B jagab 2 teost A-ga, C ainult 1
    (state_dir / "works_creators_index.json").write_text(json.dumps({
        "w1": {"title": "T1", "year": 1680, "creators": [
            {"person_id": A_ID, "roles": ["praeses"]},
            {"person_id": B_ID, "roles": ["respondens"]},
        ]},
        "w2": {"title": "T2", "year": 1681, "creators": [
            {"person_id": A_ID, "roles": ["autor"]},
            {"person_id": B_ID, "roles": ["pühendaja"]},
        ]},
        "w3": {"title": "T3", "year": 1682, "creators": [
            {"person_id": A_ID, "roles": ["praeses"]},
            {"person_id": C_ID, "roles": ["respondens"]},
        ]},
    }), encoding="utf-8")
    (state_dir / "person_to_works.json").write_text(json.dumps({
        A_ID: [{"work_id": "w1", "role": "praeses"}, {"work_id": "w2", "role": "autor"}, {"work_id": "w3", "role": "praeses"}],
        B_ID: [{"work_id": "w1", "role": "respondens"}, {"work_id": "w2", "role": "pühendaja"}],
        C_ID: [{"work_id": "w3", "role": "respondens"}],
    }), encoding="utf-8")
    (state_dir / "prosopography_index.json").write_text(json.dumps({"entries": [
        {"id": A_ID, "label": "A"}, {"id": B_ID, "label": "B"}, {"id": C_ID, "label": "C"},
    ]}), encoding="utf-8")
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        results = get_work_relations(A_ID)
    assert results[0]["person_id"] == B_ID
    assert results[0]["shared_works_count"] == 2
    assert results[1]["person_id"] == C_ID
    assert results[1]["shared_works_count"] == 1


def test_get_work_relations_pagination(tmp_path):
    """limit ja offset töötavad korrektselt."""
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    _setup_relation_data(state_dir)
    patches = _patch(tmp_path, state_dir=state_dir)
    with patches[0], patches[1], patches[2], patches[3]:
        first = get_work_relations(A_ID, limit=1, offset=0)
        second = get_work_relations(A_ID, limit=1, offset=1)
    assert len(first) == 1
    assert len(second) == 1
    assert first[0]["person_id"] != second[0]["person_id"]
```

- [ ] **Samm 4: Käivita testid — kinnita et kõik kukuvad**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/test_work_relations_ops.py -v 2>&1 | head -30
```

Oodatav: `NotImplementedError` kõigis testides.

- [ ] **Samm 5: Commit**

```bash
git add server/config.py server/prosopography/work_relations_ops.py tests/test_work_relations_ops.py
git commit -m "test: lisa work_relations_ops testid (TDD — kõik punased)"
```

---

## Task 2: Implementeeri build_works_creators_index ja update_works_creators_index

**Files:**
- Modify: `server/prosopography/work_relations_ops.py`

- [ ] **Samm 1: Implementeeri mõlemad funktsioonid**

Asenda stub-is `build_works_creators_index` ja `update_works_creators_index`:

```python
def _creators_to_entries(creators: list) -> list:
    """Koondab sama isiku mitu rolli massiivi."""
    entries: list[dict] = []
    for creator in (creators or []):
        pid = (creator.get("id") or "")
        if not pid.startswith("vutt:P"):
            continue
        role = creator.get("role") or "creator"
        existing = next((e for e in entries if e["person_id"] == pid), None)
        if existing:
            if role not in existing["roles"]:
                existing["roles"].append(role)
        else:
            entries.append({"person_id": pid, "roles": [role]})
    return entries


def build_works_creators_index() -> None:
    """Ehitab works_creators_index.json nullist kõigi teoste _metadata.json põhjal."""
    index: dict = {}
    if not os.path.exists(BASE_DIR):
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)
        return
    for entry in os.scandir(BASE_DIR):
        if not entry.is_dir():
            continue
        meta_path = os.path.join(entry.path, "_metadata.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            continue
        work_id = meta.get("id") or meta.get("work_id")
        if not work_id:
            continue
        entries = _creators_to_entries(meta.get("creators") or [])
        if entries:
            index[work_id] = {
                "title": meta.get("title") or "",
                "year": meta.get("year"),
                "creators": entries,
            }
    with _creators_lock:
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)


def update_works_creators_index(
    work_id: str,
    creators: list,
    title: str = "",
    year: Optional[int] = None,
) -> None:
    """Uuendab ühe teose kirjet works_creators_index.json-s."""
    entries = _creators_to_entries(creators)
    with _creators_lock:
        if os.path.exists(WORKS_CREATORS_INDEX_FILE):
            try:
                with open(WORKS_CREATORS_INDEX_FILE, "r", encoding="utf-8") as f:
                    index = json.load(f)
            except Exception:
                index = {}
        else:
            index = {}
        if entries:
            index[work_id] = {"title": title, "year": year, "creators": entries}
        else:
            index.pop(work_id, None)
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)
```

- [ ] **Samm 2: Käivita esimesed 5 testi**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/test_work_relations_ops.py::test_build_index_basic tests/test_work_relations_ops.py::test_build_index_multi_role_same_person tests/test_work_relations_ops.py::test_build_index_ignores_non_vutt tests/test_work_relations_ops.py::test_update_index_adds_new_work tests/test_work_relations_ops.py::test_update_index_removes_empty_work -v
```

Oodatav: kõik 5 `PASSED`.

- [ ] **Samm 3: Commit**

```bash
git add server/prosopography/work_relations_ops.py
git commit -m "feat: implementeeri build_works_creators_index ja update_works_creators_index"
```

---

## Task 3: Implementeeri get_work_relations

**Files:**
- Modify: `server/prosopography/work_relations_ops.py`

- [ ] **Samm 1: Lisa abifunktsioonid ja implementeeri get_work_relations**

Lisa stub-i alla (enne `get_work_relations`):

```python
def _load_person_to_works() -> dict:
    if os.path.exists(PERSON_TO_WORKS_FILE):
        try:
            with open(PERSON_TO_WORKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _load_creators_index() -> dict:
    if os.path.exists(WORKS_CREATORS_INDEX_FILE):
        try:
            with open(WORKS_CREATORS_INDEX_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _load_person_name_map() -> dict:
    """Tagastab { person_id: label } kaardi prosopography_index.json-st."""
    if os.path.exists(PROSOPOGRAPHY_INDEX_FILE):
        try:
            with open(PROSOPOGRAPHY_INDEX_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            return {e["id"]: e.get("label", e["id"]) for e in data.get("entries", [])}
        except Exception:
            pass
    return {}
```

Asenda `get_work_relations` stub:

```python
def get_work_relations(person_id: str, limit: int = 10, offset: int = 0) -> list:
    """
    Tagastab isikud, kellega person_id jagab teoseid creators[] kaudu.
    Sorteeritud shared_works_count järgi kahanevalt.
    """
    ptw = _load_person_to_works()
    creators_index = _load_creators_index()
    name_map = _load_person_name_map()

    a_work_ids = {w["work_id"] for w in ptw.get(person_id, [])}

    # b_id → { work_id → (a_roles, b_roles, title, year) }
    shared: dict[str, dict] = {}

    for work_id in a_work_ids:
        work_entry = creators_index.get(work_id)
        if not work_entry:
            continue
        work_creators = work_entry.get("creators", [])
        a_entry = next((e for e in work_creators if e["person_id"] == person_id), None)
        if a_entry is None:
            continue
        a_roles = a_entry["roles"]
        for entry in work_creators:
            b_id = entry["person_id"]
            if b_id == person_id or not b_id.startswith("vutt:P"):
                continue
            shared.setdefault(b_id, {})[work_id] = (
                a_roles,
                entry["roles"],
                work_entry.get("title", ""),
                work_entry.get("year"),
            )

    results = []
    for b_id, works in shared.items():
        work_list = [
            {
                "work_id": wid,
                "work_title": title,
                "work_year": year,
                "a_roles": a_roles,
                "b_roles": b_roles,
            }
            for wid, (a_roles, b_roles, title, year) in works.items()
        ]
        results.append({
            "person_id": b_id,
            "person_name": name_map.get(b_id, b_id),
            "shared_works_count": len(works),
            "shared_works": work_list,
        })

    results.sort(key=lambda x: x["shared_works_count"], reverse=True)
    return results[offset: offset + limit]
```

- [ ] **Samm 2: Käivita kõik testid**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/test_work_relations_ops.py -v
```

Oodatav: kõik 10 testi `PASSED`.

- [ ] **Samm 3: Commit**

```bash
git add server/prosopography/work_relations_ops.py
git commit -m "feat: implementeeri get_work_relations"
```

---

## Task 4: Haagi work_relations_ops ops.py-sse

**Files:**
- Modify: `server/prosopography/ops.py`

- [ ] **Samm 1: Lisa import ops.py algusesse**

Leia `ops.py` importide blokk (read 16–22). Lisa rida 22 järele:

```python
from .work_relations_ops import update_works_creators_index, build_works_creators_index
```

- [ ] **Samm 2: Kutsu update_works_creators_index update_person_to_works sees**

Leia `update_person_to_works` funktsioon (rida ~778). Funktsioon lõppeb `atomic_write_json(PERSON_TO_WORKS_FILE, data)` kutsega. Lisa selle järele:

```python
        atomic_write_json(PERSON_TO_WORKS_FILE, data)

    # Uuenda works_creators_index (background-ühilduv, ei nõua locks)
    try:
        update_works_creators_index(work_id, creators, title="", year=None)
    except Exception:
        logger.exception("update_works_creators_index viga teose %s jaoks", work_id)
```

Märkus: `title` ja `year` saame lisada hiljem kui `update_person_to_works` saab need parameetrid — praegu jätame tühjaks (indeks uuendatakse `rebuild_indices` käivitamisel täielikult).

- [ ] **Samm 3: Kutsu build_works_creators_index rebuild_indices sees**

Leia `rebuild_indices` funktsiooni lõpp (~rida 955 `atomic_write_json(PERSON_TO_WORKS_FILE, ptw)` järel):

```python
    # Kirjuta person_to_works
    with _works_lock:
        atomic_write_json(PERSON_TO_WORKS_FILE, ptw)
```

Lisa selle järele:

```python
    # Ehita works_creators_index
    try:
        build_works_creators_index()
    except Exception:
        logger.exception("build_works_creators_index viga rebuild_indices sees")
```

- [ ] **Samm 4: Käivita kõik testid**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/ -v
```

Oodatav: kõik testid `PASSED`.

- [ ] **Samm 5: Commit**

```bash
git add server/prosopography/ops.py
git commit -m "feat: haagi work_relations_ops update_person_to_works ja rebuild_indices külge"
```

---

## Task 5: Lisa router endpoint

**Files:**
- Modify: `server/prosopography/router.py`

- [ ] **Samm 1: Lisa import router.py algusesse**

Leia `from .reciprocal_ops import sync_reciprocals` (rida 28). Lisa selle järele:

```python
from .work_relations_ops import get_work_relations
```

- [ ] **Samm 2: Lisa endpoint ENNE `@router.get("/{person_id:path")`**

Leia `@router.get("/{person_id:path}")` endpoint (rida ~341). Lisa vahetult ENNE seda:

```python
@router.get("/work-relations/{person_id:path}")
async def prosopography_work_relations(
    person_id: str,
    limit: int = 10,
    offset: int = 0,
):
    """Teostest tuletatud isiku-isiku seosed. Avalik endpoint."""
    return get_work_relations(person_id, limit=limit, offset=offset)

```

Märkus: registreerimine ENNE `/{person_id:path}` on kriitiline — FastAPI hindab route'e registreerimise järjekorras.

- [ ] **Samm 3: Käivita kõik testid**

```bash
cd /home/mf/LLM/VUTT && python -m pytest tests/ -v
```

Oodatav: kõik testid `PASSED`.

- [ ] **Samm 4: Commit**

```bash
git add server/prosopography/router.py
git commit -m "feat: lisa GET /prosopography/work-relations/{person_id} endpoint"
```

---

## Task 6: Lisa fetchWorkRelations frontend teenusesse

**Files:**
- Modify: `src/prosopography/services/prosopographyService.ts`

- [ ] **Samm 1: Lisa tüüpide definitsioonid ja fetchWorkRelations**

Ava `src/prosopography/services/prosopographyService.ts`. Lisa faili lõppu:

```typescript
export interface WorkRelationWork {
  work_id: string;
  work_title: string;
  work_year: number | null;
  a_roles: string[];
  b_roles: string[];
}

export interface WorkRelation {
  person_id: string;
  person_name: string;
  shared_works_count: number;
  shared_works: WorkRelationWork[];
}

export async function fetchWorkRelations(
  personId: string,
  params?: { limit?: number; offset?: number },
): Promise<WorkRelation[]> {
  const url = new URL(`${BASE}/work-relations/${personId}`, window.location.origin);
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit));
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset));
  const resp = await fetchWithTimeout(url.toString(), { timeout: 10000 });
  if (!resp.ok) throw new Error(`fetchWorkRelations: ${resp.status}`);
  return resp.json();
}
```

- [ ] **Samm 2: Kontrolli TypeScript kompileerimist**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -10
```

Oodatav: `✓ built in` — no TypeScript errors.

- [ ] **Samm 3: Commit**

```bash
git add src/prosopography/services/prosopographyService.ts
git commit -m "feat: lisa fetchWorkRelations prosopographyService-sse"
```

---

## Task 7: Loo WorkRelationsCard komponent

**Files:**
- Create: `src/prosopography/components/WorkRelationsCard.tsx`

- [ ] **Samm 1: Loo komponent**

Loo `src/prosopography/components/WorkRelationsCard.tsx`:

```tsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, ChevronDown, ChevronRight, BookOpen } from 'lucide-react';
import { fetchWorkRelations, type WorkRelation } from '../services/prosopographyService';

const INITIAL_LIMIT = 10;

const WorkRelationsCard: React.FC<{ personId: string }> = ({ personId }) => {
  const { t } = useTranslation(['prosopography', 'workspace']);
  const [relations, setRelations] = useState<WorkRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchWorkRelations(personId, { limit: INITIAL_LIMIT + 1 })
      .then(data => {
        setHasMore(data.length > INITIAL_LIMIT);
        setRelations(data.slice(0, INITIAL_LIMIT));
        setOffset(INITIAL_LIMIT);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [personId]);

  const loadMore = () => {
    fetchWorkRelations(personId, { limit: INITIAL_LIMIT + 1, offset })
      .then(data => {
        setHasMore(data.length > INITIAL_LIMIT);
        setRelations(prev => [...prev, ...data.slice(0, INITIAL_LIMIT)]);
        setOffset(prev => prev + INITIAL_LIMIT);
      })
      .catch(() => {});
  };

  if (loading) return null;
  if (relations.length === 0) return null;

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6">
      <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
        <span className="text-primary-600"><ArrowLeftRight size={18} /></span>
        <h4 className="font-bold">{t('workRelations', 'Seosed teoste kaudu')}</h4>
        <span className="text-xs text-gray-400 font-normal">({relations.length}{hasMore ? '+' : ''})</span>
      </div>

      <div className="space-y-1">
        {relations.map(rel => (
          <div key={rel.person_id}>
            <button
              onClick={() => setExpanded(e => e === rel.person_id ? null : rel.person_id)}
              className="w-full flex items-center justify-between py-2 -mx-1 px-1 rounded hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2 min-w-0">
                {expanded === rel.person_id
                  ? <ChevronDown size={13} className="shrink-0 text-gray-400" />
                  : <ChevronRight size={13} className="shrink-0 text-gray-400" />
                }
                <Link
                  to={`/persons/${rel.person_id}`}
                  onClick={e => e.stopPropagation()}
                  className="text-sm text-primary-700 hover:underline truncate"
                >
                  {rel.person_name}
                </Link>
              </div>
              <span className="text-xs text-gray-400 shrink-0 ml-3">
                {rel.shared_works_count} {t('sharedWorks', 'ühist teost')}
              </span>
            </button>

            {expanded === rel.person_id && (
              <div className="ml-5 mt-1 mb-2 space-y-1">
                {rel.shared_works.map(w => (
                  <div key={w.work_id} className="flex items-start gap-2 text-xs text-gray-600 py-1">
                    <BookOpen size={11} className="shrink-0 text-gray-300 mt-0.5" />
                    <div className="min-w-0">
                      <Link
                        to={`/work/${w.work_id}/1`}
                        className="hover:text-primary-700 hover:underline truncate block"
                      >
                        {w.work_title || w.work_id}
                        {w.work_year ? ` (${w.work_year})` : ''}
                      </Link>
                      <span className="text-gray-400">
                        {w.a_roles.map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ')}
                        {' ↔ '}
                        {w.b_roles.map(r => t(`workspace:metadata.roles.${r}`, { defaultValue: r })).join(', ')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={loadMore}
          className="mt-3 w-full text-xs text-gray-500 hover:text-primary-600 py-1.5 border border-gray-200 rounded hover:border-primary-300 transition-colors"
        >
          {t('loadMore', 'Lae veel')}
        </button>
      )}
    </div>
  );
};

export default WorkRelationsCard;
```

- [ ] **Samm 2: Kontrolli TypeScript kompileerimist**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -10
```

Oodatav: `✓ built in` — no TypeScript errors.

- [ ] **Samm 3: Commit**

```bash
git add src/prosopography/components/WorkRelationsCard.tsx
git commit -m "feat: loo WorkRelationsCard komponent"
```

---

## Task 8: Lisa WorkRelationsCard PersonDetailPage-sse

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx`

- [ ] **Samm 1: Lisa import**

Leia `src/prosopography/pages/PersonDetailPage.tsx` rida 15 (`import { index } from '../../services/meiliService';`). Lisa selle järele:

```typescript
import WorkRelationsCard from '../components/WorkRelationsCard';
```

- [ ] **Samm 2: Lisa komponent JSX-i**

Leia `PersonDetailPage` return-is `{/* ── Struktureeritud info (klapitav) ── */}` rida (rida ~487). Lisa vahetult ENNE seda:

```tsx
        {/* ── Seosed teoste kaudu ── */}
        {id && <WorkRelationsCard personId={id} />}
```

Märkus: `id` parameetrist `useParams` on täis prosopo ID (`vutt:Pxxx`) — navigeerimine `/persons/vutt:Pxxx` kaudu, React Router annab `id = "vutt:Pxxx"` otse.

- [ ] **Samm 4: Kontrolli TypeScript kompileerimist**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -10
```

Oodatav: `✓ built in` — no TypeScript errors.

- [ ] **Samm 5: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat: lisa WorkRelationsCard PersonDetailPage-le"
```

---

## Lõplik kontroll

- [ ] Käivita kõik testid: `python -m pytest tests/ -v`
- [ ] Käivita build: `npm run build`
- [ ] **Backend — käivita rebuild_indices serveril** (uuendab `works_creators_index.json`):
  ```bash
  ssh vutt
  cd ~/VUTT && git pull
  docker compose build --no-cache backend && docker compose up -d backend
  # Seejärel admin UI-st: "Taasta indeksid" nupp
  ```
- [ ] **Frontend kontroll:** ava isiku detail leht kellel on mitu teost → "Seosed teoste kaudu" sektsiooni peab kuvuma; klõps isikul → accordion avab jagatud teosed rollipaaridega
- [ ] **"Lae veel":** isikul kellel on >10 seotud isikut, "Lae veel" nupp laeb järgmised
