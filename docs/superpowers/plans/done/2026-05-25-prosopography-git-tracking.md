# Prosopograafia Git-versioonihaldus — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Liigutada prosopograafia isikukaardid `state/prosopography/` → `data/config/prosopography/` (gitti), lisada git-commitid kõigile CRUD-operatsioonidele, kuvada isiku-muudatused Review lehel ja lisada PersonDetailPage-le ajalugu+taastamine.

**Architecture:** Isikufailide tee muutub `_DATA_CONFIG_DIR/prosopography/` alla, mis on juba olemasoleva `data/`-giti sees. `create_person`, `update_person`, `delete_person`, `merge_person` asendavad `atomic_write_json` → `save_with_git`. `get_recent_commits()` laiendatakse prosopograafia commitite tuvastamiseks. Uued endpointid `/history`, `/diff`, `/restore`. Frontend: Review leht saab isiku-badge'id, PersonDetailPage saab klapitava ajaloo-sektsiooni.

**Tech Stack:** Python 3.9, FastAPI, GitPython, React 19, TypeScript, Tailwind, lucide-react

---

## Muudetavad failid

| Fail | Muudatus |
|------|----------|
| `server/config.py` | `PROSOPOGRAPHY_DIR` → `_DATA_CONFIG_DIR/prosopography`, uus `PROSOPOGRAPHY_IMAGES_DIR` |
| `server/git_ops.py` | Uus `delete_file_from_git()`, `get_recent_commits()` prosopo laiendus |
| `server/prosopography/ops.py` | Piltide teefix, `compute_person_diff()`, create/update/delete/merge → git |
| `server/prosopography/router.py` | Uued endpointid: `/history`, `/diff`, `/restore` |
| `src/pages/Review.tsx` | Isiku-commitide tüüp + kuvamine |
| `src/prosopography/pages/PersonDetailPage.tsx` | Ajalugu-sektsioon |
| `scripts/migrate_prosopography_to_git.py` | Ühekordselt käivitatav migratsiooniskript |
| `tests/test_prosopography_git.py` | Uued testid (luuakse selles plaanis) |

---

## Task 1: Config — PROSOPOGRAPHY_DIR muutus + PROSOPOGRAPHY_IMAGES_DIR

**Files:**
- Modify: `server/config.py:103-104`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Loo testifail ja kirjuta esimene test**

```python
# tests/test_prosopography_git.py
"""Testid prosopograafia git-versioonihalduse jaoks."""
import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_prosopography_dir_is_under_data_config():
    """PROSOPOGRAPHY_DIR peab olema DATA_CONFIG_DIR all."""
    from server.config import PROSOPOGRAPHY_DIR, DATA_CONFIG_DIR
    assert PROSOPOGRAPHY_DIR.startswith(DATA_CONFIG_DIR), (
        f"PROSOPOGRAPHY_DIR ({PROSOPOGRAPHY_DIR}) peab olema DATA_CONFIG_DIR ({DATA_CONFIG_DIR}) all"
    )


def test_prosopography_images_dir_is_under_state():
    """PROSOPOGRAPHY_IMAGES_DIR peab olema STATE_DIR all."""
    from server.config import PROSOPOGRAPHY_IMAGES_DIR, STATE_DIR
    assert PROSOPOGRAPHY_IMAGES_DIR.startswith(STATE_DIR), (
        f"PROSOPOGRAPHY_IMAGES_DIR ({PROSOPOGRAPHY_IMAGES_DIR}) peab olema STATE_DIR ({STATE_DIR}) all"
    )
```

- [ ] **Step 2: Käivita testid — peavad PUUDUMA (ImportError `PROSOPOGRAPHY_IMAGES_DIR`)**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: `ImportError: cannot import name 'PROSOPOGRAPHY_IMAGES_DIR'` VÕI `AssertionError` esimesel testil (PROSOPOGRAPHY_DIR on praegu STATE_DIR all).

- [ ] **Step 3: Muuda `server/config.py` ridu 103-104**

Asenda:
```python
# Prosopograafia isikukaardid
PROSOPOGRAPHY_DIR = os.path.join(_STATE_DIR, "prosopography")
```

sellega:
```python
# Prosopograafia isikukaardid (JSON failid — gitis, pildid — state-is)
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(_STATE_DIR, "prosopography", "images")
```

- [ ] **Step 4: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: `PASSED` mõlemad testid.

- [ ] **Step 5: Commit**

```bash
git add server/config.py tests/test_prosopography_git.py
git commit -m "feat: prosopo PROSOPOGRAPHY_DIR → data/config, lisa PROSOPOGRAPHY_IMAGES_DIR"
```

---

## Task 2: `git_ops.py` — `delete_file_from_git()` funktsioon

**Files:**
- Modify: `server/git_ops.py`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa test `delete_file_from_git()` jaoks**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_delete_file_from_git(tmp_path):
    """delete_file_from_git kustutab faili gitist ja teeb commit."""
    import git
    from unittest.mock import patch, MagicMock

    # Loo mini git repo
    repo = git.Repo.init(str(tmp_path))
    test_file = tmp_path / "test.json"
    test_file.write_text('{"id": "test"}', encoding="utf-8")
    repo.index.add(["test.json"])
    repo.index.commit("init", author=git.Actor("test", "t@t.com"), committer=git.Actor("test", "t@t.com"))

    with patch("server.git_ops.get_or_init_repo", return_value=repo), \
         patch("server.git_ops.BASE_DIR", str(tmp_path)):
        from server.git_ops import delete_file_from_git
        result = delete_file_from_git(str(test_file), "Kustutamine: test.json", "testuser")

    assert result is True
    assert not test_file.exists()
    assert "Kustutamine: test.json" in repo.head.commit.message
```

- [ ] **Step 2: Käivita test — peab LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_delete_file_from_git -v
```

Oodatav: `ImportError: cannot import name 'delete_file_from_git'`

- [ ] **Step 3: Lisa `delete_file_from_git()` `server/git_ops.py` lõppu (enne `get_recent_commits`)**

```python
def delete_file_from_git(absolute_path: str, commit_msg: str, username: str = "VUTT Server") -> bool:
    """
    Eemaldab faili gitist ja teeb commit.
    Erinevalt delete_page_from_git()-st võtab absoluutse tee (mitte folder/base).
    """
    repo = get_or_init_repo()
    relative_path = os.path.relpath(absolute_path, BASE_DIR)
    try:
        if os.path.exists(absolute_path):
            try:
                repo.index.remove([relative_path])
            except Exception:
                repo.git.rm("--cached", relative_path)
            os.remove(absolute_path)
        else:
            try:
                repo.git.rm("--cached", relative_path)
            except Exception:
                return False

        actor = Actor(username, f"{username}@vutt.local")
        repo.index.commit(commit_msg, author=actor, committer=actor)
        logger.info(f"GIT: Kustutatud {relative_path} ({username})")
        return True
    except Exception as e:
        logger.error(f"GIT viga faili kustutamisel ({relative_path}): {e}")
        return False
```

