# Kaardi halduspiirid level 2+3 ja hover-esiletõst — implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/persons` ajalooline kaart näitab Saksa-Rooma riigi sees ka selle osi (OHM `admin_level=3`) ning hover-esiletõst muutub selgelt loetavaks.

**Architecture:** Backend küsib OHM Overpassist kahte haldustaset korraga, arvutab igale alamüksusele lähima ülemise tasandi vanema ja lisab need GeoJSON-i omadustesse. Frontend jagab senise ühe täite- ja joonekihi kaheks tasemepaariks, mille läbipaistvus sõltub suumist; **sama suumilävend juhib ka hiire-tabamust**, sest MapLibre tagastab `queryRenderedFeatures()`-ist ka läbipaistvusega 0 kihid. Hover saab valge casing-joone alla, et piir loeks reljeefse aluskaardi peal.

**Tech Stack:** FastAPI + shapely + osm2geojson (backend), React 19 + TypeScript + Leaflet + maplibre-gl 5.24 + `@maplibre/maplibre-gl-leaflet` (frontend), pytest + vitest.

**Spekk:** `docs/superpowers/specs/2026-08-10-kaardi-piirid-level3-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles** (CLAUDE.md).
- **Python 3.9 ühilduvus:** `Optional[int]`, mitte `int | None`. `from typing import Optional`.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002). Selles töös muutuvad ainult sync-funktsioonid, mida `router.py` kutsub juba `run_in_threadpool` kaudu — seda mustrit ei muudeta.
- **Uusi i18n-võtmeid ei lisandu.** Tooltip kuvab ainult nimesid. ADR 0011 (`fallbackLng` väljas) väravaid see töö ei puuduta.
- **`REGION_DETAIL_ZOOM` on MapLibre'i suumiskaalas**, mitte Leafleti omas, ja on **ainus** tõe allikas nii paint-avaldistele kui hit-testile.
- **Väravad iga taski lõpus:** `.venv/bin/pytest tests/` (backend), `npm run typecheck && npm test` (frontend), `npm run lint:ci` enne lõppu. Kasuta ALATI `.venv/bin/python`, mitte süsteemi `python3`.
- **Väärtused spekist, mida ei tohi omavoliliselt muuta:** `PARENT_MIN_CONTAINMENT = 0.75`, hover-täide `0.42`, hover-joon `4` px, casing `7` px / `rgba(255, 255, 255, 0.85)`, L2 täide alla lävendi `0.10` ja üle lävendi `0`, L3 täide `0` → `0.10`.

## Failistruktuur

| Fail | Vastutus | Staatus |
|---|---|---|
| `server/prosopography/region_hierarchy.py` | **Puhas geomeetria:** lapse → lähima ülemise tasandi vanema leidmine. Ei tea Overpassist, cache'ist ega GeoJSON-ist midagi. | uus |
| `server/prosopography/historical_regions.py` | Overpassi päring, GeoJSON-teisendus, cache. Kutsub `region_hierarchy`-t. | muudetakse |
| `tests/test_region_hierarchy.py` | Hierarhia ühiktestid. | uus |
| `tests/test_historical_regions.py` | Olemasolev; laieneb. | muudetakse |
| `src/prosopography/utils/regionLayers.ts` | **Puhas valikuloogika:** kihi-ID-d, `REGION_DETAIL_ZOOM`, `regionQueryLayers`, `pickRegionFeature`. Ei impordi MapLibre'i ega Leafletit. | uus |
| `src/prosopography/utils/__tests__/regionLayers.test.ts` | Valikuloogika ühiktestid. | uus |
| `src/prosopography/components/HistoricalMapLayer.tsx` | Kihtide elutsükkel, paint-avaldised, hover ja tooltip. | muudetakse |
| `src/prosopography/types.ts` | `HistoricalRegionProperties` laieneb. | muudetakse |

Puhtad moodulid (`region_hierarchy.py`, `regionLayers.ts`) on eraldi seetõttu, et
neid saab testida ilma shapely-Overpassi torustiku ega MapLibre'i mockimiseta.

---

### Task 1: Vanema leidmine puhta moodulina

**Files:**
- Create: `server/prosopography/region_hierarchy.py`
- Test: `tests/test_region_hierarchy.py`

**Interfaces:**
- Consumes: shapely geomeetriaobjektid (`shapely.geometry.base.BaseGeometry`)
- Produces:
  - `PARENT_MIN_CONTAINMENT: float = 0.75`
  - `find_parents(levels: Sequence[int], geometries: Sequence[BaseGeometry], min_containment: float = PARENT_MIN_CONTAINMENT) -> List[Optional[int]]` — tagastab iga sisendelemendi kohta vanema **indeksi** samas järjestuses või `None`

**Taustainfo teostajale.** OHM-i `admin_level` on **väiksem arv = kõrgem tasand**: 2 = suveräänne riik, 3 = selle alamüksus. „Vanem" tähendab siin väiksema `admin_level`-i väärtusega üksust. Kui komplektis on kolm taset (2, 3, 4), peab level-4 üksus leidma **kõigepealt level-3** vanema ja alles selle puudumisel level-2 oma — muidu hüppaks hierarhia üle astme ja sõltuks iteratsioonijärjekorrast.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `tests/test_region_hierarchy.py`:

```python
from shapely.geometry import box

from server.prosopography.region_hierarchy import PARENT_MIN_CONTAINMENT, find_parents


def test_taielikult_sisalduv_laps_saab_vanema():
    # Riik (0,0)-(10,10), selle sees alamüksus (1,1)-(3,3).
    levels = [2, 3]
    geometries = [box(0, 0, 10, 10), box(1, 1, 3, 3)]
    assert find_parents(levels, geometries) == [None, 0]


def test_osaliselt_kattuv_laps_ei_saa_vanemat():
    # Alamüksusest jääb pool riigist välja (Brandenburg-Preußeni juhtum).
    levels = [2, 3]
    geometries = [box(0, 0, 10, 10), box(9, 0, 11, 10)]
    assert find_parents(levels, geometries) == [None, None]


def test_lavendi_ules_jaav_kattuvus_annab_vanema():
    # 80% lapsest on riigi sees — üle PARENT_MIN_CONTAINMENT lävendi.
    levels = [2, 3]
    geometries = [box(0, 0, 10, 10), box(8, 0, 10.5, 10)]
    ratio = geometries[1].intersection(geometries[0]).area / geometries[1].area
    assert ratio > PARENT_MIN_CONTAINMENT
    assert find_parents(levels, geometries) == [None, 0]


def test_valitakse_lahim_ulemine_tase_mitte_tipp():
    # Level 4 asub korraga level-3 ja level-2 üksuse sees; vanem peab olema level 3.
    levels = [2, 3, 4]
    geometries = [box(0, 0, 10, 10), box(0, 0, 5, 5), box(1, 1, 2, 2)]
    assert find_parents(levels, geometries) == [None, 0, 1]


