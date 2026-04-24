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
        "coordinates": {"lat": 56.9475, "lon": 24.1069, "source": "wikidata", "wikidata_property": "P625", "geonames_id": "456172"},
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


# ── _get_place_coordinates ─────────────────────────────────────────────────

def test_get_place_coordinates_normalizes_numeric_values():
    with _patch_places():
        from server.prosopography.places_ops import _get_place_coordinates
        assert _get_place_coordinates("Riga") == {
            "lat": 56.9475,
            "lon": 24.1069,
            "source": "wikidata",
            "wikidata_property": "P625",
            "geonames_id": "456172",
        }


def test_get_place_coordinates_returns_none_for_missing_or_invalid():
    with _patch_places():
        from server.prosopography.places_ops import _get_place_coordinates
        assert _get_place_coordinates("Dorpat") is None
        assert _get_place_coordinates(None) is None


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


# ── Wikidata koordinaadid ──────────────────────────────────────────────────

def test_parse_wikidata_point():
    from server.prosopography.places_ops import _parse_wikidata_point
    assert _parse_wikidata_point("Point(24.1069 56.9475)") == {
        "lat": 56.9475,
        "lon": 24.1069,
        "source": "wikidata",
        "wikidata_property": "P625",
    }


def test_parse_wikidata_point_rejects_invalid():
    from server.prosopography.places_ops import _parse_wikidata_point
    assert _parse_wikidata_point("") is None
    assert _parse_wikidata_point("Point(200 95)") is None
    assert _parse_wikidata_point("not a point") is None


def test_put_place_accepts_coordinates(tmp_path):
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    places_file.write_text(json.dumps({}))
    groups_file.write_text(json.dumps({}))
    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
    ):
        from server.prosopography.places_ops import put_place
        entry = put_place("Riga", {
            "id": "Q1773",
            "labels": {"en": "Riga"},
            "coordinates": {"lat": 56.9475, "lon": 24.1069},
        })
        assert entry["coordinates"] == {"lat": 56.9475, "lon": 24.1069}


def test_put_place_rejects_invalid_coordinates(tmp_path):
    places_file = tmp_path / "places.json"
    groups_file = tmp_path / "origin_groups.json"
    places_file.write_text(json.dumps({}))
    groups_file.write_text(json.dumps({}))
    with (
        patch("server.prosopography.places_ops.PLACES_FILE", str(places_file)),
        patch("server.prosopography.places_ops.ORIGIN_GROUPS_FILE", str(groups_file)),
        patch("server.prosopography.places_ops._places_cache", None),
        patch("server.prosopography.places_ops._groups_cache", None),
    ):
        from server.prosopography.places_ops import put_place
        with pytest.raises(ValueError, match="coordinates"):
            put_place("Bad", {"coordinates": {"lat": "56", "lon": 24}})