- [ ] **Step 4: Uuenda `server/git_ops.py` eksporti `__init__.py`-s**

```bash
grep -n "delete_file_from_git\|delete_page_from_git" /home/mf/LLM/VUTT/server/__init__.py
```

Kui `delete_page_from_git` on seal eksporditud, lisa ka `delete_file_from_git`. Kui faili pole või eksporti pole, jätka.

- [ ] **Step 5: Käivita test — peab LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_delete_file_from_git -v
```

Oodatav: `PASSED`

- [ ] **Step 6: Commit**

```bash
git add server/git_ops.py tests/test_prosopography_git.py
git commit -m "feat: lisa delete_file_from_git() git_ops.py-sse"
```

---

## Task 3: `git_ops.py` — `get_recent_commits()` prosopo laiendus

**Files:**
- Modify: `server/git_ops.py:636-733`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa test prosopo commitite tuvastamiseks**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_get_recent_commits_includes_prosopo(tmp_path):
    """get_recent_commits peab tagastama prosopo commitid."""
    import git
    from unittest.mock import patch

    repo = git.Repo.init(str(tmp_path))
    prosopo_dir = tmp_path / "config" / "prosopography"
    prosopo_dir.mkdir(parents=True)
    person_file = prosopo_dir / "abc123.json"
    person_file.write_text('{"id": "vutt:Pabc123", "name": {"label": "Test Isik"}}', encoding="utf-8")
    repo.index.add(["config/prosopography/abc123.json"])
    repo.index.commit(
        "Prosopo loomine: Test Isik [vutt:Pabc123]",
        author=git.Actor("testuser", "t@t.com"),
        committer=git.Actor("testuser", "t@t.com"),
    )

    with patch("server.git_ops.get_or_init_repo", return_value=repo), \
         patch("server.git_ops.BASE_DIR", str(tmp_path)):
        from server import git_ops
        import importlib; importlib.reload(git_ops)
        result = git_ops.get_recent_commits(limit=10)

    commits = result["commits"]
    assert len(commits) == 1
    c = commits[0]
    assert c["change_type"] == "person"
    assert c["person_id"] == "vutt:Pabc123"
    assert c["person_name"] == "Test Isik"
    assert c["work_id"] is None


def test_parse_person_name_from_message():
    """_parse_person_name_from_message parsib nime commit-sõnumist."""
    from server.git_ops import _parse_person_name_from_message
    assert _parse_person_name_from_message("Prosopo muudatus: Hans Ludenius [vutt:Pabc]") == "Hans Ludenius"
    assert _parse_person_name_from_message("Prosopo loomine: Johann [vutt:Pxyz]") == "Johann"
    assert _parse_person_name_from_message("Prosopo liitmine: A → B") == "A → B"
    assert _parse_person_name_from_message("Prosopo migratsioon: 2218 isikut") == "2218 isikut"
```

- [ ] **Step 2: Käivita testid — peavad LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_get_recent_commits_includes_prosopo tests/test_prosopography_git.py::test_parse_person_name_from_message -v
```

Oodatav: mõlemad FAIL.

- [ ] **Step 3: Lisa `_parse_person_name_from_message()` helper `server/git_ops.py`-sse (faili algusesse, pärast importe)**

```python
def _parse_person_name_from_message(message: str) -> str:
    """Parsib isiku nime commit-sõnumist.
    'Prosopo muudatus: Hans Ludenius [vutt:Pabc]' → 'Hans Ludenius'
    'Prosopo liitmine: A → B' → 'A → B'
    """
    import re as _re
    m = _re.search(r':\s*(.+?)(?:\s*\[vutt:P[^\]]+\])?$', message.strip())
    return m.group(1).strip() if m else message.strip()
```

- [ ] **Step 4: Laienda `get_recent_commits()` — lisa prosopo tuvastamine**

Leia `get_recent_commits()` funktsioon (rida ~636). Selle `for filepath in file_paths:` tsüklis, ENNE `if not is_txt and not is_metadata: continue` rida, lisa:

```python
# Prosopo failid: config/prosopography/{nanoid}.json
is_prosopo = (
    len(parts) >= 3
    and parts[0] == "config"
    and parts[1] == "prosopography"
    and filename.endswith(".json")
    and filename not in ("prosopography_index.json",)
)

if is_prosopo:
    nanoid = filename.removesuffix(".json")
    person_id = f"vutt:P{nanoid}"
    file_key = f"prosopo/{commit.hexsha[:8]}"  # üks kirje per commit (merge puhuks)
    if file_key in seen_files:
        continue
    seen_files.add(file_key)
    if skipped < skip:
        skipped += 1
        continue
    results.append({
        "commit_hash": commit.hexsha[:8],
        "full_hash": commit.hexsha,
        "author": commit.author.name,
        "date": commit.committed_datetime.isoformat(),
        "formatted_date": commit.committed_datetime.strftime("%d.%m.%Y %H:%M"),
        "message": commit.message.strip(),
        "work_id": None,
        "title": None,
        "year": None,
        "work_author": None,
        "lehekylje_number": None,
        "filepath": filepath,
        "change_type": "person",
        "person_id": person_id,
        "person_name": _parse_person_name_from_message(commit.message.strip()),
    })
    if len(results) >= limit:
        has_more = True
        break
    continue
```

- [ ] **Step 5: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: kõik PASSED.

- [ ] **Step 6: Commit**

```bash
git add server/git_ops.py tests/test_prosopography_git.py
git commit -m "feat: git_ops laiendus prosopo commitite tuvastamiseks Review lehel"
```

---

## Task 4: `ops.py` — piltide teefix + `compute_person_diff()` helper

**Files:**
- Modify: `server/prosopography/ops.py`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa `compute_person_diff()` test**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_compute_person_diff_basic():
    """compute_person_diff leiab muutunud väljad."""
    from server.prosopography.ops import compute_person_diff
    before = {"name": {"label": "Hans"}, "imm_year": 1640, "biography": None, "updated_at": "2024-01-01"}
    after  = {"name": {"label": "Hans Ludenius"}, "imm_year": 1642, "biography": None, "updated_at": "2024-06-01"}
    changes = compute_person_diff(before, after)
    fields = {c["field"] for c in changes}
    assert "name" in fields
    assert "imm_year" in fields
    assert "updated_at" not in fields  # tehniline väli, ignoreerida
    assert "biography" not in fields   # väärtus ei muutunud (mõlemad None)


def test_compute_person_diff_new_field():
    """compute_person_diff tuvastab uue välja lisamise."""
    from server.prosopography.ops import compute_person_diff
    before = {"name": {"label": "Hans"}}
    after  = {"name": {"label": "Hans"}, "notes": "Uus märge"}
    changes = compute_person_diff(before, after)
    assert any(c["field"] == "notes" and c["old"] is None and c["new"] == "Uus märge" for c in changes)
```