def test_puuduva_vahetaseme_korral_langetakse_jargmisele_astmele():
    # Level 4 ei mahu ühessegi level-3 üksusesse, aga mahub level-2 sisse.
    levels = [2, 3, 4]
    geometries = [box(0, 0, 10, 10), box(0, 0, 2, 2), box(6, 6, 7, 7)]
    assert find_parents(levels, geometries) == [None, 0, 0]


def test_vordse_kattuvuse_korral_voidab_esimene_kandidaat():
    # Laps on täielikult mõlema kandidaadi sees (suhe 1.0 mõlemal). Reegel on
    # "rangelt suurem suhe võidab", seega jääb peale esimene kvalifitseerunu.
    levels = [2, 2, 3]
    geometries = [box(0, 0, 10, 10), box(0, 0, 20, 20), box(1, 1, 2, 2)]
    assert find_parents(levels, geometries)[2] == 0


def test_tuhi_sisend_ei_kuku_labi():
    assert find_parents([], []) == []
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_region_hierarchy.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.prosopography.region_hierarchy'`

- [ ] **Step 3: Kirjuta moodul**

Loo `server/prosopography/region_hierarchy.py`:

```python
"""Halduspiirkondade hierarhia: lapsele lähima ülemise tasandi vanema leidmine.

Puhas geomeetria — ei tea Overpassist, cache'ist ega GeoJSON-i kujust midagi.
OHM-i `admin_level`-is on VÄIKSEM arv kõrgem tasand (2 = riik, 3 = selle osa).
"""

from typing import List, Optional, Sequence

from shapely.errors import GEOSException
from shapely.geometry.base import BaseGeometry

# Osa lapse pindalast, mis peab kandidaadi sisse jääma, et teda vanemaks lugeda.
# Osaliselt kattuv üksus (nt Brandenburg-Preußen, mille üks pool jääb HRR-ist
# välja) peab jääma vanemata: puuduv vanem on parem kui vale vanem.
PARENT_MIN_CONTAINMENT = 0.75


def _containment_ratio(child: BaseGeometry, candidate: BaseGeometry, child_area: float) -> float:
    """Osa lapse pindalast, mis jääb kandidaadi sisse."""
    if candidate.contains(child):
        return 1.0
    if not candidate.intersects(child):
        return 0.0
    try:
        return candidate.intersection(child).area / child_area
    except GEOSException:
        # Üks vigane polügoon ei tohi kogu piirkonnakihti maha võtta.
        return 0.0


def _parent_index(
    index: int,
    levels: Sequence[int],
    geometries: Sequence[BaseGeometry],
    ancestor_levels: Sequence[int],
    min_containment: float,
) -> Optional[int]:
    child = geometries[index]
    child_area = child.area
    if child_area <= 0:
        return None

    # Lähim ülemine tase enne kaugemat: level 4 otsib kõigepealt level-3 vanemat.
    for candidate_level in ancestor_levels:
        if candidate_level >= levels[index]:
            continue
        best_index = None
        best_ratio = 0.0
        for other, other_level in enumerate(levels):
            if other == index or other_level != candidate_level:
                continue
            ratio = _containment_ratio(child, geometries[other], child_area)
            if ratio >= min_containment and ratio > best_ratio:
                best_index = other
                best_ratio = ratio
        if best_index is not None:
            return best_index
    return None


def find_parents(
    levels: Sequence[int],
    geometries: Sequence[BaseGeometry],
    min_containment: float = PARENT_MIN_CONTAINMENT,
) -> List[Optional[int]]:
    """Igale elemendile vanema indeks samas järjestuses või None.

    Ruutkeerukus on siinsete mahtude juures (Euroopas ~80–300 piirkonda) tähtsusetu.
    """
    ancestor_levels = sorted(set(levels), reverse=True)
    return [
        _parent_index(index, levels, geometries, ancestor_levels, min_containment)
        for index in range(len(levels))
    ]
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_region_hierarchy.py -v`
Expected: PASS, 7 testi

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/region_hierarchy.py tests/test_region_hierarchy.py
git commit -m "feat(kaart): halduspiirkondade vanema leidmine puhta moodulina"
```

---

### Task 2: Kaks haldustaset Overpassi päringus ja GeoJSON-is

**Files:**
- Modify: `server/prosopography/historical_regions.py` (konstandid ~rida 38–51, `_build_overpass_query` ~183–189, `_normalize_geojson` ~265–316)
- Modify: `tests/test_historical_regions.py` (`test_overpass_query_filters_year_and_admin_level_two` ~55–60, `test_normalize_geojson_keeps_only_needed_localized_properties` ~63–78)

**Interfaces:**
- Consumes: `find_parents` Task 1-st
- Produces:
  - `ADMIN_LEVELS: Tuple[int, ...] = (2, 3)`
  - `_admin_level(tags: dict) -> Optional[int]`
  - GeoJSON feature `properties`, mida Task 5 frontendis tarbib: `relation_id`, `admin_level`, `name`, `label_et`, `label_en`, `start_date`, `end_date`, `color`, `parent_name`, `parent_label_et`, `parent_label_en`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Asenda `tests/test_historical_regions.py`-s funktsioon `test_overpass_query_filters_year_and_admin_level_two` järgmisega ja lisa allapoole uued testid. Muuda ka olemasolevat `_square_relation()` abifunktsiooni **mitte** — selle asemel lisa uus abifunktsioon.

```python
def test_overpass_query_filters_year_and_all_admin_levels():
    query = _build_overpass_query(1650, (50, 10, 65, 30))
    assert '"admin_level"~"^(2|3)$"' in query
    assert '1650-01-01' in query
    assert '(50,10,65,30)' in query
    assert 'out geom' in query


def _empire_with_circle():
    """Level-2 riik ja täielikult selle sees asuv level-3 alamüksus."""
    def ring(west, south, east, north):
        return [
            {"lat": south, "lon": west},
            {"lat": south, "lon": east},
            {"lat": north, "lon": east},
            {"lat": north, "lon": west},
            {"lat": south, "lon": west},
        ]

    return {
        "elements": [
            {
                "type": "relation",
                "id": 1,
                "members": [{"type": "way", "ref": 11, "role": "outer", "geometry": ring(10, 50, 20, 55)}],
                "tags": {
                    "type": "boundary", "boundary": "administrative", "admin_level": "2",
                    "name": "Sacrum Imperium Romanum", "name:et": "Saksa-Rooma riik",
                },
            },
            {
                "type": "relation",
                "id": 2,
                "members": [{"type": "way", "ref": 22, "role": "outer", "geometry": ring(11, 51, 13, 53)}],
                "tags": {
                    "type": "boundary", "boundary": "administrative", "admin_level": "3",
                    "name": "Bayerischer Reichskreis",
                },
            },
        ],
    }


