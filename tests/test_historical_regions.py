import server.prosopography.historical_regions as historical_regions
from server.prosopography.historical_regions import (
    _build_overpass_query,
    _fallback_all_inner_geometry,
    _normalize_geojson,
    _quantize_bbox,
    _region_color,
    _validate_bbox,
)


def _square_relation():
    return {
        "elements": [{
            "type": "relation",
            "id": 123,
            "members": [{
                "type": "way",
                "ref": 456,
                "role": "outer",
                "geometry": [
                    {"lat": 58.0, "lon": 24.0},
                    {"lat": 58.0, "lon": 25.0},
                    {"lat": 59.0, "lon": 25.0},
                    {"lat": 59.0, "lon": 24.0},
                    {"lat": 58.0, "lon": 24.0},
                ],
            }],
            "tags": {
                "type": "boundary",
                "boundary": "administrative",
                "admin_level": "2",
                "name": "Testimaa",
                "name:en": "Testland",
                "start_date": "1600",
                "end_date": "1700",
            },
        }],
    }


def test_quantize_bbox_expands_to_shared_grid():
    assert _quantize_bbox(51.2, 11.1, 60.1, 29.9) == (50, 10, 65, 30)


def test_validate_bbox_rejects_invalid_or_excessive_extent():
    for bbox in [(60, 20, 50, 30), (-80, -180, 80, 180)]:
        try:
            _validate_bbox(*bbox)
            assert False, "vigane bbox pidi tõstma ValueErrori"
        except ValueError:
            pass


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


def test_overpass_query_filters_year_and_all_admin_levels():
    query = _build_overpass_query(1650, (50, 10, 65, 30))
    assert '"admin_level"~"^(2|3)$"' in query
    assert '1650-01-01' in query
    assert '(50,10,65,30)' in query
    assert 'out geom' in query


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


def test_all_inner_boundary_members_are_recovered_as_polygon():
    element = _square_relation()["elements"][0]
    element["members"][0]["role"] = "inner"
    geometry = _fallback_all_inner_geometry(element)
    assert geometry is not None
    assert geometry.geom_type == "Polygon"
    assert round(geometry.area, 3) == 1.0


def test_disk_cache_survives_memory_cache(tmp_path, monkeypatch):
    monkeypatch.setattr(historical_regions, "DISK_CACHE_DIR", str(tmp_path))
    key = (1650, 45, -10, 65, 35)
    result = {"year": 1650, "geojson": {"type": "FeatureCollection", "features": []}}
    historical_regions._write_disk_cache(key, result)
    assert historical_regions._read_disk_cache(key) == result


def test_expired_cache_can_be_used_as_stale_fallback(tmp_path, monkeypatch):
    monkeypatch.setattr(historical_regions, "DISK_CACHE_DIR", str(tmp_path))
    key = (1650, 45, -10, 65, 35)
    result = {"year": 1650}
    historical_regions._write_disk_cache(key, result)
    now = historical_regions.time.time()
    monkeypatch.setattr(historical_regions.time, "time", lambda: now + 8 * 24 * 60 * 60)
    assert historical_regions._read_disk_cache(key) is None
    assert historical_regions._read_disk_cache(key, historical_regions.STALE_CACHE_TTL_SECONDS) == result


def test_default_snapshot_warmup_loads_fresh_disk_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(historical_regions, "DISK_CACHE_DIR", str(tmp_path))
    result = {"year": 1650, "region_count": 1}
    historical_regions._write_disk_cache(historical_regions.DEFAULT_SNAPSHOT_KEY, result)
    monkeypatch.setattr(
        historical_regions,
        "_fetch_regions",
        lambda *args: (_ for _ in ()).throw(AssertionError("värsket snapshot'i ei tohi uuesti laadida")),
    )
    historical_regions._pinned_cache.pop(historical_regions.DEFAULT_SNAPSHOT_KEY, None)
    try:
        assert historical_regions._warm_default_snapshot_once() is False
        assert historical_regions._pinned_cache[historical_regions.DEFAULT_SNAPSHOT_KEY] == result
    finally:
        historical_regions._pinned_cache.pop(historical_regions.DEFAULT_SNAPSHOT_KEY, None)


def test_default_snapshot_warmup_refreshes_stale_snapshot(tmp_path, monkeypatch):
    monkeypatch.setattr(historical_regions, "DISK_CACHE_DIR", str(tmp_path))
    old_result = {"year": 1650, "region_count": 1}
    new_result = {"year": 1650, "region_count": 2}
    historical_regions._write_disk_cache(historical_regions.DEFAULT_SNAPSHOT_KEY, old_result)
    monkeypatch.setattr(historical_regions, "_disk_cache_age_seconds", lambda key: float("inf"))
    monkeypatch.setattr(historical_regions, "_fetch_regions", lambda year, bbox: new_result)
    historical_regions._pinned_cache.pop(historical_regions.DEFAULT_SNAPSHOT_KEY, None)
    try:
        assert historical_regions._warm_default_snapshot_once() is True
        assert historical_regions._pinned_cache[historical_regions.DEFAULT_SNAPSHOT_KEY] == new_result
        assert historical_regions._read_disk_cache(historical_regions.DEFAULT_SNAPSHOT_KEY) == new_result
    finally:
        historical_regions._pinned_cache.pop(historical_regions.DEFAULT_SNAPSHOT_KEY, None)


def test_overpass_429_honors_retry_after(monkeypatch):
    class FakeResponse:
        def __init__(self, status_code, headers=None):
            self.status_code = status_code
            self.headers = headers or {}

        def raise_for_status(self):
            if self.status_code >= 400:
                raise AssertionError(f"ootamatu HTTP {self.status_code}")

        def json(self):
            return {"elements": []}

    responses = iter([FakeResponse(429, {"Retry-After": "3"}), FakeResponse(200)])
    sleeps = []
    monkeypatch.setattr(historical_regions, "OVERPASS_MIN_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(historical_regions.requests, "post", lambda *args, **kwargs: next(responses))
    monkeypatch.setattr(historical_regions.time, "sleep", sleeps.append)

    assert historical_regions._post_overpass("test") == {"elements": []}
    assert sleeps == [3.0]


def test_region_color_is_stable():
    assert _region_color(123) == _region_color(123)
    assert _region_color(123) != _region_color(124)