- [ ] **Step 2: Käivita testid — peavad LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_compute_person_diff_basic tests/test_prosopography_git.py::test_compute_person_diff_new_field -v
```

Oodatav: `ImportError: cannot import name 'compute_person_diff'`

- [ ] **Step 3: Uuenda `ops.py` importe — lisa `PROSOPOGRAPHY_IMAGES_DIR`**

Leia `server/prosopography/ops.py` read 19-24:
```python
from ..config import (
    PROSOPOGRAPHY_DIR,
    PROSOPOGRAPHY_INDEX_FILE,
    PERSON_TO_WORKS_FILE,
    PERSON_ALIASES_FILE,
)
```

Asenda:
```python
from ..config import (
    PROSOPOGRAPHY_DIR,
    PROSOPOGRAPHY_IMAGES_DIR,
    PROSOPOGRAPHY_INDEX_FILE,
    PERSON_TO_WORKS_FILE,
    PERSON_ALIASES_FILE,
)
```

- [ ] **Step 4: Uuenda `_person_image_path()` ja `upload_person_image()` `ops.py`-s**

Leia `_person_image_path()` (rida ~974):
```python
def _person_image_path(person_id: str, ext: str) -> str:
    """Tagastab isiku pildi failitee."""
    nanoid = person_id.removeprefix("vutt:P")
    img_dir = os.path.join(PROSOPOGRAPHY_DIR, PERSON_IMAGES_DIR_NAME)
    return os.path.join(img_dir, f"{nanoid}{ext}")
```

Asenda:
```python
def _person_image_path(person_id: str, ext: str) -> str:
    """Tagastab isiku pildi failitee (state/prosopography/images/ — ei ole gitis)."""
    nanoid = person_id.removeprefix("vutt:P")
    return os.path.join(PROSOPOGRAPHY_IMAGES_DIR, f"{nanoid}{ext}")
```

Leia `upload_person_image()` rida ~1017:
```python
    img_dir = os.path.join(PROSOPOGRAPHY_DIR, PERSON_IMAGES_DIR_NAME)
    os.makedirs(img_dir, exist_ok=True)
    img_path = _person_image_path(person_id, ext)
```

Asenda:
```python
    os.makedirs(PROSOPOGRAPHY_IMAGES_DIR, exist_ok=True)
    img_path = _person_image_path(person_id, ext)
```

- [ ] **Step 5: Lisa `compute_person_diff()` `ops.py`-sse (faili lõppu)**

```python
_DIFF_IGNORED_FIELDS = frozenset({
    "updated_at", "updated_by", "created_at", "created_by",
    "schema_version", "import_batch_ids", "id",
})

def compute_person_diff(before: dict, after: dict) -> list:
    """
    Tagastab [{field, old, new}] muutunud väljade loendi.
    Ignoreerib tehnilisi välju (timestamps, id jne).
    """
    changes = []
    for key in sorted(set(before) | set(after)):
        if key in _DIFF_IGNORED_FIELDS:
            continue
        old_val = before.get(key)
        new_val = after.get(key)
        if old_val != new_val:
            changes.append({"field": key, "old": old_val, "new": new_val})
    return changes
```

- [ ] **Step 6: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: kõik PASSED.

- [ ] **Step 7: Commit**

```bash
git add server/prosopography/ops.py tests/test_prosopography_git.py
git commit -m "feat: prosopo ops — PROSOPOGRAPHY_IMAGES_DIR, compute_person_diff()"
```

---

## Task 5: `ops.py` — `create_person()` ja `update_person()` git commit

**Files:**
- Modify: `server/prosopography/ops.py:385-563`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa testid**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_create_person_calls_save_with_git(tmp_path, monkeypatch):
    """create_person() peab kutsuma save_with_git()."""
    import json
    from unittest.mock import patch, MagicMock, call

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc12345"})

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.save_with_git", mock_save), \
         patch("server.prosopography.ops._update_index_entry"), \
         patch("server.prosopography.ops._update_aliases_entry"):
        from server.prosopography import ops
        import importlib; importlib.reload(ops)
        with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
             patch("server.prosopography.ops.save_with_git", mock_save), \
             patch("server.prosopography.ops._update_index_entry"), \
             patch("server.prosopography.ops._update_aliases_entry"):
            person = ops.create_person({"name": "Test Isik"}, "testuser")

    assert mock_save.called
    call_args = mock_save.call_args
    assert "Prosopo loomine:" in call_args.kwargs.get("message", "") or \
           "Prosopo loomine:" in (call_args.args[3] if len(call_args.args) > 3 else "")
    assert person["created_by"] == "testuser"


def test_update_person_calls_save_with_git(tmp_path):
    """update_person() peab kutsuma save_with_git()."""
    import json
    from unittest.mock import patch, MagicMock

    person_data = {
        "id": "vutt:Pabc123",
        "name": {"label": "Test"},
        "updated_at": "2024-01-01T00:00:00+00:00",
        "record_status": "draft",
    }
    person_file = tmp_path / "abc123.json"
    person_file.write_text(json.dumps(person_data), encoding="utf-8")

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc12345"})

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.save_with_git", mock_save), \
         patch("server.prosopography.ops._update_index_entry"), \
         patch("server.prosopography.ops._update_aliases_entry"), \
         patch("server.prosopography.ops._propagate_name_to_works"):
        from server.prosopography import ops
        result = ops.update_person("vutt:Pabc123", {"updated_at": "2024-01-01T00:00:00+00:00", "name": {"label": "Test muudetud"}}, "testuser")

    assert mock_save.called
    msg = mock_save.call_args.kwargs.get("message", "")
    assert "Prosopo muudatus:" in msg
    assert result["updated_by"] == "testuser"
```

- [ ] **Step 2: Käivita testid — peavad LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_create_person_calls_save_with_git tests/test_prosopography_git.py::test_update_person_calls_save_with_git -v
```

Oodatav: FAIL (save_with_git ei ole kutsutud).

- [ ] **Step 3: Lisa `save_with_git` import `ops.py`-sse faili ülaosas (koos teiste impordiga)**

Leia `ops.py` impordiblokk (read ~1-35). Lisa:
```python
from ..git_ops import save_with_git
```

- [ ] **Step 4: Uuenda `create_person()` — asenda `atomic_write_json` → `save_with_git`**

Leia `create_person()` lõppu (rida ~435-439):
```python
    os.makedirs(PROSOPOGRAPHY_DIR, exist_ok=True)
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)
    return person
