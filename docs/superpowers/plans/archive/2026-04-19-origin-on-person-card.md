# Päritolukoht isikukaardil — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lisada isikukaardile hierarhiline päritolukoha mudel (`origin.place` → `places.json` register), kuvada see PersonCard-il, ning asendada PersonsPage amet-filter päritolugrupi filtriga.

**Architecture:** Backend laeb `places.json` + `origin_groups.json` konfiguratsioonifailidest (cache TTL 5 min), tuletab grupi transitiivse parent-ahela kaudu, lisab indeksisse 5 uut välja. Frontend saab uue `PlacePicker` komponendi, PersonCard kuvab `place · parent` tekstina, PersonsPage URL param `occupation` → `origin_group`. Migratsiooniskript teisendab vana `origin.city`/`origin.region` → `origin.place`.

**Tech Stack:** Python 3.9 (FastAPI backend), React 19 + TypeScript (frontend), pytest (TDD), i18next (tõlked)

---

## Failide kaart

### Uued failid
| Fail | Vastutus |
|------|----------|
| `server/prosopography/places_ops.py` | Places cache, abifunktsioonid, propagatsioon, endpointide loogika |
| `tests/test_places_ops.py` | TDD testid places_ops jaoks |
| `src/prosopography/components/personForm/PlacePicker.tsx` | Päritolukoha valikukomponent inline-lisamisega |
| `scripts/migrate_origin_dry_run.py` | Analüüsib mis `origin.city/region` väärtused pole places.json-s |
| `scripts/migrate_origin.py` | Tegelik migratsioon isikufailides |

### Muudetavad failid
| Fail | Muutus |
|------|--------|
| `data/config/origin_groups.json` | Uus konfiguratsioonifail (loob Task 1) |
| `data/config/places.json` | Lisa `group`, `type` väljad kirjetele (Task 1) |
| `server/prosopography/ops.py` | `_index_entry_from_person`, `list_persons`, `get_person_facets`, `create_person`, `update_person` |
| `server/prosopography/router.py` | Lisa `GET /places`, `GET /places/meta`, `PUT /admin/places/{key}` |
| `server/config.py` | Lisa `ORIGIN_GROUPS_FILE` konstant |
| `src/prosopography/types.ts` | `ProsopoIndexEntry` + `ProsopoRecord` uued väljad |
| `src/prosopography/components/personForm/types.ts` | `FormDraft.origin_place` |
| `src/prosopography/components/personForm/helpers.ts` | `recordToDraft`, `draftToPayload` |
| `src/prosopography/pages/PersonEditPage.tsx` | Lisa `PlacePicker` päritolukoha jaoks |
| `src/prosopography/components/PersonCard.tsx` | Kuva `origin_place_labels · origin_parent.labels` |
| `src/prosopography/pages/PersonsPage.tsx` | `occupation` → `origin_group` |
| `src/prosopography/components/PersonAdvancedFilters.tsx` | Amet → Päritolugrupp |
| `src/prosopography/services/prosopographyService.ts` | `listPersons`, `getPersonFacets`, lisa `fetchPlaces`, `addPlace` |
| `src/locales/et/prosopography.json` | Uued tõlkevõtmed |
| `src/locales/en/prosopography.json` | Uued tõlkevõtmed |

---

## Task 1: Konfiguratsioonifailid serveril

**Files:**
- Create: `data/config/origin_groups.json`
- Modify: `data/config/places.json` (serveril — lisa `group` + `type` väljad)
- Modify: `server/config.py:88-95`

### Kontekst
`places.json` on serveril (`/data/config/places.json` Dockeris). Lokaalselt on vaid viide `server/config.py`-s. Migratsioon käivitatakse serveril. Config.py-s on `PLACES_FILE` juba olemas — lisame `ORIGIN_GROUPS_FILE`.

- [ ] **Samm 1: Lisa `ORIGIN_GROUPS_FILE` config.py-sse**

```python
# server/config.py — lisa PLACES_FILE järele:
ORIGIN_GROUPS_FILE = os.path.join(_DATA_CONFIG_DIR, "origin_groups.json")
```

- [ ] **Samm 2: Loo `origin_groups.json` serveril**

SSH serverisse ja loo fail:
```bash
ssh vutt
cat > ~/VUTT/data/config/origin_groups.json << 'EOF'
{
  "Liivimaa": {
    "labels": { "et": "Liivimaa", "en": "Livonia", "de": "Livland", "la": "Livonia" },
    "sort_order": 10
  },
  "Kuramaa": {
    "labels": { "et": "Kuramaa", "en": "Courland", "de": "Kurland", "la": "Curlandia" },
    "sort_order": 20
  },
  "Eestimaa": {
    "labels": { "et": "Eestimaa", "en": "Estonia", "de": "Estland", "la": "Estonia" },
    "sort_order": 30
  },
  "Saksamaa": {
    "labels": { "et": "Saksamaa", "en": "Germany", "de": "Deutschland", "la": "Germania" },
    "sort_order": 40
  },
  "Rootsi": {
    "labels": { "et": "Rootsi", "en": "Sweden", "de": "Schweden", "la": "Suecia" },
    "sort_order": 50
  },
  "Soome": {
    "labels": { "et": "Soome", "en": "Finland", "de": "Finnland", "la": "Finlandia" },
    "sort_order": 60
  },
  "Muud piirkonnad": {
    "labels": { "et": "Muud piirkonnad", "en": "Other regions", "de": "Andere Regionen", "la": "Aliae regiones" },
    "sort_order": 999
  }
}
EOF
```

- [ ] **Samm 3: Uuenda `places.json` serveril — lisa `group` ja `type` väljad**

Käivita serveril Pythoni skript, mis lisab `group` ja `type` väljad olemasolevatele kirjetele. Kuna kohalik arendaja ei tea täpset `places.json` sisu, tuleb kirjed ise läbi vaadata ja `group` määrata vastava piirkonna järgi. Näide:

```python
# Käivita serveril: python3 scripts/add_place_groups.py
import json, os

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
path = os.path.join(DATA_ROOT, "config", "places.json")

with open(path) as f:
    places = json.load(f)

# Näidis-mapping (täienda vastavalt tegelikele kirjetele):
GROUP_MAP = {
    "Livland": "Liivimaa",
    "Kurland": "Kuramaa",
    "Estland": "Eestimaa",
    # ... täienda kõigi kirjete jaoks
}
TYPE_MAP = {
    "Riga": "city",
    "Livland": "historical_region",
    # ... täienda
}

for key, entry in places.items():
    if key in GROUP_MAP:
        entry["group"] = GROUP_MAP[key]
    if key in TYPE_MAP:
        entry.setdefault("type", TYPE_MAP[key])

with open(path, "w") as f:
    json.dump(places, f, ensure_ascii=False, indent=2)
print("Valmis")
```

- [ ] **Samm 4: Commit**

```bash
git add server/config.py
git commit -m "feat: lisa ORIGIN_GROUPS_FILE konstant config.py-sse"
```

---

## Task 2: `places_ops.py` — cache + abifunktsioonid + TDD testid

**Files:**
- Create: `server/prosopography/places_ops.py`
- Create: `tests/test_places_ops.py`

- [ ] **Samm 1: Kirjuta testid (TDD — kõigepealt testid)**

