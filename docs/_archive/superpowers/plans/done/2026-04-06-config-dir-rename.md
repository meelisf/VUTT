# Kataloogistruktuuri korrashoid — Implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eralda konfiguratsioon (`data/state/` → `data/config/`) ja kasutaja runtime seaded (`state/user_settings/`) selgelt, ning migreeri vana `user_chars/` formaat `user_settings/`-i sisse.

**Architecture:** Kolm muudatust paralleelselt: (1) `server/config.py` nimetused, (2) `server/main.py` kasutaja seadete tee, (3) serveril migratsiooniskript + `data/` sisemine git rename. Koodimuudatused on puhtalt tee-muutused — käitumine ei muutu.

**Tech Stack:** Python 3.9+, pytest

---

## Failide kaart

| Fail | Muudatus |
|------|----------|
| `server/config.py` | `_DATA_STATE_DIR` → `_DATA_CONFIG_DIR`; lisa `USER_SETTINGS_DIR` |
| `server/main.py` | impordi `USER_SETTINGS_DIR`; kasuta kahes funktsioonis |
| `server/prosopography/work_relations_ops.py` | uuenda kommentaar |
| `tests/conftest.py` | eemalda `user_chars_dir`, lisa `user_settings_dir` + monkeypatch |
| `tests/test_backend_smoke.py` | kasuta `user_settings_dir` fixture'i |
| `scripts/migrate_user_settings.py` | **Uus** — migratsiooniskript serverile |
| `CLAUDE.md` | uuenda kõik `data/state/` → `data/config/` viited |

---

## Task 1: Uuenda server/config.py

**Files:**
- Modify: `server/config.py:85-95`

- [ ] **Samm 1: Asenda `_DATA_STATE_DIR` blokk**

Ava `server/config.py`. Leia read 85–95:

```python
# Andmefailid — data/state/ kaustas (sisemises gitis)
_DATA_STATE_DIR = os.path.join(BASE_DIR, "state")
DATA_STATE_DIR = _DATA_STATE_DIR  # Ekspordi kasutamiseks teistes moodulites
COLLECTIONS_FILE = os.path.join(_DATA_STATE_DIR, "collections.json")
VOCABULARIES_FILE = os.path.join(_DATA_STATE_DIR, "vocabularies.json")
PERSON_ALIASES_FILE = os.path.join(_DATA_STATE_DIR, "person_aliases.json")
LABELS_FILE = os.path.join(_DATA_STATE_DIR, "labels.json")
PLACES_FILE = os.path.join(_DATA_STATE_DIR, "places.json")
PROSOPOGRAPHY_INDEX_FILE = os.path.join(_DATA_STATE_DIR, "prosopography_index.json")
PERSON_TO_WORKS_FILE = os.path.join(_DATA_STATE_DIR, "person_to_works.json")
WORKS_CREATORS_INDEX_FILE = os.path.join(_DATA_STATE_DIR, "works_creators_index.json")
```

Asenda:

```python
# Konfiguratsioonifailid — data/config/ kaustas (sisemises gitis)
_DATA_CONFIG_DIR = os.path.join(BASE_DIR, "config")
DATA_CONFIG_DIR = _DATA_CONFIG_DIR  # Ekspordi kasutamiseks teistes moodulites
COLLECTIONS_FILE = os.path.join(_DATA_CONFIG_DIR, "collections.json")
VOCABULARIES_FILE = os.path.join(_DATA_CONFIG_DIR, "vocabularies.json")
PERSON_ALIASES_FILE = os.path.join(_DATA_CONFIG_DIR, "person_aliases.json")
LABELS_FILE = os.path.join(_DATA_CONFIG_DIR, "labels.json")
PLACES_FILE = os.path.join(_DATA_CONFIG_DIR, "places.json")
PROSOPOGRAPHY_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "prosopography_index.json")
PERSON_TO_WORKS_FILE = os.path.join(_DATA_CONFIG_DIR, "person_to_works.json")
WORKS_CREATORS_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "works_creators_index.json")

# Kasutaja runtime seaded — state/user_settings/ kaustas (ei ole gitis)
USER_SETTINGS_DIR = os.path.join(_STATE_DIR, "user_settings")
```

- [ ] **Samm 2: Commit**

```bash
git add server/config.py
git commit -m "refactor: nimeta DATA_STATE_DIR → DATA_CONFIG_DIR, lisa USER_SETTINGS_DIR"
```

---

## Task 2: Uuenda server/main.py