```

Asenda:
```python
    os.makedirs(PROSOPOGRAPHY_DIR, exist_ok=True)
    name = person.get("name", {}).get("label") or person_id
    save_with_git(
        _id_to_path(person_id),
        json.dumps(person, ensure_ascii=False, indent=2),
        username,
        message=f"Prosopo loomine: {name} [{person_id}]",
    )
    _update_index_entry(person)
    _update_aliases_entry(person)
    return person
```

- [ ] **Step 5: Uuenda `update_person()` — asenda `atomic_write_json` → `save_with_git`**

Leia `update_person()` rida ~555:
```python
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)
```

Asenda:
```python
    name = (person.get("name") or {}).get("label") or person_id
    save_with_git(
        _id_to_path(person_id),
        json.dumps(person, ensure_ascii=False, indent=2),
        username,
        message=f"Prosopo muudatus: {name} [{person_id}]",
    )
    _update_index_entry(person)
    _update_aliases_entry(person)
```

- [ ] **Step 6: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: kõik PASSED.

- [ ] **Step 7: Commit**

```bash
git add server/prosopography/ops.py tests/test_prosopography_git.py
git commit -m "feat: create_person + update_person → save_with_git"
```

---

## Task 6: `ops.py` — `delete_person()` git commit

**Files:**
- Modify: `server/prosopography/ops.py:1600-1652`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa test**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_delete_person_calls_delete_file_from_git(tmp_path):
    """delete_person() peab kutsuma delete_file_from_git()."""
    import json
    from unittest.mock import patch, MagicMock

    person_data = {
        "id": "vutt:Pabc123",
        "name": {"label": "Kustutav Isik"},
        "record_status": "draft",
        "updated_at": "2024-01-01T00:00:00+00:00",
    }
    person_file = tmp_path / "abc123.json"
    person_file.write_text(json.dumps(person_data), encoding="utf-8")

    mock_delete = MagicMock(return_value=True)

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.delete_file_from_git", mock_delete), \
         patch("server.prosopography.ops._load_person_to_works", return_value={}), \
         patch("server.prosopography.ops._load_index", return_value={"entries": []}), \
         patch("server.prosopography.ops.atomic_write_json"), \
         patch("server.prosopography.ops._remove_aliases_entry"), \
         patch("server.prosopography.ops._glob.glob", return_value=[]):
        from server.prosopography import ops
        result = ops.delete_person("vutt:Pabc123", "testuser")

    assert mock_delete.called
    call_args = mock_delete.call_args
    assert "Prosopo kustutamine:" in call_args.args[1]
    assert result["deleted"] == "vutt:Pabc123"
```

- [ ] **Step 2: Käivita test — peab LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_delete_person_calls_delete_file_from_git -v
```

Oodatav: FAIL.

- [ ] **Step 3: Lisa `delete_file_from_git` import `ops.py` ülaossa**

Uuenda olemasolevat `save_with_git` importi:
```python
from ..git_ops import save_with_git, delete_file_from_git
```

- [ ] **Step 4: Uuenda `delete_person()` — asenda `os.remove` → `delete_file_from_git`**

Leia `delete_person()` rida ~1639-1642:
```python
    # Kustuta fail
    path = _id_to_path(person_id)
    if os.path.exists(path):
        os.remove(path)
```

Asenda:
```python
    # Kustuta fail gitist
    path = _id_to_path(person_id)
    name = (person.get("name") or {}).get("label") or person_id
    delete_file_from_git(path, f"Prosopo kustutamine: {name} [{person_id}]", username)
```

- [ ] **Step 5: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: kõik PASSED.

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/ops.py tests/test_prosopography_git.py
git commit -m "feat: delete_person → delete_file_from_git"
```

---

## Task 7: `ops.py` — `merge_person()` git commit

**Files:**
- Modify: `server/prosopography/ops.py:1513-1525`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa test**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_merge_person_commits_source_and_target(tmp_path):
    """merge_person() peab commitama source (tombstone) + target ühes commit-is."""
    import json
    from unittest.mock import patch, MagicMock, call

    source = {"id": "vutt:Psrc", "name": {"label": "Allikas"}, "record_status": "draft",
               "updated_at": "2024-01-01T00:00:00+00:00", "relations": [], "identifiers": [],
               "import_batch_ids": [], "statuses": [], "occupations": [], "education": [],
               "sources": [], "confession": None, "birth": None, "death": None,
               "origin": {}, "gender": None, "biography": None, "notes": None, "image_url": None}
    target = {"id": "vutt:Ptgt", "name": {"label": "Sihtmärk"}, "record_status": "draft",
               "updated_at": "2024-01-01T00:00:00+00:00", "relations": [], "identifiers": [],
               "import_batch_ids": [], "statuses": [], "occupations": [], "education": [],
               "sources": [], "confession": None, "birth": None, "death": None,
               "origin": {}, "gender": None, "biography": None, "notes": None, "image_url": None}

    (tmp_path / "src.json").write_text(json.dumps(source), encoding="utf-8")
    (tmp_path / "tgt.json").write_text(json.dumps(target), encoding="utf-8")

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc"})

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.save_with_git", mock_save), \
         patch("server.prosopography.ops._update_index_entry"), \
         patch("server.prosopography.ops._update_aliases_entry"), \
         patch("server.prosopography.ops._remove_aliases_entry"), \
         patch("server.prosopography.ops.atomic_write_json"), \
         patch("server.prosopography.ops._glob.glob", return_value=[]), \
         patch("server.prosopography.ops.rebuild_indices"), \
         patch("server.prosopography.ops._load_index", return_value={"entries": []}), \
         patch("server.prosopography.ops.sync_work_to_meilisearch_async"):
        from server.prosopography import ops
        # Mock get_person to return from tmp files
        def _get_person(pid):
            nanoid = pid.removeprefix("vutt:P")
            path = tmp_path / f"{nanoid}.json"
            return json.loads(path.read_text()) if path.exists() else None
        with patch("server.prosopography.ops.get_person", side_effect=_get_person):
            ops.merge_person("vutt:Psrc", "vutt:Ptgt", "testuser")

    # Kontrollime, et save_with_git on kutsutud prosopo commitiga
    prosopo_calls = [c for c in mock_save.call_args_list
                     if "Prosopo liitmine:" in (c.kwargs.get("message", "") or "")]
    assert len(prosopo_calls) >= 1
    # Source (tombstone) peab olema primary fail
    call_args = prosopo_calls[0]
    primary_path = call_args.args[0] if call_args.args else call_args.kwargs.get("filepath", "")
    assert "src.json" in primary_path  # source on primary
