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


# ---- tags-filter ----

FAKE_INDEX = {
    "entries": [
        {
            "id": "p1", "label": "Pietist", "sort_name": "Pietist", "record_status": "draft",
            "tags": [
                {"label": "pietism", "id": "Q193664", "labels": {"et": "pietism", "en": "Pietism"}},
                {"label": "trükkal", "id": "Q175151", "labels": {"et": "trükkal", "en": "printer"}},
            ],
        },
        {
            "id": "p2", "label": "Printer", "sort_name": "Printer", "record_status": "draft",
            "tags": [{"label": "trükkal", "id": "Q175151", "labels": {"et": "trükkal", "en": "printer"}}],
        },
        {"id": "p3", "label": "Plain", "sort_name": "Plain", "record_status": "draft", "tags": []},
        {
            "id": "p4", "label": "Legacy", "sort_name": "Legacy", "record_status": "draft",
            "tags": ["kantsler"],
        },
    ]
}


@pytest.fixture
def indexed(ops, monkeypatch):
    monkeypatch.setattr(ops, "_load_index", lambda: FAKE_INDEX)
    monkeypatch.setattr(ops, "_load_person_to_works", lambda: {})
    monkeypatch.setattr(ops, "_entry_occupations", lambda e: [])
    monkeypatch.setattr(ops, "_load_person_aliases", lambda: {})
    # get_person_facets kutsub selle alati välja — ilma patchita loeks päris konfiguratsiooni.
    monkeypatch.setattr(ops, "_load_origin_groups", lambda: {})
    return ops


def _ids(result):
    return [r["id"] for r in result["results"]]


def test_tags_filter_by_qcode(indexed):
    assert _ids(indexed.list_persons(tags=["Q193664"])) == ["p1"]


def test_tags_filter_qcode_is_case_insensitive(indexed):
    assert _ids(indexed.list_persons(tags=["q193664"])) == ["p1"]


def test_tags_filter_by_estonian_label(indexed):
    assert sorted(_ids(indexed.list_persons(tags=["trükkal"]))) == ["p1", "p2"]


def test_tags_filter_by_english_label(indexed):
    assert sorted(_ids(indexed.list_persons(tags=["PRINTER"]))) == ["p1", "p2"]


def test_tags_filter_two_values_is_and_logic(indexed):
    """Kaks märksõna → ainult isik, kellel on MÕLEMAD."""
    assert _ids(indexed.list_persons(tags=["Q193664", "Q175151"])) == ["p1"]


def test_tags_filter_matches_legacy_string_tag(indexed):
    assert _ids(indexed.list_persons(tags=["kantsler"])) == ["p4"]


def test_tags_filter_empty_list_is_no_filter(indexed):
    assert len(_ids(indexed.list_persons(tags=[]))) == 4


def test_tags_filter_blank_value_is_no_filter(indexed):
    assert len(_ids(indexed.list_persons(tags=["  "]))) == 4


def test_tags_filter_unknown_value_matches_nobody(indexed):
    assert _ids(indexed.list_persons(tags=["Q999999"])) == []


def test_tags_filter_applies_to_map_markers(indexed):
    result = indexed.get_person_map_markers(tags=["Q193664"])
    assert result["total_persons"] == 1


# ---- q-otsing märksõnades ----

def test_q_finds_person_by_estonian_tag_label(indexed):
    assert _ids(indexed.list_persons(q="pietism")) == ["p1"]


def test_q_finds_person_by_english_tag_label(indexed):
    assert _ids(indexed.list_persons(q="Pietism")) == ["p1"]


def test_q_finds_person_by_tag_qcode(indexed):
    assert _ids(indexed.list_persons(q="Q193664")) == ["p1"]


def test_q_tag_qcode_is_case_insensitive(indexed):
    assert _ids(indexed.list_persons(q="q193664")) == ["p1"]


def test_q_matches_partial_tag_label(indexed):
    """Osaline vaste — nagu nimeotsingutki."""
    assert sorted(_ids(indexed.list_persons(q="rükka"))) == ["p1", "p2"]


def test_q_still_matches_names(indexed):
    """Nimevaste ei tohi kaduda."""
    assert _ids(indexed.list_persons(q="Plain")) == ["p3"]


def test_q_qcode_matches_exactly_not_partially(indexed):
    """Q-koodi osaline vaste ei tohi kogu registrit tagastada."""
    assert _ids(indexed.list_persons(q="Q19")) == []


# ---- facetid ----

def test_facets_include_tags_with_counts(indexed):
    facets = indexed.get_person_facets()
    by_value = {t["value"]: t for t in facets["tags"]}
    assert by_value["Q175151"]["count"] == 2
    assert by_value["Q193664"]["count"] == 1
    assert by_value["Q193664"]["label"] == "pietism"
    assert by_value["Q193664"]["labels"]["en"] == "Pietism"


def test_facets_tags_sorted_by_count_desc(indexed):
    values = [t["value"] for t in indexed.get_person_facets()["tags"]]
    assert values[0] == "Q175151"


def test_facets_legacy_string_tag_uses_label_as_value(indexed):
    by_value = {t["value"]: t for t in indexed.get_person_facets()["tags"]}
    assert by_value["kantsler"]["count"] == 1


def _facets_for(ops, monkeypatch, tags_value):
    index = {
        "entries": [{
            "id": "p1", "label": "Dup", "sort_name": "Dup", "record_status": "draft",
            "tags": tags_value,
        }]
    }
    monkeypatch.setattr(ops, "_load_index", lambda: index)
    monkeypatch.setattr(ops, "_load_person_to_works", lambda: {})
    monkeypatch.setattr(ops, "_entry_occupations", lambda e: [])
    monkeypatch.setattr(ops, "_load_person_aliases", lambda: {})
    monkeypatch.setattr(ops, "_load_origin_groups", lambda: {})
    return [(t["value"], t["count"]) for t in ops.get_person_facets()["tags"]]


def test_facets_duplicate_tag_on_one_person_counts_once(ops, monkeypatch):
    """Sama märksõna kaks korda ühel isikul ei tohi loendurit topeltada."""
    result = _facets_for(ops, monkeypatch, [
        {"label": "pietism", "id": "Q193664"},
        {"label": "Pietism", "id": "Q193664"},
    ])
    assert result == [("Q193664", 1)]


def test_facets_qcode_and_bare_label_are_separate_rows(ops, monkeypatch):
    """Grupeerimisvõti on Q-kood kui olemas, muidu label.

    Q-koodiga ja Q-koodita märksõna on seega eraldi read, isegi kui label
    kattub. Label-põhine liitmine oleks mitmemõtteline: kui sama labeliga on
    kaks eri Q-koodi, ei ole ühest vastust, kumma alla paljas label kuulub.
    """
    result = _facets_for(ops, monkeypatch, [
        {"label": "pietism", "id": "Q193664"},
        "pietism",
    ])
    assert sorted(result) == [("Q193664", 1), ("pietism", 1)]


def test_facets_tag_selection_does_not_narrow_facets(indexed):
    """get_person_facets ei võta tag-parameetrit — signatuur ei muutu."""
    with pytest.raises(TypeError):
        indexed.get_person_facets(tags=["Q193664"])