def test_normalize_geojson_adds_admin_level_and_parent():
    result = _normalize_geojson(_empire_with_circle(), 0.001)
    features = {feature["id"]: feature["properties"] for feature in result["features"]}

    assert features[1]["admin_level"] == 2
    assert features[1]["parent_name"] is None
    assert features[2]["admin_level"] == 3
    assert features[2]["parent_name"] == "Sacrum Imperium Romanum"
    assert features[2]["parent_label_et"] == "Saksa-Rooma riik"


def test_normalize_geojson_sorts_larger_regions_first():
    result = _normalize_geojson(_empire_with_circle(), 0.001)
    # Suurem enne: väiksem jääb peale ja tuleb queryRenderedFeatures'is esimesena.
    assert [feature["id"] for feature in result["features"]] == [1, 2]


def test_normalize_geojson_skips_levels_outside_admin_levels():
    data = _empire_with_circle()
    data["elements"][1]["tags"]["admin_level"] = "8"
    result = _normalize_geojson(data, 0.001)
    assert [feature["id"] for feature in result["features"]] == [1]
```

Asenda ka olemasolev omaduste-võrdlus, sest properties-sõnastik laieneb:

```python
def test_normalize_geojson_keeps_only_needed_localized_properties():
    result = _normalize_geojson(_square_relation(), 0.001)
    assert result["type"] == "FeatureCollection"
    assert len(result["features"]) == 1
    feature = result["features"][0]
    assert feature["id"] == 123
    assert feature["geometry"]["type"] in ("Polygon", "MultiPolygon")
    assert feature["properties"] == {
        "relation_id": 123,
        "admin_level": 2,
        "name": "Testimaa",
        "label_et": None,
        "label_en": "Testland",
        "start_date": "1600",
        "end_date": "1700",
        "color": _region_color(123),
        "parent_name": None,
        "parent_label_et": None,
        "parent_label_en": None,
    }
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_historical_regions.py -v`
Expected: FAIL — `test_overpass_query_filters_year_and_all_admin_levels` ei leia regexi; `admin_level` puudub omadustest

- [ ] **Step 3: Muuda konstante ja päringu ehitajat**

`server/prosopography/historical_regions.py` — lisa importidesse `Optional` ja uus moodul:

```python
from typing import Dict, List, Optional, Tuple

from .region_hierarchy import find_parents
```

Lisa konstantide juurde (`MAX_BBOX_HEIGHT = 90` järele):

```python
# Küsitavad OHM-i haldustasemed. VÄIKSEM arv = kõrgem tasand (2 = riik, 3 = selle osa).
# Taseme muutmine invalideerib cache'i automaatselt CACHE_VARIANT-i kaudu.
ADMIN_LEVELS = (2, 3)
```

Asenda `_build_overpass_query`:

```python
def _admin_level_regex() -> str:
    return "^(" + "|".join(str(level) for level in ADMIN_LEVELS) + ")$"


