# Kohtade haldur — implementatsiooniplaani

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ehita admin leht `/admin/places` kohtade registri haldamiseks — hierarhiapuu + detailpaneel, redigeerimise vorm, ühendamine (merge) ja minikaart koordinaatidele.

**Architecture:** Backend saab uue `merge_places()` funktsiooni + `POST /admin/places/{source_key}/merge` endpointi. Frontend: `AddPlaceModal` ekstraktida PlacePicker.tsx-ist, uued komponendid `PlacesTree`, `PlacesDetail`, `PlacesMergeModal` ja pealeht `Places.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, react-leaflet 5, lucide-react, vitest (frontend tests), pytest (backend tests).

---

## Failide kaart

| Fail | Muudatus |
|------|----------|
| `server/prosopography/places_ops.py` | Lisa `merge_places()` |
| `server/prosopography/router.py` | Lisa `POST /admin/places/{source_key}/merge` endpoint |
| `tests/test_places_ops.py` | Lisa merge testid |
| `src/prosopography/components/AddPlaceModal.tsx` | **Uus** — ekstrakteeria PlacePicker.tsx-ist |
| `src/prosopography/components/personForm/PlacePicker.tsx` | Eemalda AddPlaceModal + searchWikidataPlaces, impordi uuest failist |
| `src/prosopography/services/prosopographyService.ts` | Lisa `updatePlace()` ja `mergePlaces()` |
| `src/locales/et/admin.json` | Lisa `cards.places` + `places.*` võtmed |
| `src/locales/en/admin.json` | Sama inglise keeles |
| `src/pages/admin/placesTreeUtils.ts` | **Uus** — `buildPlacesTree()` puhtfunktsioon |
| `src/pages/admin/__tests__/placesTreeUtils.test.ts` | **Uus** — vitest testid puufunktsioonile |
| `src/pages/admin/PlacesTree.tsx` | **Uus** — hierarhiapuu komponent |
| `src/pages/admin/PlacesDetail.tsx` | **Uus** — detailpaneel + editvorm + minikaart |
| `src/pages/admin/PlacesMergeModal.tsx` | **Uus** — merge modaal |
| `src/pages/admin/Places.tsx` | **Uus** — pealeht |
| `src/pages/Admin.tsx` | Lisa "Kohtade register" kaart |
| `src/App.tsx` | Lisa `/admin/places` route |

---

## Task 1: Backend — `merge_places()` funktsioon + testid

**Files:**
- Modify: `server/prosopography/places_ops.py`
- Modify: `tests/test_places_ops.py`

- [ ] **Samm 1: Kirjuta puuduvad testid `tests/test_places_ops.py` lõppu**

```python
# ── merge_places ────────────────────────────────────────────────────────────

def test_merge_places_redirects_persons(tmp_path):
    """Ühendamisel uuendatakse kõik isikud kelle origin.place == source_key."""
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()

    places = {
        "Wexionensis": {"labels": {"et": "Wexionensis"}, "type": "parish", "historical_names": []},
        "Smaland": {"labels": {"et": "Smaland"}, "type": "province", "historical_names": ["ex Smolandia"]},
    }
    places_file.write_text(json.dumps(places))
    groups_file.write_text(json.dumps({}))

    person1 = {"id": "aaa", "name": "Johannes", "origin": {"place": "Wexionensis"}}
    person2 = {"id": "bbb", "name": "Andreas", "origin": {"place": "Wexionensis"}}
    person3 = {"id": "ccc", "name": "Petrus", "origin": {"place": "Smaland"}}
    (prosopo_dir / "aaa.json").write_text(json.dumps(person1))
    (prosopo_dir / "bbb.json").write_text(json.dumps(person2))
    (prosopo_dir / "ccc.json").write_text(json.dumps(person3))

    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
        patch("server.prosopography.places_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)),
    ):
        from server.prosopography.places_ops import merge_places
        result = merge_places("Wexionensis", "Smaland")

    assert result["redirected"] == 2
    p1 = json.loads((prosopo_dir / "aaa.json").read_text())
    p2 = json.loads((prosopo_dir / "bbb.json").read_text())
    p3 = json.loads((prosopo_dir / "ccc.json").read_text())
    assert p1["origin"]["place"] == "Smaland"
    assert p2["origin"]["place"] == "Smaland"
    assert p3["origin"]["place"] == "Smaland"  # oli juba Smaland


def test_merge_places_adds_source_to_historical_names(tmp_path):
    """Source võti lisatakse sihtkoha historical_names listi."""
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()

    places = {
        "Wexionensis": {"labels": {"et": "Wexionensis"}, "historical_names": ["cohaesivi"]},
        "Smaland": {"labels": {"et": "Smaland"}, "historical_names": ["ex Smolandia"]},
    }
    places_file.write_text(json.dumps(places))
    groups_file.write_text(json.dumps({}))

    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
        patch("server.prosopography.places_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)),
    ):
        from server.prosopography.places_ops import merge_places
        merge_places("Wexionensis", "Smaland")

    updated_places = json.loads(places_file.read_text())
    assert "Wexionensis" not in updated_places
    assert "Wexionensis" in updated_places["Smaland"]["historical_names"]
    assert "ex Smolandia" in updated_places["Smaland"]["historical_names"]  # vana säilib


def test_merge_places_raises_on_missing_source(tmp_path):
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    places_file.write_text(json.dumps({"Smaland": {"labels": {}, "historical_names": []}}))
    groups_file.write_text(json.dumps({}))

    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
        patch("server.prosopography.places_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)),
    ):
        from server.prosopography.places_ops import merge_places
        with pytest.raises(ValueError, match="Source"):
            merge_places("TundmatuKoht", "Smaland")


def test_merge_places_raises_on_missing_target(tmp_path):
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    places_file.write_text(json.dumps({"Wexionensis": {"labels": {}, "historical_names": []}}))
    groups_file.write_text(json.dumps({}))

    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
        patch("server.prosopography.places_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)),
    ):
        from server.prosopography.places_ops import merge_places
        with pytest.raises(ValueError, match="Target"):
            merge_places("Wexionensis", "TundmatuSiht")


def test_merge_places_raises_on_self_merge(tmp_path):
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    places_file.write_text(json.dumps({"Smaland": {"labels": {}, "historical_names": []}}))
    groups_file.write_text(json.dumps({}))

    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
        patch("server.prosopography.places_ops.PROSOPOGRAPHY_DIR", str(prosopo_dir)),
    ):
        from server.prosopography.places_ops import merge_places
        with pytest.raises(ValueError, match="ise"):
            merge_places("Smaland", "Smaland")
```

- [ ] **Samm 2: Käivita testid — veendu et need läbi ei lähe**

```bash
.venv/bin/python -m pytest tests/test_places_ops.py::test_merge_places_redirects_persons tests/test_places_ops.py::test_merge_places_adds_source_to_historical_names tests/test_places_ops.py::test_merge_places_raises_on_missing_source tests/test_places_ops.py::test_merge_places_raises_on_missing_target tests/test_places_ops.py::test_merge_places_raises_on_self_merge -v
```

Oodatav: `ERROR` — `merge_places` ei ole veel defineeritud.

- [ ] **Samm 3: Lisa `merge_places()` `server/prosopography/places_ops.py` lõppu**

Lisa järgmise koodi lõppu faili (pärast `refresh_all_place_labels()`):

```python
# Vajalik import faili alguses (lisa olemasolevate importide hulka):
# import glob as _glob
# (kontrollida kas _glob juba on imporditud — ops.py kasutab seda, places_ops.py ei pruugi)

