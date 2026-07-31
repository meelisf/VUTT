# Prosopograafia märksõnaotsing — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isikut saab leida märksõna (`tags`) järgi — vaba otsinguga, külgriba filtriga ja märksõnasildile klikkides.

**Architecture:** Märksõnad on `prosopography_index.json`-is juba olemas, seega migratsiooni pole. Backend saab uue `tags`-filtri (loend, JA-semantika), `q` laieneb märksõnadele ja facets tagastab märksõnade loenduse. Frontend loeb URL-ist korduvat `tag` parameetrit, kuvab üksikvaliku filtri ja teeb olemasolevad märksõnasildid klikitavaks.

**Tech Stack:** FastAPI (Python 3.9-ühilduv), pytest + `TestClient`; React 19 + TypeScript, react-router `useSearchParams`, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-07-31-prosopo-marksona-otsing-design.md`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[list]`, `Optional[str]` — MITTE `list | None`. Fail `person_search.py` algab `from __future__ import annotations`, seega annotatsioonid on stringid, aga `Query(None)` vaikeväärtused routeris peavad olema `Optional[...]` kujul.
- **Kommentaarid koodis on eesti keeles.**
- **i18n:** uus võti tuleb lisada **mõlemasse** faili — `src/locales/et/prosopography.json` JA `src/locales/en/prosopography.json`. `fallbackLng` on väljas (ADR 0011); puuduv võti katkestab `localeParity.test.ts`. Uutel võtmetel **ei kasutata** `t('key', 'vaikeväärtus')` teist argumenti.
- **Tõstutundetu võrdlus:** alati `casefold()`, mitte `lower()` — kehtib nii labelitele kui Q-koodidele.
- **Tühi normaliseeritud loend = filtrit pole**, mitte "ükski kirje ei vasta".
- **Testid lokaalselt:** `.venv/bin/pytest`, mitte süsteemi `pytest`. Frontend: `npm run typecheck` ja `npm test`.
- **Facets:** `tag` **ei** lisandu facets-endpointi ega `get_person_facets` signatuuri.
- **Ei kirjutata komponenditeste** — projektis pole `@testing-library`-t ega jsdom'i.

## File Structure

| Fail | Roll | Tegevus |
|------|------|---------|
| `server/prosopography/person_search.py` | filtriloogika, facetid | muuda |
| `server/prosopography/ops.py` | ühilduvusfassaad, re-eksport | muuda (2 uut nime) |
| `server/prosopography/_compat.py` | monkeypatch-sünkroonimine | muuda (1 uus nimi) |
| `server/prosopography/router.py` | HTTP-endpointid | muuda (3 endpointi) |
| `tests/test_prosopography_tags.py` | kõik märksõna-testid | **loo** |
| `src/prosopography/services/prosopographyService.ts` | API-kliendid | muuda |
| `src/prosopography/services/tagParams.ts` | `appendTagParams` puhas funktsioon | **loo** |
| `src/prosopography/services/__tests__/tagParams.test.ts` | vitest | **loo** |
| `src/prosopography/pages/PersonsPage.tsx` | URL-olek, päringud | muuda |
| `src/prosopography/components/PersonAdvancedFilters.tsx` | külgriba filter | muuda |
| `src/prosopography/components/PersonCard.tsx` | klikitavad sildid | muuda |
| `src/prosopography/pages/PersonDetailPage.tsx` | sildi link + Wikidata ikoon | muuda |
| `src/locales/{et,en}/prosopography.json` | tõlked | muuda |

**Ülesannete järjekord:** 1–5 backend (iseseisev, testitav), 6–10 frontend. Frontend eeldab backendi lepingut, seega järjekord loeb.

---

### Task 1: Märksõnade normaliseerimise abifunktsioonid

**Files:**
- Modify: `server/prosopography/person_search.py` (lisa pärast `_extract_occupation_entries`, ~rida 60)
- Modify: `server/prosopography/ops.py:65-75` (import) ja `ops.py:110` (`__all__`)
- Modify: `server/prosopography/_compat.py:38` (`_SYNC_NAMES`)
- Test: `tests/test_prosopography_tags.py` (loo)

**Interfaces:**
- Produces: `_entry_tags(entry: dict) -> list[dict]` — iga element `{"id": Optional[str], "label": str, "labels": Optional[dict]}`
- Produces: `_normalize_tag_query(value) -> list[str]` — võtab `None`, `str` või `list`, tagastab puhastatud loendi
- Produces: `_tag_match_keys(tag: dict) -> set[str]` — kõik casefold-võtmed, millega üks märksõna vastab (id + label + kõik labels-väärtused)

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `tests/test_prosopography_tags.py`:

```python
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
```