def _build_overpass_query(year: int, bbox: Tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    date = f"{year:04d}-01-01"
    return f'''[out:json][timeout:60];
relation["boundary"="administrative"]["admin_level"~"{_admin_level_regex()}"]({south},{west},{north},{east})
(if: (!is_tag("start_date") || t["start_date"] <= "{date}") && (!is_tag("end_date") || t["end_date"] >= "{date}"));
out geom;'''
```

- [ ] **Step 4: Kirjuta `_normalize_geojson` ümber**

Lisa `_region_color` juurde abifunktsioon:

```python
def _admin_level(tags: dict) -> Optional[int]:
    """Lubatud haldustase arvuna; muu tase või puuduv silt annab None."""
    try:
        level = int(tags.get("admin_level", ""))
    except (TypeError, ValueError):
        return None
    return level if level in ADMIN_LEVELS else None
```

Asenda kogu `_normalize_geojson` funktsioon:

```python
def _normalize_geojson(overpass_data: dict, tolerance: float, wikidata_labels: dict = None) -> dict:
    """Teisendab Overpassi relatsioonid lihtsustatud ja väikseks GeoJSON-iks."""
    converted = osm2geojson.json2geojson(overpass_data, log_level="CRITICAL")
    converted_geometries = {
        feature.get("properties", {}).get("id"): feature.get("geometry")
        for feature in converted.get("features", [])
        if feature.get("geometry")
    }
    entries: List[dict] = []

    for element in overpass_data.get("elements", []):
        relation_id = element.get("id")
        tags = element.get("tags") or {}
        geometry_data = converted_geometries.get(relation_id)
        if not isinstance(relation_id, int):
            continue

        admin_level = _admin_level(tags)
        if admin_level is None:
            continue

        try:
            geometry = shape(geometry_data) if geometry_data else _fallback_all_inner_geometry(element)
            if geometry is None:
                continue
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            geometry = geometry.simplify(tolerance, preserve_topology=True)
        except Exception as exc:
            logger.warning("OHM relatsiooni %s geomeetria teisendamine ebaõnnestus: %s", relation_id, exc)
            continue

        if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            continue

        qid = tags.get("wikidata")
        labels = _localized_labels(tags, (wikidata_labels or {}).get(qid, {}))
        entries.append({
            "relation_id": relation_id,
            "admin_level": admin_level,
            "geometry": geometry,
            "labels": labels,
            "name": tags.get("name") or labels.get("en") or labels.get("et") or str(relation_id),
            "start_date": tags.get("start_date"),
            "end_date": tags.get("end_date"),
        })

    # Suuremad üksused enne: väiksemad kattuvad alad jäävad nende peale nähtavaks
    # ja tulevad seetõttu queryRenderedFeatures'is esimesena (vt spekk, §3).
    entries.sort(key=lambda entry: entry["geometry"].area, reverse=True)

    parents = find_parents(
        [entry["admin_level"] for entry in entries],
        [entry["geometry"] for entry in entries],
    )

    features = []
    for index, entry in enumerate(entries):
        parent_index = parents[index]
        parent = entries[parent_index] if parent_index is not None else None
        features.append({
            "type": "Feature",
            "id": entry["relation_id"],
            "properties": {
                "relation_id": entry["relation_id"],
                "admin_level": entry["admin_level"],
                "name": entry["name"],
                "label_et": entry["labels"].get("et"),
                "label_en": entry["labels"].get("en"),
                "start_date": entry["start_date"],
                "end_date": entry["end_date"],
                "color": _region_color(entry["relation_id"]),
                "parent_name": parent["name"] if parent else None,
                "parent_label_et": parent["labels"].get("et") if parent else None,
                "parent_label_en": parent["labels"].get("en") if parent else None,
            },
            "geometry": mapping(entry["geometry"]),
        })

    return {"type": "FeatureCollection", "features": features}
```

Märkus: vana versioon kutsus sortimisvõtmes `shape(item["geometry"])`, mis parsis geomeetria teist korda. Uus versioon sordib juba olemasoleva shapely-objekti pindala järgi.

- [ ] **Step 5: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_historical_regions.py -v`
Expected: PASS, kõik testid

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/historical_regions.py tests/test_historical_regions.py
git commit -m "feat(kaart): OHM päring küsib admin_level 2 ja 3, feature kannab vanemat"
```

---

### Task 3: Cache'i variandivõti

**Files:**
- Modify: `server/prosopography/historical_regions.py` (`DEFAULT_SNAPSHOT_KEY` ~rida 35, `get_historical_regions` ~387–392)
- Modify: `tests/test_historical_regions.py`

**Interfaces:**
- Consumes: `ADMIN_LEVELS` Task 2-st
- Produces: `CACHE_VARIANT: Tuple`, `_cache_key(year: int, bbox: Tuple[float, float, float, float]) -> Tuple`

**Miks.** Ilma selleta serveeriks `_warm_default_snapshot_once` vana kujuga kinnistatud snapshot'i kuni nädala (`_read_disk_cache(KEY, None)` ei vaata vanust), ja hilisem `ADMIN_LEVELS = (2, 3, 4)` sobiks endiselt vana võtmega — level 4 ei ilmuks kunagi.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_historical_regions.py` lõppu:

```python
def test_cache_key_carries_variant():
    key = historical_regions._cache_key(1650, (30, -40, 70, 80))
    assert key[0] == historical_regions.CACHE_VARIANT
    assert key[1:] == (1650, 30, -40, 70, 80)


def test_admin_levels_change_invalidates_disk_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(historical_regions, "DISK_CACHE_DIR", str(tmp_path))
    bbox = (30, -40, 70, 80)
    historical_regions._write_disk_cache(historical_regions._cache_key(1650, bbox), {"year": 1650})

    monkeypatch.setattr(historical_regions, "CACHE_VARIANT", (99, (2, 3, 4), 1))
    assert historical_regions._read_disk_cache(historical_regions._cache_key(1650, bbox)) is None


def test_default_snapshot_key_uses_cache_key():
    assert historical_regions.DEFAULT_SNAPSHOT_KEY == (
        historical_regions.CACHE_VARIANT,
        historical_regions.DEFAULT_SNAPSHOT_YEAR,
        *historical_regions.DEFAULT_SNAPSHOT_BBOX,
    )
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_historical_regions.py -k "cache_key or admin_levels_change or default_snapshot_key" -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_cache_key'`

- [ ] **Step 3: Lisa variandivõti**

`server/prosopography/historical_regions.py` — asenda rida

```python
DEFAULT_SNAPSHOT_KEY = (DEFAULT_SNAPSHOT_YEAR, *DEFAULT_SNAPSHOT_BBOX)
```

järgnevaga (pane see `ADMIN_LEVELS` definitsioonist **allapoole**, sest `CACHE_VARIANT` sõltub sellest):

```python
# Cache'i variant: skeemi, haldustasemete või lihtsustusprofiili muutus peab
# vana cache'i automaatselt kehtetuks tegema. Vanad failid muutuvad leidmatuks
# ja tõrjutakse DISK_CACHE_MAX_ENTRIES piiriga tavakorras välja.
SCHEMA_VERSION = 2
SIMPLIFY_PROFILE_VERSION = 1
CACHE_VARIANT = (SCHEMA_VERSION, ADMIN_LEVELS, SIMPLIFY_PROFILE_VERSION)


def _cache_key(year: int, bbox: Tuple[float, float, float, float]) -> Tuple:
    """Cache võti kannab variandi, et andmeskeemi muutus ei serveeriks vana sisu."""
    return (CACHE_VARIANT, year, *bbox)


DEFAULT_SNAPSHOT_KEY = _cache_key(DEFAULT_SNAPSHOT_YEAR, DEFAULT_SNAPSHOT_BBOX)
```

`_cache_key` loeb `CACHE_VARIANT`-i kutsumise hetkel, mistõttu test saab seda `monkeypatch`-iga asendada.

- [ ] **Step 4: Kasuta võtit `get_historical_regions`-is**

Asenda funktsioonis `get_historical_regions` rida

```python
    key = (year, *bbox)
```

järgnevaga:

```python
    key = _cache_key(year, bbox)
```

Ülejäänud funktsioon jääb muutmata.

- [ ] **Step 5: Käivita kõik backend-testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/historical_regions.py tests/test_historical_regions.py
git commit -m "feat(kaart): cache võti kannab skeemi ja haldustasemete varianti"
```

---

### Task 4: Frontendi valikuloogika puhta moodulina

**Files:**
- Create: `src/prosopography/utils/regionLayers.ts`
- Test: `src/prosopography/utils/__tests__/regionLayers.test.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `REGION_SOURCE_ID: string`
  - `REGION_LAYERS` — objekt kihi-ID-dega: `l2Fill`, `l2Casing`, `l2Line`, `l3Fill`, `l3Casing`, `l3Line`
  - `REGION_DETAIL_ZOOM: number` (MapLibre'i suum)
  - `regionQueryLayers(zoom: number): string[]`
  - `pickRegionFeature<T>(zoom: number, queryLayer: (layerId: string) => T[]): T | null`

**Miks eraldi moodul.** `maplibre-gl@5.24.0` dokumentatsioon (`maplibre-gl.d.ts:12144–12155`) ütleb, et `queryRenderedFeatures()` **kaasab** kihid, mille läbipaistvus on 0. Seega ei piisa sellest, et L3 on väljasuumitult nähtamatu — hit-test peab suumi ise arvesse võtma, muidu annaks Euroopa-vaade tooltipiks „Bayerischer Reichskreis", kuigi kasutaja näeb ainult „Sacrum Imperium Romanum". See loogika on puhas ja testitav ilma MapLibre'ita.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `src/prosopography/utils/__tests__/regionLayers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  REGION_DETAIL_ZOOM,
  REGION_LAYERS,
  pickRegionFeature,
  regionQueryLayers,
} from '../regionLayers';

describe('regionQueryLayers', () => {
  it('küsib väljasuumitult ainult katusüksuse kihti', () => {
    expect(regionQueryLayers(REGION_DETAIL_ZOOM - 1)).toEqual([REGION_LAYERS.l2Fill]);
  });

  it('küsib sissesuumitult alamüksust enne katusüksust', () => {
    expect(regionQueryLayers(REGION_DETAIL_ZOOM + 1)).toEqual([
      REGION_LAYERS.l3Fill,
      REGION_LAYERS.l2Fill,
    ]);
  });

  it('lävendil endal kehtib juba detailne vaade', () => {
    expect(regionQueryLayers(REGION_DETAIL_ZOOM)).toEqual([
      REGION_LAYERS.l3Fill,
      REGION_LAYERS.l2Fill,
    ]);
  });
});

describe('pickRegionFeature', () => {
  it('eelistab alamüksust, kui see tabab', () => {
    const query = vi.fn((layerId: string) => (
      layerId === REGION_LAYERS.l3Fill ? ['ringkond'] : ['impeerium']
    ));
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, query)).toBe('ringkond');
  });

  it('langeb katusüksusele tagasi alamüksuseta augu kohal', () => {
    const query = vi.fn((layerId: string) => (
      layerId === REGION_LAYERS.l3Fill ? [] : ['impeerium']
    ));
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, query)).toBe('impeerium');
  });

  it('ei küsi väljasuumitult alamüksuse kihti üldse', () => {
    const query = vi.fn(() => ['impeerium']);
    expect(pickRegionFeature(REGION_DETAIL_ZOOM - 1, query)).toBe('impeerium');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(REGION_LAYERS.l2Fill);
  });

  it('tagastab null, kui ükski kiht ei taba', () => {
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, () => [])).toBeNull();
  });

  it('võtab kihi sees esimese ehk pealmise vaste', () => {
    const query = vi.fn((layerId: string) => (
      layerId === REGION_LAYERS.l3Fill ? ['väiksem', 'suurem'] : []
    ));
    expect(pickRegionFeature(REGION_DETAIL_ZOOM + 1, query)).toBe('väiksem');
  });
});
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `npx vitest run src/prosopography/utils/__tests__/regionLayers.test.ts`
Expected: FAIL — `Failed to resolve import "../regionLayers"`