PROSOPOGRAPHY_DIR: str  # deklareerida tüübina — tegelik import järgmisest reast:

def merge_places(source_key: str, target_key: str) -> dict:
    """
    Ühendab source_key sihtkoha target_key alla.
    1. Uuendab kõik isikud kelle origin.place == source_key → target_key.
    2. Lisab source_key sihtkoha historical_names listi.
    3. Kustutab source_key places.json-st.
    4. Tagastab {"redirected": N, "target_key": target_key}.
    """
    import glob as _glob

    from ..config import PROSOPOGRAPHY_DIR as _PROSOPOGRAPHY_DIR

    # Lae PROSOPOGRAPHY_DIR — toetab ka mock'imist testides
    try:
        prosopo_dir = PROSOPOGRAPHY_DIR  # type: ignore[name-defined]
    except NameError:
        prosopo_dir = _PROSOPOGRAPHY_DIR

    if source_key == target_key:
        raise ValueError("Ei saa kohta iseendaga ühendada")

    places = _load_places_cache(force_reload=True)

    if source_key not in places:
        raise ValueError(f"Source koht ei leitud: {source_key!r}")
    if target_key not in places:
        raise ValueError(f"Target koht ei leitud: {target_key!r}")

    # 1. Uuenda isikute failid
    redirected = 0
    pattern = os.path.join(prosopo_dir, "*.json")
    for fpath in _glob.glob(pattern):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                person = json.load(f)
        except Exception:
            continue
        origin = person.get("origin")
        if not isinstance(origin, dict):
            continue
        if origin.get("place") != source_key:
            continue
        origin["place"] = target_key
        atomic_write_json(fpath, person)
        redirected += 1

    # 2. Lisa source_key sihtkoha historical_names-i
    target = dict(places[target_key])
    hist = list(target.get("historical_names") or [])
    if source_key not in hist:
        hist.append(source_key)
    target["historical_names"] = hist
    places[target_key] = target

    # 3. Kustuta source
    del places[source_key]

    atomic_write_json(PLACES_FILE, places)
    _load_places_cache(force_reload=True)

    logger.info("merge_places: %s → %s, %d isikut ümber suunatud", source_key, target_key, redirected)
    return {"redirected": redirected, "target_key": target_key}
```

**NB:** Kontrolli kas `_glob` on juba imporditud failis. Kui mitte, lisa faili algusesse: `import glob as _glob`. Siis eemalda `import glob as _glob` funktsiooni seest ja kasuta `_glob.glob(...)` otse.

- [ ] **Samm 4: Käivita testid — veendu et need läbivad**

```bash
.venv/bin/python -m pytest tests/test_places_ops.py -v
```

Oodatav: kõik testid `PASSED`.

- [ ] **Samm 5: Commit**

```bash
git add server/prosopography/places_ops.py tests/test_places_ops.py
git commit -m "feat: add merge_places() to places_ops with tests"
```

---

## Task 2: Backend — merge router endpoint

**Files:**
- Modify: `server/prosopography/router.py`

- [ ] **Samm 1: Lisa import `router.py` algusesse**

Leia rida kus on `from .places_ops import ...` ja lisa `merge_places` listi:

```python
from .places_ops import get_places, get_places_meta, put_place, search_places_wikidata, fetch_place_wikidata, _propagate_place_change, refresh_all_place_labels, merge_places
```

- [ ] **Samm 2: Lisa endpoint ENNE `@router.put("/admin/places/{key}")` rida**

```python
@router.post("/admin/places/{source_key}/merge")
async def places_merge(
    source_key: str,
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(_require_role("admin")),
):
    """
    Ühendab source_key sihtkoha target_key alla (admin).
    Body: {"target_key": "smaland"}
    Tagastab: {"redirected": N, "target_key": "smaland"}
    """
    data = await _get_json(request)
    target_key = data.get("target_key", "").strip()
    if not target_key:
        raise HTTPException(status_code=400, detail="target_key on kohustuslik")
    try:
        result = merge_places(source_key, target_key)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    background_tasks.add_task(_propagate_place_change, target_key)

    return result
```

- [ ] **Samm 3: Kontrolli käsitsi**

```bash
ssh vutt "cd ~/VUTT && docker logs vutt-backend --tail=5"
```

Oodatav: server jookseb vigadeta (testid ei kata endpointi otseselt, piisab suitsu-testist).

- [ ] **Samm 4: Commit**

```bash
git add server/prosopography/router.py
git commit -m "feat: add POST /admin/places/{source_key}/merge endpoint"
```

---

## Task 3: Extract AddPlaceModal + frontend service functions

**Files:**
- Create: `src/prosopography/components/AddPlaceModal.tsx`
- Modify: `src/prosopography/components/personForm/PlacePicker.tsx`
- Modify: `src/prosopography/services/prosopographyService.ts`

- [ ] **Samm 1: Loo `src/prosopography/components/AddPlaceModal.tsx`**

Kopeeri PlacePicker.tsx-ist `searchWikidataPlaces` funktsioon, `AddPlaceModalProps` interface, `WdPreview` interface ja `AddPlaceModal` komponent uude faili. Lisa vajalikud impordid:

```typescript
import React, { useState, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Search, Loader2, Plus } from 'lucide-react';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import { addPlace, fetchPlaceWikidata } from '../services/prosopographyService';
import type { PlaceEntry } from '../types';

export async function searchWikidataPlaces(
  q: string,
  lang: string,
): Promise<{ q: string; label: string; description: string; aliases: string[] }[]> {
  if (!q.trim()) return [];
  const params = new URLSearchParams({
    action: 'wbsearchentities', search: q, language: lang,
    format: 'json', type: 'item', limit: '10', origin: '*',
  });
  try {
    const resp = await fetchWithTimeout(
      `https://www.wikidata.org/w/api.php?${params}`,
      { timeout: 10000 },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.search ?? []).map((item: any) => ({
      q: item.id, label: item.label ?? '',
      description: item.description ?? '', aliases: item.aliases ?? [],
    }));
  } catch { return []; }
}
```

Seejärel kopeeri `AddPlaceModalProps`, `WdPreview` ja `AddPlaceModal` täielikult PlacePicker.tsx-ist siia faili. Lisa faili lõppu:

```typescript
export default AddPlaceModal;
```

- [ ] **Samm 2: Uuenda `PlacePicker.tsx` — eemalda duplikaat-kood, impordi uuest failist**

Kustuta PlacePicker.tsx-ist:
- `searchWikidataPlaces` funktsioon (rida 10–19)
- `AddPlaceModalProps` interface
- `WdPreview` interface
- `AddPlaceModal` komponent (read 46–481)

Lisa faili algusesse import:

```typescript
import AddPlaceModal, { searchWikidataPlaces } from '../AddPlaceModal';
```

- [ ] **Samm 3: Lisa `updatePlace` ja `mergePlaces` `prosopographyService.ts` lõppu**

```typescript
export async function updatePlace(
  key: string,
  data: Partial<PlaceEntry> & { historical_names?: string[]; notes?: string },
  token: string,
): Promise<{ key: string; entry: PlaceEntry }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/places/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(data),
      timeout: 10000,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `updatePlace: ${resp.status}`);
  }
  return resp.json();
}

