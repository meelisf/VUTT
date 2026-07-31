"""Testid isiku märksõnade (tags) otsingule, filtrile ja facetidele."""
import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def ops():
    return importlib.import_module("server.prosopography.ops")


# ---- _normalize_tag_query ----

def test_normalize_tag_query_none_gives_empty_list(ops):
    assert ops._normalize_tag_query(None) == []


def test_normalize_tag_query_string_becomes_single_item(ops):
    assert ops._normalize_tag_query("Q193664") == ["Q193664"]


def test_normalize_tag_query_strips_whitespace(ops):
    assert ops._normalize_tag_query(["  Q193664  ", "\tpietism\n"]) == ["Q193664", "pietism"]


def test_normalize_tag_query_drops_empty_values(ops):
    """?tag= ei tohi tekitada filtrit."""
    assert ops._normalize_tag_query(["", "   ", "Q193664"]) == ["Q193664"]
    assert ops._normalize_tag_query([""]) == []


def test_normalize_tag_query_dedupes_preserving_order(ops):
    assert ops._normalize_tag_query(["b", "a", "b", "a"]) == ["b", "a"]


def test_normalize_tag_query_ignores_non_strings(ops):
    assert ops._normalize_tag_query([None, 5, "Q1"]) == ["Q1"]


# ---- _entry_tags ----

def test_entry_tags_normalizes_dict_items(ops):
    entry = {"tags": [{"label": " pietism ", "id": " Q193664 ", "labels": {"et": "pietism", "en": " Pietism "}}]}
    assert ops._entry_tags(entry) == [
        {"id": "Q193664", "label": "pietism", "labels": {"et": "pietism", "en": "Pietism"}}
    ]


def test_entry_tags_accepts_legacy_string_items(ops):
    entry = {"tags": ["trükkal"]}
    assert ops._entry_tags(entry) == [{"id": None, "label": "trükkal", "labels": None}]


def test_entry_tags_falls_back_to_labels_when_label_missing(ops):
    entry = {"tags": [{"id": "Q1", "labels": {"en": "printer"}}]}
    assert ops._entry_tags(entry) == [{"id": "Q1", "label": "printer", "labels": {"en": "printer"}}]


def test_entry_tags_skips_empty_and_broken_items(ops):
    entry = {"tags": [{}, {"label": "  "}, None, "", {"label": "ok"}]}
    assert ops._entry_tags(entry) == [{"id": None, "label": "ok", "labels": None}]


def test_entry_tags_missing_field_gives_empty_list(ops):
    assert ops._entry_tags({"id": "p1"}) == []


# ---- _tag_match_keys ----

def test_tag_match_keys_includes_id_label_and_all_languages(ops):
    tag = {"id": "Q193664", "label": "pietism", "labels": {"et": "pietism", "de": "Pietismus"}}
    assert ops._tag_match_keys(tag) == {"q193664", "pietism", "pietismus"}


def test_tag_match_keys_without_id(ops):
    assert ops._tag_match_keys({"id": None, "label": "Trükkal", "labels": None}) == {"trükkal"}
