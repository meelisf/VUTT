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


def test_overpass_query_filters_year_and_admin_level_two():
    query = _build_overpass_query(1650, (50, 10, 65, 30))
    assert '"admin_level"="2"' in query
    assert '1650-01-01' in query
    assert '(50,10,65,30)' in query
    assert 'out geom' in query


def test_normalize_geojson_keeps_only_needed_localized_properties():
    result = _normalize_geojson(_square_relation(), 0.001)
    assert result["type"] == "FeatureCollection"
    assert len(result["features"]) == 1
    feature = result["features"][0]
    assert feature["id"] == 123
    assert feature["geometry"]["type"] in ("Polygon", "MultiPolygon")
    assert feature["properties"] == {
        "relation_id": 123,
        "name": "Testimaa",
        "label_et": None,
        "label_en": "Testland",
        "start_date": "1600",
        "end_date": "1700",
        "color": _region_color(123),
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


def test_region_color_is_stable():
    assert _region_color(123) == _region_color(123)
    assert _region_color(123) != _region_color(124)