export async function mergePlaces(
  sourceKey: string,
  targetKey: string,
  token: string,
): Promise<{ redirected: number; target_key: string }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/places/${encodeURIComponent(sourceKey)}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify({ target_key: targetKey }),
      timeout: 15000,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `mergePlaces: ${resp.status}`);
  }
  return resp.json();
}
```

Kontrolli et `BASE` on defineeritud samas failis (on juba: `const BASE = ...`). Kontrolli et `getAuthHeaders` on imporditud.

- [ ] **Samm 4: Kontrolli et TypeScript kompileerub**

```bash
npm run build 2>&1 | head -30
```

Oodatav: 0 TypeScript viga.

- [ ] **Samm 5: Commit**

```bash
git add src/prosopography/components/AddPlaceModal.tsx src/prosopography/components/personForm/PlacePicker.tsx src/prosopography/services/prosopographyService.ts
git commit -m "refactor: extract AddPlaceModal, add updatePlace/mergePlaces service"
```

---

## Task 4: Tõlked

**Files:**
- Modify: `src/locales/et/admin.json`
- Modify: `src/locales/en/admin.json`

- [ ] **Samm 1: Lisa eestikeelsed tõlked `src/locales/et/admin.json`**

Lisa `"cards"` objekti:
```json
"places": "Kohtade register"
```

Lisa uus `"places"` objekt faili tipptasemele (nt pärast `"maintenance"` blokki):
```json
"places": {
  "tab": "Kohtade register",
  "search": "Otsi kohanimega, ajaloolise nimega…",
  "addPlace": "Lisa koht",
  "selectPrompt": "Vali vasakult koht",
  "noQCode": "Q-kood puudub",
  "wikidata": "Wikidata",
  "map": "Kaardil",
  "persons": "Isikut",
  "personsLabel": "ISIKUD ({{count}})",
  "personsEmpty": "Sellel kohal isikuid ei ole",
  "personsMore": "… ja {{count}} rohkem",
  "edit": "Redigeeri",
  "merge": "Ühenda",
  "editTitle": "Redigeeri: {{name}}",
  "save": "Salvesta",
  "saving": "Salvestan…",
  "cancel": "Tühista",
  "saveError": "Salvestamine ebaõnnestus",
  "labels": "Nimed",
  "type": "Tüüp",
  "qcode": "Q-kood",
  "parentPlace": "Ülempiirkond",
  "group": "Grupp",
  "historicalNames": "Ajaloolised nimed",
  "addHistoricalName": "+ lisa",
  "coordinates": "Koordinaadid",
  "notes": "Märkused",
  "mergeTitle": "Ühenda kohad",
  "mergeDescription": "Ühenda <strong>{{source}}</strong> teise kohaga — kõik isikud suunatakse ümber ja praegune kirje kustutatakse.",
  "mergeSearch": "Otsi sihtkohta…",
  "mergeConfirm": "Ühenda {{count}} isikut kohale \"{{target}}\"",
  "mergeConfirmZero": "Ühenda (isikuid pole — ohutu kustutada)",
  "merging": "Ühendan…",
  "mergeError": "Ühendamine ebaõnnestus",
  "mergeSuccess": "Ühendatud — {{count}} isikut suunati ümber",
  "parentLink": "→ {{name}}",
  "ungrouped": "(määramata grupp)",
  "loadError": "Kohtade laadimine ebaõnnestus"
}
```

- [ ] **Samm 2: Lisa ingliskeelsed tõlked `src/locales/en/admin.json`**

Lisa `"cards"` objekti:
```json
"places": "Place Register"
```

Lisa uus `"places"` objekt:
```json
"places": {
  "tab": "Place Register",
  "search": "Search by place name, historical name…",
  "addPlace": "Add place",
  "selectPrompt": "Select a place on the left",
  "noQCode": "No Q-code",
  "wikidata": "Wikidata",
  "map": "On map",
  "persons": "persons",
  "personsLabel": "PERSONS ({{count}})",
  "personsEmpty": "No persons at this place",
  "personsMore": "… and {{count}} more",
  "edit": "Edit",
  "merge": "Merge",
  "editTitle": "Edit: {{name}}",
  "save": "Save",
  "saving": "Saving…",
  "cancel": "Cancel",
  "saveError": "Save failed",
  "labels": "Names",
  "type": "Type",
  "qcode": "Q-code",
  "parentPlace": "Parent region",
  "group": "Group",
  "historicalNames": "Historical names",
  "addHistoricalName": "+ add",
  "coordinates": "Coordinates",
  "notes": "Notes",
  "mergeTitle": "Merge places",
  "mergeDescription": "Merge <strong>{{source}}</strong> into another place — all persons will be redirected and this entry will be deleted.",
  "mergeSearch": "Search target place…",
  "mergeConfirm": "Merge {{count}} persons into \"{{target}}\"",
  "mergeConfirmZero": "Merge (no persons — safe to delete)",
  "merging": "Merging…",
  "mergeError": "Merge failed",
  "mergeSuccess": "Merged — {{count}} persons redirected",
  "parentLink": "→ {{name}}",
  "ungrouped": "(no group)",
  "loadError": "Failed to load places"
}
```

- [ ] **Samm 3: Commit**

```bash
git add src/locales/et/admin.json src/locales/en/admin.json
git commit -m "i18n: add places admin translations (et + en)"
```

---

## Task 5: `buildPlacesTree` utiliit + testid

**Files:**
- Create: `src/pages/admin/placesTreeUtils.ts`
- Create: `src/pages/admin/__tests__/placesTreeUtils.test.ts`

- [ ] **Samm 1: Kirjuta testid `src/pages/admin/__tests__/placesTreeUtils.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildPlacesTree } from '../placesTreeUtils';
import type { PlaceEntry } from '../../../prosopography/types';

const PLACES: Record<string, PlaceEntry> = {
  Smaland: { labels: { et: 'Smaland', sv: 'Småland' }, type: 'province', group: 'rootsi' } as PlaceEntry,
  Wexionensis: { labels: { et: 'Wexionensis' }, type: 'parish', parent_key: 'Smaland' } as PlaceEntry,
  Kronoberg: { labels: { et: 'Kronoberg' }, type: 'county', parent_key: 'Smaland' } as PlaceEntry,
  Riga: { labels: { et: 'Riia', en: 'Riga' }, type: 'city', parent_key: 'Livland' } as PlaceEntry,
  Livland: { labels: { et: 'Liivimaa' }, type: 'historical_region', group: 'liivimaa' } as PlaceEntry,
  Isolated: { labels: { et: 'Isoleeritud' }, type: 'city' } as PlaceEntry,
};