- [ ] **Step 2: Käivita testid, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -v`
Expected: FAIL — `AttributeError: module 'server.prosopography.ops' has no attribute '_normalize_tag_query'`

- [ ] **Step 3: Lisa abifunktsioonid `person_search.py`-sse**

Lisa pärast `_extract_occupation_entries` funktsiooni (enne `_entry_occupations`):

```python
def _entry_tags(entry: dict) -> list[dict]:
    """Normaliseerib indeksikirje märksõnad kujule {id, label, labels}.

    Indeks on täielik (kõigil kirjetel on `tags` väli), seega täiskaardilt
    varuvarianti lugema ei pea — erinevalt `_entry_occupations`-ist.
    """
    result: list[dict] = []
    for item in (entry.get("tags") or []):
        if isinstance(item, str):
            label = item.strip()
            if label:
                result.append({"id": None, "label": label, "labels": None})
            continue
        if not isinstance(item, dict):
            continue
        labels = item.get("labels")
        normalized_labels = {
            key: value.strip()
            for key, value in labels.items()
            if isinstance(key, str) and isinstance(value, str) and value.strip()
        } if isinstance(labels, dict) else None
        label = item.get("label")
        label = label.strip() if isinstance(label, str) else ""
        if not label and normalized_labels:
            label = normalized_labels.get("et") or normalized_labels.get("en") or next(iter(normalized_labels.values()), "")
        tag_id = item.get("id")
        tag_id = tag_id.strip() if isinstance(tag_id, str) and tag_id.strip() else None
        if not label and not tag_id:
            continue
        result.append({"id": tag_id, "label": label, "labels": normalized_labels or None})
    return result


def _normalize_tag_query(value) -> list[str]:
    """Puhastab märksõna-päringu: string või loend → puhastatud unikaalne loend.

    Tühi tulemus tähendab "filtrit pole", mitte "ükski kirje ei vasta".
    """
    if value is None:
        return []
    raw = [value] if isinstance(value, str) else list(value)
    seen: set = set()
    result: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        cleaned = item.strip()
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


def _tag_match_keys(tag: dict) -> set:
    """Kõik casefold-võtmed, millega märksõna võib vastata (id, label, kõik keeled)."""
    keys = set()
    if tag.get("id"):
        keys.add(tag["id"].casefold())
    if tag.get("label"):
        keys.add(tag["label"].casefold())
    for value in (tag.get("labels") or {}).values():
        if isinstance(value, str) and value.strip():
            keys.add(value.strip().casefold())
    return keys
```

- [ ] **Step 4: Ekspordi nimed fassaadi kaudu**

`server/prosopography/person_search.py` — lisa `__all__` loendisse (fail lõpp):
`'_entry_tags'`, `'_normalize_tag_query'`, `'_tag_match_keys'`

`server/prosopography/ops.py` — lisa `from .person_search import (...)` plokki (rida ~65) kolm nime ja samad kolm stringi `__all__` loendisse.

`server/prosopography/_compat.py` — lisa `_SYNC_NAMES` hulka `"_entry_tags"` (rida ~38, `"_entry_occupations"` kõrvale). Ainult `_entry_tags` — teised kaks ei ole monkeypatch'itavad sõltuvused.

- [ ] **Step 5: Käivita testid, veendu et läbivad**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -v`
Expected: PASS (14 testi)

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/person_search.py server/prosopography/ops.py server/prosopography/_compat.py tests/test_prosopography_tags.py
git commit -m "feat(prosopo): märksõnade normaliseerimise abifunktsioonid"
```

---

### Task 2: `tags`-filter listingus ja kaardil

**Files:**
- Modify: `server/prosopography/person_search.py:123-197` (`_filter_index_entries`), `:200-260` (`list_persons`), `:263-307` (`get_person_map_markers`)
- Test: `tests/test_prosopography_tags.py`

**Interfaces:**
- Consumes: `_entry_tags`, `_normalize_tag_query`, `_tag_match_keys` (Task 1)
- Produces: `_filter_index_entries(..., tags: Optional[list] = None)`, `list_persons(..., tags: Optional[list] = None)`, `get_person_map_markers(..., tags: Optional[list] = None)` — kõigil sama JA-semantika

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_prosopography_tags.py` lõppu:

```python
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
```

- [ ] **Step 2: Käivita, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -k "tags_filter" -v`
Expected: FAIL — `TypeError: list_persons() got an unexpected keyword argument 'tags'`

- [ ] **Step 3: Lisa filter `_filter_index_entries`-sse**

`person_search.py` — lisa parameeter `tags: Optional[list] = None` signatuuri (pärast `ids`), ja filtriploki `if status_id:` järele:

```python
    tag_queries = _normalize_tag_query(tags)
    if tag_queries:
        wanted = [t.casefold() for t in tag_queries]

        def _entry_has_all_tags(entry: dict) -> bool:
            entry_keys: set = set()
            for tag in _entry_tags(entry):
                entry_keys |= _tag_match_keys(tag)
            return all(w in entry_keys for w in wanted)

        results = [e for e in results if _entry_has_all_tags(e)]
```

- [ ] **Step 4: Anna parameeter edasi `list_persons` ja `get_person_map_markers` kaudu**

Mõlemas: lisa `tags: Optional[list] = None` signatuuri (pärast `ids`) ja `tags=tags,` `_filter_index_entries(...)` kutsesse.

- [ ] **Step 5: Käivita testid**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -v`
Expected: PASS (24 testi)