```

- [ ] **Step 2: Käivita test — peab LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_merge_person_commits_source_and_target -v
```

- [ ] **Step 3: Uuenda `merge_person()` — lisa git commit pärast source+target kirjutamist**

Leia `merge_person()` read ~1510-1520:
```python
    if target_changed:
        target["updated_at"] = now
        target["updated_by"] = username
        atomic_write_json(_id_to_path(target_id), target)

    # 1. Source → tombstone
    source["record_status"] = "tombstone"
    source["merged_into"] = target_id
    source["updated_at"] = now
    source["updated_by"] = username
    atomic_write_json(_id_to_path(source_id), source)
```

Asenda kogu see blokk:
```python
    if target_changed:
        target["updated_at"] = now
        target["updated_by"] = username
        # NB: kirjutatakse allpool save_with_git-iga

    # 1. Source → tombstone
    source["record_status"] = "tombstone"
    source["merged_into"] = target_id
    source["updated_at"] = now
    source["updated_by"] = username

    # Git commit: source (primary, alati muutub) + target (additional, ainult kui muutus)
    source_name = (source.get("name") or {}).get("label") or source_id
    target_name = (target.get("name") or {}).get("label") or target_id
    additional = (
        [(_id_to_path(target_id), json.dumps(target, ensure_ascii=False, indent=2))]
        if target_changed else None
    )
    save_with_git(
        _id_to_path(source_id),
        json.dumps(source, ensure_ascii=False, indent=2),
        username,
        message=f"Prosopo liitmine: {source_name} → {target_name}",
        additional_files=additional,
    )
```

- [ ] **Step 4: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/ops.py tests/test_prosopography_git.py
git commit -m "feat: merge_person → save_with_git (source+target ühes commit-is)"
```

---

## Task 8: `router.py` — `/history`, `/diff`, `/restore` endpointid

**Files:**
- Modify: `server/prosopography/router.py`
- Test: `tests/test_prosopography_git.py`

- [ ] **Step 1: Lisa testid**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_person_history_uses_correct_relative_path():
    """person_history endpoint kutsub get_file_git_history õige suhtelise teega."""
    from unittest.mock import patch, MagicMock, AsyncMock
    import asyncio

    mock_history = [{"hash": "abc12345", "full_hash": "abc12345full", "author": "testuser",
                     "date": "2024-01-01T00:00:00", "formatted_date": "01.01.2024 00:00",
                     "message": "Prosopo muudatus: Hans [vutt:Pabc]", "is_original": False}]

    with patch("server.prosopography.router.get_file_git_history", return_value=mock_history) as mock_git:
        from server.prosopography import router as prosopo_router
        import importlib; importlib.reload(prosopo_router)
        with patch("server.prosopography.router.get_file_git_history", return_value=mock_history) as mock_git2:
            result = asyncio.run(prosopo_router.person_history("vutt:Pabc123", user={"username": "t", "role": "editor"}))

    assert result["status"] == "ok"
    called_path = mock_git2.call_args.args[0]
    assert called_path == "config/prosopography/abc123.json"


def test_compute_person_diff_used_in_diff_endpoint():
    """person_diff endpoint integreerib compute_person_diff tulemuse."""
    from unittest.mock import patch
    import asyncio, json as _json

    before = {"name": {"label": "Hans"}, "imm_year": 1640, "updated_at": "2024-01-01"}
    after  = {"name": {"label": "Hans Uus"}, "imm_year": 1641, "updated_at": "2024-06-01"}

    mock_commit = type("C", (), {"parents": []})()

    with patch("server.prosopography.router.get_file_at_commit", side_effect=[
               _json.dumps(after), _json.dumps(before)
           ]), \
         patch("server.prosopography.router.get_or_init_repo") as mock_repo:
        mock_repo.return_value.commit.return_value = mock_commit
        from server.prosopography import router as prosopo_router
        result = asyncio.run(prosopo_router.person_diff("vutt:Pabc123", commit="abc12345",
                             user={"username": "t", "role": "editor"}))

    assert result["status"] == "ok"
    fields = {c["field"] for c in result["changes"]}
    assert "name" in fields or "imm_year" in fields
```

- [ ] **Step 2: Käivita testid — peavad LÄBI KUKKUMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_person_history_uses_correct_relative_path tests/test_prosopography_git.py::test_compute_person_diff_used_in_diff_endpoint -v
```

Oodatav: FAIL (endpointid puuduvad).

- [ ] **Step 3: Lisa endpointid `server/prosopography/router.py`-sse**

Lisa faili ülaossa impordid (kui puuduvad):
```python
import json as _json_mod
import os
```

Lisa endpointid `router.py` lõppu (enne viimast `if __name__ == "__main__":` blokki kui on, muidu lihtsalt lõppu):

```python
# ── Ajalugu ja taastamine ──────────────────────────────────

@router.get("/{person_id:path}/history")
async def person_history(person_id: str, user=Depends(_require_role("editor"))):
    """Tagastab isikukaardi muudatuste ajaloo (git commitid)."""
    from ..git_ops import get_file_git_history
    nanoid = person_id.removeprefix("vutt:P")
    relative_path = f"config/prosopography/{nanoid}.json"
    history = get_file_git_history(relative_path, max_count=50)
    return {"status": "ok", "history": history}


@router.get("/{person_id:path}/diff")
async def person_diff(person_id: str, commit: str, user=Depends(_require_role("editor"))):
    """Tagastab commit-i muutunud väljade loendi võrreldes eelmise commitiga."""
    from ..git_ops import get_file_at_commit, get_or_init_repo
    from git.exc import GitCommandError
    nanoid = person_id.removeprefix("vutt:P")
    relative_path = f"config/prosopography/{nanoid}.json"

    after_content = get_file_at_commit(relative_path, commit)
    if after_content is None:
        raise HTTPException(status_code=404, detail="Commit ei leitud")

    try:
        repo = get_or_init_repo()
        commit_obj = repo.commit(commit)
        parent_hash = commit_obj.parents[0].hexsha if commit_obj.parents else None
    except Exception:
        raise HTTPException(status_code=404, detail="Commit ei leitud")

    before_content = get_file_at_commit(relative_path, parent_hash) if parent_hash else None

    try:
        after = _json_mod.loads(after_content)
        before = _json_mod.loads(before_content) if before_content else {}
    except _json_mod.JSONDecodeError:
        raise HTTPException(status_code=500, detail="JSON parse viga")

    from .ops import compute_person_diff
    return {"status": "ok", "changes": compute_person_diff(before, after)}


