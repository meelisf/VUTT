"""
Koharegister (places.json) ja päritolugrupid (origin_groups.json).
Cache, abifunktsioonid, propagatsioon.
"""
import glob
import json
import os
import re
import time
import threading
import urllib.request
import urllib.parse
from typing import Optional

from ..config import PLACES_FILE, ORIGIN_GROUPS_FILE, PROSOPOGRAPHY_DIR, get_logger
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


def _get_place_coordinates(key: Optional[str]) -> Optional[dict]:
    if not key:
        return None
    coordinates = _load_places_cache().get(key, {}).get("coordinates")
    if not isinstance(coordinates, dict):
        return None
    lat = coordinates.get("lat")
    lon = coordinates.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        return None
    result = {"lat": float(lat), "lon": float(lon)}
    for field in ("source", "wikidata_property", "geonames_id"):
        value = coordinates.get(field)
        if isinstance(value, str) and value:
            result[field] = value
    return result


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


async def _propagate_place_merge(source_key: str, target_key: str) -> None:
    """
    Pärast kohade ühendamist uuendab nii source kui target isikud indeksis.
    Source isikute failid ütlevad nüüd target_key — indeks peab järele jõudma.
    """
    from .ops import _load_index, _index_entry_from_person, get_person
    from ..config import PROSOPOGRAPHY_INDEX_FILE

    places = _load_places_cache(force_reload=True)
    affected = _collect_descendants(target_key, places)
    affected.add(target_key)
    affected.add(source_key)  # redirectitud isikud on indeksis veel source_key all

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
        logger.info("_propagate_place_merge: uuendas indeksi %s → %s", source_key, target_key)


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


def put_group(key: str, data: dict) -> dict:
    """Lisab või uuendab gruppi origin_groups.json-s."""
    if not key or not key.strip():
        raise ValueError("Grupi võti on kohustuslik")
    groups = _load_origin_groups(force_reload=True)
    parent = data.get("parent") or None
    if parent and parent not in groups:
        raise ValueError(f"Parent grupp ei leitud: {parent!r}")
    if parent == key:
        raise ValueError("Grupp ei saa olla oma parent")
    entry = dict(groups.get(key, {}))
    if "labels" in data:
        entry["labels"] = data["labels"]
    if "sort_order" in data:
        entry["sort_order"] = int(data["sort_order"])
    entry["parent"] = parent
    groups[key] = entry
    atomic_write_json(ORIGIN_GROUPS_FILE, groups)
    _load_origin_groups(force_reload=True)
    return {"key": key, "entry": entry}


def delete_group(key: str) -> None:
    """Kustutab grupi origin_groups.json-st. Blokeerib kui kasutusel."""
    groups = _load_origin_groups(force_reload=True)
    if key not in groups:
        raise ValueError(f"Grupp ei leitud: {key!r}")
    places = _load_places_cache(force_reload=True)
    used_by_places = [k for k, e in places.items() if e.get("group") == key]
    if used_by_places:
        raise ValueError(
            f"Ei saa kustutada: gruppi kasutab {len(used_by_places)} koht(a): "
            + ", ".join(used_by_places[:5])
        )
    child_groups = [k for k, e in groups.items() if e.get("parent") == key]
    if child_groups:
        raise ValueError(
            f"Ei saa kustutada: grupil on alamgrupid: {', '.join(child_groups)}"
        )
    del groups[key]
    atomic_write_json(ORIGIN_GROUPS_FILE, groups)
    _load_origin_groups(force_reload=True)


AUTO_PARENT_MAP = {
    "gootaland": "rootsi",
    "svealand": "rootsi",
    "norrland": "rootsi",
    "ahvenanmaa": "soome",
    "hame": "soome",
    "lappi": "soome",
    "pohjanmaa": "soome",
    "satakunta": "soome",
    "savo": "soome",
    "uusimaa": "soome",
    "varsinais-suomi": "soome",
}


def auto_assign_group_parents() -> dict:
    """Rakendab AUTO_PARENT_MAP automaatselt teadaolevatele alamgruppidele."""
    groups = _load_origin_groups(force_reload=True)
    assigned = 0
    skipped = []
    for child_key, parent_key in AUTO_PARENT_MAP.items():
        if child_key not in groups:
            skipped.append(child_key)
            continue
        if parent_key not in groups:
            skipped.append(f"{child_key}->{parent_key}(missing)")
            continue
        groups[child_key]["parent"] = parent_key
        assigned += 1
    atomic_write_json(ORIGIN_GROUPS_FILE, groups)
    _load_origin_groups(force_reload=True)
    logger.info("auto_assign_group_parents: %d uuendatud, %d vahele jäetud", assigned, len(skipped))
    return {"assigned": assigned, "skipped": skipped}


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
    if "coordinates" in data:
        coordinates = data.get("coordinates")
        if coordinates is not None:
            lat = coordinates.get("lat") if isinstance(coordinates, dict) else None
            lon = coordinates.get("lon") if isinstance(coordinates, dict) else None
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                raise ValueError("coordinates peab olema kujul {lat: number, lon: number}")
            if not (-90 <= float(lat) <= 90 and -180 <= float(lon) <= 180):
                raise ValueError("coordinates väärtused on väljaspool lubatud vahemikku")

    for field in ("id", "labels", "parent_key", "group", "type", "historical_names", "notes", "coordinates"):
        if field in data:
            entry[field] = data[field]
    places[key] = entry
    atomic_write_json(PLACES_FILE, places)
    _load_places_cache(force_reload=True)
    return entry