- [ ] **Step 6: Veendu, et olemasolevad testid ei katkenud**

Run: `.venv/bin/pytest tests/test_prosopography_ops.py tests/test_prosopography_side_writes.py -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/prosopography/person_search.py tests/test_prosopography_tags.py
git commit -m "feat(prosopo): tags-filter JA-semantikaga listingus ja kaardil"
```

---

### Task 3: `q`-otsing leiab märksõna järgi

**Files:**
- Modify: `server/prosopography/person_search.py:149-158` (`if q:` plokk)
- Test: `tests/test_prosopography_tags.py`

**Interfaces:**
- Consumes: `_entry_tags`, `_tag_match_keys` (Task 1)
- Produces: muutuv käitumine `_filter_index_entries(q=...)` — nime/aliase vastele lisandub märksõna-vaste

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_prosopography_tags.py` lõppu:

```python
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
```

- [ ] **Step 2: Käivita, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -k "test_q_" -v`
Expected: FAIL — `assert [] == ['p1']` (märksõna ei ole veel otsitav)

- [ ] **Step 3: Laienda `q`-plokki**

Asenda `person_search.py`-s `if q:` plokk:

```python
    if q:
        q_lower = q.casefold()
        aliases_data = _load_person_aliases()

        def _matches_tags(entry: dict) -> bool:
            for tag in _entry_tags(entry):
                # Q-kood: täpne vaste (osaline annaks liiga laia tulemuse).
                if tag.get("id") and tag["id"].casefold() == q_lower:
                    return True
                # Labelid: osaline vaste, nagu nimeotsingul.
                for key in _tag_match_keys(tag):
                    if key != (tag.get("id") or "").casefold() and q_lower in key:
                        return True
            return False

        results = [
            e for e in results
            if q_lower in (e.get("label") or "").casefold()
            or q_lower in (e.get("sort_name") or "").casefold()
            or any(q_lower in a.casefold() for a in (e.get("aliases") or []))
            or any(q_lower in a.casefold() for a in (aliases_data.get(e.get("id"), {}).get("aliases") or []))
            or _matches_tags(e)
        ]
```

**NB:** `lower()` → `casefold()` ka olemasolevatel nimevõrdlustel — ühtne reegel kogu failis.

- [ ] **Step 4: Käivita testid**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -v`
Expected: PASS (31 testi)

- [ ] **Step 5: Regressioonikontroll**

Run: `.venv/bin/pytest tests/ -k prosopo -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/person_search.py tests/test_prosopography_tags.py
git commit -m "feat(prosopo): q-otsing leiab isiku märksõna järgi"
```

---

### Task 4: Märksõnade facet

**Files:**
- Modify: `server/prosopography/person_search.py:369-425` (`get_person_facets`)
- Test: `tests/test_prosopography_tags.py`

**Interfaces:**
- Consumes: `_entry_tags`, `_tag_match_keys` (Task 1)
- Produces: `get_person_facets()` tagastab lisaks uue võtme `"tags"`: `list[{"value": str, "label": str, "labels": Optional[dict], "count": int}]`. Signatuur EI muutu.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_prosopography_tags.py` lõppu:

```python
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


def test_facets_duplicate_tag_on_one_person_counts_once(ops, monkeypatch):
    """Sama märksõna kaks korda ühel isikul ei tohi loendurit topeltada."""
    dup_index = {
        "entries": [{
            "id": "p1", "label": "Dup", "sort_name": "Dup", "record_status": "draft",
            "tags": [
                {"label": "pietism", "id": "Q193664"},
                {"label": "Pietism", "id": "Q193664"},
                "pietism",
            ],
        }]
    }
    monkeypatch.setattr(ops, "_load_index", lambda: dup_index)
    monkeypatch.setattr(ops, "_load_person_to_works", lambda: {})
    monkeypatch.setattr(ops, "_entry_occupations", lambda e: [])
    monkeypatch.setattr(ops, "_load_person_aliases", lambda: {})
    monkeypatch.setattr(ops, "_load_origin_groups", lambda: {})
    tags = ops.get_person_facets()["tags"]
    assert [(t["value"], t["count"]) for t in tags] == [("Q193664", 1)]


def test_facets_tag_selection_does_not_narrow_facets(indexed):
    """get_person_facets ei võta tag-parameetrit — signatuur ei muutu."""
    with pytest.raises(TypeError):
        indexed.get_person_facets(tags=["Q193664"])
```