```python
# tests/test_places_ops.py
"""Testid: places_ops abifunktsioonid vastab spec käitumisreeglitele."""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


SAMPLE_PLACES = {
    "Riga": {
        "id": "Q1773",
        "parent_key": "Livland",
        "labels": {"et": "Riia", "en": "Riga", "de": "Riga", "la": "Riga"},
        "type": "city",
    },
    "Livland": {
        "id": "Q1757",
        "group": "Liivimaa",
        "parent_key": None,
        "labels": {"et": "Liivimaa", "en": "Livonia", "de": "Livland", "la": "Livonia"},
        "type": "historical_region",
    },
    "Dorpat": {
        "id": "Q3258",
        "parent_key": "Livland",
        "labels": {"et": "Tartu", "en": "Dorpat", "de": "Dorpat"},
        "type": "city",
    },
    "Kanepi": {
        "id": None,
        "parent_key": "Estland",
        "labels": {"et": "Kanepi", "en": "Kanepi"},
        "type": "parish",
    },
    "Estland": {
        "id": "Q179670",
        "group": "Eestimaa",
        "parent_key": None,
        "labels": {"et": "Eestimaa", "en": "Estonia"},
        "type": "historical_region",
    },
    "Kylakoht": {
        "id": None,
        "parent_key": "Kanepi",
        "labels": {"et": "Külakoht"},
        "type": "village",
    },
}

SAMPLE_GROUPS = {
    "Liivimaa": {
        "labels": {"et": "Liivimaa", "en": "Livonia"},
        "sort_order": 10,
    },
    "Eestimaa": {
        "labels": {"et": "Eestimaa", "en": "Estonia"},
        "sort_order": 30,
    },
}

ALLOWED_TYPES = ["city", "village", "parish", "county", "province", "territory", "historical_region"]


def _patch_places(places=SAMPLE_PLACES, groups=SAMPLE_GROUPS):
    """Context manager: asendab places + groups cache mock-andmetega."""
    return patch.multiple(
        "server.prosopography.places_ops",
        _places_cache=places,
        _places_cache_time=float("inf"),
        _groups_cache=groups,
        _groups_cache_time=float("inf"),
    )


# ── _walk_to_group ─────────────────────────────────────────────────────────

def test_walk_to_group_direct():
    """Kui kohal endal on group, tagastatakse see kohe."""
    with _patch_places():
        from server.prosopography.places_ops import _walk_to_group
        assert _walk_to_group("Livland", SAMPLE_PLACES) == "Liivimaa"


def test_walk_to_group_one_hop():
    """Riga → Livland → grupp."""
    with _patch_places():
        from server.prosopography.places_ops import _walk_to_group
        assert _walk_to_group("Riga", SAMPLE_PLACES) == "Liivimaa"


def test_walk_to_group_two_hops():
    """Kylakoht → Kanepi → Estland → grupp."""
    with _patch_places():
        from server.prosopography.places_ops import _walk_to_group
        assert _walk_to_group("Kylakoht", SAMPLE_PLACES) == "Eestimaa"


def test_walk_to_group_unknown_key():
    with _patch_places():
        from server.prosopography.places_ops import _walk_to_group
        assert _walk_to_group("TundmatuKoht", SAMPLE_PLACES) is None


def test_walk_to_group_none_key():
    with _patch_places():
        from server.prosopography.places_ops import _walk_to_group
        assert _walk_to_group(None, SAMPLE_PLACES) is None


def test_walk_stops_at_max_steps():
    """Ahel pikem kui MAX_PLACE_PARENT_STEPS (5) → tagastab None."""
    deep_places = {
        f"Level{i}": {"parent_key": f"Level{i+1}" if i < 7 else None, "labels": {}}
        for i in range(8)
    }
    # Level0 → Level1 → ... → Level7 (parent_key=None, pole gruppi)
    with _patch_places(places=deep_places):
        from server.prosopography.places_ops import _walk_to_group
        result = _walk_to_group("Level0", deep_places)
        assert result is None  # > 5 sammu, grupp puudub


def test_walk_stops_on_cycle():
    """Ringviide → tagastab None (ei jää lõpmatusse tsüklisse)."""
    cyclic = {
        "A": {"parent_key": "B", "labels": {}},
        "B": {"parent_key": "A", "labels": {}},
    }
    with _patch_places(places=cyclic):
        from server.prosopography.places_ops import _walk_to_group
        assert _walk_to_group("A", cyclic) is None


# ── _resolve_origin_group ──────────────────────────────────────────────────

def test_resolve_by_place_key():
    with _patch_places():
        from server.prosopography.places_ops import _resolve_origin_group
        assert _resolve_origin_group(place_id=None, place_key="Riga") == "Liivimaa"


def test_resolve_by_place_id():
    with _patch_places():
        from server.prosopography.places_ops import _resolve_origin_group
        assert _resolve_origin_group(place_id="Q1773", place_key=None) == "Liivimaa"


def test_resolve_region_directly():
    with _patch_places():
        from server.prosopography.places_ops import _resolve_origin_group
        assert _resolve_origin_group(place_id=None, place_key="Livland") == "Liivimaa"


def test_resolve_unknown():
    with _patch_places():
        from server.prosopography.places_ops import _resolve_origin_group
        assert _resolve_origin_group(place_id=None, place_key="TundmatuKoht") is None


def test_resolve_none_none():
    with _patch_places():
        from server.prosopography.places_ops import _resolve_origin_group
        assert _resolve_origin_group(place_id=None, place_key=None) is None


# ── _get_parent_place ──────────────────────────────────────────────────────

def test_get_parent_place_exists():
    with _patch_places():
        from server.prosopography.places_ops import _get_parent_place
        parent = _get_parent_place("Riga")
        assert parent is not None
        assert parent["key"] == "Livland"
        assert parent["id"] == "Q1757"


def test_get_parent_place_root_returns_none():
    """Livland-il pole parent → tagastab None."""
    with _patch_places():
        from server.prosopography.places_ops import _get_parent_place
        assert _get_parent_place("Livland") is None


def test_get_parent_place_none_key():
    with _patch_places():
        from server.prosopography.places_ops import _get_parent_place
        assert _get_parent_place(None) is None


# ── _enrich_origin_from_places ─────────────────────────────────────────────

def test_enrich_fills_id_and_labels():
    with _patch_places():
        from server.prosopography.places_ops import _enrich_origin_from_places
        origin = {"place": "Riga", "geonames_id": None, "coordinates": None}
        result = _enrich_origin_from_places(origin)
        assert result["place_id"] == "Q1773"
        assert result["place_labels"]["et"] == "Riia"


def test_enrich_raises_on_unknown_place():
    with _patch_places():
        from server.prosopography.places_ops import _enrich_origin_from_places
        with pytest.raises(ValueError, match="Unknown origin place"):
            _enrich_origin_from_places({"place": "TundmatuKoht"})


def test_enrich_no_op_if_no_place():
    with _patch_places():
        from server.prosopography.places_ops import _enrich_origin_from_places
        origin = {"place": None, "geonames_id": None}
        result = _enrich_origin_from_places(origin)
        assert result == origin


# ── validate_places_config ─────────────────────────────────────────────────

def test_validate_raises_on_unknown_group(tmp_path):
    bad_places = {
        "SomeCity": {"group": "TundmatuGrupp", "parent_key": None, "labels": {}}
    }
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    places_file.write_text(json.dumps(bad_places))
    groups_file.write_text(json.dumps({"KnownGroup": {"labels": {"et": "OK"}}}))
    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
    ):
        from importlib import reload
        import server.prosopography.places_ops as m
        with pytest.raises(ValueError, match="TundmatuGrupp"):
            m.validate_places_config()


def test_validate_raises_on_missing_parent(tmp_path):
    bad_places = {
        "SomeCity": {"parent_key": "PuuduvaParent", "labels": {}}
    }
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    places_file.write_text(json.dumps(bad_places))
    groups_file.write_text(json.dumps({}))
    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
    ):
        import server.prosopography.places_ops as m
        with pytest.raises(ValueError, match="PuuduvaParent"):
            m.validate_places_config()


def test_validate_raises_on_cycle(tmp_path):
    bad_places = {
        "A": {"parent_key": "B", "labels": {}},
        "B": {"parent_key": "A", "labels": {}},
    }
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    places_file.write_text(json.dumps(bad_places))
    groups_file.write_text(json.dumps({}))
    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
    ):
        import server.prosopography.places_ops as m
        with pytest.raises(ValueError, match="ringviide"):
            m.validate_places_config()


# ── get_places_meta ────────────────────────────────────────────────────────

def test_get_places_meta_returns_groups_and_types():
    with _patch_places():
        from server.prosopography.places_ops import get_places_meta
        meta = get_places_meta()
        assert "groups" in meta
        assert "allowed_types" in meta
        assert "city" in meta["allowed_types"]
        assert "Liivimaa" in meta["groups"]
```

- [ ] **Samm 2: Käivita testid — veendu et kõik kukuvad läbi**

```bash
cd /home/mf/LLM/VUTT
python -m pytest tests/test_places_ops.py -v 2>&1 | head -30
```
Oodatav: `ImportError` või `ModuleNotFoundError` (places_ops puudub)

- [ ] **Samm 3: Kirjuta `places_ops.py`**

