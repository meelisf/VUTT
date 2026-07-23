"""OpenHistoricalMapi ajalooliste halduspiirkondade GeoJSON-proksi ja cache."""

import hashlib
import json
import math
import os
import tempfile
import threading
import time
from collections import OrderedDict
from typing import Dict, Tuple

import osm2geojson
import requests
from shapely.geometry import LineString, mapping, shape
from shapely.ops import polygonize, unary_union

from ..config import get_logger

logger = get_logger(__name__)

OVERPASS_URL = "https://overpass-api.openhistoricalmap.org/api/interpreter"
WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php"
OVERPASS_TIMEOUT_SECONDS = 75
OVERPASS_MIN_INTERVAL_SECONDS = 1.5
OVERPASS_MAX_RETRIES = 2
OVERPASS_BACKOFF_BASE_SECONDS = 2
CACHE_TTL_SECONDS = 7 * 24 * 60 * 60
STALE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60
CACHE_MAX_ENTRIES = 24
DISK_CACHE_MAX_ENTRIES = 100
DISK_CACHE_DIR = os.path.join(os.getenv("VUTT_STATE_DIR", "state"), "historical_regions_cache")
MAX_BBOX_WIDTH = 140
MAX_BBOX_HEIGHT = 90

# Summutatud toonid: täite läbipaistvus määratakse frontendil.
REGION_COLORS = (
    "#77978a",  # salveiroheline
    "#8497ad",  # hallikassinine
    "#b29a6b",  # ooker
    "#a98278",  # terrakota
    "#9186a3",  # tuhm lilla
    "#6f9ba2",  # sinakasroheline
    "#a38f73",  # soe hallpruun
    "#839b75",  # oliivroheline
)

_cache: "OrderedDict[Tuple, Tuple[float, dict]]" = OrderedDict()
_cache_lock = threading.Lock()
_key_locks: Dict[Tuple, threading.Lock] = {}
_overpass_request_lock = threading.Lock()
_last_overpass_request_at = 0.0


class HistoricalRegionsError(RuntimeError):
    """OHM-i piirkondade laadimine või teisendamine ebaõnnestus."""


def _disk_cache_path(key: Tuple) -> str:
    digest = hashlib.sha256(repr(key).encode("utf-8")).hexdigest()
    return os.path.join(DISK_CACHE_DIR, f"{digest}.json")


def _read_disk_cache(key: Tuple, max_age_seconds: float = CACHE_TTL_SECONDS) -> dict:
    path = _disk_cache_path(key)
    try:
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        if time.time() - payload["cached_at"] < max_age_seconds:
            return payload["result"]
    except FileNotFoundError:
        pass
    except (OSError, ValueError, KeyError, TypeError) as exc:
        logger.warning("Ajalooliste piirkondade ketta-cache lugemine ebaõnnestus: %s", exc)
        try:
            os.remove(path)
        except OSError:
            pass
    return None


def _retry_delay_seconds(response, attempt: int) -> float:
    retry_after = response.headers.get("Retry-After")
    if retry_after:
        try:
            return max(0.0, min(120.0, float(retry_after)))
        except ValueError:
            pass
    return OVERPASS_BACKOFF_BASE_SECONDS * (2 ** attempt)


def _post_overpass(query: str) -> dict:
    """Serialiseerib OHM-i päringud, piirab tempot ja kordab ajutise tõrke korral."""
    global _last_overpass_request_at

    with _overpass_request_lock:
        for attempt in range(OVERPASS_MAX_RETRIES + 1):
            wait_seconds = OVERPASS_MIN_INTERVAL_SECONDS - (time.monotonic() - _last_overpass_request_at)
            if wait_seconds > 0:
                time.sleep(wait_seconds)

            _last_overpass_request_at = time.monotonic()
            try:
                response = requests.post(
                    OVERPASS_URL,
                    data={"data": query},
                    headers={"User-Agent": "VUTT historical regions/1.0"},
                    timeout=OVERPASS_TIMEOUT_SECONDS,
                )
            except requests.RequestException:
                if attempt >= OVERPASS_MAX_RETRIES:
                    raise
                time.sleep(OVERPASS_BACKOFF_BASE_SECONDS * (2 ** attempt))
                continue

            if response.status_code not in (429, 502, 503, 504) or attempt >= OVERPASS_MAX_RETRIES:
                response.raise_for_status()
                return response.json()

            delay = _retry_delay_seconds(response, attempt)
            logger.warning(
                "OHM Overpass vastas %s; uus katse %.1f sekundi pärast",
                response.status_code,
                delay,
            )
            time.sleep(delay)

    raise HistoricalRegionsError("OpenHistoricalMapi päring ei andnud vastust")


