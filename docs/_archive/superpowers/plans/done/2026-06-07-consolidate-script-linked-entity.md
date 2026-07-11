# LinkedEntity utiliitide konsolideerimine indekseerimise skriptis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eemaldada `scripts/1-1_consolidate_data.py`-st 7 duplikaatfunktsiooni ja asendada need `server/utils.py` importiga; lisada `labels.json` kanooniline register indekseerimisse.

**Architecture:** Skript laeb `server.utils` mooduli fake-package mustriga (väldib `server/__init__.py` kõrvalefekte — FastAPI, gitpython jms). `labels.json` laaditakse käivitusel koos teiste konfifailidega ja edastatakse kõigile `get_labels_by_lang` väljakutsetele.

**Tech Stack:** Python 3.9+, `types.ModuleType`, `importlib` (stdlib)

---

## Failide kaart

| Fail | Muudatus |
|------|----------|
| `scripts/1-1_consolidate_data.py` | Import lisamine, duplikaadid eemaldamine, labels_store laadimine ja edastamine |
| `tests/test_consolidate_data.py` | Üks uus test: `labels_store` tuge kontrolliv |

`server/utils.py` — **ei muutu**.

---

### Task 1: Kirjuta ebaõnnestuv test

**Files:**
- Modify: `tests/test_consolidate_data.py`

- [ ] **Samm 1: Lisada test klassi `TestLabelsStore`**

Lisa `tests/test_consolidate_data.py` faili lõppu:

```python
class TestLabelsStore:
    """Kontrollib, et skript kasutab labels_store kanoonilisi silte."""

    def _load(self):
        spec = importlib.util.spec_from_file_location("consolidate_data", _script_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod

    def test_get_labels_by_lang_uses_labels_store(self):
        mod = self._load()
        entity = {'id': 'Q999', 'label': 'Vana Silt', 'labels': {'et': 'Vana Silt'}}
        labels_store = {'Q999': {'et': 'Kanooniline Silt'}}
        result = mod.get_labels_by_lang(entity, 'et', labels_store)
        assert result == ['Kanooniline Silt'], (
            f"labels_store-ist peaks tulema 'Kanooniline Silt', sain: {result}"
        )
```

- [ ] **Samm 2: Käivita test ja veendu, et ebaõnnestub**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_consolidate_data.py::TestLabelsStore -v
```

Oodatud: `FAILED` — `TypeError: get_labels_by_lang() takes 2 positional arguments but 3 were given`

---

### Task 2: Lisa import, eemalda duplikaadid

**Files:**
- Modify: `scripts/1-1_consolidate_data.py`

- [ ] **Samm 1: Lisa `sys` ja `types` stdlib-importide hulka (rida 18)**

Asenda:
```python
import os
import json
import re
import unicodedata
from tqdm import tqdm
```

Sellega:
```python
import os
import sys
import json
import re
import types
import unicodedata
from tqdm import tqdm
```

- [ ] **Samm 2: Lisa fake-package import pärast seadistuse blokki (pärast rida 31 `# --- LÕPP ---`)**

```python
# Impordime LinkedEntity utiliidid server/utils.py-st.
# Kasutame fake-package mustrit, et vältida server/__init__.py kõrvalefekte
# (FastAPI, gitpython, kasutajate cache jms).
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if 'server' not in sys.modules:
    _server_pkg = types.ModuleType('server')
    _server_pkg.__path__ = [os.path.join(_project_root, 'server')]
    _server_pkg.__package__ = 'server'
    sys.modules.setdefault('server', _server_pkg)
sys.path.insert(0, _project_root)
from server.utils import (
    capitalize_first, get_label, get_id, get_all_labels,
    get_primary_labels, get_labels_by_lang, get_all_ids
)
```

- [ ] **Samm 3: Eemalda duplikaatfunktsioonide blokk (read 203–330)**

Eemalda kogu järgnev plokk (7 funktsiooni, ~130 rida):

```python
def capitalize_first(text):
    ...

def get_label(value, lang='et'):
    ...

def get_id(value):
    ...

def get_all_labels(value):
    ...

def get_primary_labels(value):
    ...

def get_labels_by_lang(value, lang):
    ...

def get_all_ids(value):
    ...
```

Pärast eemaldamist peaks `get_work_metadata` definitsioon olema esimene funktsioon peale `get_collection_hierarchy` (kahe tühja reaga eraldatuna).

- [ ] **Samm 4: Käivita test ja veendu, et läbib**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_consolidate_data.py::TestLabelsStore -v
```

Oodatud: `PASSED`

- [ ] **Samm 5: Käivita kõik olemasolevad testid, veendu, et regressioone pole**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_consolidate_data.py -v
```

Oodatud: kõik `PASSED`

- [ ] **Samm 6: Commit**

```bash
git add scripts/1-1_consolidate_data.py tests/test_consolidate_data.py
git commit -m "Consolidate LinkedEntity utils: import from server/utils instead of local copies"
```

