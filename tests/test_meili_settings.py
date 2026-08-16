"""Indeksi seaded on ÜHES kohas — seed-skript ja runtime kasutavad sama allikat."""
from server.meili_settings import (
    FILTERABLE_ATTRIBUTES,
    SEARCHABLE_ATTRIBUTES,
    SORTABLE_ATTRIBUTES,
)


def test_runtime_needed_hulk_sisaldub_filterables():
    """_ensure_filterable_attributes() 'needed' hulk EI TOHI olla eraldi nimekiri."""
    from server.meilisearch_ops import RUNTIME_REQUIRED_FILTERABLE

    assert RUNTIME_REQUIRED_FILTERABLE.issubset(set(FILTERABLE_ATTRIBUTES))


def test_kriitilised_valjad_on_olemas():
    """Väljad, mille puudumine murrab teadaoleva funktsionaalsuse."""
    # distinct: "work_id" nõuab, et work_id oleks filterable
    assert "work_id" in FILTERABLE_ATTRIBUTES
    # lehekülgede järjestus get_work-is
    assert "lehekylje_number" in SORTABLE_ATTRIBUTES
    # kollektsioonifilter
    assert "collections" in FILTERABLE_ATTRIBUTES
    assert "collections_hierarchy" in FILTERABLE_ATTRIBUTES
    # tenant-tokeni filter
    assert "is_public" in FILTERABLE_ATTRIBUTES
    # põhitekst ja marginaalia otsitavad
    assert "lehekylje_tekst" in SEARCHABLE_ATTRIBUTES
    assert "marginaalia_tekst" in SEARCHABLE_ATTRIBUTES


def test_nimekirjades_pole_duplikaate():
    for attrs in (SEARCHABLE_ATTRIBUTES, FILTERABLE_ATTRIBUTES, SORTABLE_ATTRIBUTES):
        assert len(attrs) == len(set(attrs))