- [ ] **Step 3: Kirjuta moodul**

Loo `src/prosopography/utils/regionLayers.ts`:

```ts
/**
 * Ajalooliste piirkonnakihtide ID-d ja suumist sõltuv valikuloogika.
 *
 * MapLibre'i `queryRenderedFeatures()` tagastab ka kihid, mille läbipaistvus on 0
 * (välja jäävad ainult `visibility: none` ja suumivahemikust väljas olevad kihid).
 * Seetõttu ei piisa sellest, et alamüksuse kiht on väljasuumitult nähtamatu —
 * hiire-tabamus peab suumi eraldi arvesse võtma, muidu näitaks Euroopa-ülevaade
 * tooltipiks üksust, mida kasutaja ei näe.
 */

export const REGION_SOURCE_ID = 'vutt-historical-regions';

export const REGION_LAYERS = {
  l2Fill: 'vutt-historical-regions-l2-fill',
  l2Casing: 'vutt-historical-regions-l2-casing',
  l2Line: 'vutt-historical-regions-l2-line',
  l3Fill: 'vutt-historical-regions-l3-fill',
  l3Casing: 'vutt-historical-regions-l3-casing',
  l3Line: 'vutt-historical-regions-l3-line',
} as const;

/**
 * Lävend MapLibre'i suumiskaalas — AINUS tõe allikas nii paint-avaldistele kui
 * hiire-tabamusele. Kalibreeritud nii, et vaikevaade (Leaflet zoom 5) näitab juba
 * alamüksusi ja kokkutõmbumine katusüksuseks toimub Euroopa-ülevaates.
 */
export const REGION_DETAIL_ZOOM = 3.5;

/** Kihid, mida antud suumil tohib hiirega tabada, kõige spetsiifilisem eespool. */
export function regionQueryLayers(zoom: number): string[] {
  return zoom >= REGION_DETAIL_ZOOM
    ? [REGION_LAYERS.l3Fill, REGION_LAYERS.l2Fill]
    : [REGION_LAYERS.l2Fill];
}

/**
 * Võidab esimene kiht, mis üldse midagi tagastab; kihi sees esimene ehk pealmine
 * vaste. Kuna backend sordib piirkonnad pindala järgi kahanevalt, on pealmine
 * ühtlasi väikseim — nii võidab kõige spetsiifilisem üksus ka taseme sees.
 */
export function pickRegionFeature<T>(
  zoom: number,
  queryLayer: (layerId: string) => T[],
): T | null {
  for (const layerId of regionQueryLayers(zoom)) {
    const hit = queryLayer(layerId)[0];
    if (hit !== undefined) return hit;
  }
  return null;
}
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `npx vitest run src/prosopography/utils/__tests__/regionLayers.test.ts`
Expected: PASS, 8 testi

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/utils/regionLayers.ts src/prosopography/utils/__tests__/regionLayers.test.ts
git commit -m "feat(kaart): suumist sõltuv piirkonnakihi valikuloogika puhta moodulina"
```

---

### Task 5: Tüübid ja tooltipi vanemarida

**Files:**
- Modify: `src/prosopography/types.ts:89-97`
- Modify: `src/prosopography/components/HistoricalMapLayer.tsx` (`regionTooltipContent` ~158–177)

**Interfaces:**
- Consumes: Task 2 GeoJSON-omadused (`admin_level`, `parent_name`, `parent_label_et`, `parent_label_en`)
- Produces: laiendatud `HistoricalRegionProperties`

- [ ] **Step 1: Laienda tüüpi**

`src/prosopography/types.ts` — asenda `HistoricalRegionProperties`:

```ts
export interface HistoricalRegionProperties {
  relation_id: number;
  admin_level: number;
  name: string;
  label_et: string | null;
  label_en: string | null;
  start_date: string | null;
  end_date: string | null;
  color: string;
  /** Lähim ülemine haldustase; puudub, kui kattuvus jäi alla lävendi. */
  parent_name: string | null;
  parent_label_et: string | null;
  parent_label_en: string | null;
}
```

- [ ] **Step 2: Lisa tooltipile vanemarida**

`src/prosopography/components/HistoricalMapLayer.tsx` — asenda `regionTooltipContent` ja lisa selle ette abifunktsioon:

```tsx
/** Nimi eelistatud keeles; puuduva tõlke korral teine keel ja lõpuks varunimi. */
function localizedName(
  lang: string,
  labelEt: string | null,
  labelEn: string | null,
  fallback: string | null,
): string | null {
  return (lang === 'en' ? labelEn : labelEt) || labelEt || labelEn || fallback;
}

function regionTooltipContent(properties: HistoricalRegionProperties, lang: string): HTMLElement {
  const content = document.createElement('div');
  content.className = 'space-y-0.5';

  const name = document.createElement('div');
  name.className = 'font-semibold text-gray-900';
  name.textContent = localizedName(lang, properties.label_et, properties.label_en, properties.name);
  content.appendChild(name);

  if (properties.start_date || properties.end_date) {
    const dates = document.createElement('div');
    dates.className = 'text-[11px] text-gray-500';
    dates.textContent = `${properties.start_date ? yearFromHistoricalDate(properties.start_date) : '…'}–${properties.end_date ? yearFromHistoricalDate(properties.end_date) : '…'}`;
    content.appendChild(dates);
  }

  // Vanem on lisainfo: kui backend jättis ta osalise kattuvuse tõttu määramata,
  // ei kuvata rida üldse.
  const parent = localizedName(
    lang,
    properties.parent_label_et,
    properties.parent_label_en,
    properties.parent_name,
  );
  if (parent) {
    const parentRow = document.createElement('div');
    parentRow.className = 'text-[11px] text-gray-400';
    parentRow.textContent = parent;
    content.appendChild(parentRow);
  }

  return content;
}
```