def _write_disk_cache(key: Tuple, result: dict) -> None:
    try:
        os.makedirs(DISK_CACHE_DIR, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(prefix="regions-", suffix=".tmp", dir=DISK_CACHE_DIR)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump({"cached_at": time.time(), "result": result}, handle, separators=(",", ":"))
            os.replace(temp_path, _disk_cache_path(key))
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)

        files = sorted(
            (os.path.join(DISK_CACHE_DIR, name) for name in os.listdir(DISK_CACHE_DIR) if name.endswith(".json")),
            key=os.path.getmtime,
            reverse=True,
        )
        for old_path in files[DISK_CACHE_MAX_ENTRIES:]:
            os.remove(old_path)
    except OSError as exc:
        # Cache kirjutamise tõrge ei tohi kaarti katkestada.
        logger.warning("Ajalooliste piirkondade ketta-cache kirjutamine ebaõnnestus: %s", exc)


def _quantize_bbox(south: float, west: float, north: float, east: float) -> Tuple[float, float, float, float]:
    """Laiendab vaate fikseeritud ruudustikule, et eri kasutajad jagaksid cache'i."""
    width = east - west
    grid = 10 if width > 40 else 5 if width > 15 else 2
    return (
        max(-85.0, math.floor(south / grid) * grid),
        max(-180.0, math.floor(west / grid) * grid),
        min(85.0, math.ceil(north / grid) * grid),
        min(180.0, math.ceil(east / grid) * grid),
    )


def _validate_bbox(south: float, west: float, north: float, east: float) -> None:
    if not (-85 <= south < north <= 85 and -180 <= west < east <= 180):
        raise ValueError("Vigane kaardi ulatus")
    if east - west > MAX_BBOX_WIDTH or north - south > MAX_BBOX_HEIGHT:
        raise ValueError("Kaardi ulatus on piirkonnakihi jaoks liiga suur")


