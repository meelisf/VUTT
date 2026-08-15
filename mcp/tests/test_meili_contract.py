"""Meili LEPINGU test — mitte pelk väljanime olemasolu.

Väli võib dokumendis alles olla, aga päring kukub 400-ga, kui indeksiseaded
enam ei kata. Meili nõuab:
  - filtris JA `distinct`-is kasutatav atribuut → filterableAttributes
  - sorteeritav atribuut → sortableAttributes
  - otsitav atribuut → searchableAttributes

See test on peamine põhjus, miks vutt_mcp elab samas repos. Ta impordib
`server`-it — see on lubatud AINULT testis, mitte vutt_mcp runtime'is
(pipx paigaldab paketi isoleeritud venv-i, kus `server` puudub).
"""
from server.meili_settings import (
    FILTERABLE_ATTRIBUTES,
    SEARCHABLE_ATTRIBUTES,
    SORTABLE_ATTRIBUTES,
)
from vutt_mcp import queries


def test_koik_filtrivaljad_on_filterable():
    missing = set(queries.FILTER_FIELDS) - set(FILTERABLE_ATTRIBUTES)
    assert not missing, f"filterableAttributes hulgast puuduvad: {sorted(missing)}"


def test_distinct_valja_peab_olema_filterable():
    # Meili nõuab seda ka päringupõhise distinct'i puhul
    assert "work_id" in FILTERABLE_ATTRIBUTES


def test_koik_sorteeritavad_valjad_on_sortable():
    missing = set(queries.SORT_FIELDS) - set(SORTABLE_ATTRIBUTES)
    assert not missing, f"sortableAttributes hulgast puuduvad: {sorted(missing)}"


def test_koik_otsitavad_valjad_on_searchable():
    missing = set(queries.SEARCH_FIELDS) - set(SEARCHABLE_ATTRIBUTES)
    assert not missing, f"searchableAttributes hulgast puuduvad: {sorted(missing)}"


def test_facetivaljad_on_filterable():
    missing = set(queries.FACET_FIELDS.values()) - set(FILTERABLE_ATTRIBUTES)
    assert not missing, f"facet-väljad pole filterable: {sorted(missing)}"


def test_tagastatavad_valjad_eksisteerivad_dokumendis():
    """Kontrollib väljade olemasolu indekseeritava dokumendi vastu."""
    import inspect

    from server import meili_doc

    source = inspect.getsource(meili_doc)
    for field in set(queries.SEARCH_RETRIEVE_FIELDS) | set(queries.PAGE_RETRIEVE_FIELDS):
        assert f'"{field}"' in source, f"{field} ei esine meili_doc.py-s"


def test_eszett_normaliseerimine_kattub_indekseerijaga():
    """Kui indekseerija ja päring lahknevad, ei leia „Schluß" enam midagi."""
    from server.meili_doc import normalize_eszett

    for sample in ("Schluß", "daß", "auspicatißimos", "GROSSE", "ẞ"):
        assert queries.normalize_query(sample) == normalize_eszett(sample)


def test_facet_lagi_on_sama_mis_indeksis():
    """FACET_VALUE_CAP peab kattuma indeksi faceting.maxValuesPerFacet-iga."""
    from server.meili_settings import MAX_VALUES_PER_FACET

    assert queries.FACET_VALUE_CAP == MAX_VALUES_PER_FACET