@router.post("/{person_id:path}/restore")
async def person_restore(person_id: str, request: Request, user=Depends(_require_role("admin"))):
    """Taastab isikukaardi antud commit-i seisule. Teeb uue git commit-i."""
    from ..git_ops import get_file_at_commit, save_with_git
    from ..config import PROSOPOGRAPHY_DIR
    from .ops import _update_index_entry, _update_aliases_entry
    from datetime import datetime, timezone

    data = await request.json()
    commit_hash = data.get("commit_hash")
    if not commit_hash:
        raise HTTPException(status_code=400, detail="commit_hash puudub")

    nanoid = person_id.removeprefix("vutt:P")
    relative_path = f"config/prosopography/{nanoid}.json"

    content = get_file_at_commit(relative_path, commit_hash)
    if content is None:
        raise HTTPException(status_code=404, detail="Commit ei leitud")

    try:
        person = _json_mod.loads(content)
    except _json_mod.JSONDecodeError:
        raise HTTPException(status_code=500, detail="JSON parse viga")

    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = user["username"]

    path = os.path.join(PROSOPOGRAPHY_DIR, f"{nanoid}.json")
    name = (person.get("name") or {}).get("label") or person_id
    save_with_git(
        path,
        _json_mod.dumps(person, ensure_ascii=False, indent=2),
        user["username"],
        message=f"Prosopo taastamine: {name} [{person_id}]",
    )

    _update_index_entry(person)
    _update_aliases_entry(person)
    return {"status": "ok", "person": person}
```

- [ ] **Step 4: Käivita testid — peavad LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/router.py tests/test_prosopography_git.py
git commit -m "feat: prosopo /history, /diff, /restore endpointid"
```

---

## Task 9: `Review.tsx` — isiku-commitide kuvamine

**Files:**
- Modify: `src/pages/Review.tsx`

- [ ] **Step 1: Laienda `RecentCommit` interface'i**

Leia interface definitsioon (rida ~39-53):
```typescript
interface RecentCommit {
  commit_hash: string;
  ...
  change_type?: 'page' | 'metadata' | 'import';
}
```

Asenda `change_type` rida ja lisa uued väljad:
```typescript
  change_type?: 'page' | 'metadata' | 'import' | 'person';
  person_id?: string | null;
  person_name?: string | null;
  work_id: string | null;  // muuda: oli string, nüüd string | null
```

- [ ] **Step 2: Lisa `UserCircle` import lucide-react-ist**

Leia lucide-react import blokk (rida ~17-33). Lisa `UserCircle`:
```typescript
import {
  Clock,
  User,
  FileText,
  UserCircle,
  ...
} from 'lucide-react';
```

- [ ] **Step 3: Uuenda commit-rea kuvamine isiku-commitite jaoks**

Leia koht kus `<FileText size={14} ...` on (rida ~755) ja kogu commit info blokk (read ~753-796). 

Selle bloki sees, asenda fikseeritud `<FileText>` ikoon ja info kuvamine:

```tsx
{/* Teos VÕI isik */}
<div className={`${isAdmin && !selectedUser ? "col-span-6" : "col-span-8"} flex items-center gap-2 min-w-0`}>
  {commit.change_type === 'person'
    ? <UserCircle size={14} className="text-indigo-400 flex-shrink-0 hidden sm:block" />
    : <FileText size={14} className="text-gray-400 flex-shrink-0 hidden sm:block" />
  }

  {commit.change_type === 'person' ? (
    <>
      <span className="text-sm text-gray-700 truncate">{commit.person_name || commit.message}</span>
      {commit.message.startsWith('Prosopo loomine:') && (
        <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded flex-shrink-0">Uus isik</span>
      )}
      {commit.message.startsWith('Prosopo muudatus:') && (
        <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">Isik</span>
      )}
      {commit.message.startsWith('Prosopo kustutamine:') && (
        <span className="text-xs text-red-700 bg-red-100 px-1.5 py-0.5 rounded flex-shrink-0">Kustutatud</span>
      )}
      {commit.message.startsWith('Prosopo liitmine:') && (
        <span className="text-xs text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded flex-shrink-0">Liitmine</span>
      )}
      {commit.message.startsWith('Prosopo taastamine:') && (
        <span className="text-xs text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded flex-shrink-0">Taastamine</span>
      )}
      {commit.message.startsWith('Prosopo migratsioon:') && (
        <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">Migratsioon</span>
      )}
    </>
  ) : (
    <>
      <span className="text-xs text-gray-500 font-mono flex-shrink-0">{commit.year || '?'}</span>
      {commit.work_author && (
        <span className="text-sm text-gray-700 flex-shrink-0 max-w-40 truncate" title={commit.work_author}>
          {commit.work_author}
        </span>
      )}
      {commit.title && (
        <span className="text-sm text-gray-500 truncate" title={commit.title}>
          {commit.title.length > 20 ? commit.title.slice(0, 20) + '…' : commit.title}
        </span>
      )}
      {commit.change_type === 'import' ? (
        <span className="text-xs text-green-700 bg-green-100 px-1.5 py-0.5 rounded flex-shrink-0">
          {t('changeType.import', 'Uus teos')}
        </span>
      ) : commit.change_type === 'metadata' ? (
        <span className="text-xs text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded flex-shrink-0">
          {t('changeType.metadata', 'Metaandmed')}
        </span>
      ) : (
        <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded flex-shrink-0">
          lk {commit.lehekylje_number}
        </span>
      )}
    </>
  )}
</div>
```

- [ ] **Step 4: Uuenda link isiku-commitide jaoks**

Leia link-blokk (rida ~785-796). Asenda:
```tsx
{/* Link */}
<div className="col-span-1 flex items-center justify-end">
  {commit.change_type === 'person' && commit.person_id ? (
    <Link
      to={`/prosopography/${encodeURIComponent(commit.person_id)}`}
      className="inline-flex items-center gap-1 p-2 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-lg transition-colors"
      title="Ava isiku kaart"
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink size={18} />
    </Link>
  ) : commit.work_id ? (
    <Link
      to={commit.change_type === 'metadata' || commit.change_type === 'import'
        ? `/work/${commit.work_id}/1`
        : `/work/${commit.work_id}/${commit.lehekylje_number}`}
      className="inline-flex items-center gap-1 p-2 text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
      title={commit.change_type === 'metadata' || commit.change_type === 'import' ? t('actions.openWork', 'Ava teos') : t('actions.openPage')}
      onClick={(e) => e.stopPropagation()}
    >
      <ExternalLink size={18} />
    </Link>
  ) : null}
</div>
```