def _build_overpass_query(year: int, bbox: Tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
    date = f"{year:04d}-01-01"
    return f'''[out:json][timeout:60];
relation["boundary"="administrative"]["admin_level"="2"]({south},{west},{north},{east})
(if: (!is_tag("start_date") || t["start_date"] <= "{date}") && (!is_tag("end_date") || t["end_date"] >= "{date}"));
out geom;'''


def _region_color(relation_id: int) -> str:
    digest = hashlib.sha256(str(relation_id).encode("ascii")).digest()
    return REGION_COLORS[int.from_bytes(digest[:2], "big") % len(REGION_COLORS)]


def _localized_labels(tags: dict, wikidata_labels: dict = None) -> dict:
    labels = {}
    wikidata_labels = wikidata_labels or {}
    for lang in ("et", "en"):
        label = (
            tags.get(f"name:{lang}")
            or tags.get(f"alt_name:{lang}")
            or wikidata_labels.get(lang)
        )
        if label:
            labels[lang] = label
    return labels


def _fetch_wikidata_labels(overpass_data: dict) -> dict:
    """Täidab OHM-is puuduvad eesti/inglise nimed ühe Wikidata batch-päringuga."""
    qids = sorted({
        element.get("tags", {}).get("wikidata")
        for element in overpass_data.get("elements", [])
        if (
            element.get("tags", {}).get("wikidata", "").startswith("Q")
            and element.get("tags", {}).get("wikidata", "")[1:].isdigit()
        )
    })
    labels = {}
    try:
        for offset in range(0, len(qids), 50):
            response = requests.get(
                WIKIDATA_API_URL,
                params={
                    "action": "wbgetentities",
                    "ids": "|".join(qids[offset:offset + 50]),
                    "props": "labels",
                    "languages": "et|en",
                    "format": "json",
                },
                headers={"User-Agent": "VUTT historical regions/1.0"},
                timeout=15,
            )
            response.raise_for_status()
            for qid, entity in response.json().get("entities", {}).items():
                labels[qid] = {
                    lang: value.get("value")
                    for lang, value in entity.get("labels", {}).items()
                    if lang in ("et", "en") and value.get("value")
                }
    except (requests.RequestException, ValueError) as exc:
        # Nimed on rikastus: Wikidata tõrge ei tohi piirkonnakihti ära võtta.
        logger.warning("Ajalooliste piirkondade Wikidata nimede laadimine ebaõnnestus: %s", exc)
    return labels


def _fallback_all_inner_geometry(element: dict):
    """Parandab OHM-i relatsioonid, mille kõik piirijupid on ekslikult inner-rolliga."""
    members = [member for member in element.get("members", []) if member.get("geometry")]
    if not members or any(member.get("role") not in ("", "inner", None) for member in members):
        return None
    lines = []
    for member in members:
        coordinates = [(point["lon"], point["lat"]) for point in member["geometry"]]
        if len(coordinates) >= 2:
            lines.append(LineString(coordinates))
    if not lines:
        return None
    polygons = list(polygonize(unary_union(lines)))
    return unary_union(polygons) if polygons else None


def _normalize_geojson(overpass_data: dict, tolerance: float, wikidata_labels: dict = None) -> dict:
    """Teisendab Overpassi relatsioonid lihtsustatud ja väikseks GeoJSON-iks."""
    converted = osm2geojson.json2geojson(overpass_data, log_level="CRITICAL")
    converted_geometries = {
        feature.get("properties", {}).get("id"): feature.get("geometry")
        for feature in converted.get("features", [])
        if feature.get("geometry")
    }
    features = []

    for element in overpass_data.get("elements", []):
        relation_id = element.get("id")
        tags = element.get("tags") or {}
        geometry_data = converted_geometries.get(relation_id)
        if not isinstance(relation_id, int):
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
        canonical_name = tags.get("name") or labels.get("en") or labels.get("et") or str(relation_id)
        features.append({
            "type": "Feature",
            "id": relation_id,
            "properties": {
                "relation_id": relation_id,
                "name": canonical_name,
                "label_et": labels.get("et"),
                "label_en": labels.get("en"),
                "start_date": tags.get("start_date"),
                "end_date": tags.get("end_date"),
                "color": _region_color(relation_id),
            },
            "geometry": mapping(geometry),
        })

    # Suuremad üksused enne: väiksemad kattuvad alad jäävad nende peale nähtavaks.
    features.sort(key=lambda item: shape(item["geometry"]).area, reverse=True)
    return {"type": "FeatureCollection", "features": features}


def _fetch_regions(year: int, bbox: Tuple[float, float, float, float]) -> dict:
    query = _build_overpass_query(year, bbox)
    try:
        overpass_data = _post_overpass(query)
    except (requests.RequestException, ValueError) as exc:
        raise HistoricalRegionsError(f"OpenHistoricalMapi päring ebaõnnestus: {exc}") from exc

    # Ligikaudu üks ekraanipiksel madalal suumil; preserve_topology hoiab augud ja saared.
    tolerance = max(0.003, min(0.05, (bbox[3] - bbox[1]) / 3000))
    geojson = _normalize_geojson(overpass_data, tolerance, _fetch_wikidata_labels(overpass_data))
    return {
        "geojson": geojson,
        "year": year,
        "bounds": {"south": bbox[0], "west": bbox[1], "north": bbox[2], "east": bbox[3]},
        "region_count": len(geojson["features"]),
    }


def get_historical_regions(year: int, south: float, west: float, north: float, east: float) -> dict:
    """Tagastab admin_level=2 piirkonnad; cache võti kasutab ruudustikule laiendatud bbox'i."""
    _validate_bbox(south, west, north, east)
    bbox = _quantize_bbox(south, west, north, east)
    _validate_bbox(*bbox)
    key = (year, *bbox)
    now = time.time()

    with _cache_lock:
        cached = _cache.get(key)
        if cached and now - cached[0] < CACHE_TTL_SECONDS:
            _cache.move_to_end(key)
            return cached[1]
        key_lock = _key_locks.setdefault(key, threading.Lock())

    # Sama piirkonna paralleelsed päringud koondatakse üheks Overpassi päringuks.
    with key_lock:
        with _cache_lock:
            cached = _cache.get(key)
            if cached and time.time() - cached[0] < CACHE_TTL_SECONDS:
                _cache.move_to_end(key)
                return cached[1]

        disk_cached = _read_disk_cache(key)
        if disk_cached is not None:
            with _cache_lock:
                _cache[key] = (time.time(), disk_cached)
                _cache.move_to_end(key)
                while len(_cache) > CACHE_MAX_ENTRIES:
                    _cache.popitem(last=False)
                _key_locks.pop(key, None)
            return disk_cached

        try:
            result = _fetch_regions(year, bbox)
        except HistoricalRegionsError:
            stale = _read_disk_cache(key, STALE_CACHE_TTL_SECONDS)
            with _cache_lock:
                _key_locks.pop(key, None)
            if stale is not None:
                logger.warning("OHM-i tõrke tõttu tagastatakse aegunud piirkondade cache")
                return stale
            raise
        except Exception:
            with _cache_lock:
                _key_locks.pop(key, None)
            raise

        _write_disk_cache(key, result)
        with _cache_lock:
            _cache[key] = (time.time(), result)
            _cache.move_to_end(key)
            while len(_cache) > CACHE_MAX_ENTRIES:
                _cache.popitem(last=False)
            _key_locks.pop(key, None)
        return result