# ── Wikidata rikastamine ───────────────────────────────────────────────────

_WD_HEADERS = {
    "User-Agent": "VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)"
}

# Wikidata P31 (instance of) Q-koodid → meie tüübid
_WD_TYPE_MAP = {
    "Q515": "city", "Q3957": "city", "Q5119": "city", "Q1549591": "city",
    "Q1093829": "city", "Q19953632": "city", "Q7930989": "city",
    "Q532": "village", "Q5084": "village", "Q123705": "village",
    "Q15284": "village", "Q1357964": "parish", "Q102496": "parish",
    "Q48091": "province", "Q13220204": "province",
    "Q10864048": "county", "Q28575": "county",
    "Q3028596": "historical_region", "Q82794": "historical_region",
    "Q153654": "historical_region", "Q188509": "historical_region",
    "Q1763527": "historical_region", "Q182832": "historical_region",
}


def _parse_wikidata_point(value: str) -> Optional[dict]:
    """Teisendab Wikidata literal'i 'Point(lon lat)' koordinaatide dictiks."""
    if not value:
        return None
    match = re.match(r"^Point\(([-0-9.]+)\s+([-0-9.]+)\)$", value.strip())
    if not match:
        return None
    lon = float(match.group(1))
    lat = float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {
        "lat": lat,
        "lon": lon,
        "source": "wikidata",
        "wikidata_property": "P625",
    }