---

### Task 3: Lisa `labels.json` laadimine

**Files:**
- Modify: `scripts/1-1_consolidate_data.py`

- [ ] **Samm 1: Lisa `LABELS_FILE` konstant seadistuse blokki**

Seadistuse blokis (read 24–31) on juba `COLLECTIONS_FILE`, `PEOPLE_FILE`, `ARCHIVES_FILE`. Lisa neile järele:

```python
LABELS_FILE = os.path.join(CONFIG_DIR, 'labels.json')
```

- [ ] **Samm 2: Lisa `labels_store` laadimine `create_meilisearch_data_per_page()` funktsiooni algusse**

Praegu on read 454–458:
```python
    # Laeme kollektsioonid hierarhia jaoks
    collections = load_collections()
    people_data = load_people_aliases()
    archives = load_archives()
    print(f"Laetud {len(collections)} kollektsiooni, {len(people_data)} isiku andmed, {len(archives)} arhiivi")
```

Asenda sellega:
```python
    # Laeme kollektsioonid hierarhia jaoks
    collections = load_collections()
    people_data = load_people_aliases()
    archives = load_archives()
    labels_store = {}
    if os.path.exists(LABELS_FILE):
        with open(LABELS_FILE, 'r', encoding='utf-8') as _lf:
            labels_store = json.load(_lf)
    print(f"Laetud {len(collections)} kollektsiooni, {len(people_data)} isiku andmed, "
          f"{len(archives)} arhiivi, {len(labels_store)} kanoonilise sildi kirjet")
```

- [ ] **Samm 3: Käivita testid — ei tohi regressioone**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_consolidate_data.py -v
```

Oodatud: kõik `PASSED`

- [ ] **Samm 4: Commit**

```bash
git add scripts/1-1_consolidate_data.py
git commit -m "Load labels.json canonical label store in indexing script"
```

---

### Task 4: Edasta `labels_store` `get_labels_by_lang` väljakutsetele

**Files:**
- Modify: `scripts/1-1_consolidate_data.py`

8 väljakutset vajavad `labels_store` lisamist. Kõik asuvad `create_meilisearch_data_per_page()` sees — `labels_store` on selles punktis juba määratud (Task 3).

- [ ] **Samm 1: Uuenda 8 `get_labels_by_lang` väljakutset**

Leia ja asenda järgmised read (read 576–623, ligikaudu):

| Enne | Pärast |
|------|--------|
| `get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'et')` | `get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'et', labels_store)` |
| `get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'en')` | `get_labels_by_lang(doc_metadata.get('type', 'impressum'), 'en', labels_store)` |
| `get_labels_by_lang(doc_metadata.get('genre'), 'et')` | `get_labels_by_lang(doc_metadata.get('genre'), 'et', labels_store)` |
| `get_labels_by_lang(doc_metadata.get('genre'), 'en')` | `get_labels_by_lang(doc_metadata.get('genre'), 'en', labels_store)` |
| `get_labels_by_lang(doc_metadata.get('tags', []), 'et')` | `get_labels_by_lang(doc_metadata.get('tags', []), 'et', labels_store)` |
| `get_labels_by_lang(doc_metadata.get('tags', []), 'en')` | `get_labels_by_lang(doc_metadata.get('tags', []), 'en', labels_store)` |
| `get_labels_by_lang(page_meta.get('tags', []), 'et')` | `get_labels_by_lang(page_meta.get('tags', []), 'et', labels_store)` |
| `get_labels_by_lang(page_meta.get('tags', []), 'en')` | `get_labels_by_lang(page_meta.get('tags', []), 'en', labels_store)` |

- [ ] **Samm 2: Käivita kõik testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m pytest tests/test_consolidate_data.py -v
```

Oodatud: kõik `PASSED`

- [ ] **Samm 3: Kontrolli, et skript käivitub süntaksiviradata**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m py_compile scripts/1-1_consolidate_data.py && echo "OK"
```

Oodatud: `OK`

- [ ] **Samm 4: Final commit**

```bash
git add scripts/1-1_consolidate_data.py
git commit -m "Pass labels_store to all get_labels_by_lang calls in indexing script"
```

---

### Task 5: Serveris deploy ja smoke-test

- [ ] **Samm 1: Push lokaalsetest muudatustest**

```bash
git push
```

- [ ] **Samm 2: Serveris — pull ja reindekseerimine**

```bash
ssh vutt
cd ~/VUTT
git pull
./scripts/server_seed_data.sh
```

Oodatud: skript prindib `Laetud X kollektsiooni, Y isiku andmed, Z arhiivi, N kanoonilise sildi kirjet` — `N` peaks olema > 0 kui `labels.json` on olemas.

- [ ] **Samm 3: Veendu, et Meilisearch indeks uuendati**

```bash
docker logs vutt-backend --tail 20
```

Oodatud: viimased logid ei näita veidu ja indekseerimine lõppes edukalt.