- [ ] **Step 5: TypeScript build kontroll**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Oodatav: 0 TypeScript viga (või ainult eelnevad, mitte uued).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Review.tsx
git commit -m "feat: Review leht — isiku-commitide kuvamine (UserCircle, badge, link)"
```

---

## Task 10: `PersonDetailPage.tsx` — Ajalugu sektsioon

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx`
- Modify: `src/prosopography/services/prosopographyService.ts`

- [ ] **Step 1: Lisa API funktsioonid `prosopographyService.ts`-sse**

```typescript
// Lisa prosopographyService.ts lõppu:

export async function fetchPersonHistory(
  personId: string,
  token: string | null
): Promise<{ hash: string; full_hash: string; author: string; formatted_date: string; message: string; is_original: boolean }[]> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/history`, {
    headers: getAuthHeaders(token),
  });
  if (!resp.ok) throw new Error(`fetchPersonHistory: ${resp.status}`);
  const data = await resp.json();
  return data.history ?? [];
}

export async function fetchPersonDiff(
  personId: string,
  commitHash: string,
  token: string | null
): Promise<{ field: string; old: unknown; new: unknown }[]> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/diff?commit=${commitHash}`, {
    headers: getAuthHeaders(token),
  });
  if (!resp.ok) throw new Error(`fetchPersonDiff: ${resp.status}`);
  const data = await resp.json();
  return data.changes ?? [];
}

export async function restorePerson(
  personId: string,
  commitHash: string,
  token: string | null
): Promise<unknown> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ commit_hash: commitHash }),
  });
  if (!resp.ok) throw new Error(`restorePerson: ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 2: Lisa impordid ja state `PersonDetailPage.tsx` ülaossa**

Lisa lucide-react importide hulka (leia olemasolev import rida ~6-8):
```typescript
  History, RotateCcw, ChevronDown, ChevronRight,
```

Lisa `fetchPersonHistory`, `fetchPersonDiff`, `restorePerson` import:
```typescript
import { getPerson, updatePerson, fetchPersonHistory, fetchPersonDiff, restorePerson } from '../services/prosopographyService';
```