const GROUPS = {
  rootsi: { labels: { et: 'Rootsi piirkonnad' }, sort_order: 10 },
  liivimaa: { labels: { et: 'Liivimaa' }, sort_order: 20 },
};

describe('buildPlacesTree', () => {
  it('grupeerib kohad origin_groups järgi', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const groupKeys = tree.map(g => g.groupKey);
    expect(groupKeys).toContain('rootsi');
    expect(groupKeys).toContain('liivimaa');
  });

  it('sorteerib grupid sort_order järgi', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    expect(tree[0].groupKey).toBe('rootsi');
    expect(tree[1].groupKey).toBe('liivimaa');
  });

  it('paneb grupita kohad lõppu', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const last = tree[tree.length - 1];
    expect(last.groupKey).toBeNull();
    expect(last.nodes.some(n => n.key === 'Isolated')).toBe(true);
  });

  it('ehitab parent-child hierarhia', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const rootsiGroup = tree.find(g => g.groupKey === 'rootsi')!;
    const smaland = rootsiGroup.nodes.find(n => n.key === 'Smaland')!;
    expect(smaland.children.map(c => c.key)).toContain('Wexionensis');
    expect(smaland.children.map(c => c.key)).toContain('Kronoberg');
  });

  it('Riga on Livlandi all, mitte eraldi juurena', () => {
    const tree = buildPlacesTree(PLACES, GROUPS);
    const liivimaaGroup = tree.find(g => g.groupKey === 'liivimaa')!;
    const livland = liivimaaGroup.nodes.find(n => n.key === 'Livland')!;
    expect(livland.children.map(c => c.key)).toContain('Riga');
    const allRoots = liivimaaGroup.nodes.map(n => n.key);
    expect(allRoots).not.toContain('Riga');
  });

  it('tagastab tühja puu kui kohti pole', () => {
    expect(buildPlacesTree({}, {})).toEqual([]);
  });
});
```

- [ ] **Samm 2: Käivita testid — veendu et need läbi ei lähe**

```bash
npm test -- placesTreeUtils 2>&1 | tail -15
```

Oodatav: `FAIL` — `buildPlacesTree` ei ole veel defineeritud.

- [ ] **Samm 3: Loo `src/pages/admin/placesTreeUtils.ts`**

```typescript
import type { PlaceEntry } from '../../prosopography/types';

export interface PlaceTreeNode {
  key: string;
  entry: PlaceEntry;
  children: PlaceTreeNode[];
}

export interface PlaceTreeGroup {
  groupKey: string | null;
  groupLabels: Record<string, string> | null;
  sortOrder: number;
  nodes: PlaceTreeNode[];
}

function resolveGroupKey(
  placeKey: string,
  places: Record<string, PlaceEntry>,
  depth = 0,
): string | null {
  if (depth > 5) return null;
  const entry = places[placeKey];
  if (!entry) return null;
  if (entry.group) return entry.group;
  if (!entry.parent_key) return null;
  return resolveGroupKey(entry.parent_key, places, depth + 1);
}

function buildSubtree(
  rootKey: string,
  places: Record<string, PlaceEntry>,
  groupKey: string | null,
  placeGroupMap: Map<string, string | null>,
): PlaceTreeNode {
  const children = Object.entries(places)
    .filter(([k, e]) => e.parent_key === rootKey && placeGroupMap.get(k) === groupKey)
    .map(([k]) => buildSubtree(k, places, groupKey, placeGroupMap));
  return { key: rootKey, entry: places[rootKey], children };
}

export function buildPlacesTree(
  places: Record<string, PlaceEntry>,
  groups: Record<string, { labels?: Record<string, string>; sort_order?: number }>,
): PlaceTreeGroup[] {
  const placeGroupMap = new Map<string, string | null>();
  for (const key of Object.keys(places)) {
    placeGroupMap.set(key, resolveGroupKey(key, places));
  }

  const groupRoots = new Map<string | null, string[]>();
  for (const [key, entry] of Object.entries(places)) {
    const myGroup = placeGroupMap.get(key) ?? null;
    const parentGroup = entry.parent_key ? (placeGroupMap.get(entry.parent_key) ?? null) : null;
    if (!entry.parent_key || parentGroup !== myGroup) {
      const roots = groupRoots.get(myGroup) ?? [];
      roots.push(key);
      groupRoots.set(myGroup, roots);
    }
  }

  const result: PlaceTreeGroup[] = [];

  const sortedGroups = Object.entries(groups).sort(
    ([, a], [, b]) => (a.sort_order ?? 50) - (b.sort_order ?? 50),
  );

  for (const [groupKey, groupMeta] of sortedGroups) {
    const roots = groupRoots.get(groupKey) ?? [];
    if (roots.length === 0) continue;
    result.push({
      groupKey,
      groupLabels: groupMeta.labels ?? null,
      sortOrder: groupMeta.sort_order ?? 50,
      nodes: roots.map(k => buildSubtree(k, places, groupKey, placeGroupMap)),
    });
  }

  const ungroupedRoots = groupRoots.get(null) ?? [];
  if (ungroupedRoots.length > 0) {
    result.push({
      groupKey: null,
      groupLabels: null,
      sortOrder: 999,
      nodes: ungroupedRoots.map(k => buildSubtree(k, places, null, placeGroupMap)),
    });
  }

  return result;
}
```

- [ ] **Samm 4: Käivita testid — veendu et need läbivad**

```bash
npm test -- placesTreeUtils 2>&1 | tail -15
```

Oodatav: kõik testid `PASS`.

- [ ] **Samm 5: Commit**

```bash
git add src/pages/admin/placesTreeUtils.ts src/pages/admin/__tests__/placesTreeUtils.test.ts
git commit -m "feat: add buildPlacesTree utility with tests"
```

---

## Task 6: `PlacesTree` komponent

**Files:**
- Create: `src/pages/admin/PlacesTree.tsx`

- [ ] **Samm 1: Loo `src/pages/admin/PlacesTree.tsx`**

```typescript
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import type { PlaceTreeGroup, PlaceTreeNode } from './placesTreeUtils';