def search_places_wikidata(query: str, lang: str = "en", limit: int = 10) -> list:
    """
    Otsib Wikidatast kohti nime järgi (wbsearchentities API).
    Tagastab [{q, label, description, aliases}].
    """
    if not query.strip():
        return []
    url = "https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({
        "action": "wbsearchentities",
        "search": query,
        "language": lang,
        "type": "item",
        "format": "json",
        "limit": limit,
        "props": "url",
    })
    try:
        req = urllib.request.Request(url, headers=_WD_HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        results = []
        for item in data.get("search", []):
            results.append({
                "q": item.get("id", ""),
                "label": item.get("label", ""),
                "description": item.get("description", ""),
                "aliases": item.get("aliases", []),
            })
        return results
    except Exception:
        return []


def fetch_place_wikidata(qid: str) -> Optional[dict]:
    """
    Pärib Wikidatast koha andmed: labelid, tüüp, koordinaadid (P625), ülempiirkonnad (P131).
    Tagastab:
      labels: {et, en, de, la, sv}
      type: meie tüüp või None
      coordinates: {lat, lon, source, wikidata_property} või None
      parents: [{q, label_en, label_sv}] — P131 alusel
    """
    if not qid.startswith("Q") or not qid[1:].isdigit():
        return None

    sparql = f"""
SELECT ?label_et ?label_en ?label_de ?label_la ?label_sv
       ?coord
       ?typeQ (SAMPLE(?typeLabel) AS ?typeLabel)
       ?parentQ (SAMPLE(?parentLabel_en) AS ?parentLabel_en)
                (SAMPLE(?parentLabel_sv) AS ?parentLabel_sv)
WHERE {{
  OPTIONAL {{ wd:{qid} rdfs:label ?label_et. FILTER(LANG(?label_et)="et") }}
  OPTIONAL {{ wd:{qid} rdfs:label ?label_en. FILTER(LANG(?label_en)="en") }}
  OPTIONAL {{ wd:{qid} rdfs:label ?label_de. FILTER(LANG(?label_de)="de") }}
  OPTIONAL {{ wd:{qid} rdfs:label ?label_la. FILTER(LANG(?label_la)="la") }}
  OPTIONAL {{ wd:{qid} rdfs:label ?label_sv. FILTER(LANG(?label_sv)="sv") }}
  OPTIONAL {{ wd:{qid} wdt:P625 ?coord. }}
  OPTIONAL {{
    wd:{qid} wdt:P31 ?typeQ.
    ?typeQ rdfs:label ?typeLabel. FILTER(LANG(?typeLabel)="en")
  }}
  OPTIONAL {{
    wd:{qid} wdt:P131 ?parentQ.
    ?parentQ rdfs:label ?parentLabel_en. FILTER(LANG(?parentLabel_en)="en")
    OPTIONAL {{ ?parentQ rdfs:label ?parentLabel_sv. FILTER(LANG(?parentLabel_sv)="sv") }}
  }}
}}
GROUP BY ?label_et ?label_en ?label_de ?label_la ?label_sv ?coord ?typeQ ?parentQ
LIMIT 20
"""
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({
        "query": sparql, "format": "json"
    })
    try:
        req = urllib.request.Request(url, headers=_WD_HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        bindings = data.get("results", {}).get("bindings", [])
    except Exception:
        return None

    if not bindings:
        return {}

    b0 = bindings[0]
    labels: dict = {}
    for lang in ("et", "en", "de", "la", "sv"):
        v = (b0.get(f"label_{lang}") or {}).get("value")
        if v:
            labels[lang] = v

    coordinates = _parse_wikidata_point((b0.get("coord") or {}).get("value", ""))

    # Tüüp — esimene tuntud P31
    place_type = None
    seen_types: set = set()
    for b in bindings:
        tq = (b.get("typeQ") or {}).get("value", "").split("/")[-1]
        if tq and tq not in seen_types:
            seen_types.add(tq)
            if tq in _WD_TYPE_MAP:
                place_type = _WD_TYPE_MAP[tq]
                break

    # Ülempiirkonnad (P131) — unikaalsed
    seen_parents: set = set()
    parents = []
    for b in bindings:
        pq = (b.get("parentQ") or {}).get("value", "").split("/")[-1]
        if pq and pq not in seen_parents:
            seen_parents.add(pq)
            label_en = (b.get("parentLabel_en") or {}).get("value", "")
            label_sv = (b.get("parentLabel_sv") or {}).get("value", "")
            parents.append({"q": pq, "label_en": label_en, "label_sv": label_sv or label_en})

    return {"labels": labels, "type": place_type, "coordinates": coordinates, "parents": parents}


def refresh_all_place_labels() -> int:
    """Värskendab kõik places.json kirjed Wikidatast mis omavad Q-koodi."""
    places = _load_places_cache(force_reload=True)
    updated = 0
    for key, entry in list(places.items()):
        qid = entry.get("id")
        if not qid or not isinstance(qid, str) or not qid.startswith("Q"):
            continue
        result = fetch_place_wikidata(qid)
        if result and result.get("labels"):
            places[key] = {**entry, "labels": result["labels"]}
            updated += 1
    if updated:
        atomic_write_json(PLACES_FILE, places)
        _load_places_cache(force_reload=True)
    return updated


def merge_places(source_key: str, target_key: str) -> dict:
    """
    Ühendab source_key sihtkoha target_key alla.
    1. Uuendab kõik isikud kelle origin.place == source_key → target_key.
    2. Lisab source_key sihtkoha historical_names listi.
    3. Kustutab source_key places.json-st.
    4. Tagastab {"redirected": N, "target_key": target_key}.
    """
    if source_key == target_key:
        raise ValueError("Ei saa kohta iseendaga ühendada")

    places = _load_places_cache(force_reload=True)

    if source_key not in places:
        raise ValueError(f"Source koht ei leitud: {source_key!r}")
    if target_key not in places:
        raise ValueError(f"Target koht ei leitud: {target_key!r}")

    # Kontrolli et source_key-l pole alamkohti
    children = [k for k, e in places.items() if e.get("parent_key") == source_key]
    if children:
        raise ValueError(
            f"Ei saa ühendada: kohale {source_key!r} on seotud alamkohti: {', '.join(children)}"
        )

    # 1. Uuenda isikute failid
    redirected = 0
    pattern = os.path.join(PROSOPOGRAPHY_DIR, "*.json")
    for fpath in glob.glob(pattern):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                person = json.load(f)
        except Exception as exc:
            logger.warning("merge_places: skipping %s: %s", fpath, exc)
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


def delete_place(key: str) -> None:
    """
    Kustutab koha places.json-st.
    Blokeerib kui kohale on seotud alamkohti või isikuid.
    """
    places = _load_places_cache(force_reload=True)

    if key not in places:
        raise ValueError(f"Koht ei leitud: {key!r}")

    children = [k for k, e in places.items() if e.get("parent_key") == key]
    if children:
        raise ValueError(
            f"Ei saa kustutada: kohale on seotud alamkohti: {', '.join(children)}"
        )

    # Kontrolli isikute viiteid
    pattern = os.path.join(PROSOPOGRAPHY_DIR, "*.json")
    referencing = []
    for fpath in glob.glob(pattern):
        try:
            with open(fpath, "r", encoding="utf-8") as f:
                person = json.load(f)
        except Exception as exc:
            logger.warning("delete_place: skipping %s: %s", fpath, exc)
            continue
        origin = person.get("origin")
        if isinstance(origin, dict) and origin.get("place") == key:
            referencing.append(os.path.basename(fpath))

    if referencing:
        raise ValueError(
            f"Ei saa kustutada: kohale viitab {len(referencing)} isikut. "
            "Kasuta esmalt ühendamist (merge) isikute suunamiseks."
        )

    del places[key]
    atomic_write_json(PLACES_FILE, places)
    _load_places_cache(force_reload=True)

    logger.info("delete_place: %s kustutatud", key)