- [ ] **Step 2: Käivita, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -k facets -v`
Expected: FAIL — `KeyError: 'tags'`

- [ ] **Step 3: Lisa facet-arvutus**

`person_search.py`, `get_person_facets` sees — pärast `institutions.sort(...)`, enne `return`:

```python
    # Märksõnad — üks isik tõstab loendurit maksimaalselt ühe võrra.
    tag_counts: dict = {}
    tag_meta: dict = {}
    for entry in filtered:
        seen_keys: set = set()
        for tag in _entry_tags(entry):
            key = tag["id"].casefold() if tag.get("id") else (tag.get("label") or "").casefold()
            if not key or key in seen_keys:
                continue
            seen_keys.add(key)
            tag_counts[key] = tag_counts.get(key, 0) + 1
            if key not in tag_meta:
                tag_meta[key] = tag

    tags_facet = []
    for key, count in tag_counts.items():
        meta = tag_meta[key]
        tags_facet.append({
            "value": meta["id"] or meta["label"],
            "label": meta["label"],
            "labels": meta.get("labels"),
            "count": count,
        })
    tags_facet.sort(key=lambda x: (-x["count"], (x["label"] or "").lower()))
```

Ja `return` sõnastikku lisa `"tags": tags_facet,`.

- [ ] **Step 4: Käivita testid**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -v`
Expected: PASS (36 testi)

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/person_search.py tests/test_prosopography_tags.py
git commit -m "feat(prosopo): märksõnade facet isiku-kohta dedupitud loendusega"
```

---

### Task 5: HTTP-endpointid

**Files:**
- Modify: `server/prosopography/router.py:112-157` (GET), `:159-186` (POST `/query`), `:188-228` (GET `/map`)
- Test: `tests/test_prosopography_tags.py`

**Interfaces:**
- Consumes: `list_persons(tags=...)`, `get_person_map_markers(tags=...)` (Task 2), `_normalize_tag_query` (Task 1)
- Produces: `GET /prosopography?tag=A&tag=B`, `POST /prosopography/query` (`{"tag": "A"}` või `{"tag": ["A","B"]}`), `GET /prosopography/map?tag=A`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_prosopography_tags.py` lõppu:

```python
# ---- HTTP-tasand ----

@pytest.fixture
def http(client, ops, monkeypatch):
    monkeypatch.setattr(ops, "_load_index", lambda: FAKE_INDEX)
    monkeypatch.setattr(ops, "_load_person_to_works", lambda: {})
    monkeypatch.setattr(ops, "_entry_occupations", lambda e: [])
    monkeypatch.setattr(ops, "_load_person_aliases", lambda: {})
    monkeypatch.setattr(ops, "_load_origin_groups", lambda: {})
    return client


def test_get_persons_single_tag(http):
    resp = http.get("/prosopography", params={"tag": "Q193664"})
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()["results"]] == ["p1"]


def test_get_persons_repeated_tag_params_use_and_logic(http):
    resp = http.get("/prosopography?tag=Q193664&tag=Q175151")
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()["results"]] == ["p1"]


def test_get_persons_without_tag_returns_all(http):
    resp = http.get("/prosopography")
    assert resp.status_code == 200
    assert resp.json()["total"] == 4


def test_get_persons_empty_tag_is_no_filter(http):
    resp = http.get("/prosopography?tag=")
    assert resp.status_code == 200
    assert resp.json()["total"] == 4


def test_post_query_accepts_tag_as_string(http):
    resp = http.post("/prosopography/query", json={"tag": "Q193664", "ids": ["p1", "p2", "p3", "p4"]})
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()["results"]] == ["p1"]


def test_post_query_accepts_tag_as_list(http):
    resp = http.post("/prosopography/query", json={"tag": ["Q193664", "Q175151"], "ids": ["p1", "p2", "p3", "p4"]})
    assert resp.status_code == 200
    assert [r["id"] for r in resp.json()["results"]] == ["p1"]


def test_map_endpoint_applies_tag_filter(http):
    resp = http.get("/prosopography/map", params={"tag": "Q193664"})
    assert resp.status_code == 200
    assert resp.json()["total_persons"] == 1


def test_facets_endpoint_returns_tags(http):
    resp = http.get("/prosopography/facets")
    assert resp.status_code == 200
    assert any(t["value"] == "Q175151" for t in resp.json()["tags"])
```

- [ ] **Step 2: Käivita, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -k "get_persons or post_query or map_endpoint or facets_endpoint" -v`
Expected: FAIL — `assert 4 == 1` (parameeter ignoreeritakse)

- [ ] **Step 3: Lisa `tag` GET-endpointi**

`router.py:26` — laienda olemasolevat importi:
```python
from .person_search import list_persons, get_person_map_markers, get_person_facets, _normalize_tag_query
```
(**NB:** router impordib otse `person_search`-ist, MITTE `ops`-ist.)

`prosopography_list` signatuuri (pärast `ids: str = None`):

```python
    tag: Optional[List[str]] = Query(None),
```

Ja `list_persons(...)` kutsesse: `tags=_normalize_tag_query(tag),`

**NB:** `Optional` ja `List` peavad olema imporditud `typing`-ust. Kontrolli faili algust; kui puuduvad, lisa `from typing import List, Optional`.

- [ ] **Step 4: Lisa `tag` POST- ja map-endpointi**

`prosopography_query` — `run_in_threadpool(list_persons, ...)` kutsesse:
```python
        tags=_normalize_tag_query(data.get("tag")),
