"""OpenHistoricalMapi ajalooliste halduspiirkondade GeoJSON-proksi ja cache."""

import hashlib
import math
import threading
import time
from collections import OrderedDict
from typing import Dict, Optional, Tuple

import osm2geojson
import requests
from shapely.geometry import mapping, shape

from ..config import get_logger

logger = get_logger(__name__)

OVERPASS_URL = "https://overpass-api.openhistoricalmap.org/api/interpreter"
OVERPASS_TIMEOUT_SECONDS = 75
CACHE_TTL_SECONDS = 24 * 60 * 60
CACHE_MAX_ENTRIES = 24
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


class HistoricalRegionsError(RuntimeError):
    """OHM-i piirkondade laadimine või teisendamine ebaõnnestus."""


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


def _localized_labels(tags: dict) -> dict:
    labels = {}
    for lang in ("et", "en"):
        label = tags.get(f"name:{lang}") or tags.get(f"alt_name:{lang}")
        if label:
            labels[lang] = label
    return labels


def _normalize_geojson(overpass_data: dict, tolerance: float) -> dict:
    """Teisendab Overpassi relatsioonid lihtsustatud ja väikseks GeoJSON-iks."""
    converted = osm2geojson.json2geojson(overpass_data, log_level="CRITICAL")
    features = []

    for feature in converted.get("features", []):
        geometry_data = feature.get("geometry")
        properties = feature.get("properties") or {}
        tags = properties.get("tags") or {}
        relation_id = properties.get("id")
        if not geometry_data or not isinstance(relation_id, int):
            continue

        try:
            geometry = shape(geometry_data)
            if not geometry.is_valid:
                geometry = geometry.buffer(0)
            geometry = geometry.simplify(tolerance, preserve_topology=True)
        except Exception as exc:
            logger.warning("OHM relatsiooni %s geomeetria teisendamine ebaõnnestus: %s", relation_id, exc)
            continue

        if geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            continue

        labels = _localized_labels(tags)
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
        response = requests.post(
            OVERPASS_URL,
            data={"data": query},
            headers={"User-Agent": "VUTT historical regions/1.0"},
            timeout=OVERPASS_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        overpass_data = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise HistoricalRegionsError(f"OpenHistoricalMapi päring ebaõnnestus: {exc}") from exc

    # Ligikaudu üks ekraanipiksel madalal suumil; preserve_topology hoiab augud ja saared.
    tolerance = max(0.003, min(0.05, (bbox[3] - bbox[1]) / 3000))
    geojson = _normalize_geojson(overpass_data, tolerance)
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

        result = _fetch_regions(year, bbox)
        with _cache_lock:
            _cache[key] = (time.time(), result)
            _cache.move_to_end(key)
            while len(_cache) > CACHE_MAX_ENTRIES:
                _cache.popitem(last=False)
            _key_locks.pop(key, None)
        return result