**Files:**
- Modify: `server/main.py:13` (import rida)
- Modify: `server/main.py:1219–1236` (`_get_user_settings_path` ja `_save_user_settings`)

- [ ] **Samm 1: Lisa USER_SETTINGS_DIR importi**

Leia rida 13:
```python
from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, COLLECTIONS_FILE, get_logger
```

Asenda:
```python
from .config import PORT, ALLOWED_ORIGINS, BASE_DIR, UPLOAD_ENABLED, UPLOADS_DIR, COLLECTIONS_FILE, USER_SETTINGS_DIR, get_logger
```

- [ ] **Samm 2: Uuenda `_get_user_settings_path` ja `_save_user_settings`**

Leia read 1219–1236:
```python
def _get_user_settings_path(username: str) -> str:
    """Tagastab kasutaja seadete faili tee."""
    return os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_settings', f"{username}.json")

def _load_user_settings(username: str) -> dict:
    """Laeb kasutaja seaded failist."""
    path = _get_user_settings_path(username)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def _save_user_settings(username: str, settings: dict):
    """Salvestab kasutaja seaded faili."""
    dir_path = os.path.join(os.path.dirname(COLLECTIONS_FILE), 'user_settings')
    os.makedirs(dir_path, exist_ok=True)
    path = _get_user_settings_path(username)
    atomic_write_json(path, settings)
```

Asenda `_get_user_settings_path` ja `_save_user_settings` (jäta `_load_user_settings` puutumata):

```python
def _get_user_settings_path(username: str) -> str:
    """Tagastab kasutaja seadete faili tee."""
    return os.path.join(USER_SETTINGS_DIR, f"{username}.json")

def _load_user_settings(username: str) -> dict:
    """Laeb kasutaja seaded failist."""
    path = _get_user_settings_path(username)
    if os.path.exists(path):
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def _save_user_settings(username: str, settings: dict):
    """Salvestab kasutaja seaded faili."""
    os.makedirs(USER_SETTINGS_DIR, exist_ok=True)
    path = _get_user_settings_path(username)
    atomic_write_json(path, settings)
```

- [ ] **Samm 3: Commit**

```bash
git add server/main.py
git commit -m "refactor: kasuta USER_SETTINGS_DIR user_settings tee jaoks"
```

---

## Task 3: Uuenda testid

**Files:**
- Modify: `tests/conftest.py`
- Modify: `tests/test_backend_smoke.py`

- [ ] **Samm 1: Uuenda conftest.py fixture**

Leia read 24–25:
```python
    user_chars_dir = state_dir / "user_chars"
    user_chars_dir.mkdir()
```

Asenda:
```python
    user_settings_dir = state_dir / "user_settings"
    user_settings_dir.mkdir()
```

Leia rida 86 (monkeypatch blokk):
```python
    monkeypatch.setattr(main, "COLLECTIONS_FILE", str(collections_file))
```

Lisa selle järele:
```python
    monkeypatch.setattr(main, "USER_SETTINGS_DIR", str(user_settings_dir))
```

Leia rida 112 (return dict):
```python
            "user_chars_dir": user_chars_dir,
```

Asenda:
```python
            "user_settings_dir": user_settings_dir,
```

- [ ] **Samm 2: Uuenda test_backend_smoke.py**

Leia rida 39:
```python
    saved_file = backend_env["collections_file"].parent / "user_settings" / "editor.json"
```

Asenda:
```python
    saved_file = backend_env["user_settings_dir"] / "editor.json"
```