```

`prosopography_map` — signatuuri `tag: Optional[List[str]] = Query(None),` ja `get_person_map_markers(...)` kutsesse `tags=_normalize_tag_query(tag),`

- [ ] **Step 5: Käivita testid**

Run: `.venv/bin/pytest tests/test_prosopography_tags.py -v`
Expected: PASS (44 testi)

- [ ] **Step 6: Backendi täiskontroll**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS (ükski olemasolev test ei katkenud)

- [ ] **Step 7: Commit**

```bash
git add server/prosopography/router.py tests/test_prosopography_tags.py
git commit -m "feat(prosopo): tag-parameeter listingu, query ja map endpointides"
```

---

### Task 6: Frontendi API-klient

**Files:**
- Create: `src/prosopography/services/tagParams.ts`
- Create: `src/prosopography/services/__tests__/tagParams.test.ts`
- Modify: `src/prosopography/services/prosopographyService.ts:7-63` (`listPersons`), `:66-105` (`fetchPersonMapMarkers`), `:120-155` (`getPersonFacets` tüüp)

**Interfaces:**
- Produces: `appendTagParams(params: URLSearchParams, tag?: string | string[]): void`
- Produces: `listPersons`/`fetchPersonMapMarkers` võtavad `tag?: string | string[]`
- Produces: `getPersonFacets` tagastustüüp sisaldab `tags: { value: string; label: string; labels?: Record<string, string> | null; count: number }[]`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `src/prosopography/services/__tests__/tagParams.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { appendTagParams } from '../tagParams';

const collect = (tag?: string | string[]) => {
  const params = new URLSearchParams();
  appendTagParams(params, tag);
  return params.getAll('tag');
};