- [ ] **Step 3: Kontrolli tüübid ja testid**

Run: `npm run typecheck && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/types.ts src/prosopography/components/HistoricalMapLayer.tsx
git commit -m "feat(kaart): tooltip näitab alamüksuse vanemat"
```

---

### Task 6: Kaks kihipaari suumist sõltuva paintiga

**Files:**
- Modify: `src/prosopography/components/HistoricalMapLayer.tsx` (konstandid ~12–15, `ensureRegionLayers` ~104–150, `loadRegions`-i `REGION_SOURCE_ID` viited)

**Interfaces:**
- Consumes: `REGION_SOURCE_ID`, `REGION_LAYERS`, `REGION_DETAIL_ZOOM` Task 4-st; `admin_level` omadus Task 2-st
- Produces: kuus kihti allikas `REGION_SOURCE_ID`; kihijärjestus alt üles `l2Fill → l2Casing → l2Line → l3Fill → l3Casing → l3Line`

**Tüübimärkus (kontrollitud).** `maplibre-gl@5.24.0` **ei ekspordi** `ExpressionSpecification`-it — tüübid tulevad `@maplibre/maplibre-gl-style-spec`-ist ja seda konkreetset ei reeksportita (0 vastet `maplibre-gl.d.ts`-is). Seetõttu **ei tohi** paint-avaldisi eraldada abifunktsiooniks, mis tagastaks avaldise: annoteerimata massiivi tüüp järeldatakse valesti ja `addLayer` lükkab selle tagasi. Avaldised kirjutatakse **inline** `addLayer` kutse sisse, kus kontekstitüüpimine teeb töö ära — täpselt nagu praeguses failis (`ensureRegionLayers`, read 112–149) juba töötab. `FilterSpecification` **on** eksporditud ja jääb kasutusse.

- [ ] **Step 1: Eemalda kohalikud konstandid ja impordi need moodulist**

Kustuta `HistoricalMapLayer.tsx`-st read

```ts
const REGION_SOURCE_ID = 'vutt-historical-regions';
const REGION_FILL_LAYER_ID = 'vutt-historical-regions-fill';
const REGION_LINE_LAYER_ID = 'vutt-historical-regions-line';
```

ja lisa importide juurde (`maplibre-gl` import jääb muutmata):

```ts
import { REGION_DETAIL_ZOOM, REGION_LAYERS, REGION_SOURCE_ID } from '../utils/regionLayers';
```

- [ ] **Step 2: Kirjuta `ensureRegionLayers` ümber**

Asenda kogu `ensureRegionLayers` funktsioon ja lisa selle ette paint-konstandid:

```ts
// Hover on ainus koht, kus kaart läheb värvilisemaks — baaspalett jääb puutumata.
const HOVER_FILL_OPACITY = 0.42;
const HOVER_LINE_WIDTH = 4;
const HOVER_LINE_OPACITY = 0.95;
const HOVER_CASING_WIDTH = 7;
const HOVER_CASING_COLOR = 'rgba(255, 255, 255, 0.85)';

interface LevelStyle {
  fill: [number, number];
  lineWidth: [number, number];
  lineOpacity: [number, number];
}

// [väljasuumitult, sissesuumitult]. Katusüksuse täide läheb päriselt nulli:
// läbipaistvus 0 EI peida feature'it queryRenderedFeatures'i eest, nii et
// alamüksuseta augud säilitavad tooltipi ilma nähtava jäänuktäiteta.
const LEVEL_STYLES: Record<number, LevelStyle> = {
  2: { fill: [0.1, 0], lineWidth: [1, 1.8], lineOpacity: [0.5, 0.8] },
  3: { fill: [0, 0.1], lineWidth: [0, 1], lineOpacity: [0, 0.5] },
};

function addLevelLayers(
  map: MapLibreMap,
  level: number,
  ids: { fill: string; casing: string; line: string },
  beforeId: string | undefined,
): void {
  const style = LEVEL_STYLES[level];
  const filter = ['==', ['get', 'admin_level'], level] as FilterSpecification;
  const fadeIn = REGION_DETAIL_ZOOM - 0.5;
  const fadeOut = REGION_DETAIL_ZOOM + 0.5;

  if (!map.getLayer(ids.fill)) {
    map.addLayer({
      id: ids.fill,
      type: 'fill',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'fill-color': ['get', 'color'],
        'fill-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_FILL_OPACITY,
          ['interpolate', ['linear'], ['zoom'], fadeIn, style.fill[0], fadeOut, style.fill[1]],
        ],
      },
    }, beforeId);
  }

  // Valge halo põhijoone all: ainult hover'il, et piir loeks reljeefse tausta peal.
  if (!map.getLayer(ids.casing)) {
    map.addLayer({
      id: ids.casing,
      type: 'line',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'line-color': HOVER_CASING_COLOR,
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_CASING_WIDTH,
          0,
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          1,
          0,
        ],
      },
    }, beforeId);
  }

  if (!map.getLayer(ids.line)) {
    map.addLayer({
      id: ids.line,
      type: 'line',
      source: REGION_SOURCE_ID,
      filter,
      paint: {
        'line-color': ['get', 'color'],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_LINE_WIDTH,
          ['interpolate', ['linear'], ['zoom'], fadeIn, style.lineWidth[0], fadeOut, style.lineWidth[1]],
        ],
        'line-opacity': [
          'case',
          ['boolean', ['feature-state', 'hover'], false],
          HOVER_LINE_OPACITY,
          ['interpolate', ['linear'], ['zoom'], fadeIn, style.lineOpacity[0], fadeOut, style.lineOpacity[1]],
        ],
      },
    }, beforeId);
  }
}

function ensureRegionLayers(map: MapLibreMap): void {
  if (!map.getSource(REGION_SOURCE_ID)) {
    map.addSource(REGION_SOURCE_ID, { type: 'geojson', data: EMPTY_REGIONS });
  }

  const beforeId = map.getLayer('admin_country_lines_z10_case')
    ? 'admin_country_lines_z10_case'
    : undefined;

  // Sama beforeId korral tekib lisamisjärjekorras virn alt üles:
  // katusüksuse täide → halo → joon, seejärel alamüksuse samad kolm peale.
  addLevelLayers(map, 2, {
    fill: REGION_LAYERS.l2Fill,
    casing: REGION_LAYERS.l2Casing,
    line: REGION_LAYERS.l2Line,
  }, beforeId);
  addLevelLayers(map, 3, {
    fill: REGION_LAYERS.l3Fill,
    casing: REGION_LAYERS.l3Casing,
    line: REGION_LAYERS.l3Line,
  }, beforeId);
}
```