- [ ] **Samm 3: Käivita testid**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/pytest tests/ -v 2>&1 | tail -15
```

Oodatav: `38 passed`.

- [ ] **Samm 4: Commit**

```bash
git add tests/conftest.py tests/test_backend_smoke.py
git commit -m "refactor: uuenda testid kasutama user_settings_dir fixture'i"
```

---

## Task 4: Uuenda kommentaar work_relations_ops.py

**Files:**
- Modify: `server/prosopography/work_relations_ops.py:4`

- [ ] **Samm 1: Uuenda docstring**

Leia rida 4:
```python
Indeks: data/state/works_creators_index.json
```

Asenda:
```python
Indeks: data/config/works_creators_index.json
```

- [ ] **Samm 2: Commit**

```bash
git add server/prosopography/work_relations_ops.py
git commit -m "docs: uuenda data/state viide data/config-iks"
```

---

## Task 5: Kirjuta migratsiooniskript

**Files:**
- Create: `scripts/migrate_user_settings.py`

- [ ] **Samm 1: Loo skript**

Loo `scripts/migrate_user_settings.py`:

```python
#!/usr/bin/env python3
"""
Migreerib kasutaja andmed uude struktuuri.

Jooksuta serveril ENNE uue koodi deployd:
  ssh vutt
  cd ~/VUTT
  python3 scripts/migrate_user_settings.py

Teeb järgmist:
  1. Mergib state/user_chars/{user}.json → state/user_settings/{user}.json
  2. Mergib data/state/user_settings/{user}.json → state/user_settings/{user}.json
  3. Nimetab vanad kaustad .bak laiendiga ümber (ei kustuta kohe)
"""
import json
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
STATE_DIR = BASE / "state"
USER_CHARS_DIR = STATE_DIR / "user_chars"
USER_SETTINGS_DIR = STATE_DIR / "user_settings"
DATA_STATE_USER_SETTINGS = BASE / "data" / "state" / "user_settings"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    USER_SETTINGS_DIR.mkdir(exist_ok=True)
    merged_users: set = set()

    # Samm 1: user_chars → user_settings (characters)
    if USER_CHARS_DIR.exists():
        for f in sorted(USER_CHARS_DIR.glob("*.json")):
            username = f.stem
            old = _load(f)
            target = USER_SETTINGS_DIR / f"{username}.json"
            existing = _load(target)
            if "characters" in old and "characters" not in existing:
                existing["characters"] = old["characters"]
                print(f"  [{username}] characters migreeritud user_chars → user_settings")
            _save(target, existing)
            merged_users.add(username)

    # Samm 2: data/state/user_settings → state/user_settings (ülejäänud võtmed)
    if DATA_STATE_USER_SETTINGS.exists():
        for f in sorted(DATA_STATE_USER_SETTINGS.glob("*.json")):
            username = f.stem
            old = _load(f)
            target = USER_SETTINGS_DIR / f"{username}.json"
            existing = _load(target)
            added = []
            for key, value in old.items():
                if key not in existing:
                    existing[key] = value
                    added.append(key)
            if added:
                print(f"  [{username}] lisatud data/state/user_settings-st: {added}")
            _save(target, existing)
            merged_users.add(username)

    if not merged_users:
        print("Migreerida pole midagi.")
        return

    print(f"\nMigreeritud kasutajad: {sorted(merged_users)}")

    # Samm 3: nimeta vanad kaustad .bak-iks
    if USER_CHARS_DIR.exists():
        bak = STATE_DIR / "user_chars.bak"
        shutil.move(str(USER_CHARS_DIR), str(bak))
        print(f"Varundatud: state/user_chars → state/user_chars.bak")

    if DATA_STATE_USER_SETTINGS.exists():
        bak = BASE / "data" / "state" / "user_settings.bak"
        shutil.move(str(DATA_STATE_USER_SETTINGS), str(bak))
        print(f"Varundatud: data/state/user_settings → data/state/user_settings.bak")

    print("\nMigratsioon valmis. Kontrolli state/user_settings/ sisu enne .bak kaustade kustutamist.")


if __name__ == "__main__":
    main()