Lisa komponendi state-i (leia `const [works, setWorks]` tüüpi state'id):
```typescript
const [history, setHistory] = useState<{ hash: string; full_hash: string; author: string; formatted_date: string; message: string; is_original: boolean }[]>([]);
const [historyOpen, setHistoryOpen] = useState(false);
const [historyLoading, setHistoryLoading] = useState(false);
const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
const [diffCache, setDiffCache] = useState<Record<string, { field: string; old: unknown; new: unknown }[]>>({});
const [restoring, setRestoring] = useState<string | null>(null);
```

- [ ] **Step 3: Lisa `loadHistory` funktsioon komponendisse**

```typescript
const loadHistory = async () => {
  if (!id || !token || historyLoading) return;
  setHistoryLoading(true);
  try {
    const h = await fetchPersonHistory(id, token);
    setHistory(h);
    setHistoryOpen(true);
  } catch (e) {
    console.error('Ajaloo laadimine ebaõnnestus:', e);
  } finally {
    setHistoryLoading(false);
  }
};

const loadDiff = async (commitHash: string) => {
  if (!id || !token || diffCache[commitHash]) return;
  try {
    const changes = await fetchPersonDiff(id, commitHash, token);
    setDiffCache(prev => ({ ...prev, [commitHash]: changes }));
  } catch (e) {
    console.error('Diff laadimine ebaõnnestus:', e);
  }
};

const handleRestore = async (commitHash: string) => {
  if (!id || !token) return;
  if (!window.confirm('Kas oled kindel, et soovid taastada selle versiooni?')) return;
  setRestoring(commitHash);
  try {
    await restorePerson(id, commitHash, token);
    window.location.reload();
  } catch (e) {
    console.error('Taastamine ebaõnnestus:', e);
    alert('Taastamine ebaõnnestus');
  } finally {
    setRestoring(null);
  }
};
```

- [ ] **Step 4: Lisa Ajalugu sektsioon PersonDetailPage JSX-i**

Lisa JSX lõppu (pärast `{/* Märkmed */}` blokki, enne sulguvat `</div>`):

```tsx
{/* ── Ajalugu (ainult admin) ── */}
{isAdmin && id && (
  <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-6">
    <button
      onClick={() => historyOpen ? setHistoryOpen(false) : loadHistory()}
      className="w-full flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
    >
      <div className="flex items-center gap-2 text-gray-700 font-medium">
        <History size={18} className="text-gray-400" />
        {t('history', 'Muudatuste ajalugu')}
        {history.length > 0 && (
          <span className="text-xs text-gray-400 font-normal">({history.length})</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {historyLoading && <span className="text-xs text-gray-400">Laadin…</span>}
        {historyOpen ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      </div>
    </button>

    {historyOpen && history.length > 0 && (
      <div className="border-t border-gray-100 divide-y divide-gray-50">
        {history.map((commit) => (
          <div key={commit.hash} className="px-5 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs text-gray-400 font-mono flex-shrink-0">{commit.formatted_date}</span>
                <span className="text-xs text-gray-500 flex-shrink-0">{commit.author}</span>
                <span className="text-sm text-gray-700 truncate">{commit.message}</span>
                {commit.is_original && (
                  <span className="text-xs text-green-700 bg-green-50 px-1.5 py-0.5 rounded flex-shrink-0">Originaal</span>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    if (expandedCommit === commit.hash) {
                      setExpandedCommit(null);
                    } else {
                      setExpandedCommit(commit.hash);
                      loadDiff(commit.hash);
                    }
                  }}
                  className="text-xs text-gray-500 hover:text-primary-600 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                >
                  {expandedCommit === commit.hash ? 'Peida' : 'Muudatused'}
                </button>
                {!commit.is_original && (
                  <button
                    onClick={() => handleRestore(commit.full_hash)}
                    disabled={restoring === commit.full_hash}
                    className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-1"
                    title="Taasta see versioon"
                  >
                    <RotateCcw size={12} />
                    Taasta
                  </button>
                )}
              </div>
            </div>

            {expandedCommit === commit.hash && (
              <div className="mt-2 ml-2">
                {diffCache[commit.hash] ? (
                  diffCache[commit.hash].length === 0 ? (
                    <p className="text-xs text-gray-400 italic">Muudatusi ei leitud</p>
                  ) : (
                    <div className="space-y-1">
                      {diffCache[commit.hash].map((change, i) => (
                        <div key={i} className="text-xs font-mono bg-gray-50 rounded px-2 py-1">
                          <span className="text-gray-500">{change.field}: </span>
                          <span className="text-red-600">{JSON.stringify(change.old)}</span>
                          <span className="text-gray-400"> → </span>
                          <span className="text-green-600">{JSON.stringify(change.new)}</span>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="text-xs text-gray-400 italic">Laadin…</p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    )}

    {historyOpen && history.length === 0 && !historyLoading && (
      <div className="border-t border-gray-100 px-5 py-4 text-sm text-gray-400 italic">
        Ajalugu puudub
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: Kontrolli et `isAdmin` on PersonDetailPage-s olemas**

```bash
grep -n "isAdmin\|isAdmin\|role.*admin" /home/mf/LLM/VUTT/src/prosopography/pages/PersonDetailPage.tsx | head -5
```

Kui `isAdmin` puudub, lisa:
```typescript
const { user, authToken: token } = useUser();
const isAdmin = user?.role === 'admin';
```

- [ ] **Step 6: TypeScript build kontroll**

```bash
cd /home/mf/LLM/VUTT && npm run build 2>&1 | tail -20
```

Oodatav: 0 TypeScript viga.

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx src/prosopography/services/prosopographyService.ts
git commit -m "feat: PersonDetailPage — Ajalugu sektsioon (admin) koos diff+taastamisega"
```

---

## Task 11: Migratsiooniskript + deploy

**Files:**
- Create: `scripts/migrate_prosopography_to_git.py`

- [ ] **Step 1: Loo migratsiooniskript**

```python
#!/usr/bin/env python3
"""
Migreerib prosopograafia isikukaardid state/prosopography/ → data/config/prosopography/
ja loob git-initsiaalse commit-i.

Käivita AINULT ÜKS KORD serveris:
    .venv/bin/python3 scripts/migrate_prosopography_to_git.py

Skript on idempotentne — kui failid on juba sihtkohas, ei tee kahju.
"""
import os
import sys
import shutil
import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def migrate():
    from server.config import PROSOPOGRAPHY_DIR, STATE_DIR, DATA_CONFIG_DIR
    from server.git_ops import get_or_init_repo
    from git import Actor

    src_dir = Path(STATE_DIR) / "prosopography"
    dst_dir = Path(PROSOPOGRAPHY_DIR)

    if not src_dir.exists():
        print(f"Lähtekausta {src_dir} ei leitud — midagi migreerida pole.")
        return

    dst_dir.mkdir(parents=True, exist_ok=True)

    json_files = list(src_dir.glob("*.json"))
    print(f"Leitud {len(json_files)} isikukaarti {src_dir}")

    copied = 0
    skipped = 0
    for src_file in json_files:
        dst_file = dst_dir / src_file.name
        if dst_file.exists():
            skipped += 1
            continue
        shutil.copy2(str(src_file), str(dst_file))
        copied += 1

    print(f"Kopeeritud: {copied}, vahele jäetud (juba olemas): {skipped}")

    if copied == 0:
        print("Kõik failid on juba sihtkohas — git commit vahele jäetud.")
        return

    # Git commit
    repo = get_or_init_repo()
    relative_files = [
        os.path.relpath(str(dst_dir / f.name), str(Path(repo.working_dir)))
        for f in json_files
        if (dst_dir / f.name).exists()
    ]
    repo.index.add(relative_files)
    actor = Actor("VUTT Server", "vutt@vutt.local")
    total = len(json_files)
    repo.index.commit(
        f"Prosopo migratsioon: {total} isikut",
        author=actor,
        committer=actor,
    )
    print(f"Git commit tehtud: Prosopo migratsioon: {total} isikut")
    print("Migratsioon valmis.")


if __name__ == "__main__":
    migrate()
```

- [ ] **Step 2: Testi skripti tmp_path-ga**

```python
# Lisa tests/test_prosopography_git.py lõppu:

def test_migration_script(tmp_path):
    """Migratsiooniskript kopeerib failid ja teeb git commit-i."""
    import importlib.util, git, json

    state_prosopo = tmp_path / "state" / "prosopography"
    state_prosopo.mkdir(parents=True)
    data_config = tmp_path / "data" / "config"
    data_config.mkdir(parents=True)

    # Loo 2 isikufaili lähtekaustas
    (state_prosopo / "abc123.json").write_text('{"id": "vutt:Pabc123"}', encoding="utf-8")
    (state_prosopo / "xyz456.json").write_text('{"id": "vutt:Pxyz456"}', encoding="utf-8")

    # Initsialiseeri git repo data/ all
    repo = git.Repo.init(str(tmp_path / "data"))

    from unittest.mock import patch
    with patch("server.config.PROSOPOGRAPHY_DIR", str(data_config / "prosopography")), \
         patch("server.config.STATE_DIR", str(tmp_path / "state")), \
         patch("server.config.DATA_CONFIG_DIR", str(data_config)), \
         patch("server.git_ops.get_or_init_repo", return_value=repo), \
         patch("server.git_ops.BASE_DIR", str(tmp_path / "data")):
        spec = importlib.util.spec_from_file_location("migrate", PROJECT_ROOT / "scripts" / "migrate_prosopography_to_git.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.migrate()

    dst_dir = data_config / "prosopography"
    assert (dst_dir / "abc123.json").exists()
    assert (dst_dir / "xyz456.json").exists()
    assert "migratsioon" in repo.head.commit.message.lower()
```

- [ ] **Step 3: Käivita test — peab LÄBIMA**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py::test_migration_script -v
```

- [ ] **Step 4: Käivita kõik testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_prosopography_git.py -v
```

Oodatav: kõik PASSED.

- [ ] **Step 5: Commit kood**

```bash
git add scripts/migrate_prosopography_to_git.py tests/test_prosopography_git.py
git commit -m "feat: prosopo migratsiooniskript + testid"
```

- [ ] **Step 6: Build ja frontend deploy**

```bash
cd /home/mf/LLM/VUTT && npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Step 7: Backend deploy serveris**

```bash
ssh vutt
cd ~/VUTT
./scripts/server_update.sh
```

- [ ] **Step 8: Käivita migratsiooniskript serveris (AINULT ÜKS KORD)**

```bash
ssh vutt
cd ~/VUTT
.venv/bin/python3 scripts/migrate_prosopography_to_git.py
```

Oodatav väljund: `Kopeeritud: ~2218, vahele jäetud: 0` ja `Git commit tehtud: Prosopo migratsioon: 2218 isikut`

- [ ] **Step 9: Kontrolli Review lehel et isiku-commitid on nähtavad**

Mine `https://vutt.site/review` ja kontrolli, et migratsiooni commit ilmub voos.