describe('appendTagParams', () => {
  it('ei lisa midagi, kui väärtus puudub', () => {
    expect(collect(undefined)).toEqual([]);
  });

  it('lisab üksiku stringi', () => {
    expect(collect('Q193664')).toEqual(['Q193664']);
  });

  it('lisab iga loendi väärtuse eraldi võtmena (append, mitte set)', () => {
    expect(collect(['Q193664', 'Q175151'])).toEqual(['Q193664', 'Q175151']);
  });

  it('jätab tühjad ja tühikulised väärtused vahele', () => {
    expect(collect(['', '   ', 'Q1'])).toEqual(['Q1']);
  });

  it('eemaldab duplikaadid järjekorda säilitades', () => {
    expect(collect(['Q1', 'Q2', 'Q1'])).toEqual(['Q1', 'Q2']);
  });

  it('tühi loend ei lisa võtmeid', () => {
    expect(collect([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npm test -- tagParams`
Expected: FAIL — `Cannot find module '../tagParams'`

- [ ] **Step 3: Loo `tagParams.ts`**

```ts
/**
 * Märksõna-parameetrite serialiseerimine URL-i.
 *
 * Korduv `tag` võti on ainus koht teenusekihis, kus kasutatakse `append`-i
 * `set`-i asemel — `set` kirjutaks eelmise väärtuse üle ja mitmikvalik murduks.
 */
export function appendTagParams(params: URLSearchParams, tag?: string | string[]): void {
  if (!tag) return;
  const values = Array.isArray(tag) ? tag : [tag];
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    params.append('tag', cleaned);
  }
}
```

- [ ] **Step 4: Käivita test**

Run: `npm test -- tagParams`
Expected: PASS (6 testi)

- [ ] **Step 5: Ühenda teenusesse**

`prosopographyService.ts` — lisa import:
```ts
import { appendTagParams } from './tagParams';
```

`listPersons` params-tüüpi lisa `tag?: string | string[];` (pärast `status_id`). URL-i ehituses, pärast `if (params?.status_id) ...` rida:
```ts
  appendTagParams(url.searchParams, params?.tag);
```

**NB:** POST-haru (`if (params?.ids?.length)`) saadab `JSON.stringify(params)` — `tag` läheb automaatselt kaasa, muudatust ei vaja.

`fetchPersonMapMarkers` — sama: `tag?: string | string[];` tüüpi ja `appendTagParams(url.searchParams, params?.tag);` URL-i ehitusse.

`getPersonFacets` tagastustüüpi lisa:
```ts
  tags: { value: string; label: string; labels?: Record<string, string> | null; count: number }[];
```
Facets-päringu params-tüüpi `tag` **EI** lisandu.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/services/tagParams.ts src/prosopography/services/__tests__/tagParams.test.ts src/prosopography/services/prosopographyService.ts
git commit -m "feat(prosopo): tag-parameeter API-kliendis + appendTagParams"
```

---

### Task 7: PersonsPage URL-olek ja päringud

**Files:**
- Modify: `src/prosopography/pages/PersonsPage.tsx` — read 32-50 (olek), 79-95 (setterid), 134-168 (`fetchPersons`), 195-212 (`mapFilters`), ~371 (`onClearAll`)

**Interfaces:**
- Consumes: `listPersons({ tag })`, `fetchPersonMapMarkers({ tag })` (Task 6)
- Produces: `tags: string[]` — URL-ist loetud märksõnad; `setTag` lisandub Task 8-s koos tarbijaga

- [ ] **Step 1: Lisa URL-olek**

Pärast rida `const statusId = searchParams.get('status_id') ?? '';` lisa:

```tsx
  // Märksõnad — URL toetab kordust (?tag=A&tag=B), UI valib praegu ühe.
  // Stabiilne string on vajalik, sest getAll() annab igal renderdusel uue massiivi
  // ja see destabiliseeriks useCallback deps-listi (lõputu päringutsükkel).
  const tagsKey = searchParams.getAll('tag').join(TAG_SEP);
  const tags = useMemo(() => (tagsKey ? tagsKey.split(TAG_SEP) : []), [tagsKey]);
```

Ja mooduli tasemel, `const LIMIT = 48;` kõrvale:

```tsx
// Unit Separator — märksõna ise võib sisaldada tühikuid ja komasid
// ("kreeka keele professor"), seega tavaline eraldaja ei sobi.
const TAG_SEP = '\u001F';
```

**NB:** `setTag` setterit siin veel EI lisata. `tsconfig.json` seab `noUnusedLocals: true`,
seega kasutamata funktsioon katkestaks typecheck'i. Setter lisandub Task 8-s koos oma tarbijaga.

- [ ] **Step 2: Anna päringutesse**

`fetchPersons` sees, `listPersons({...})` objekti lisa (pärast `status_id`):
```tsx
      tag: tags.length ? tags : undefined,
```
ja `useCallback` deps-listi lisa `tags` (pärast `statusId`).

`mapFilters` objekti lisa (pärast `status_id`):
```tsx
    tag: tags.length ? tags : undefined,
```

`fetchFacets` jääb **muutmata** — `tag` ei lähe facets-päringusse.

- [ ] **Step 3: Lisa aktiivsete filtrite arvestusse ja puhastusse**

`hasActiveFilters` rida — lisa `|| tags.length`:
```tsx
  const hasActiveFilters = !!(originGroup || originPlace || institution || source || gender || yearFrom || yearTo || statusId || tags.length);
```

`onClearAll` massiivi lisa `'tag'`:
```tsx
              ['origin_group', 'origin_place', 'institution', 'source', 'gender', 'year_from', 'year_to', 'imm_year_from', 'imm_year_to', 'status_id', 'tag', 'offset'].forEach(k => n.delete(k));
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/pages/PersonsPage.tsx
git commit -m "feat(prosopo): PersonsPage loeb ja saadab tag-parameetri"
```

---

### Task 8: Külgriba märksõna-filter

**Files:**
- Modify: `src/prosopography/components/PersonAdvancedFilters.tsx` — read 3 (import), 28-47 (props), 108-119 (destruktureerimine, `hasActive`, `activeCount`), 126-135 (facet-itemid), ~150 (uus sektsioon)
- Modify: `src/prosopography/pages/PersonsPage.tsx` — facet-olek, `<PersonAdvancedFilters>` propsid
- Modify: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json`

**Interfaces:**
- Consumes: `tags`, `setTag` (Task 7), `getPersonFacets().tags` (Task 6)
- Produces: `PersonAdvancedFilters` uued propsid `tag: string`, `tagFacets: FacetItem[]`, `onTagChange: (v: string) => void`

- [ ] **Step 1: Lisa tõlkevõtmed**

`src/locales/et/prosopography.json` — lisa `filterSourceAll` kõrvale:
```json
  "filterTags": "Märksõnad",
  "filterTagsSearch": "Otsi märksõna…",
```

`src/locales/en/prosopography.json` — samad võtmed:
```json
  "filterTags": "Keywords",
  "filterTagsSearch": "Search keyword…",
```

- [ ] **Step 2: Kontrolli tõlkeparieteeti**

Run: `npm test -- localeParity`
Expected: PASS

- [ ] **Step 3: Lisa facet-olek PersonsPage'ile**

`PersonsPage.tsx` — `institutionFacets` oleku kõrvale:
```tsx
  const [tagFacets, setTagFacets] = useState<{ value: string; label: string; count: number }[]>([]);
```

`fetchFacets` `.then` sees, pärast `setInstitutionFacets(data.institutions || []);`:
```tsx
        setTagFacets((data.tags || []).map(item => ({
          value: item.value,
          label: item.labels?.[lang] ?? item.labels?.['et'] ?? item.labels?.['en'] ?? item.label,
          count: item.count,
        })));
```
ja `.catch` harusse lisa `setTagFacets([]);`

- [ ] **Step 4: Lisa propsid `PersonAdvancedFilters`-ile**

Interface `PersonAdvancedFiltersProps` — lisa:
```tsx
  tag: string;
  tagFacets: FacetItem[];
  onTagChange: (v: string) => void;
```

Komponendi destruktureerimine — lisa `tag`, `tagFacets`, `onTagChange`.

`hasActive` ja `activeCount` (read ~118-119):
```tsx
  const hasActive = !!(originGroup || originPlace || institution || source || gender || hasYearRange || statusId || tag);
  const activeCount = [originGroup, originPlace, institution, source, gender, hasYearRange ? '1' : '', statusId, tag].filter(Boolean).length;
```

- [ ] **Step 5: Lisa filtrisektsioon**

Import real 3 — lisa `Tag` lucide'i ikoonide hulka.

Pärast haridusasutuse `<FilterSection>`-i (rida ~172) lisa:

```tsx
          <FilterSection
            title={t('filterTags')}
            icon={<Tag size={13} />}
            items={tagFacets}
            selectedValue={tag}
            onSelect={onTagChange}
            searchPlaceholder={t('filterTagsSearch')}
            emptyLabel={t('filterNoMatches', 'Ei leitud vasteid')}
          />
```

- [ ] **Step 6: Lisa `setTag` setter PersonsPage'ile**

Pärast rida `const setStatusId = (v: string) => setFilterParam('status_id', v);` lisa:

```tsx
  // Uus valik asendab kõik senised märksõnad (UI on üksikvalik).
  const setTag = (v: string) =>
    setSearchParams(p => {
      const n = new URLSearchParams(p);
      n.delete('tag');
      if (v) n.append('tag', v);
      n.delete('offset');
      return n;
    }, { replace: true });
```

- [ ] **Step 7: Ühenda PersonsPage'is**

`<PersonAdvancedFilters ... />` propsidele lisa:
```tsx
            tag={tags[0] ?? ''}
            tagFacets={tagFacets}
            onTagChange={setTag}
```

- [ ] **Step 8: Typecheck + testid**

Run: `npm run typecheck && npm test`
Expected: exit 0, kõik testid PASS

- [ ] **Step 9: Commit**

```bash
git add src/prosopography/components/PersonAdvancedFilters.tsx src/prosopography/pages/PersonsPage.tsx src/locales/et/prosopography.json src/locales/en/prosopography.json
git commit -m "feat(prosopo): märksõna-filter külgribal"
```

---

### Task 9: Klikitavad märksõnad isikukaardil

**Files:**
- Modify: `src/prosopography/components/PersonCard.tsx` — read 78-84 (`CardInner` propsid), 115-127 (siltide renderdus), 228-295 (`PersonCard`)

**Interfaces:**
- Consumes: URL-leping `?tag=<value>` (Task 5, 7)
- Produces: kaardi märksõna-silt navigeerib `/persons?tag=<value>`

**Kontekst:** kaardi juur EI ole `<Link>`, vaid `div role="link"` + `onClick` (read 284-293). Pesastatud ankru probleemi ei ole. Sama mustrit kasutab juba päritolukoha nupp real 154-165.

- [ ] **Step 1: Lisa prop `CardInner`-ile**

`CardInner` propside tüüpi (rida ~78-84) lisa:
```tsx
  onTagClick?: (value: string) => void;
```
ja destruktureerimisse (rida ~84) `onTagClick`.

- [ ] **Step 2: Tee sildid klikitavaks**

Asenda siltide renderdus (read 115-127):

```tsx
          {(person.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(person.tags ?? []).map((tag, i) => {
                const lang = i18n.language?.slice(0, 2) ?? 'et';
                const label = tag.labels?.[lang] ?? tag.labels?.en ?? tag.label;
                const value = tag.id || tag.label;
                const chipClass = 'px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100/90 text-blue-700 border border-blue-200';
                // Valikurežiimis onTagClick puudub → silt jääb passiivseks (sama muster mis onOriginClick).
                if (!onTagClick || !value) {
                  return <span key={i} className={chipClass}>{label}</span>;
                }
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={e => { e.stopPropagation(); onTagClick(value); }}
                    className={`${chipClass} hover:bg-blue-200 transition-colors`}
                    title={t('filterTags')}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
```

- [ ] **Step 3: Lisa navigeerimine `PersonCard`-is**

Pärast `openOriginMap` funktsiooni (rida ~282):

```tsx
  const openTagFilter = (value: string) => {
    const params = new URLSearchParams();
    params.append('tag', value);
    navigate(`/persons?${params.toString()}`);
  };
```

Ja mitte-valikurežiimi `<CardInner ... />` kutsesse (rida ~292) lisa `onTagClick={openTagFilter}`.

**NB:** valikurežiimi `<CardInner>` (rida 266) jääb ILMA `onTagClick`-ita — täpselt nagu `onOriginClick` praegu.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 5: Käsitsi kontroll**

```bash
npm run dev
```
Ava `http://localhost:5173/persons?q=pietism`. Kontrolli:
1. isik leitakse märksõna järgi;
2. klikk sinisel märksõnasildil viib `/persons?tag=Q193664` — MITTE isiku detailvaatesse;
3. "Täpsemad valikud" avaneb ja "Märksõnad" sektsioonis on valik esile tõstetud;
4. liitmise valikurežiimis (admin, "Vali") klikk sildil valib kaardi, ei navigeeri.

- [ ] **Step 6: Commit**

```bash
git add src/prosopography/components/PersonCard.tsx
git commit -m "feat(prosopo): isikukaardi märksõnad viivad filtreeritud nimekirja"
```

---

### Task 10: Detailvaate märksõna — sisemine link + Wikidata ikoon

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx:588-617` (märksõnade renderdus)

**Interfaces:**
- Consumes: URL-leping `?tag=<value>` (Task 5, 7)

**Kontekst:** praegu on sildi tekst link Wikidatasse (read 594-597). Uus jaotus: tekst → sisemine filter, väike `ExternalLink` ikoon → Wikidata.

**Importe ei ole vaja lisada:** `Link` on juba real 3 (`react-router-dom`), `ExternalLink` real 7 (`lucide-react`), `isQCode` real 10.

- [ ] **Step 1: Asenda sildi renderdus**

Asenda `{(person.tags ?? []).map(...)}` sisu (read 589-617) nii, et `<span>`-i sees on:

```tsx
                  const label = tag.labels?.[lang] ?? tag.labels?.en ?? tag.label;
                  const url = tag.id && isQCode(tag.id) ? `https://www.wikidata.org/wiki/${tag.id}` : null;
                  const value = tag.id || tag.label;
                  return (
                    <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-gray-100 text-gray-700 border border-gray-200 rounded">
                      {value ? (
                        <Link to={`/persons?tag=${encodeURIComponent(value)}`}
                          className="hover:text-primary-700 transition-colors">
                          {label}
                        </Link>
                      ) : label}
                      {url && (
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="text-gray-400 hover:text-primary-700 transition-colors"
                          title="Wikidata">
                          <ExternalLink size={10} />
                        </a>
                      )}
                      {canEdit && (
                        <button
                          onClick={async () => {
                            const newTags = (person.tags ?? []).filter((_: any, j: number) => j !== i);
                            setPerson({ ...person, tags: newTags });
                            setTagsSaving(true);
                            try { await updatePerson(person.id, { tags: newTags, updated_at: person.updated_at } as any, token); }
                            catch { setPerson({ ...person }); }
                            finally { setTagsSaving(false); }
                          }}
                          className="text-gray-400 hover:text-red-500 transition-colors ml-0.5"
                        >
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                        </button>
                      )}
                    </span>
                  );
```

**NB:** kustutusnupp on ülal toodud muutmata kujul — see on täpselt praegune kood. Muutuvad ainult sildi tekstiosa (Wikidata-link → `<Link>`) ja uus `ExternalLink` ikoon.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 3: Käsitsi kontroll**

```bash
npm run dev
```
Ava suvalise märksõnaga isiku detailvaade. Kontrolli:
1. märksõna teksti klikk viib `/persons?tag=…`;
2. väike välislingi ikoon avab Wikidata uues sakis;
3. toimetaja rollis on kustutusnupp alles ja töötab;
4. Q-koodita märksõnal on ainult sisemine link, ikooni pole.

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat(prosopo): detailvaate märksõna viib filtrisse, Wikidata eraldi ikoonil"
```

---

### Task 11: Lõppkontroll ja PR

**Files:** puuduvad (ainult kontroll)

- [ ] **Step 1: Backendi testid**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS, 0 failed

- [ ] **Step 2: Frontendi testid ja typecheck**

Run: `npm run typecheck && npm test`
Expected: exit 0

- [ ] **Step 3: Lint (ei tohi tõusta üle lävendi)**

Run: `npx eslint . --max-warnings 56`
Expected: exit 0

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 5: Ava PR**

```bash
git push -u origin feat/prosopo-marksona-otsing
gh pr create --base main --title "feat(prosopo): isiku otsimine märksõna järgi" --body "$(cat <<'EOF'
Märksõnad (`tags`) olid isikuindeksis olemas, aga neid ei saanud otsida.
Kolm sisenemisteed: vaba otsing, külgriba filter, klikitavad sildid.

- `q` leiab isiku märksõna labeli (kõik keeled) või Q-koodi järgi
- uus `tag` parameeter listingu-, query- ja map-endpointides; URL toetab
  kordust (`?tag=A&tag=B`, JA-loogika), UI on praegu üksikvalik
- facets tagastab märksõnade loenduse (isiku kohta dedupitud)
- kaardi ja detailvaate sildid viivad filtreeritud nimekirja

Migratsiooni ei ole — indeks sisaldab märksõnu juba.
Spec: `docs/superpowers/specs/2026-07-31-prosopo-marksona-otsing-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Deploy pärast merge'i**

```bash
ssh vutt 'cd ~/VUTT && ./scripts/server_update.sh --no-cache'
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

**NB:** Meilisearch sync EI ole vajalik — isikuotsing käib indeksifailist, mitte Meilist.