- [ ] **Step 3: Hoia `featureAt` kompileeruvana (vahesamm)**

Kustutatud `REGION_FILL_LAYER_ID` on veel kasutusel hover-`useEffect`-i sees. Ilma selle sammuta ei kompileeruks fail Task 6 ja Task 7 vahel. Asenda `featureAt`-is kaks viidet nii, et **käitumine jääb täpselt samaks nagu täna** (küsitakse ainult katusüksuse täidet); suumiteadlikkuse lisab Task 7:

```tsx
    const featureAt = (latlng: L.LatLng) => {
      if (!mapLibre.getLayer(REGION_LAYERS.l2Fill)) return null;
      const point = mapLibre.project([latlng.lng, latlng.lat]);
      return mapLibre.queryRenderedFeatures(point, { layers: [REGION_LAYERS.l2Fill] })[0] ?? null;
    };
```

- [ ] **Step 4: Kontrolli tüübid ja testid**

Run: `npm run typecheck && npm test`
Expected: PASS. Kui `addLayer` kurdab paint-avaldise tüübi üle, on avaldis tõenäoliselt tõstetud muutujasse või abifunktsiooni — vii see tagasi `addLayer` kutse sisse, sest kontekstitüüpimine töötab ainult seal.

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/components/HistoricalMapLayer.tsx
git commit -m "feat(kaart): kaks kihipaari suumist sõltuva täite ja hover-casinguga"
```

---

### Task 7: Suumist sõltuv hiire-tabamus ja hover'i puhastus

**Files:**
- Modify: `src/prosopography/components/HistoricalMapLayer.tsx` (hover-`useEffect` ~305–365)

**Interfaces:**
- Consumes: `pickRegionFeature`, `REGION_LAYERS` Task 4-st
- Produces: —

- [ ] **Step 1: Asenda `featureAt` suumiteadliku versiooniga**

Täienda kõigepealt Task 6-s lisatud importi:

```ts
import { REGION_DETAIL_ZOOM, REGION_LAYERS, REGION_SOURCE_ID, pickRegionFeature } from '../utils/regionLayers';
```

(`REGION_DETAIL_ZOOM` jääb kasutusse `ensureRegionLayers`-is, `pickRegionFeature` tuleb siia.)

Seejärel asenda hover-`useEffect`-is Task 6 vahesammuga jäetud `featureAt`:

```tsx
    const featureAt = (latlng: L.LatLng) => {
      const point = mapLibre.project([latlng.lng, latlng.lat]);
      // Suum tuleb MapLibre'i kaardilt, et hit-test ja paint oleksid samas
      // koordinaatsüsteemis — Leafleti suum võib sellest nihkes olla.
      return pickRegionFeature(mapLibre.getZoom(), layerId => (
        mapLibre.getLayer(layerId)
          ? mapLibre.queryRenderedFeatures(point, { layers: [layerId] })
          : []
      ));
    };
```

- [ ] **Step 2: Lisa hover'i puhastus suumimisel**

Asenda samas `useEffect`-is sündmusekäsitlejate plokk (alates `const onMouseMove` kuni `return`-i lõpuni):

```tsx
    // Kui kasutaja hoiab hiirt paigal ja suumib üle lävendi, uut mousemove'i ei
    // tule — vana esiletõst jääks külge vale tasemega. Suumi lõpus arvutame
    // tabamuse viimase teadaoleva hiirekoha põhjal uuesti.
    let lastLatLng: L.LatLng | null = null;

    const onMouseMove = (event: L.LeafletMouseEvent) => {
      lastLatLng = event.latlng;
      showFeature(event.latlng, featureAt(event.latlng));
    };
    const onClick = (event: L.LeafletMouseEvent) => {
      lastLatLng = event.latlng;
      showFeature(event.latlng, featureAt(event.latlng));
    };
    const onMouseOut = () => {
      lastLatLng = null;
      clearHover();
    };
    const onZoomStart = () => clearHover();
    const onZoomEnd = () => {
      if (lastLatLng) showFeature(lastLatLng, featureAt(lastLatLng));
    };

    map.on('mousemove', onMouseMove);
    map.on('click', onClick);
    map.on('zoomstart', onZoomStart);
    map.on('zoomend', onZoomEnd);
    map.getContainer().addEventListener('mouseleave', onMouseOut);
    return () => {
      clearHover();
      tooltip.remove();
      map.off('mousemove', onMouseMove);
      map.off('click', onClick);
      map.off('zoomstart', onZoomStart);
      map.off('zoomend', onZoomEnd);
      map.getContainer().removeEventListener('mouseleave', onMouseOut);
    };
```

- [ ] **Step 3: Kontrolli tüübid, testid ja lint**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: PASS. `lint:ci` lävi on `--max-warnings 55`; kui arv langeb, jäta see nii — ära tõsta.

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/components/HistoricalMapLayer.tsx
git commit -m "feat(kaart): hiire-tabamus järgib suumilävendit, hover puhastub suumimisel"
```

---

### Task 8: Kalibreerimine, mahu mõõtmine ja kontrollpunktid

**Files:**
- Modify: `src/prosopography/utils/regionLayers.ts` (`REGION_DETAIL_ZOOM` väärtus)
- Modify: `docs/superpowers/specs/2026-08-10-kaardi-piirid-level3-design.md` (katse tulemus)

**Interfaces:**
- Consumes: kõik eelnevad taskid
- Produces: kalibreeritud `REGION_DETAIL_ZOOM`, mõõdetud snapshot'i maht, kirjalik katse tulemus

**See task ei ole vabatahtlik.** Spekk sätestab katsele edukriteeriumi; ilma selle läbimänguta ei ole teada, kas level 3 üldse kõlbab.