```python
# server/prosopography/places_ops.py
"""
Koharegister (places.json) ja päritolugrupid (origin_groups.json).
Cache, abifunktsioonid, propagatsioon.
"""
import json
import os
import time
import threading
from typing import Optional

from ..config import PLACES_FILE, ORIGIN_GROUPS_FILE, get_logger
from ..utils import atomic_write_json

logger = get_logger(__name__)

# ── Lubatud kohatüübid ─────────────────────────────────────────────────────
ALLOWED_PLACE_TYPES = [
    "city", "village", "parish", "county",
    "province", "territory", "historical_region",
]

MAX_PLACE_PARENT_STEPS = 5

# ── Moodulitaseme cache ────────────────────────────────────────────────────
_places_cache: Optional[dict] = None
_places_cache_time: float = 0.0
_groups_cache: Optional[dict] = None
_groups_cache_time: float = 0.0
_CACHE_TTL = 300.0  # 5 min
_cache_lock = threading.Lock()


def _load_places_cache(force_reload: bool = False) -> dict:
    global _places_cache, _places_cache_time
    now = time.monotonic()
    with _cache_lock:
        if _places_cache is not None and not force_reload and (now - _places_cache_time) < _CACHE_TTL:
            return _places_cache
        try:
            with open(PLACES_FILE, "r", encoding="utf-8") as f:
                _places_cache = json.load(f)
            _places_cache_time = now
        except FileNotFoundError:
            _places_cache = {}
        return _places_cache


def _load_origin_groups(force_reload: bool = False) -> dict:
    global _groups_cache, _groups_cache_time
    now = time.monotonic()
    with _cache_lock:
        if _groups_cache is not None and not force_reload and (now - _groups_cache_time) < _CACHE_TTL:
            return _groups_cache
        try:
            with open(ORIGIN_GROUPS_FILE, "r", encoding="utf-8") as f:
                _groups_cache = json.load(f)
            _groups_cache_time = now
        except FileNotFoundError:
            _groups_cache = {}
        return _groups_cache


# ── Valideerimine ──────────────────────────────────────────────────────────

def validate_places_config() -> None:
    """
    Käivitatakse serveri stardimisel.
    Tõstab ValueError kui konfiguratsioon on vigane.
    """
    try:
        with open(PLACES_FILE, "r", encoding="utf-8") as f:
            places = json.load(f)
    except FileNotFoundError:
        return  # places.json puudub — OK (server käivitub ilma)

    try:
        with open(ORIGIN_GROUPS_FILE, "r", encoding="utf-8") as f:
            groups = json.load(f)
    except FileNotFoundError:
        groups = {}

    known_groups = set(groups.keys())
    known_keys = set(places.keys())

    for key, entry in places.items():
        group = entry.get("group")
        if group and group not in known_groups:
            raise ValueError(
                f"places.json kirje '{key}': group='{group}' ei ole origin_groups.json-s"
            )
        parent_key = entry.get("parent_key")
        if parent_key and parent_key not in known_keys:
            raise ValueError(
                f"places.json kirje '{key}': parent_key='{parent_key}' ei leitud places.json-s"
            )

    # Ringviidete kontroll
    for start_key in places:
        seen = set()
        current = start_key
        for _ in range(len(places) + 1):
            if current is None:
                break
            if current in seen:
                raise ValueError(
                    f"places.json: ringviide parent-ahelas, algab '{start_key}'"
                )
            seen.add(current)
            current = places.get(current, {}).get("parent_key")


# ── Abifunktsioonid ────────────────────────────────────────────────────────

def _walk_to_group(key: Optional[str], places: dict) -> Optional[str]:
    """Järgib parent_key ahelat kuni grupini, max MAX_PLACE_PARENT_STEPS sammu."""
    current = key
    steps = 0
    seen: set = set()

    while current and steps < MAX_PLACE_PARENT_STEPS:
        if current in seen:
            return None
        seen.add(current)
        entry = places.get(current)
        if not entry:
            return None
        if entry.get("group"):
            return entry["group"]
        current = entry.get("parent_key")
        steps += 1

    return None


def _resolve_origin_group(
    place_id: Optional[str],
    place_key: Optional[str],
) -> Optional[str]:
    """Tuletab päritolugrupi Q-koodi või places.json võtme kaudu."""
    places = _load_places_cache()

    if place_id:
        for key, entry in places.items():
            if entry.get("id") == place_id:
                result = _walk_to_group(key, places)
                if result:
                    return result

    if place_key:
        return _walk_to_group(place_key, places)

    return None


def _get_parent_place(key: Optional[str]) -> Optional[dict]:
    """Tagastab lähima parent-kirje kuvamiseks (nt 'Riga · Liivimaa')."""
    if not key:
        return None
    places = _load_places_cache()
    entry = places.get(key) or {}
    parent_key = entry.get("parent_key")
    if not parent_key:
        return None
    parent = places.get(parent_key) or {}
    return {
        "key": parent_key,
        "id": parent.get("id"),
        "labels": parent.get("labels"),
        "type": parent.get("type"),
    }


def _get_place_labels(key: Optional[str]) -> Optional[dict]:
    if not key:
        return None
    return _load_places_cache().get(key, {}).get("labels")


def _enrich_origin_from_places(origin: dict) -> dict:
    """
    Täidab origin['place_id'] ja origin['place_labels'] places.json-st.
    Tõstab ValueError kui place võti ei ole registris.
    """
    place_key = origin.get("place")
    if not place_key:
        return origin
    places = _load_places_cache()
    entry = places.get(place_key)
    if not entry:
        raise ValueError(f"Unknown origin place: {place_key!r}")
    origin = dict(origin)
    origin["place_id"] = entry.get("id")
    origin["place_labels"] = entry.get("labels")
    return origin


# ── Propagatsioon ──────────────────────────────────────────────────────────

def _collect_descendants(place_key: str, places: dict, max_depth: int = MAX_PLACE_PARENT_STEPS) -> set:
    """Kogub kõik koha järeltulijad (keys millel on parent_key = place_key, transitiivselt)."""
    result = set()
    queue = [place_key]
    depth = 0
    while queue and depth <= max_depth:
        next_queue = []
        for key, entry in places.items():
            if entry.get("parent_key") in queue and key not in result:
                result.add(key)
                next_queue.append(key)
        queue = next_queue
        depth += 1
    return result


async def _propagate_place_change(place_key: str) -> None:
    """
    Pärast places.json muutmist uuendab kõik mõjutatud isikute indeksikirjed.
    Käivitatakse background task-ina.
    """
    from .ops import _load_index, _index_entry_from_person, get_person
    from ..utils import atomic_write_json
    from ..config import PROSOPOGRAPHY_INDEX_FILE

    places = _load_places_cache(force_reload=True)
    affected = _collect_descendants(place_key, places)
    affected.add(place_key)

    index = _load_index()
    changed = False
    for entry in index.get("entries", []):
        if entry.get("origin_place") not in affected:
            continue
        person = get_person(entry["id"])
        if not person:
            continue
        new_entry = _index_entry_from_person(person, work_count=entry.get("work_count", 0))
        entry.update(new_entry)
        changed = True

    if changed:
        atomic_write_json(PROSOPOGRAPHY_INDEX_FILE, index)
        logger.info("_propagate_place_change: uuendas indeksi place_key=%s", place_key)


# ── Endpoint loogika ───────────────────────────────────────────────────────

def get_places() -> dict:
    """Tagastab kõik places.json kirjed. Kasutab cache't."""
    return _load_places_cache()


def get_places_meta() -> dict:
    """Tagastab origin_groups.json sisu + lubatud type väärtused."""
    groups = _load_origin_groups()
    return {
        "groups": groups,
        "allowed_types": ALLOWED_PLACE_TYPES,
    }


def put_place(key: str, data: dict) -> dict:
    """
    Lisab või uuendab koha places.json-s.
    Valideerib type enum-i vastu.
    Tagastab uuendatud kirje.
    """
    place_type = data.get("type")
    if place_type and place_type not in ALLOWED_PLACE_TYPES:
        raise ValueError(
            f"Tundmatu kohatüüp: '{place_type}'. Lubatud: {', '.join(ALLOWED_PLACE_TYPES)}"
        )

    places = _load_places_cache(force_reload=True)
    entry = places.get(key, {})
    for field in ("id", "labels", "parent_key", "group", "type", "historical_names", "notes"):
        if field in data:
            entry[field] = data[field]
    places[key] = entry
    atomic_write_json(PLACES_FILE, places)
    _load_places_cache(force_reload=True)
    return entry
```

- [ ] **Samm 4: Käivita testid — veendu et kõik lähevad läbi**

```bash
python -m pytest tests/test_places_ops.py -v
```
Oodatav: kõik testid `PASSED`

- [ ] **Samm 5: Commit**

```bash
git add server/prosopography/places_ops.py tests/test_places_ops.py server/config.py
git commit -m "feat: places_ops.py — cache, abifunktsioonid, propagatsioon (TDD)"
```

---

## Task 3: `ops.py` — `_index_entry_from_person` + `create_person` uuendamine

**Files:**
- Modify: `server/prosopography/ops.py:84-129` (`_index_entry_from_person`)
- Modify: `server/prosopography/ops.py:298-302` (`create_person` origin default)
- Modify: `server/prosopography/ops.py:418-433` (`update_person` — lisa `_enrich_origin_from_places`)

- [ ] **Samm 1: Lisa origin impordid ops.py algusesse**

```python
# server/prosopography/ops.py — lisa olemasolevate importide juurde:
from .places_ops import (
    _resolve_origin_group,
    _get_parent_place,
    _get_place_labels,
    _enrich_origin_from_places,
)
```

- [ ] **Samm 2: Laienda `_index_entry_from_person()` — lisa 5 uut välja**

Asenda olemasolev `_index_entry_from_person` return statement (rida ~109):