```

- [ ] **Samm 2: Commit**

```bash
git add scripts/migrate_user_settings.py
git commit -m "feat: lisa user_settings migratsiooniskript"
```

---

## Task 6: Uuenda CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Samm 1: Uuenda kõik `data/state/` viited `data/config/`-iks**

Muuda järgmised read:

Andmeasukohade tabel (rida ~56):
```markdown
| `~/VUTT/data/` | `./data:/data` | Teosed, leheküljed, `data/state/` konfiguratsioon | Sisemises gitis (`data/` oma git) | Ei |
```
→
```markdown
| `~/VUTT/data/` | `./data:/data` | Teosed, leheküljed, `data/config/` konfiguratsioon | Sisemises gitis (`data/` oma git) | Ei |
```

Kriitiliste teede tabel (read ~85):
```markdown
- `data/state/` (hostil) = `/data/state/` (Dockeris) — konfiguratsioon (`collections.json` jne) ← `VUTT_DATA_DIR/state`
- `state/` (hostil) = `/app/state/` (Dockeris) — runtime (`users.json`, sessioonid) ← MITTE konfiguratsioon
```
→
```markdown
- `data/config/` (hostil) = `/data/config/` (Dockeris) — konfiguratsioon (`collections.json` jne) ← `VUTT_DATA_DIR/config`
- `state/` (hostil) = `/app/state/` (Dockeris) — runtime (`users.json`, sessioonid, `user_settings/`) ← MITTE konfiguratsioon
```

Skriptide näide (rida ~78):
```python
STATE_DIR = os.path.join(DATA_ROOT_DIR, "state")   # ← ÕIGE
```
→
```python
CONFIG_DIR = os.path.join(DATA_ROOT_DIR, "config")   # ← ÕIGE
```

`data/state/` sisaldab sektsioon (rida ~58) — muuda pealkiri ja viited:
```markdown
**`data/state/` sisaldab** (backend loeb/kirjutab siia Dockerist):
```
→
```markdown
**`data/config/` sisaldab** (backend loeb/kirjutab siia Dockerist):
```

scp näide (rida ~74):
```bash
scp vutt:~/VUTT/data/state/collections.json ./data-state-backup/
```
→
```bash
scp vutt:~/VUTT/data/config/collections.json ./data-config-backup/
```

Key Files tabel rida ~118:
```markdown
| `data/state/` | Konfiguratsioon ...
```
→
```markdown
| `data/config/` | Konfiguratsioon ...
```

Collections config rida ~135:
```markdown
**Config:** `data/state/collections.json`
```
→
```markdown
**Config:** `data/config/collections.json`
```

Person Aliases rida ~162 ja ~167:
```markdown
**File:** `data/state/person_aliases.json`
...
3. Aliases are saved to `data/state/person_aliases.json`
```
→
```markdown
**File:** `data/config/person_aliases.json`
...
3. Aliases are saved to `data/config/person_aliases.json`
```

Lisa `state/` tabeli reale juurde `user_settings/`:
```markdown
| `~/VUTT/state/` | `/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `prosopography/` isikukaardid | Ei | Ei (ainult serveril) |
```
→
```markdown
| `~/VUTT/state/` | `/app/state` | Runtime: `users.json`, sessioonid, tokenid, `reocr_log.json`, `prosopography/` isikukaardid, `user_settings/` | Ei | Ei (ainult serveril) |
```

- [ ] **Samm 2: Käivita testid — kontrolli et kõik ikka rohelised**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/pytest tests/ 2>&1 | tail -5
```

Oodatav: `38 passed`.

- [ ] **Samm 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: uuenda CLAUDE.md — data/state → data/config, user_settings runtime"
```

---

## Task 7: Deploy ja migratsioon serveril (manuaalsed sammud)

Need sammud jooksuta **serveril**, mitte lokaalses masinas.

- [ ] **Samm 1: Jooksuta migratsiooniskript**

```bash
ssh vutt
cd ~/VUTT
git pull
python3 scripts/migrate_user_settings.py
```

Oodatav väljund:
```
  [meelis] characters migreeritud user_chars → user_settings
  [meelis] lisatud data/state/user_settings-st: []   (või konkreetsed võtmed)
  [raheltoomik] characters migreeritud user_chars → user_settings

Migreeritud kasutajad: ['meelis', 'raheltoomik']
Varundatud: state/user_chars → state/user_chars.bak
Varundatud: data/state/user_settings → data/state/user_settings.bak
```

- [ ] **Samm 2: Kontrolli tulemust**

```bash
cat ~/VUTT/state/user_settings/meelis.json | python3 -m json.tool | head -10
cat ~/VUTT/state/user_settings/raheltoomik.json | python3 -m json.tool | head -10
```

Meelisel peaksid olema `characters` + `default_tab`. Raheltoomikul `characters`.

- [ ] **Samm 3: Nimeta data/state → data/config siseemises gitis**

```bash
cd ~/VUTT/data
git mv state config
git commit -m "refactor: nimeta state → config (konfiguratsioonifailid)"
```

- [ ] **Samm 4: Deploy uus kood**

```bash
cd ~/VUTT
docker compose build --no-cache backend && docker compose up -d backend
```

- [ ] **Samm 5: Kontrolli logid**

```bash
docker logs vutt-backend --tail 20
```

Oodatav: server käivitub vigadeta. Vaata, et ei ole `FileNotFoundError` ega `No such file or directory` vigu.

- [ ] **Samm 6: Testi kasutajana**

Logi sisse, kontrolli et erimärgid on alles ja default_tab töötab.

- [ ] **Samm 7: Puhasta .bak kaustad (kui kõik töötab)**

```bash
rm -rf ~/VUTT/state/user_chars.bak
rm -rf ~/VUTT/data/config/user_settings.bak  # NB: pärast git mv on see data/config/ all
```