- [ ] **Step 1: Mõõda Euroopa snapshot'i maht ilma serverit käivitamata**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -c "
import gzip, json
from server.prosopography.historical_regions import DEFAULT_SNAPSHOT_BBOX, DEFAULT_SNAPSHOT_YEAR, _fetch_regions
result = _fetch_regions(DEFAULT_SNAPSHOT_YEAR, DEFAULT_SNAPSHOT_BBOX)
payload = json.dumps(result, separators=(',', ':')).encode('utf-8')
print('piirkondi:', result['region_count'])
print('gzip kB:', round(len(gzip.compress(payload)) / 1024, 1))
"
```

Overpassi päring võtab ~60 sekundit. Kirjuta tulemus üles.

- [ ] **Step 2: Otsusta mahu põhjal**

- Alla 180 kB gzip → mine edasi.
- Üle 180 kB gzip → **ära** hakka automaatselt lihtsustama. Vaata geomeetria üle ja tee teadlik otsus; `shapely.simplify` säilitab topoloogia geomeetria sees, aga mitte naaberpolügoonide vahel, nii et agressiivsem lihtsustus tekitab naabrite vahele pilusid, mis 7 px casing-joone all muutuvad nähtavaks. Kirjuta otsus ja põhjendus spekki. Kui muudad lihtsustust, tõsta `SIMPLIFY_PROFILE_VERSION`.

- [ ] **Step 3: Käivita backend lokaalselt**

```bash
cd /home/mf/LLM/VUTT && .venv/bin/python -m uvicorn server.main:app --host 0.0.0.0 --port 8002
```

Esimene `/persons` kaardilaadimine soojendab 1650 snapshot'i (~60 s Overpassi päring); järgmised tulevad ketta-cache'ist.

- [ ] **Step 4: Suuna dev-frontend lokaalse backendi peale**

`vite.config.ts:6` `const DEV_BACKEND = '172.17.120.146';` → `'127.0.0.1'`.

**Seda muudatust EI committita** — taasta enne Task 8 lõppu.

Käivita teises terminalis: `npm run dev`

- [ ] **Step 5: Kalibreeri `REGION_DETAIL_ZOOM`**

Ava `/persons`, lülita kaardivaade sisse. Loe brauserikonsoolis MapLibre'i suum Leafleti suumi kohta — lisa ajutiselt `HistoricalMapLayer.tsx` hover-`useEffect`-i `onZoomEnd`-i sisse:

```tsx
      console.log('leaflet', map.getZoom(), 'maplibre', mapLibre.getZoom());
```

Loe välja MapLibre'i suum Leafleti suumide 4 ja 5 juures. Vali `REGION_DETAIL_ZOOM` nii, et:

- Leaflet zoom 5 (vaikevaade) on **üle** lävendi → ringkonnad nähtaval
- Leaflet zoom 4 või vähem (Euroopa-ülevaade) on **alla** lävendi → ainult impeerium

Uuenda `src/prosopography/utils/regionLayers.ts` konstanti ja **eemalda `console.log`**.

- [ ] **Step 6: Mängi läbi kontrollpunktid**

Vaikevaates (Leaflet zoom 5) kontrolli ja kirjuta iga rea tulemus üles:

| Kontrollpunkt | Mida vaadata |
|---|---|
| Baieri | Kas tooltip vastab aluskaardil nähtavale nimele või annab „Bayerischer Reichskreis" seal, kus aluskaart ütleb „Churfürstenthum Baiern"? |
| Brandenburg | Brandenburg-Preußen vs Obersächsischer Reichskreis kattuvus — kas väiksem võidab ja tulemus on loetav? |
| Magdeburg | Level-4 üksus ilma oma level-3 katteta — mida kasutaja saab? |
| Böömimaa | `Země Koruny české` level-3 üksusena |
| Poola-Leedu | `Korona Królestwa Polskiego` L3 vs `Rzeczpospolita` L2 — kas vanem tooltipis on õige? |
| Rootsi / Baltikum | Piirkond ilma level-3 katteta: kas L2 käitub muutumatult? |
| Brandenburg-Preußeni vanem | Kas `parent` on `None` (rida puudub) — 0,75 lävi pidi selle välja jätma |
| Auk HRR-i sees | Ala ilma level-3 katteta: kas tooltip näitab endiselt impeeriumi? |
| Euroopa-ülevaade | Zoom 3–4: ainult impeerium, hover EI anna ringkonda |
| Suum hiir paigal | Suumi rullikuga üle lävendi hiirt liigutamata: kas esiletõst ja tooltip vahetuvad õigele tasemele? |
| Hover-kontrast | Kas valge casing teeb piiri loetavaks reljeefse tausta peal? |

- [ ] **Step 7: Otsusta katse tulemus**

Kui level 3 annab **süstemaatiliselt** kummalisema üksuse kui aluskaardil nähtav nimi, on katse läbi kukkunud: muuda `ADMIN_LEVELS = (2, 4)` (cache invalideerub `CACHE_VARIANT`-i kaudu automaatselt), korda Step 1 ja Step 6. Muul juhul jäta `(2, 3)`.

Kirjuta tulemus spekki `## Katse edukriteerium` peatüki lõppu: mõõdetud maht, valitud `REGION_DETAIL_ZOOM`, iga kontrollpunkti tulemus ja lõppotsus.

- [ ] **Step 8: Taasta dev-konfiguratsioon ja käivita kõik väravad**

```bash
cd /home/mf/LLM/VUTT
git checkout vite.config.ts
git diff --stat            # veendu, et vite.config.ts ega console.log ei ole jäänud
npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/
```

Expected: kõik PASS, `vite.config.ts` muutmata.

- [ ] **Step 9: Commit**

```bash
git add src/prosopography/utils/regionLayers.ts docs/superpowers/specs/2026-08-10-kaardi-piirid-level3-design.md
git commit -m "feat(kaart): kalibreeritud suumilävend ja katse tulemus"
```

---

## Deploy

Muudatus puudutab **mõlemat poolt**, seega mõlemad sammud on vajalikud.

```bash
# Backend (Python muutus → --no-cache on kohustuslik)
ssh vutt && cd ~/VUTT && ./scripts/server_update.sh --no-cache

# Frontend (lokaalses masinas)
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

Meilisearch reindeksit **ei ole vaja** — see töö ei puuduta `_metadata.json`-i ega Meili dokumente.

Pärast backendi restarti soojendab `start_historical_regions_warm_loop` uue variandivõtmega
1650 snapshot'i taustal (~60 s Overpassi päring). Vana variandiga cache-failid jäävad kettale
kuni `DISK_CACHE_MAX_ENTRIES` need välja tõrjub — see on ootuspärane, mitte viga.

## Enesekontroll pärast plaani

- **Spekikate:** §1 andmed → Task 1–3; §2 renderdus → Task 6; §3 hover ja tooltip → Task 5, 7; katse edukriteerium → Task 8; testid → Task 1, 2, 3, 4 ja Task 8 käsitsi osa; maht → Task 8 Step 1–2.
- **Nimede järjepidevus:** `find_parents` (Task 1) = kutsutud Task 2-s; `_cache_key` (Task 3) kasutatud ainult `get_historical_regions`-is ja `DEFAULT_SNAPSHOT_KEY`-s; `REGION_LAYERS` võtmed `l2Fill/l2Casing/l2Line/l3Fill/l3Casing/l3Line` on identsed Task 4, 6 ja 7 vahel; `pickRegionFeature` allkiri Task 4-s = kasutus Task 7-s; `REGION_SOURCE_ID` liigub Task 6-s komponendist moodulisse, ülejäänud viited (`loadRegions`, `setFeatureState`) kasutavad imporditud konstanti.