```python
def _index_entry_from_person(person: dict, work_count: int = 0) -> dict:
    """Ehitab prosopography_index.json kirje isiku täisandmetest."""
    birth = person.get("birth") or {}
    death = person.get("death") or {}
    identifiers = person.get("identifiers") or []
    schemes = {i.get("scheme") for i in identifiers}
    status_obj = person.get("status") or {}
    confession_obj = person.get("confession") or {}
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or person.get("id", "")
    family_name = name_obj.get("family_name") or ""
    sort_name = family_name or label
    aliases = name_obj.get("aliases") or []
    occupations = _extract_occupation_entries(person)

    # Päritolukoht
    origin = person.get("origin") or {}
    place_key = origin.get("place") or None
    place_id = origin.get("place_id") or None
    origin_group = _resolve_origin_group(place_id, place_key)
    origin_parent = _get_parent_place(place_key)
    origin_place_labels = _get_place_labels(place_key)
    # Grupi tõlgitud labelid PersonCard kuvamiseks
    origin_group_labels: Optional[dict] = None
    if origin_group:
        groups_cfg = _load_origin_groups()
        origin_group_labels = groups_cfg.get(origin_group, {}).get("labels")

    def _extract_year(date_obj: dict):
        date_str = date_obj.get("date") or ""
        if date_str and len(date_str) >= 4:
            try:
                return int(date_str[:4])
            except ValueError:
                pass
        return None

    return {
        "id": person["id"],
        "label": label,
        "sort_name": sort_name,
        "birth_year": _extract_year(birth),
        "death_year": _extract_year(death),
        "gender": person.get("gender"),
        "status_id": status_obj.get("id"),
        "status_label": status_obj.get("label"),
        "confession_id": confession_obj.get("id"),
        "has_wikidata": "wikidata" in schemes,
        "has_gnd": "gnd" in schemes,
        "has_aa": "album_academicum" in schemes,
        "record_status": person.get("record_status", "draft"),
        "verification_level": person.get("verification_level", "draft"),
        "work_count": work_count,
        "biography_snippet": _make_snippet(person),
        "image_url": person.get("image_url"),
        "aliases": aliases,
        "occupations": occupations,
        # Päritolu (uued väljad)
        "origin_place": place_key,
        "origin_place_id": place_id,
        "origin_place_labels": origin_place_labels,
        "origin_parent": origin_parent,
        "origin_group": origin_group,
        "origin_group_labels": origin_group_labels,
    }
```

- [ ] **Samm 3: Uuenda `create_person()` — muuda `origin` default**

Leia rida kus on `"origin": {"city": None, "region": None, ...}` (rida ~301) ja asenda:

```python
"origin": {"place": None, "place_id": None, "place_labels": None, "geonames_id": None, "coordinates": None},
```

- [ ] **Samm 4: Uuenda `update_person()` — lisa `_enrich_origin_from_places` kutse**

Pärast rida `person.update(data)` (rida ~421), lisa enne `atomic_write_json`:

```python
# Normaliseeri päritolukoht places.json-st
origin = person.get("origin") or {}
if origin.get("place"):
    try:
        person["origin"] = _enrich_origin_from_places(origin)
    except ValueError as e:
        raise ValueError(str(e))
```

- [ ] **Samm 5: Testi, et server käivitub**

```bash
cd /home/mf/LLM/VUTT
python -c "from server.prosopography.ops import _index_entry_from_person; print('OK')"
```
Oodatav: `OK`

- [ ] **Samm 6: Commit**

```bash
git add server/prosopography/ops.py
git commit -m "feat: _index_entry_from_person lisab origin_place, origin_group, origin_parent"
```

---

## Task 4: `ops.py` — `list_persons` + `get_person_facets` uuendamine

**Files:**
- Modify: `server/prosopography/ops.py:436-499` (`list_persons`)
- Modify: `server/prosopography/ops.py:527-568` (`get_person_facets`)

- [ ] **Samm 1: Lisa `origin_group` param `list_persons()`-le**

Asenda `list_persons` signatuur (rida ~436):

```python
def list_persons(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,   # jääb tagasiühilduvuseks
    origin_group: Optional[str] = None, # uus
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    ids: Optional[list] = None,
    limit: int = 48,
    offset: int = 0,
) -> dict:
```

Lisa `origin_group` filter pärast `occupation` filtrit (rida ~480):

```python
if origin_group:
    results = [e for e in results if e.get("origin_group") == origin_group]
```

- [ ] **Samm 2: Uuenda `get_person_facets()` — `occupations` → `origin_groups`**

Enne, lisa `_load_origin_groups` import `ops.py` algusesse (koos teiste places_ops importidega):

```python
from .places_ops import (
    _resolve_origin_group,
    _get_parent_place,
    _get_place_labels,
    _enrich_origin_from_places,
    _load_origin_groups,  # lisa
)
```

Asenda kogu `get_person_facets` funktsioon:

```python
def get_person_facets(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    ids: Optional[list] = None,
) -> dict:
    """
    Tagastab persons-listingu jaoks facetid.
    origin_groups: päritolugruppide loend sagedustega (asendab occupations).
    occupations: jääb tagasiühilduvuseks (tühi nimekiri).
    """
    filtered = list_persons(
        q=q,
        gender=gender,
        ids=ids,
        limit=10**9,
        offset=0,
    )["results"]

    groups_config = _load_origin_groups()

    group_counts: dict[str, int] = {}
    for entry in filtered:
        grp = entry.get("origin_group")
        if grp:
            group_counts[grp] = group_counts.get(grp, 0) + 1

    origin_groups = []
    for grp_key, count in group_counts.items():
        grp_config = groups_config.get(grp_key, {})
        labels = grp_config.get("labels", {})
        origin_groups.append({
            "value": grp_key,
            "labels": labels,
            "label_et": labels.get("et", grp_key),
            "label_en": labels.get("en", grp_key),
            "sort_order": grp_config.get("sort_order", 999),
            "count": count,
        })

    origin_groups.sort(key=lambda x: (-x["count"], x.get("sort_order", 999)))

    return {
        "origin_groups": origin_groups,
        "occupations": [],  # tagasiühilduvus
    }
```

- [ ] **Samm 3: Testi käsitsi**

```bash
python -c "
from server.prosopography.ops import list_persons, get_person_facets
r = list_persons(limit=1)
print('list_persons ok, total:', r['total'])
f = get_person_facets()
print('get_person_facets ok:', list(f.keys()))
"
```
Oodatav: `list_persons ok, total: N` ja `get_person_facets ok: ['origin_groups', 'occupations']`

- [ ] **Samm 4: Commit**

```bash
git add server/prosopography/ops.py
git commit -m "feat: list_persons toetab origin_group filtrit; get_person_facets tagastab origin_groups"
```

---

## Task 5: `router.py` — uued place endpointid

**Files:**
- Modify: `server/prosopography/router.py`

- [ ] **Samm 1: Lisa places_ops impordid routerisse**

```python
# server/prosopography/router.py — lisa olemasolevate importide juurde:
from fastapi import BackgroundTasks
from .places_ops import get_places, get_places_meta, put_place, _propagate_place_change
```

- [ ] **Samm 2: Lisa `origin_group` param `prosopography_list` endpointi**

Leia `prosopography_list` endpoint (rida ~94) ja lisa `origin_group: str = None` param:

```python
@router.get("")
async def prosopography_list(
    request: Request,
    q: str = None,
    gender: str = None,
    occupation: str = None,
    origin_group: str = None,  # uus
    status_id: str = None,
    source: str = None,
    verification_level: str = None,
    ids: str = None,
    limit: int = 48,
    offset: int = 0,
    user=Depends(_optional_user),
):
    id_list = [i for i in ids.split(",") if i] if ids else None
    return list_persons(
        q=q,
        gender=gender,
        occupation=occupation,
        origin_group=origin_group,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        ids=id_list,
        limit=limit,
        offset=offset,
    )
```

Uuenda ka `prosopography_query` POST endpoint (rida ~123):

```python
@router.post("/query")
async def prosopography_query(request: Request):
    data = await _get_json(request)
    return list_persons(
        q=data.get("q"),
        gender=data.get("gender"),
        occupation=data.get("occupation"),
        origin_group=data.get("origin_group"),
        status_id=data.get("status_id"),
        source=data.get("source"),
        verification_level=data.get("verification_level"),
        ids=data.get("ids"),
        limit=data.get("limit", 48),
        offset=data.get("offset", 0),
    )
```

- [ ] **Samm 3: Lisa kolm uut place endpointi routerisse**

Lisa enne `@router.get("/{person_id:path}")` (rida ~359):

```python
# ── Places register ────────────────────────────────────────────────────────

@router.get("/places")
async def places_list():
    """Tagastab kõik places.json kirjed. Avalik — töötab kõigil rollidel."""
    return get_places()


@router.get("/places/meta")
async def places_meta():
    """Tagastab origin_groups.json sisu + lubatud type väärtused. Avalik."""
    return get_places_meta()


@router.put("/admin/places/{key}")
async def places_put(
    key: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(_require_role("editor")),
):
    """
    Lisab/uuendab koha places.json-s.
    Nõuab editor rolli.
    Pärast salvestust käivitab sihtotstarbelise propagatsiooni background task-ina.
    Body: {id?, labels?, parent_key?, group?, type?, historical_names?, notes?}
    """
    data = await _get_json(request)
    try:
        entry = put_place(key, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Sihtotstarbeline propagatsioon — background task (ei blokeeri vastust)
    background_tasks.add_task(_propagate_place_change, key)

    return {"key": key, "entry": entry}
```

- [ ] **Samm 4: Testi endpointid**