interface PlacesTreeProps {
  groups: PlaceTreeGroup[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

function TreeNode({
  node, depth, selectedKey, onSelect, lang,
}: {
  node: PlaceTreeNode;
  depth: number;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  lang: string;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const isSelected = node.key === selectedKey;
  const hasQCode = !!node.entry.id;

  return (
    <div>
      <button
        type="button"
        onClick={() => { onSelect(node.key); if (hasChildren) setOpen(o => !o); }}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        className={`w-full text-left flex items-center gap-1 py-1 pr-2 rounded text-sm
          ${isSelected ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
      >
        <span className="shrink-0 w-4 text-gray-400">
          {hasChildren
            ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />)
            : <span className="inline-block w-3" />}
        </span>
        <span className="truncate flex-1">{resolveLabel(node.entry.labels, lang)}</span>
        {node.entry.type && (
          <span className="text-xs text-gray-400 shrink-0">{node.entry.type}</span>
        )}
        {!hasQCode && (
          <AlertTriangle size={11} className="text-amber-400 shrink-0" title="Q-kood puudub" />
        )}
      </button>
      {hasChildren && open && (
        <div>
          {node.children.map(child => (
            <TreeNode
              key={child.key}
              node={child}
              depth={depth + 1}
              selectedKey={selectedKey}
              onSelect={onSelect}
              lang={lang}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const PlacesTree: React.FC<PlacesTreeProps> = ({ groups, selectedKey, onSelect, lang }) => {
  const { t } = useTranslation('admin');

  if (groups.length === 0) {
    return <p className="px-3 py-4 text-sm text-gray-400 italic">Kohti pole</p>;
  }

  return (
    <div className="py-2">
      {groups.map(group => (
        <div key={group.groupKey ?? '__ungrouped'} className="mb-3">
          <div className="px-3 pb-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {group.groupLabels
              ? resolveLabel(group.groupLabels, lang)
              : t('places.ungrouped')}
          </div>
          {group.nodes.map(node => (
            <TreeNode
              key={node.key}
              node={node}
              depth={0}
              selectedKey={selectedKey}
              onSelect={onSelect}
              lang={lang}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export default PlacesTree;
```

- [ ] **Samm 2: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep -i "error" | head -10
```

Oodatav: 0 viga.

- [ ] **Samm 3: Commit**

```bash
git add src/pages/admin/PlacesTree.tsx
git commit -m "feat: add PlacesTree component"
```

---

## Task 7: `PlacesMergeModal` komponent

**Files:**
- Create: `src/pages/admin/PlacesMergeModal.tsx`

- [ ] **Samm 1: Loo `src/pages/admin/PlacesMergeModal.tsx`**

```typescript
import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { mergePlaces } from '../../prosopography/services/prosopographyService';
import type { PlaceEntry } from '../../prosopography/types';

interface PlacesMergeModalProps {
  sourceKey: string;
  sourceEntry: PlaceEntry;
  places: Record<string, PlaceEntry>;
  personCount: number;
  token: string;
  lang: string;
  onMerged: (targetKey: string, redirected: number) => void;
  onClose: () => void;
}

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

const PlacesMergeModal: React.FC<PlacesMergeModalProps> = ({
  sourceKey, sourceEntry, places, personCount, token, lang, onMerged, onClose,
}) => {
  const { t } = useTranslation('admin');
  const [query, setQuery] = useState('');
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceName = resolveLabel(sourceEntry.labels, lang);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return [];
    return Object.entries(places)
      .filter(([k]) => k !== sourceKey)
      .filter(([k, e]) => {
        const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
        const inHist = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
        return inLabels || inHist || k.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [query, places, sourceKey]);

  const targetEntry = targetKey ? places[targetKey] : null;
  const targetName = targetEntry ? resolveLabel(targetEntry.labels, lang) : '';

  const handleMerge = async () => {
    if (!targetKey) return;
    setMerging(true);
    setError(null);
    try {
      const result = await mergePlaces(sourceKey, targetKey, token);
      onMerged(targetKey, result.redirected);
    } catch (e: any) {
      setError(e.message ?? t('places.mergeError'));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900">{t('places.mergeTitle')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <p
          className="text-sm text-gray-600 mb-4"
          dangerouslySetInnerHTML={{ __html: t('places.mergeDescription', { source: sourceName }) }}
        />

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        {!targetKey ? (
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('places.mergeSearch')}
              autoFocus
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            />
            {filtered.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filtered.map(([k, e]) => (
                  <button
                    key={k}
                    type="button"
                    onMouseDown={() => { setTargetKey(k); setQuery(''); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 border-b border-gray-50 last:border-0 flex items-baseline gap-2"
                  >
                    <span className="font-medium">{resolveLabel(e.labels, lang)}</span>
                    {e.type && <span className="text-xs text-gray-400">({e.type})</span>}
                    <span className="ml-auto text-xs font-mono text-gray-300">{k}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-800">{targetName}</p>
              <p className="text-xs text-green-600 font-mono">{targetKey}</p>
            </div>
            <button
              type="button"
              onClick={() => setTargetKey(null)}
              className="text-green-400 hover:text-green-600"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            {t('places.cancel')}
          </button>
          <button
            onClick={handleMerge}
            disabled={!targetKey || merging}
            className="px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {merging && <Loader2 size={13} className="animate-spin" />}
            {targetKey
              ? (personCount > 0
                ? t('places.mergeConfirm', { count: personCount, target: targetName })
                : t('places.mergeConfirmZero'))
              : t('places.merge')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlacesMergeModal;
```

- [ ] **Samm 2: Commit**

```bash
git add src/pages/admin/PlacesMergeModal.tsx
git commit -m "feat: add PlacesMergeModal component"
```

---

## Task 8: `PlacesDetail` komponent

**Files:**
- Create: `src/pages/admin/PlacesDetail.tsx`

- [ ] **Samm 1: Loo `src/pages/admin/PlacesDetail.tsx`**

```typescript
import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Edit2, GitMerge, Loader2, X, Plus } from 'lucide-react';
import { MapContainer, Marker, TileLayer } from 'react-leaflet';
import { icon } from 'leaflet';
import { updatePlace, fetchPlaces, fetchPlacesMeta } from '../../prosopography/services/prosopographyService';
import type { PlaceEntry } from '../../prosopography/types';
import PlacesMergeModal from './PlacesMergeModal';

const PLACE_TYPES = ['city', 'village', 'parish', 'county', 'province', 'territory', 'historical_region'];
const LANGS = ['et', 'en', 'de', 'la', 'sv'];

const ZOOM_BY_TYPE: Record<string, number> = {
  city: 9, village: 9, parish: 9,
  county: 6, province: 6, territory: 6, historical_region: 6,
};

const DEFAULT_MARKER = icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41],
});

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

interface PlacesDetailProps {
  placeKey: string;
  entry: PlaceEntry;
  places: Record<string, PlaceEntry>;
  meta: { groups: Record<string, any>; allowed_types: string[] } | null;
  personCount: number;
  personSample: { id: string; name: string; imm_year?: number | null }[];
  token: string;
  lang: string;
  onUpdated: (key: string, entry: PlaceEntry) => void;
  onMerged: (sourceKey: string, targetKey: string) => void;
  onSelectKey: (key: string) => void;
}

const PlacesDetail: React.FC<PlacesDetailProps> = ({
  placeKey, entry, places, meta, personCount, personSample,
  token, lang, onUpdated, onMerged, onSelectKey,
}) => {
  const { t } = useTranslation('admin');
  const [editing, setEditing] = useState(false);
  const [showMerge, setShowMerge] = useState(false);

  // Edit form state
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [placeType, setPlaceType] = useState('');
  const [qCode, setQCode] = useState('');
  const [parentKey, setParentKey] = useState('');
  const [parentQuery, setParentQuery] = useState('');
  const [parentDropOpen, setParentDropOpen] = useState(false);
  const [group, setGroup] = useState('');
  const [historicalNames, setHistoricalNames] = useState<string[]>([]);
  const [newHistName, setNewHistName] = useState('');
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const name = resolveLabel(entry.labels, lang) || placeKey;

  useEffect(() => {
    if (editing) {
      setLabels({ ...(entry.labels ?? {}) });
      setPlaceType(entry.type ?? '');
      setQCode(entry.id ?? '');
      setParentKey(entry.parent_key ?? '');
      setParentQuery(entry.parent_key
        ? (resolveLabel(places[entry.parent_key]?.labels, lang) || entry.parent_key)
        : '');
      setGroup(entry.group ?? '');
      setHistoricalNames([...(entry.historical_names ?? [])]);
      setNewHistName('');
      setLat(entry.coordinates?.lat != null ? String(entry.coordinates.lat) : '');
      setLon(entry.coordinates?.lon != null ? String(entry.coordinates.lon) : '');
      setNotes(entry.notes ?? '');
      setSaveError(null);
    }
  }, [editing]);

  const filteredParents = Object.entries(places)
    .filter(([k]) => k !== placeKey)
    .filter(([k, e]) => {
      const q = parentQuery.toLowerCase();
      if (!q) return false;
      return (
        k.toLowerCase().includes(q) ||
        Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q))
      );
    })
    .slice(0, 8);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const latNum = lat.trim() ? parseFloat(lat) : undefined;
      const lonNum = lon.trim() ? parseFloat(lon) : undefined;
      const coordinates =
        latNum != null && lonNum != null && !isNaN(latNum) && !isNaN(lonNum)
          ? { lat: latNum, lon: lonNum }
          : null;

      const data: any = {
        labels: Object.fromEntries(Object.entries(labels).filter(([, v]) => v.trim())),
        type: placeType || undefined,
        id: qCode.trim() || null,
        parent_key: parentKey || undefined,
        group: group || undefined,
        historical_names: historicalNames,
        notes: notes || undefined,
      };
      if (coordinates !== undefined) data.coordinates = coordinates;

      const result = await updatePlace(placeKey, data, token);
      onUpdated(result.key, result.entry);
      setEditing(false);
    } catch (e: any) {
      setSaveError(e.message ?? t('places.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const coords = entry.coordinates;
  const hasCoords = coords && typeof coords.lat === 'number' && typeof coords.lon === 'number';
  const zoom = ZOOM_BY_TYPE[entry.type ?? ''] ?? 7;

  const wikidataUrl = entry.id ? `https://www.wikidata.org/wiki/${entry.id}` : null;
  const osmUrl = hasCoords
    ? `https://www.openstreetmap.org/?mlat=${coords!.lat}&mlon=${coords!.lon}&zoom=10`
    : null;

  if (editing) {
    return (
      <div className="p-4 overflow-y-auto h-full">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-gray-900">{t('places.editTitle', { name })}</h3>
        </div>
        {saveError && <p className="mb-3 text-xs text-red-600">{saveError}</p>}

        {/* Labelid */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.labels')}</label>
          <div className="space-y-1">
            {LANGS.map(l => (
              <div key={l} className="flex items-center gap-2">
                <span className="w-5 text-xs text-gray-400 font-mono shrink-0">{l}</span>
                <input
                  type="text"
                  value={labels[l] ?? ''}
                  onChange={e => setLabels(prev => ({ ...prev, [l]: e.target.value }))}
                  className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Tüüp + Q-kood */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">{t('places.type')}</label>
            <select
              value={placeType}
              onChange={e => setPlaceType(e.target.value)}
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            >
              <option value="">—</option>
              {PLACE_TYPES.map(tp => <option key={tp} value={tp}>{tp}</option>)}
            </select>
          </div>
          <div className="w-32">
            <label className="block text-xs text-gray-500 mb-1">{t('places.qcode')}</label>
            <input
              type="text"
              value={qCode}
              onChange={e => setQCode(e.target.value)}
              placeholder="Q12345"
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono"
            />
          </div>
        </div>

        {/* Ülempiirkond */}
        <div className="mb-3 relative">
          <label className="block text-xs text-gray-500 mb-1">{t('places.parentPlace')}</label>
          <input
            type="text"
            value={parentKey ? `${parentQuery} (${parentKey})` : parentQuery}
            onChange={e => { setParentQuery(e.target.value); setParentKey(''); setParentDropOpen(true); }}
            onFocus={() => { if (!parentKey) setParentDropOpen(true); }}
            onBlur={() => setTimeout(() => setParentDropOpen(false), 150)}
            readOnly={!!parentKey}
            placeholder="Otsi ülempiirkonda…"
            className={`w-full px-2 py-1.5 text-sm border rounded focus:ring-1 focus:ring-primary-500 outline-none
              ${parentKey ? 'border-green-300 bg-green-50 text-green-800' : 'border-gray-300'}`}
          />
          {parentKey && (
            <button
              type="button"
              onClick={() => { setParentKey(''); setParentQuery(''); }}
              className="absolute right-2 top-7 text-gray-400 hover:text-gray-600"
            >
              <X size={13} />
            </button>
          )}
          {parentDropOpen && !parentKey && filteredParents.length > 0 && (
            <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
              {filteredParents.map(([k, e]) => (
                <button
                  key={k}
                  type="button"
                  onMouseDown={() => {
                    setParentKey(k);
                    setParentQuery(resolveLabel(e.labels, lang) || k);
                    setParentDropOpen(false);
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-primary-50 border-b border-gray-50 last:border-0 flex items-baseline gap-2"
                >
                  <span className="font-medium">{resolveLabel(e.labels, lang)}</span>
                  <span className="ml-auto text-xs font-mono text-gray-300">{k}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Grupp */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.group')}</label>
          <select
            value={group}
            onChange={e => setGroup(e.target.value)}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
          >
            <option value="">—</option>
            {Object.entries(meta?.groups ?? {})
              .sort(([, a]: any, [, b]: any) => (a.sort_order ?? 50) - (b.sort_order ?? 50))
              .map(([k, v]: any) => (
                <option key={k} value={k}>{resolveLabel(v.labels, lang) || k}</option>
              ))}
          </select>
        </div>

        {/* Ajaloolised nimed */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.historicalNames')}</label>
          <div className="flex flex-wrap gap-1 mb-1">
            {historicalNames.map(n => (
              <span key={n} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs flex items-center gap-1">
                {n}
                <button
                  type="button"
                  onClick={() => setHistoricalNames(hn => hn.filter(x => x !== n))}
                  className="text-blue-400 hover:text-blue-600"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={newHistName}
              onChange={e => setNewHistName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && newHistName.trim()) {
                  e.preventDefault();
                  setHistoricalNames(hn => [...hn, newHistName.trim()]);
                  setNewHistName('');
                }
              }}
              placeholder="Lisa nimi + Enter"
              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            />
            <button
              type="button"
              onClick={() => {
                if (newHistName.trim()) {
                  setHistoricalNames(hn => [...hn, newHistName.trim()]);
                  setNewHistName('');
                }
              }}
              className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>

        {/* Koordinaadid */}
        <div className="mb-3">
          <label className="block text-xs text-gray-500 mb-1">{t('places.coordinates')}</label>
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={lat}
              onChange={e => setLat(e.target.value)}
              placeholder="lat (57.18)"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono"
            />
            <input
              type="text"
              inputMode="decimal"
              value={lon}
              onChange={e => setLon(e.target.value)}
              placeholder="lon (14.59)"
              className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none font-mono"
            />
          </div>
        </div>

        {/* Märkused */}
        <div className="mb-4">
          <label className="block text-xs text-gray-500 mb-1">{t('places.notes')}</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none resize-none"
          />
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setEditing(false)}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            {t('places.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            {t(saving ? 'places.saving' : 'places.save')}
          </button>
        </div>
      </div>
    );
  }

  // Detailvaade
  return (
    <div className="p-4 overflow-y-auto h-full">
      {/* Päis */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">{name}</h2>
          <div className="flex flex-wrap gap-1.5">
            {entry.type && (
              <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">{entry.type}</span>
            )}
            {wikidataUrl && (
              <a href={wikidataUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-blue-600 border border-blue-200 bg-blue-50 px-2 py-0.5 rounded-full hover:bg-blue-100">
                🌐 {entry.id}
              </a>
            )}
            {osmUrl && hasCoords && (
              <a href={osmUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-emerald-600 border border-emerald-200 bg-emerald-50 px-2 py-0.5 rounded-full hover:bg-emerald-100">
                📍 {coords!.lat.toFixed(4)}°N, {coords!.lon.toFixed(4)}°E
              </a>
            )}
            <span className="text-xs text-gray-500 border border-gray-200 px-2 py-0.5 rounded-full">
              👥 {personCount}
            </span>
          </div>
        </div>
        <div className="flex gap-2 shrink-0 ml-2">
          <button
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded hover:bg-primary-700"
          >
            <Edit2 size={13} />
            {t('places.edit')}
          </button>
          <button
            onClick={() => setShowMerge(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded hover:bg-violet-700"
          >
            <GitMerge size={13} />
            {t('places.merge')}
          </button>
        </div>
      </div>

      {/* Minikaart */}
      {hasCoords && (
        <div className="mb-3 rounded-lg overflow-hidden border border-gray-200" style={{ height: 120 }}>
          <MapContainer
            center={[coords!.lat, coords!.lon]}
            zoom={zoom}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={false}
            dragging={true}
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <Marker position={[coords!.lat, coords!.lon]} icon={DEFAULT_MARKER} />
          </MapContainer>
        </div>
      )}

      {/* Andmetabel */}
      <div className="bg-gray-50 rounded-lg border border-gray-100 p-3 mb-3 text-sm space-y-1.5">
        {LANGS.filter(l => entry.labels?.[l]).map(l => (
          <div key={l} className="flex gap-3">
            <span className="w-5 text-xs text-gray-400 font-mono shrink-0 mt-0.5">{l}</span>
            <span className="text-gray-800">{entry.labels![l]}</span>
          </div>
        ))}
        {entry.parent_key && (
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.parentPlace')}</span>
            <button
              type="button"
              onClick={() => onSelectKey(entry.parent_key!)}
              className="text-primary-600 hover:text-primary-800 text-sm"
            >
              {resolveLabel(places[entry.parent_key]?.labels, lang) || entry.parent_key} ↗
            </button>
          </div>
        )}
        {(entry.historical_names ?? []).length > 0 && (
          <div className="flex gap-3 flex-wrap">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.historicalNames')}</span>
            <div className="flex flex-wrap gap-1">
              {(entry.historical_names ?? []).map(n => (
                <span key={n} className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">{n}</span>
              ))}
            </div>
          </div>
        )}
        {entry.group && meta?.groups[entry.group] && (
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.group')}</span>
            <span className="text-gray-700">{resolveLabel(meta.groups[entry.group].labels, lang)}</span>
          </div>
        )}
        {entry.notes && (
          <div className="flex gap-3">
            <span className="text-xs text-gray-400 shrink-0 mt-0.5">{t('places.notes')}</span>
            <span className="text-gray-700">{entry.notes}</span>
          </div>
        )}
      </div>

      {/* Isikute loend */}
      <div>
        <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          {t('places.personsLabel', { count: personCount })}
        </div>
        {personCount === 0 ? (
          <p className="text-sm text-gray-400 italic">{t('places.personsEmpty')}</p>
        ) : (
          <div className="bg-gray-50 rounded-lg border border-gray-100 overflow-hidden">
            {personSample.map(p => (
              <div key={p.id} className="flex items-center justify-between px-3 py-1.5 text-sm border-b border-gray-100 last:border-0">
                <Link to={`/persons/${p.id}`} className="text-primary-600 hover:text-primary-800">{p.name}</Link>
                {p.imm_year && <span className="text-xs text-gray-400">{p.imm_year}</span>}
              </div>
            ))}
            {personCount > personSample.length && (
              <Link
                to={`/persons?origin_place=${encodeURIComponent(placeKey)}`}
                className="block px-3 py-1.5 text-xs text-gray-400 hover:text-primary-600"
              >
                {t('places.personsMore', { count: personCount - personSample.length })}
              </Link>
            )}
          </div>
        )}
      </div>

      {showMerge && (
        <PlacesMergeModal
          sourceKey={placeKey}
          sourceEntry={entry}
          places={places}
          personCount={personCount}
          token={token}
          lang={lang}
          onMerged={(targetKey, redirected) => {
            setShowMerge(false);
            onMerged(placeKey, targetKey);
          }}
          onClose={() => setShowMerge(false)}
        />
      )}
    </div>
  );
};

export default PlacesDetail;
```

- [ ] **Samm 2: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep "error" | head -10
```

- [ ] **Samm 3: Commit**

```bash
git add src/pages/admin/PlacesDetail.tsx
git commit -m "feat: add PlacesDetail component with edit form and mini-map"
```

---

## Task 9: `Places.tsx` pealeht

**Files:**
- Create: `src/pages/admin/Places.tsx`

- [ ] **Samm 1: Loo `src/pages/admin/Places.tsx`**

```typescript
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Loader2, Search, Plus } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { fetchPlaces, fetchPlacesMeta } from '../../prosopography/services/prosopographyService';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { FILE_API_URL } from '../../config';
import type { PlaceEntry } from '../../prosopography/types';
import { buildPlacesTree } from './placesTreeUtils';
import PlacesTree from './PlacesTree';
import PlacesDetail from './PlacesDetail';
import AddPlaceModal from '../../prosopography/components/AddPlaceModal';

const MAX_PERSON_SAMPLE = 5;

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

const Places: React.FC = () => {
  const { t, i18n } = useTranslation('admin');
  const lang = i18n.language?.slice(0, 2) ?? 'et';
  const { user, authToken, isLoading: userLoading } = useUser();
  const navigate = useNavigate();

  const [places, setPlaces] = useState<Record<string, PlaceEntry>>({});
  const [meta, setMeta] = useState<{ groups: Record<string, any>; allowed_types: string[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  // Isikute arv koha kaupa (laetakse prosopograafia indeksist)
  const [personCounts, setPersonCounts] = useState<Record<string, number>>({});
  const [personSamples, setPersonSamples] = useState<
    Record<string, { id: string; name: string; imm_year?: number | null }[]>
  >({});

  useEffect(() => {
    if (!userLoading && (!user || user.role !== 'admin')) navigate('/');
  }, [user, userLoading, navigate]);

  useEffect(() => {
    if (!authToken) return;
    setLoading(true);
    Promise.all([fetchPlaces(), fetchPlacesMeta()])
      .then(([p, m]) => { setPlaces(p); setMeta(m); })
      .catch(() => setLoadError(t('places.loadError')))
      .finally(() => setLoading(false));
  }, [authToken]);

  // Lae isikute statistika
  useEffect(() => {
    if (!authToken || Object.keys(places).length === 0) return;
    fetchWithTimeout(`${FILE_API_URL}/prosopography?limit=5000`, {
      headers: getAuthHeaders(authToken),
    })
      .then(r => r.json())
      .then((data: any) => {
        const counts: Record<string, number> = {};
        const samples: Record<string, { id: string; name: string; imm_year?: number | null }[]> = {};
        for (const entry of (data.entries ?? [])) {
          const pk = entry.origin_place;
          if (!pk) continue;
          counts[pk] = (counts[pk] ?? 0) + 1;
          if (!samples[pk]) samples[pk] = [];
          if (samples[pk].length < MAX_PERSON_SAMPLE) {
            samples[pk].push({
              id: entry.id,
              name: entry.name ?? entry.id,
              imm_year: entry.imm_year ?? null,
            });
          }
        }
        setPersonCounts(counts);
        setPersonSamples(samples);
      })
      .catch(() => {});
  }, [authToken, places]);

  const treeGroups = useMemo(() => buildPlacesTree(places, meta?.groups ?? {}), [places, meta]);

  // Otsingu tulemused (flat list)
  const searchResults = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return null;
    return Object.entries(places).filter(([k, e]) => {
      const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
      const inHist = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
      return inLabels || inHist || k.toLowerCase().includes(q);
    });
  }, [searchQuery, places]);

  const handleUpdated = useCallback((key: string, entry: PlaceEntry) => {
    setPlaces(prev => ({ ...prev, [key]: entry }));
  }, []);

  const handleMerged = useCallback((sourceKey: string, _targetKey: string) => {
    setPlaces(prev => {
      const next = { ...prev };
      delete next[sourceKey];
      return next;
    });
    setSelectedKey(null);
  }, []);

  if (userLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (user.role !== 'admin') return null;

  const selectedEntry = selectedKey ? places[selectedKey] : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header showSearchButton={false} pageTitle={t('places.tab')} />
      <div className="max-w-5xl mx-auto px-4 py-8">
        <Link to="/admin" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6">
          <ChevronLeft size={16} />
          Admin
        </Link>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Otsingubaar */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
            <Search size={14} className="text-gray-400 shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder={t('places.search')}
              className="flex-1 text-sm outline-none text-gray-700 placeholder-gray-400"
            />
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 shrink-0"
            >
              <Plus size={14} />
              {t('places.addPlace')}
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : loadError ? (
            <p className="p-6 text-sm text-red-600">{loadError}</p>
          ) : (
            <div className="flex" style={{ minHeight: 'calc(100vh - 240px)' }}>
              {/* Vasak: puu / otsingutulemused */}
              <div className="w-64 border-r border-gray-100 overflow-y-auto shrink-0">
                {searchResults ? (
                  <div className="py-2">
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-gray-400 italic">Tulemusi ei leitud</p>
                    ) : (
                      searchResults.map(([k, e]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setSelectedKey(k)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-baseline gap-2 rounded mx-1
                            ${selectedKey === k ? 'bg-primary-50 text-primary-700 font-medium' : 'text-gray-700 hover:bg-gray-50'}`}
                        >
                          <span className="truncate flex-1">{resolveLabel(e.labels, lang)}</span>
                          {e.type && <span className="text-xs text-gray-400 shrink-0">{e.type}</span>}
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <PlacesTree
                    groups={treeGroups}
                    selectedKey={selectedKey}
                    onSelect={setSelectedKey}
                    lang={lang}
                  />
                )}
              </div>

              {/* Parem: detailpaneel */}
              <div className="flex-1 overflow-hidden">
                {selectedEntry ? (
                  <PlacesDetail
                    placeKey={selectedKey!}
                    entry={selectedEntry}
                    places={places}
                    meta={meta}
                    personCount={personCounts[selectedKey!] ?? 0}
                    personSample={personSamples[selectedKey!] ?? []}
                    token={authToken ?? ''}
                    lang={lang}
                    onUpdated={handleUpdated}
                    onMerged={handleMerged}
                    onSelectKey={setSelectedKey}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-sm text-gray-400 italic">
                    {t('places.selectPrompt')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <AddPlaceModal
          query=""
          meta={meta}
          places={places}
          token={authToken ?? ''}
          onAdd={(key, entry) => {
            setPlaces(prev => ({ ...prev, [key]: entry }));
            setShowAddModal(false);
            setSelectedKey(key);
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  );
};

export default Places;
```

- [ ] **Samm 2: Kontrolli TypeScript**

```bash
npm run build 2>&1 | grep "error" | head -20
```

- [ ] **Samm 3: Commit**

```bash
git add src/pages/admin/Places.tsx
git commit -m "feat: add Places admin page"
```

---

## Task 10: Navigatsiooni ühendamine

**Files:**
- Modify: `src/pages/Admin.tsx`
- Modify: `src/App.tsx`

- [ ] **Samm 1: Lisa Admin.tsx-is import ja kaart**

Lisa impordi reale `{ UserPlus, Users, Upload, Library, History, Trash2, Wrench }` ka `MapPin`:

```typescript
import { UserPlus, Users, Upload, Library, History, Trash2, Wrench, MapPin } from 'lucide-react';
```

Lisa `cards` massiivi (nt pärast `collections` kirjet):

```typescript
{
  key: 'places',
  icon: <MapPin size={18} className="text-teal-600" />,
  group: t('admin:groups.settings'),
  href: '/admin/places',
},
```

- [ ] **Samm 2: Lisa route App.tsx-is**

Leia `lazyRetry` importide plokk ja lisa:

```typescript
const AdminPlaces = lazyRetry(() => import('./pages/admin/Places'));
```

Leia `/admin/maintenance` route ja lisa pärast seda:

```typescript
{
  path: "/admin/places",
  element: <Lazy><AdminPlaces /></Lazy>,
},
```

- [ ] **Samm 3: Käivita kõik testid**

```bash
npm test 2>&1 | tail -20
.venv/bin/python -m pytest tests/test_places_ops.py -v 2>&1 | tail -20
```

Oodatav: kõik `PASS`.

- [ ] **Samm 4: Ehita production build**

```bash
npm run build 2>&1 | tail -10
```

Oodatav: 0 viga.

- [ ] **Samm 5: Commit**

```bash
git add src/pages/Admin.tsx src/App.tsx
git commit -m "feat: wire up /admin/places route and admin card"
```

---

## Lõplik deploy

```bash
# Frontend
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/

# Backend (kui server/prosopography/places_ops.py või router.py muutus)
ssh vutt "cd ~/VUTT && git pull && docker compose build --no-cache backend && docker compose up -d backend"
```

Kontrolli brauseris: `/admin` → "Kohtade register" kaart → `/admin/places` avaneb, hierarhiapuu nähtav, koha valimisel ilmub detailpaneel koordinaatide minikaardiga.