```bash
# Käivita server lokaalselt ja testi:
curl http://localhost:8002/prosopography/places/meta
```
Oodatav: JSON `{"groups": {...}, "allowed_types": [...]}`

- [ ] **Samm 5: Commit**

```bash
git add server/prosopography/router.py
git commit -m "feat: lisa GET /places, GET /places/meta, PUT /admin/places/{key} endpointid"
```

---

## Task 6: Frontend tüübid + service

**Files:**
- Modify: `src/prosopography/types.ts`
- Modify: `src/prosopography/services/prosopographyService.ts`

- [ ] **Samm 1: Uuenda `ProsopoIndexEntry` ja `ProsopoRecord` tüübid**

```typescript
// src/prosopography/types.ts

export interface PlaceEntry {
  id: string | null;
  group?: string | null;
  parent_key?: string | null;
  labels: Record<string, string>;
  historical_names?: string[];
  type?: string;
  notes?: string;
}

export interface OriginParent {
  key: string;
  id: string | null;
  labels: Record<string, string> | null;
  type?: string | null;
}

export interface ProsopoIndexEntry {
  id: string;
  label: string;
  sort_name: string;
  birth_year: number | null;
  death_year: number | null;
  gender: 'M' | 'F' | null;
  status_id: string | null;
  status_label: string | null;
  confession_id: string | null;
  has_wikidata: boolean;
  has_gnd: boolean;
  has_aa: boolean;
  record_status: 'draft' | 'reviewed' | 'verified' | 'tombstone';
  verification_level: 'draft' | 'reviewed' | 'verified';
  work_count: number;
  biography_snippet: string;
  image_url: string | null;
  aliases: string[];
  occupations?: { id: string | null; label: string; labels?: Record<string, string> | null }[];
  // Päritolu (uued väljad)
  origin_place: string | null;
  origin_place_id: string | null;
  origin_place_labels: Record<string, string> | null;
  origin_parent: OriginParent | null;
  origin_group: string | null;
  origin_group_labels: Record<string, string> | null;
}

// ProsopoRecord.origin — vana city/region asendub place-ga
export interface ProsopoRecord {
  // ... kõik olemasolevad väljad ...
  id: string;
  identifiers: { scheme: string; id: string; checked_at: string | null }[];
  merged_into: string | null;
  import_batch_ids: string[];
  schema_version: number;
  record_status: string;
  verification_level: string;
  created_at: string;
  updated_at: string;
  created_by: string;
  updated_by: string;
  name: {
    label: string;
    family_name: string | null;
    first_name: string | null;
    qualifier: string | null;
    qualifier_type: string | null;
    noble_status: string | null;
    maiden_name: string | null;
    aliases: string[];
    family_name_variants: string[];
    first_name_variants: string[];
  };
  gender: 'M' | 'F' | null;
  birth: HistoricalDate;
  death: HistoricalDate;
  origin: {
    place: string | null;
    place_id?: string | null;
    place_labels?: Record<string, string> | null;
    geonames_id: string | null;
    coordinates: string | null;
  };
  floruit?: { year_from?: number | null; year_to?: number | null } | null;
  status: { id: string; label: string } | null;
  confession: { id: string; label: string } | null;
  occupations: any[];
  education: any[];
  burial: any | null;
  relations: { name: string; type?: string; target_id?: string | null }[];
  tags?: any[];
  sources: { text: string; note?: string | null }[];
  biography: string | null;
  notes: string | null;
  image_url: string | null;
  source_data: Record<string, any>;
  works?: { work_id: string; role: string }[];
}
```

- [ ] **Samm 2: Uuenda `prosopographyService.ts` — lisa `origin_group`, `fetchPlaces`, `addPlace`**

```typescript
// src/prosopography/services/prosopographyService.ts

// Leia listPersons() funktsioon ja lisa origin_group param:
export async function listPersons(params?: {
  q?: string;
  gender?: string;
  occupation?: string;
  origin_group?: string;  // uus
  status_id?: string;
  source?: string;
  verification_level?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
}, token?: string): Promise<{ results: ProsopoIndexEntry[]; total: number; offset: number; limit: number }> {
  // ... olemasolev loogika, lisa:
  if (params?.origin_group) url.searchParams.set('origin_group', params.origin_group);
  // ... POST /query harus samuti:
  // body: JSON.stringify(params) — origin_group läheb automaatselt kaasa
```

Uuenda `getPersonFacets` tagastustüüp:

```typescript
export async function getPersonFacets(params?: {
  q?: string;
  gender?: string;
  ids?: string[];
}, token?: string): Promise<{
  origin_groups: { value: string; labels: Record<string, string>; label_et: string; label_en: string; count: number }[];
  occupations: any[];  // tagasiühilduvus
}> {
  // ... olemasolev loogika muutub ainult tagastustüübiga
```

Lisa lõppu:

```typescript
export async function fetchPlaces(): Promise<Record<string, import('../types').PlaceEntry>> {
  const resp = await fetchWithTimeout(`${FILE_API_URL}/prosopography/places`, { timeout: 10000 });
  if (!resp.ok) throw new Error(`fetchPlaces: ${resp.status}`);
  return resp.json();
}

export async function fetchPlacesMeta(): Promise<{
  groups: Record<string, { labels: Record<string, string>; sort_order: number }>;
  allowed_types: string[];
}> {
  const resp = await fetchWithTimeout(`${FILE_API_URL}/prosopography/places/meta`, { timeout: 10000 });
  if (!resp.ok) throw new Error(`fetchPlacesMeta: ${resp.status}`);
  return resp.json();
}

export async function addPlace(key: string, data: Partial<import('../types').PlaceEntry>, token: string): Promise<{ key: string; entry: import('../types').PlaceEntry }> {
  const resp = await fetchWithTimeout(`${FILE_API_URL}/prosopography/admin/places/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify(data),
    timeout: 10000,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `addPlace: ${resp.status}`);
  }
  return resp.json();
}
```

- [ ] **Samm 3: TypeScript compile kontroll**

```bash
cd /home/mf/LLM/VUTT
npx tsc --noEmit 2>&1 | head -30
```
Oodatav: tüüpide muutus toob vigu `types.ts` importijates — parandame Tasks 7-10 käigus.

- [ ] **Samm 4: Commit**

```bash
git add src/prosopography/types.ts src/prosopography/services/prosopographyService.ts
git commit -m "feat: prosopography tüübid + service — origin_group, fetchPlaces, addPlace"
```

---

## Task 7: Frontend — `PlacePicker` komponent

**Files:**
- Create: `src/prosopography/components/personForm/PlacePicker.tsx`

- [ ] **Samm 1: Kirjuta `PlacePicker` komponent**

```tsx
// src/prosopography/components/personForm/PlacePicker.tsx
import React, { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Plus, X } from 'lucide-react';
import { fetchPlaces, fetchPlacesMeta, addPlace } from '../../services/prosopographyService';
import type { PlaceEntry } from '../../types';

const SHOWN_TYPES = ['city', 'village', 'parish', 'county', 'province', 'territory', 'historical_region'];

interface PlacePickerProps {
  value: string | null;          // places.json võti
  onChange: (key: string | null) => void;
  token: string;
  canEdit: boolean;              // editor/admin
  lang: string;
}

interface AddPlaceModalProps {
  query: string;
  meta: { groups: Record<string, any>; allowed_types: string[] } | null;
  onAdd: (key: string, entry: PlaceEntry) => void;
  onClose: () => void;
  token: string;
}

const AddPlaceModal: React.FC<AddPlaceModalProps> = ({ query, meta, onAdd, onClose, token }) => {
  const { t } = useTranslation('prosopography');
  const [name, setName] = useState(query);
  const [placeType, setPlaceType] = useState('');
  const [qCode, setQCode] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [group, setGroup] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!name.trim()) { setError(t('form.nameRequired')); return; }
    const key = name.trim().replace(/\s+/g, '_');
    setSaving(true);
    setError(null);
    try {
      const result = await addPlace(key, {
        labels: { et: name.trim(), en: name.trim() },
        id: qCode.trim() || null,
        type: placeType || undefined,
        parent_key: parentKey.trim() || undefined,
        group: group || undefined,
      }, token);
      onAdd(result.key, result.entry);
    } catch (e: any) {
      setError(e.message ?? t('form.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-sm mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">{t('addPlace')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t('form.nameLabel')} *</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tüüp</label>
            <select value={placeType} onChange={e => setPlaceType(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
              <option value="">—</option>
              {(meta?.allowed_types ?? []).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Wikidata Q-kood (valikuline)</label>
            <input type="text" value={qCode} onChange={e => setQCode(e.target.value)}
              placeholder="Q12345"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono" />
            {!qCode.trim() && (
              <p className="mt-1 text-xs text-amber-600">{t('noQCode')}</p>
            )}
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Ülem-koht (parent_key, valikuline)</label>
            <input type="text" value={parentKey} onChange={e => setParentKey(e.target.value)}
              placeholder="Livland"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Grupp (valikuline)</label>
            <select value={group} onChange={e => setGroup(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none">
              <option value="">—</option>
              {Object.entries(meta?.groups ?? {}).map(([k, v]: any) => (
                <option key={k} value={k}>{v.labels?.et ?? k}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
            Tühista
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-60">
            {saving ? '…' : 'Lisa'}
          </button>
        </div>
      </div>
    </div>
  );
};

const PlacePicker: React.FC<PlacePickerProps> = ({ value, onChange, token, canEdit, lang }) => {
  const { t } = useTranslation('prosopography');
  const [places, setPlaces] = useState<Record<string, PlaceEntry>>({});
  const [meta, setMeta] = useState<{ groups: Record<string, any>; allowed_types: string[] } | null>(null);
  const [query, setQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    fetchPlaces().then(setPlaces).catch(() => {});
    fetchPlacesMeta().then(setMeta).catch(() => {});
  }, []);

  const selectedEntry = value ? places[value] : null;

  const resolveLabel = (labels: Record<string, string> | undefined | null): string => {
    if (!labels) return '';
    return labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? '';
  };

  const displayLabel = selectedEntry ? resolveLabel(selectedEntry.labels) : (value ?? '');

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return [];
    return Object.entries(places)
      .filter(([, e]) => SHOWN_TYPES.includes(e.type ?? ''))
      .filter(([k, e]) => {
        const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
        const inHistorical = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
        const inKey = k.toLowerCase().includes(q);
        return inLabels || inHistorical || inKey;
      })
      .slice(0, 12);
  }, [query, places]);

  const handleSelect = (key: string) => {
    onChange(key);
    setQuery('');
    setShowDropdown(false);
  };

  const handleClear = () => {
    onChange(null);
    setQuery('');
  };

  const resolvedGroup = (() => {
    if (!selectedEntry) return null;
    const entry = selectedEntry;
    // Lihtsustatud grupi kuvamine: entry.group või parent.group
    if (entry.group) {
      const g = meta?.groups[entry.group];
      return g?.labels ? resolveLabel(g.labels) : entry.group;
    }
    const parentKey = entry.parent_key;
    if (parentKey) {
      const parentEntry = places[parentKey];
      if (parentEntry?.group) {
        const g = meta?.groups[parentEntry.group];
        return g?.labels ? resolveLabel(g.labels) : parentEntry.group;
      }
    }
    return null;
  })();

  return (
    <div className="relative">
      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
        <MapPin size={11} className="inline mr-1 text-primary-600" />
        {t('originPlace')}
      </label>

      {value ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded bg-gray-50 text-gray-800">
            {displayLabel}
          </span>
          <button onClick={handleClear} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X size={14} />
          </button>
        </div>
      ) : (
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setShowDropdown(true); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
          placeholder="Otsi linna, kihelkonda, piirkonda…"
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
        />
      )}

      {/* Tuletatud grupp */}
      {resolvedGroup && value && (
        <p className="mt-0.5 text-xs text-gray-400">
          {t('placeGroup', { group: resolvedGroup })}
        </p>
      )}

      {/* Dropdown */}
      {showDropdown && query && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {filtered.map(([key, entry]) => (
            <button
              key={key}
              className="w-full text-left px-3 py-2 text-sm text-gray-800 hover:bg-primary-50 border-b border-gray-50 last:border-0"
              onMouseDown={() => handleSelect(key)}
            >
              <span className="font-medium">{resolveLabel(entry.labels)}</span>
              {entry.type && <span className="ml-1.5 text-xs text-gray-400">({entry.type})</span>}
            </button>
          ))}
          {canEdit && (
            <button
              className="w-full text-left px-3 py-2 text-sm text-primary-600 hover:bg-primary-50 flex items-center gap-1.5 border-t border-gray-100"
              onMouseDown={() => { setShowDropdown(false); setShowAddModal(true); }}
            >
              <Plus size={13} />
              {t('addPlace')}
            </button>
          )}
          {filtered.length === 0 && !canEdit && (
            <p className="px-3 py-2 text-sm text-gray-400 italic">Ei leitud. Paluge editoril lisada.</p>
          )}
        </div>
      )}

      {showAddModal && (
        <AddPlaceModal
          query={query}
          meta={meta}
          token={token}
          onAdd={(key, entry) => {
            setPlaces(prev => ({ ...prev, [key]: entry }));
            handleSelect(key);
            setShowAddModal(false);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default PlacePicker;
```

- [ ] **Samm 2: TypeScript kontroll**

```bash
npx tsc --noEmit 2>&1 | grep PlacePicker
```
Oodatav: PlacePicker-iga seotud vigu ei ole

- [ ] **Samm 3: Commit**

```bash
git add src/prosopography/components/personForm/PlacePicker.tsx
git commit -m "feat: PlacePicker komponent päritolukoha valimiseks inline-lisamisega"
```

---

## Task 8: Frontend — `FormDraft` + `helpers.ts` + `PersonEditPage`

**Files:**
- Modify: `src/prosopography/components/personForm/types.ts`
- Modify: `src/prosopography/components/personForm/helpers.ts`
- Modify: `src/prosopography/pages/PersonEditPage.tsx`

- [ ] **Samm 1: Lisa `origin_place` `FormDraft`-le**

```typescript
// src/prosopography/components/personForm/types.ts
// Lisa FormDraft liidesesse:
export interface FormDraft {
  // ... olemasolevad väljad ...
  origin_place: string;  // places.json võti, tühi string = pole valitud
}

// emptyDraft() täiendus:
export const emptyDraft = (): FormDraft => ({
  // ... olemasolevad väljad ...
  origin_place: '',
});
```

- [ ] **Samm 2: Uuenda `recordToDraft()` — eemalda legacy `origin.city` fallback `birth.place`-le**

```typescript
// src/prosopography/components/personForm/helpers.ts
// recordToDraft() sees:

// ASENDA vana birth.place loogika (read ~105-111):
//   place: p.birth?.place?.label
//     ? { label: p.birth.place.label, id: p.birth.place.id ?? null, labels: null, source: 'wikidata' as const }
//     : p.origin?.city  // ← EEMALDA see legacy fallback
//     ? { label: p.origin.city, id: p.origin.city_id ?? null, ... }
//     : p.origin?.region
//     ? { ... }
//     : null,

// UUEGA:
birth: {
  year: p.birth?.date ? p.birth.date.slice(0, 4) : '',
  month: p.birth?.date && p.birth.precision !== 'year' ? String(parseInt(p.birth.date.slice(5, 7))) : '',
  day: p.birth?.date && p.birth.precision === 'day' ? String(parseInt(p.birth.date.slice(8, 10))) : '',
  circa: p.birth?.is_circa ?? false,
  bound: p.birth?.bound ?? '',
  calendar: (p.birth?.calendar ?? '') as DateDraft['calendar'],
  place: p.birth?.place?.label
    ? { label: p.birth.place.label, id: p.birth.place.id ?? null, labels: null, source: 'wikidata' as const }
    : null,  // ← legacy origin.city fallback EEMALDATUD
},

// Lisa origin_place kaardistus (pärast death):
origin_place: p.origin?.place ?? '',
```

- [ ] **Samm 3: Uuenda `draftToPayload()` — asenda `origin.city` → `origin.place`**

```typescript
// src/prosopography/components/personForm/helpers.ts
// draftToPayload() sees, asenda vana origin plokk (read ~221-230):

// ASENDA:
origin: {
  city: draft.birth?.place?.label ?? null,
  city_id: draft.birth?.place?.id ?? null,
  city_labels: draft.birth?.place?.labels ?? null,
  region: original?.origin?.region ?? null,
  region_id: original?.origin?.region_id ?? null,
  region_labels: original?.origin?.region_labels ?? null,
  geonames_id: original?.origin?.geonames_id ?? null,
  coordinates: original?.origin?.coordinates ?? null,
},

// UUEGA:
origin: {
  place: draft.origin_place || null,
  geonames_id: original?.origin?.geonames_id ?? null,
  coordinates: original?.origin?.coordinates ?? null,
},
```

- [ ] **Samm 4: Lisa `PlacePicker` `PersonEditPage`-le**

```typescript
// src/prosopography/pages/PersonEditPage.tsx
// Lisa import:
import PlacePicker from '../components/personForm/PlacePicker';
```

Leia päritolu sektsiooni koht (ühes kohas kus praegu näidatakse `origin.city`). Asenda kogu päritolu sektsiooni sisu:

```tsx
{/* ── Päritolukoht ── */}
<div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-5">
  <PlacePicker
    value={draft.origin_place || null}
    onChange={key => set({ origin_place: key ?? '' })}
    token={token}
    canEdit={!!canEdit}
    lang={lang}
  />
</div>
```

**NB:** Otsige PersonEditPage-st koht kus on `origin` väljad (tõenäoliselt `draft.origin_city` vm) ja asendage see `PlacePicker`-iga. Kui sellist sektsiooni pole veel, lisa uus `div` enne Elulugu sektsiooni.

- [ ] **Samm 5: TypeScript compile kontroll**

```bash
npx tsc --noEmit 2>&1 | head -20
```
Oodatav: vigu pole (või ainult seotud PersonsPage/PersonAdvancedFilters muutustega — need parandame Task 10-s)

- [ ] **Samm 6: Commit**

```bash
git add src/prosopography/components/personForm/types.ts \
        src/prosopography/components/personForm/helpers.ts \
        src/prosopography/pages/PersonEditPage.tsx
git commit -m "feat: FormDraft.origin_place, helpers kaardistab place, PersonEditPage PlacePicker"
```

---

## Task 9: Frontend — `PersonCard` päritolu kuvamine

**Files:**
- Modify: `src/prosopography/components/PersonCard.tsx`

- [ ] **Samm 1: Lisa päritolu abifunktsioon ja kuva PersonCard-is**

```tsx
// src/prosopography/components/PersonCard.tsx
// Lisa pärast imports, enne ExternalBadge:

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string | null {
  if (!labels) return null;
  return labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? null;
}
```

Leia `CardInner` komponent ja lisa päritolu kuva eluaastate järele:

```tsx
// CardInner sees, pärast eluaastate <p>:
{(() => {
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const placeLabel = resolveLabel(person.origin_place_labels, lang)
    ?? person.origin_place;
  const parentLabel = resolveLabel(person.origin_parent?.labels, lang)
    ?? person.origin_parent?.key;

  if (placeLabel && parentLabel && placeLabel !== parentLabel) {
    return (
      <p className="text-xs text-gray-400">
        {placeLabel} · {parentLabel}
      </p>
    );
  }
  if (placeLabel) {
    return <p className="text-xs text-gray-400">{placeLabel}</p>;
  }
  if (person.origin_group) {
    const groupLabel = resolveLabel(person.origin_group_labels, lang) ?? person.origin_group;
    return <p className="text-xs text-gray-400">{groupLabel}</p>;
  }
  return null;
})()}
```

**NB:** `CardInner` kasutab `useTranslation` — lisa `i18n` destructuring:

```tsx
const CardInner: React.FC<{ person: ProsopoIndexEntry; lifespan: React.ReactNode }> = ({
  person, lifespan,
}) => {
  const { t, i18n } = useTranslation(['prosopography']);
  // ... ülejäänud jääb samaks
```

- [ ] **Samm 2: TypeScript kontroll**

```bash
npx tsc --noEmit 2>&1 | grep PersonCard
```
Oodatav: vigu ei ole

- [ ] **Samm 3: Commit**

```bash
git add src/prosopography/components/PersonCard.tsx
git commit -m "feat: PersonCard kuvab päritolukoha keelestatud labelitega"
```

---

## Task 10: Frontend — `PersonsPage` + `PersonAdvancedFilters`

**Files:**
- Modify: `src/prosopography/pages/PersonsPage.tsx`
- Modify: `src/prosopography/components/PersonAdvancedFilters.tsx`

- [ ] **Samm 1: Uuenda `PersonAdvancedFilters` liides ja ikoon**

```tsx
// src/prosopography/components/PersonAdvancedFilters.tsx
// Muuda import: Briefcase → MapPin
import { ChevronDown, ChevronRight, MapPin, Search, Venus, X } from 'lucide-react';

// Muuda OccupationFacetItem → OriginGroupFacetItem (või jäta sama, muuda prop nimed):
interface PersonAdvancedFiltersProps {
  gender: GenderFilter;
  originGroup: string;              // oli: occupation: string
  originGroups: { value: string; label: string; count: number }[];  // oli: occupations
  onGenderChange: (v: GenderFilter) => void;
  onOriginGroupChange: (v: string) => void;  // oli: onOccupationChange
  onClearAll: () => void;
}

// Uuenda hasActive ja activeCount:
const hasActive = !!(originGroup || gender);
const activeCount = [originGroup, gender].filter(Boolean).length;

// Uuenda FilterSection kutse:
<FilterSection
  title={t('originGroup', 'Päritolu')}
  icon={<MapPin size={13} />}
  items={originGroups}
  selectedValue={originGroup}
  onSelect={onOriginGroupChange}
  searchPlaceholder={t('filterOriginSearch', 'Otsi piirkonda…')}
  emptyLabel={t('filterNoMatches', 'Ei leitud vasteid')}
/>

// Uuenda badge kuvamine:
{originGroup && (
  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-50 text-primary-700 border border-primary-200">
    {originGroup}
    <button onClick={() => onOriginGroupChange('')} className="hover:bg-primary-100 rounded-full p-0.5">
      <X size={11} />
    </button>
  </span>
)}
```

- [ ] **Samm 2: Uuenda `PersonsPage` — `occupation` → `origin_group` URL param**

```tsx
// src/prosopography/pages/PersonsPage.tsx

// Muuda:
const occupation = searchParams.get('occupation') ?? '';
// → 
const originGroup = searchParams.get('origin_group') ?? '';

// Muuda setFilterParam kutsed:
const setOriginGroup = (v: string) => setFilterParam('origin_group', v);

// Muuda listPersons kutse:
listPersons({
  q: query || undefined,
  origin_group: originGroup || undefined,  // oli: occupation
  gender: gender || undefined,
  ids: idsParam,
  limit: LIMIT,
  offset,
}, token)

// Muuda facets state:
const [originGroupFacets, setOriginGroupFacets] = useState<{ value: string; label: string; count: number }[]>([]);

// Muuda fetchFacets:
getPersonFacets({ q: query || undefined, gender: gender || undefined, ids: idsParam }, token)
  .then(data => {
    const lang = i18n.language?.slice(0, 2) ?? 'et';
    setOriginGroupFacets((data.origin_groups || []).map(item => ({
      value: item.value,
      label: item.labels?.[lang] ?? item.labels?.['et'] ?? item.labels?.['en'] ?? item.value,
      count: item.count,
    })));
  })
  .catch(() => setOriginGroupFacets([]));

// Muuda PersonAdvancedFilters props:
<PersonAdvancedFilters
  gender={gender}
  originGroup={originGroup}
  originGroups={originGroupFacets}
  onGenderChange={setGender}
  onOriginGroupChange={setOriginGroup}
  onClearAll={() => {
    setOriginGroup('');
    setGender('');
  }}
/>

// Muuda clearAll handler (kus iganes on occupation reset):
// setOccupation('') → setOriginGroup('')

// Muuda import: Briefcase pole enam vajalik PersonsPage-s
// (kui ainult PersonAdvancedFilters kasutas seda)
```

- [ ] **Samm 3: TypeScript compile kontroll**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Oodatav: 0 viga

- [ ] **Samm 4: Commit**

```bash
git add src/prosopography/pages/PersonsPage.tsx \
        src/prosopography/components/PersonAdvancedFilters.tsx
git commit -m "feat: PersonsPage + PersonAdvancedFilters — occupation→origin_group, MapPin ikoon"
```

---

## Task 11: Tõlked

**Files:**
- Modify: `src/locales/et/prosopography.json`
- Modify: `src/locales/en/prosopography.json`

- [ ] **Samm 1: Lisa eesti tõlked**

```json
// src/locales/et/prosopography.json — lisa olemasolevate võtmete järele:
"originGroup":       "Päritolu",
"originPlace":       "Päritolukoht",
"filterByOrigin":    "Filtreeri päritolu järgi",
"filterOriginSearch": "Otsi piirkonda…",
"noQCode":           "Q-kood puudub — kaardil ei kuvata",
"addPlace":          "Lisa uus koht",
"placeGroup":        "Grupp: {{group}}"
```

- [ ] **Samm 2: Lisa inglise tõlked**

```json
// src/locales/en/prosopography.json — lisa samade võtmetega:
"originGroup":       "Origin",
"originPlace":       "Origin place",
"filterByOrigin":    "Filter by origin",
"filterOriginSearch": "Search region…",
"noQCode":           "No Q-code — won't appear on map",
"addPlace":          "Add new place",
"placeGroup":        "Group: {{group}}"
```

- [ ] **Samm 3: Muuda `filterOccupationAll` PersonAdvancedFilters-s koodis kasutusest `originGroup`-ks**

`PersonAdvancedFilters.tsx`-is leia `t('filterOccupationAll', 'Amet')` ja asenda `t('originGroup', 'Päritolu')`.

- [ ] **Samm 4: Commit**

```bash
git add src/locales/et/prosopography.json src/locales/en/prosopography.json
git commit -m "feat: tõlkevõtmed päritolukoha filtrile (et + en)"
```

---

## Task 12: Startup valideerimine serveril

**Files:**
- Modify: `server/main.py` (startup hook)

- [ ] **Samm 1: Lisa `validate_places_config()` startup kutsesse**

Otsi `server/main.py`-st `lifespan` funktsioon (või `@app.on_event("startup")`). Lisa **esimese** avaldusena — enne `build_work_id_cache()` ja enne `rebuild_indices` threadi käivitamist, et vigane konfiguratsioon blokeerib serveri käivitumise varakult:

```python
# server/main.py — lifespan funktsiooni ESIMENE avaldus:
from server.prosopography.places_ops import validate_places_config
try:
    validate_places_config()
    logger.info("places.json + origin_groups.json valideeritud")
except ValueError as e:
    logger.error("places.json konfiguratsiooniviga: %s", e)
    # fail-fast: enne rebuild_indices threadi käivitamist
    raise SystemExit(1)
```

- [ ] **Samm 2: Testi lokaalselt**

```bash
python -c "
import os; os.environ.setdefault('VUTT_DATA_DIR', 'data')
from server.prosopography.places_ops import validate_places_config
validate_places_config()
print('Valideerimine OK')
"
```

- [ ] **Samm 3: Commit**

```bash
git add server/main.py
git commit -m "feat: startup valideerib places.json + origin_groups.json konfiguratsioon"
```

---

## Task 13: Migratsiooniskriptid

**Files:**
- Create: `scripts/migrate_origin_dry_run.py`
- Create: `scripts/migrate_origin.py`

- [ ] **Samm 1: Kirjuta dry-run skript**

```python
# scripts/migrate_origin_dry_run.py
"""
Analüüsib olemasolevaid isikufaile ja prindib kõik origin.city/region väärtused
mis POLE places.json võtmed. Käivita enne migratsiooni!
"""
import glob, json, os, sys

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")

def load_places():
    try:
        with open(PLACES_FILE) as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"VIGA: places.json ei leitud: {PLACES_FILE}")
        sys.exit(1)

def main():
    places = load_places()
    known_keys = set(places.keys())

    unmapped_city = set()
    unmapped_region = set()
    total = 0

    for fpath in glob.glob(os.path.join(PROSOPO_DIR, "*.json")):
        try:
            with open(fpath) as f:
                person = json.load(f)
        except Exception:
            continue
        if person.get("record_status") == "tombstone":
            continue
        total += 1
        origin = person.get("origin") or {}
        city = origin.get("city")
        region = origin.get("region")
        if city and city not in known_keys:
            unmapped_city.add(city)
        if region and region not in known_keys:
            unmapped_region.add(region)

    print(f"\nKokku isikuid: {total}")
    print(f"\norigin.city väärtused mis pole places.json võtmed ({len(unmapped_city)}):")
    for v in sorted(unmapped_city):
        print(f"  - {v!r}")
    print(f"\norigin.region väärtused mis pole places.json võtmed ({len(unmapped_region)}):")
    for v in sorted(unmapped_region):
        print(f"  - {v!r}")

    if not unmapped_city and not unmapped_region:
        print("\n✓ Kõik väärtused on places.json-s. Migratsiooni võib käivitada.")
    else:
        print("\n⚠ Lisa puuduvad kohad places.json-i enne migratsiooni käivitamist.")

if __name__ == "__main__":
    main()
```

- [ ] **Samm 2: Kirjuta migratsiooniskript**

```python
# scripts/migrate_origin.py
"""
Migreerib isikufailide origin.city/region → origin.place.
Käivita PÄRAST dry-run analüüsi ja places.json täiendamist.
"""
import glob, json, os, sys
from datetime import datetime, timezone

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")
STATE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "state")
PROSOPO_DIR = os.path.join(STATE_DIR, "prosopography")
PLACES_FILE = os.path.join(DATA_ROOT, "config", "places.json")

def load_places():
    with open(PLACES_FILE) as f:
        return json.load(f)

def migrate_person(person: dict, places: dict, dry_run: bool) -> tuple[bool, str]:
    """Tagastab (changed, log_msg)."""
    origin = person.get("origin") or {}
    city = origin.get("city")
    region = origin.get("region")

    # Kui origin.place on juba olemas, ei muuda
    if origin.get("place") is not None:
        return False, "place juba olemas, vahele jäetud"

    new_place = None
    if city:
        if city in places:
            new_place = city
        else:
            return False, f"UNMAPPED city={city!r} — vahele jäetud"
    elif region:
        if region in places:
            new_place = region
        else:
            return False, f"UNMAPPED region={region!r} — vahele jäetud"

    if new_place is None:
        return False, "pole city ega region — vahele jäetud"

    # Ehita uus origin
    entry = places[new_place]
    new_origin = {
        "place": new_place,
        "place_id": entry.get("id"),
        "place_labels": entry.get("labels"),
        "geonames_id": origin.get("geonames_id"),
        "coordinates": origin.get("coordinates"),
    }
    person["origin"] = new_origin
    return True, f"city={city!r} region={region!r} → place={new_place!r}"

def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY-RUN režiim — faile ei kirjutata")

    places = load_places()
    updated = 0
    skipped = 0
    errors = 0

    for fpath in sorted(glob.glob(os.path.join(PROSOPO_DIR, "*.json"))):
        try:
            with open(fpath) as f:
                person = json.load(f)
        except Exception as e:
            print(f"VIGA lugemisel {fpath}: {e}")
            errors += 1
            continue

        if person.get("record_status") == "tombstone":
            continue

        changed, msg = migrate_person(person, places, dry_run)
        pid = person.get("id", os.path.basename(fpath))

        if changed:
            updated += 1
            print(f"  {pid}: {msg}")
            if not dry_run:
                person["updated_at"] = datetime.now(timezone.utc).isoformat()
                tmp = fpath + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(person, f, ensure_ascii=False, indent=2)
                os.replace(tmp, fpath)
        else:
            skipped += 1

    print(f"\nKokku: uuendatud={updated}, vahele jäetud={skipped}, vigu={errors}")
    if not dry_run and updated > 0:
        print("\nPärast migratsiooni käivita serveril rebuild_indices:")
        print("  POST /prosopography/admin/rebuild-indices")

if __name__ == "__main__":
    main()
```

- [ ] **Samm 3: Commit**

```bash
git add scripts/migrate_origin_dry_run.py scripts/migrate_origin.py
git commit -m "feat: migratsiooniskriptid origin.city → origin.place"
```

---

## Task 14: Deploy + rebuild

**Ainult serveril — ei nõua koodimuutusi**

- [ ] **Samm 1: Deploy backend**

```bash
ssh vutt
cd ~/VUTT && git pull
./scripts/server_update.sh
```

- [ ] **Samm 2: Deploy frontend**

Lokaalselt:
```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

- [ ] **Samm 3: Käivita dry-run analüüs serveril**

```bash
ssh vutt
cd ~/VUTT
python3 scripts/migrate_origin_dry_run.py
```

Tulemus: lisa kõik puuduvad kohad `places.json`-i enne järgmist sammu.

- [ ] **Samm 4: Käivita migratsiooni eelvaade**

```bash
python3 scripts/migrate_origin.py --dry-run
```

- [ ] **Samm 5: Käivita migratsiooni tegelikult**

```bash
python3 scripts/migrate_origin.py
```

- [ ] **Samm 6: Rebuild indeksid**

```bash
curl -X POST http://localhost:8002/prosopography/admin/rebuild-indices \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

---

## Self-Review

### Spec coverage

| Spec sektsiooni | Task |
|-----------------|------|
| §1a `origin_groups.json` | Task 1 |
| §1b `places.json` hierarhia | Task 1 |
| §2 Andmemudel `origin.place` | Task 8 (helpers), Task 3 (backend) |
| §3a `_walk_to_group` MAX=5 | Task 2 |
| §3b `_get_parent_place` | Task 2 |
| §3c `_index_entry_from_person` 5 välja | Task 3 |
| §3d `_get_place_labels` | Task 2 |
| §3e `_enrich_origin_from_places` | Task 2, Task 3 |
| §3f Propagatsioon background task | Task 2 (`_propagate_place_change`) |
| §3g `list_persons` origin_group filter | Task 4 |
| §3g `get_person_facets` origin_groups | Task 4 |
| §3h Endpointid + type valideerimine | Task 5 |
| §4 `PlacePicker` komponent | Task 7 |
| §4 `noQCode` hoiatus inline-lisamisel | Task 7 |
| §5 PersonCard keele fallback | Task 9 |
| §6 PersonsPage `origin_group` URL param | Task 10 |
| §7 Frontend tüübid | Task 6 |
| §8 Tõlked | Task 11 |
| §9 Testid backend | Task 2 |
| §9 Testid frontend | PersonCard + PlacePicker — käsitsi UI test |
| Migratsioon dry-run | Task 13 |
| Startup valideerimine | Task 12 |

### Placeholder scan

Kõik sammud sisaldavad konkreetset koodi.

### Type consistency

- `PlaceEntry` defineeritud `types.ts`-s (Task 6), kasutatav `PlacePicker.tsx`-s (Task 7) ✓
- `OriginParent` defineeritud `types.ts`-s (Task 6), `ProsopoIndexEntry.origin_parent` tüübis ✓
- `origin_place: string` (mitte `null`) `FormDraft`-s — tühjus = `''`, `onChange(key ?? '')` ✓
- Backend `_resolve_origin_group` → tagastab `Optional[str]`, `_index_entry_from_person` kasutab — ✓
- `addPlace()` service tagastab `{key, entry}`, `PlacePicker` kasutab `result.key` ja `result.entry` ✓
