# Isiku lisamise voog — PR 3: isikupaneel — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isiku lisamine teose kontekstist ühes paneelis samal lehel: ühine otsing (VUTT + Wikidata + GND + VIAF), identiteedi järgi grupeeritud kandidaadid koos eluaastate/ametite/kohtade ja allikate vastuoludega, „VUTT-is juba olemas" alati ees, „Loo ja vali" paneb isiku kohe lahtrisse; `/persons/new` kasutab sama paneeli.

**Architecture:** Server annab kandidaatide normaliseeritud kokkuvõtted (`POST /prosopography/candidates`, uus moodul `server/prosopography/candidates.py`, mis taaskasutab rikastuse parsereid). Otsing jääb brauserisse (lobid/VIAF/Wikidata CORS; lobid ei olnud serverist alati kättesaadav). Kliendi puhtad funktsioonid (grupeerimine, nimevalik, otsingu ühendamine) elavad `src/prosopography/panel/` all; paneel `PersonAddPanel` kasutab neid ja PR 1 otspunkti `POST /prosopography/persons/create`.

**Tech Stack:** Python 3.12 / FastAPI / pytest; React 19 + TypeScript / vitest (+ jsdom komponenditestides).

**Spec:** `docs/superpowers/specs/2026-09-24-isiku-lisamise-voog-design.md` (rev 4) — §4.1, §5.1, §5.2, §6 (§6.1 admini järjekord EI ole selle PR-i osa).

**Kõrvalekalle spekist (kontrolleri otsus 2026-09-24):** kokkuvõtted küsitakse kõigi (≤ 15) viidete kohta KOHE otsingu järel ühe `/candidates` päringuga, mitte lahti klõpsamisel — kasutaja põhivalu on „rippmenüüst ei saa aru, kas see on õige isik"; eluaastad/ametid peavad olema näha juba kokkuklapitud real.

## Global Constraints

- Koodikommentaarid eesti keeles; UI tekstid **mõlemasse** keelde (`src/locales/et/*.json`, `src/locales/en/*.json`) korraga (ADR 0011). Eestikeelne UI tekst peab olema loomulik eesti keel.
- Python: `.venv/bin/pytest`. Blokeeriv I/O mitte `async def`-is (ADR 0002) — `/candidates` on sync `def` route.
- Välisallika päringut ei tehta ühegi luku all; `/candidates` ei võta lukke üldse (ainult loeb).
- Loomine käib AINULT `POST /prosopography/persons/create` kaudu (ADR 0048); 409 `exists` → vali olemasolev, 409 `split` → ära loo ega vali midagi.
- Kaardi nimi (spekk §5.2): allika täisnimi, mis sobib kõigi otsitud sõnadega **sõna-eesliite** reegli järgi; mitme sobiva korral keeled **la → mul → de → en → et**; ükski ei sobi → allika põhinimi; võrdlus NFC + tõstutundetu + `ß` = `ss`; valimata nimed → `aliases`.
- Täisekraani/külgpaneel `z-[1300]` (päis on `z-[1200]`).
- Frontendi väravad: `npm run typecheck`, `npm test`, `npm run lint:ci` — **lint on 43 hoiatuse lävel, varu 0**: uus kood EI TOHI lisada ühtki `react-hooks/exhaustive-deps` hoiatust.
- Commit'i lõpp: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Allikas ei vasta** (lobid maas, VIAF aegub): paneel näitab teisi allikaid ja lubab luua; tõrkunud viide on märgitud, mitte vaikselt kadunud. Test: Task 2 (osaline tõrge) + Task 5 (paneel näitab märget).
2. **Sama isik mitmes allikas, mis EI viita üksteisele** (GND ilma Wikidata `sameAs`-ita): kaks eraldi kandidaati — ei ühendata nime järgi (vale ühendamine oleks halvem kui kaks rida). Test: Task 3.
3. **Otsing, mille ükski nimi ei sisalda** (vaste kirjeldusest): kaardi nimeks allika põhinimi, mitte otsitud sõna. Test: Task 3.
4. **409 `split`**: paneel ei loo ega vali; näitab mõlemat kaarti. Test: Task 5.
5. **Valija ilma sisselogimiseta / tokenita**: „Lisa isik…" ei ilmu (loomine nõuab editor+). Test: Task 6.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/prosopography/enrichment.py` | `_wikidata_result(entity)` eraldatud `_fetch_wikidata`-st; `_fetch_lobid_raw(gnd_id)` eraldatud `_fetch_gnd`-st |
| `server/prosopography/candidates.py` (uus) | `candidate_summary(scheme, id)`, `candidates(name, refs)` |
| `server/prosopography/router.py` | `POST /prosopography/candidates` |
| `src/prosopography/panel/candidateNames.ts` (uus) | `chooseCardName`, `nameMatches` (puhas) |
| `src/prosopography/panel/candidateGroups.ts` (uus) | `groupCandidates` (puhas, union-find seotud ID-de järgi) |
| `src/prosopography/panel/searchSources.ts` (uus) | `searchPersonSources(query, lang)` — Wikidata kiir- + täistekst, GND, VIAF → viited |
| `src/services/wikidataService.ts` | `searchWikidataPersonsFulltext(query, lang)` |
| `src/prosopography/services/prosopographyService.ts` | `fetchCandidates(name, refs, token)` + tüübid |
| `src/prosopography/components/PersonAddPanel.tsx` (uus) | paneel |
| `src/components/EntityPicker.tsx` | „Lisa isik…" + välise tulemuse klikk → paneel; prop `personContext` |
| `src/components/MetadataModal.tsx`, `src/components/UploadMetaForm.tsx` | `personContext` (work_id, role) |
| `src/prosopography/pages/PersonEditPage.tsx` | uus isik: paneel esimese sammuna |
| `src/locales/{et,en}/prosopography.json` | `panel.*` võtmed |

---

### Task 1: Kandidaadi kokkuvõte serveris (`candidates.py`)

**Files:**
- Modify: `server/prosopography/enrichment.py`
- Create: `server/prosopography/candidates.py`
- Test: `tests/test_candidates_summary.py`

**Interfaces:**
- Produces: `enrichment._wikidata_result(entity: dict) -> Optional[dict]` (sama väljund mis `_fetch_wikidata` — viimane muutub `_wd_entity` + `_wikidata_result`-iks).
- Produces: `enrichment._fetch_lobid_raw(gnd_id: str) -> Optional[dict]` (lobid JSON või `None`); `_fetch_gnd` = `_parse_lobid(raw)` või d-nb varutee.
- Produces: `candidates.candidate_summary(scheme: str, ext_id: str) -> Optional[dict]` kujul:

```json
{"label": "Lorenz Luden",
 "names": [{"text": "Lorenz Luden", "lang": "et", "kind": "label"},
           {"text": "Laurentius Ludenius", "lang": "mul", "kind": "alias"}],
 "description": "German scientist and author (1592–1654)",
 "birth": {"date": "1592-01-01", "precision": "year", "place": {"id": "Q…", "label": "Greifswald"}},
 "death": {"date": null, "precision": null, "place": null},
 "occupations": [{"id": "Q…", "label": "õigusteadlane"}],
 "url": "https://www.wikidata.org/wiki/Q1870103",
 "links": {"gnd": "…", "viaf": "…"}}
```

- [ ] **Step 1: Ebaõnnestuvad testid**

```python
"""Kandidaadi kokkuvõte isikupaneelile (spekk §4.1).

Kokkuvõte tuleb SAMADEST parseritest kui rikastus — paneel näitab täpselt
seda, mis kaardile hiljem kirjutatakse. Võrk asendatakse.
"""
import json
from pathlib import Path

import pytest

from server.prosopography import candidates, enrichment

WD = json.loads((Path(__file__).parent / "fixtures" / "wikidata" / "Q1698324_entity.json")
                .read_text(encoding="utf-8"))


def test_wikidata_kokkuvote_nimede_keelte_ja_linkidega(monkeypatch):
    entity = {**WD, "labels": {"et": {"value": "Johannes Schefferus"},
                               "sv": {"value": "Johannes Schefferus"}},
              "descriptions": {"en": {"value": "Swedish academic (1621–1679)"}},
              "claims": {**WD["claims"],
                         "P227": [{"rank": "normal", "mainsnak": {"snaktype": "value",
                                   "datavalue": {"value": "118607588"}}}],
                         "P214": [{"rank": "normal", "mainsnak": {"snaktype": "value",
                                   "datavalue": {"value": "32004409"}}}]}}
    monkeypatch.setattr(enrichment, "_wd_entity", lambda q: entity)
    monkeypatch.setattr(enrichment, "_wd_labels",
                        lambda ids: {i: {"et": f"silt {i}"} for i in ids})
    s = candidates.candidate_summary("wikidata", "Q1698324")
    assert s["label"] == "Johannes Schefferus"
    assert any(n["text"] == "Johannes Scheffer" and n["kind"] == "alias" for n in s["names"])
    assert s["names"][0] == {"text": "Johannes Schefferus", "lang": "et", "kind": "label"}
    assert s["description"] == "Swedish academic (1621–1679)"
    assert s["birth"]["date"] == "1621-02-02" and s["birth"]["place"]["id"] == "Q6602"
    assert s["links"] == {"gnd": "118607588", "viaf": "32004409"}
    assert s["url"] == "https://www.wikidata.org/wiki/Q1698324"


def test_gnd_kokkuvote_lobidist(monkeypatch):
    raw = {"preferredName": "Hezel, Wilhelm Friedrich",
           "variantName": ["Hezel, Guilielmus Fridericus"],
           "biographicalOrHistoricalInformation": ["Orientalist, Theologe"],
           "dateOfBirth": ["1754-05-16"], "dateOfDeath": ["1824-06-12"],
           "sameAs": [{"id": "http://www.wikidata.org/entity/Q16405824"},
                      {"id": "http://viaf.org/viaf/34486358"}]}
    monkeypatch.setattr(enrichment, "_fetch_lobid_raw", lambda g: raw)
    s = candidates.candidate_summary("gnd", "116796197")
    assert s["label"] == "Wilhelm Friedrich Hezel"
    assert {"text": "Guilielmus Fridericus Hezel", "lang": None, "kind": "alias"} in s["names"]
    assert s["description"] == "Orientalist, Theologe"
    assert s["birth"]["date"] == "1754-05-16"
    assert s["links"] == {"wikidata": "Q16405824", "viaf": "34486358"}
    assert s["url"] == "https://explore.gnd.network/gnd/116796197"


def test_gnd_varutee_kui_lobid_ei_vasta(monkeypatch):
    monkeypatch.setattr(enrichment, "_fetch_lobid_raw", lambda g: None)
    monkeypatch.setattr(enrichment, "_fetch_gnd_dnb", lambda g: {
        "name.label": "Wilhelm Friedrich Hezel", "name.aliases": ["W. F. Hezel"],
        "birth.date": "1754-05-16", "birth.precision": "day", "_linked_wikidata": "Q16405824"})
    s = candidates.candidate_summary("gnd", "116796197")
    assert s["label"] == "Wilhelm Friedrich Hezel"
    assert s["links"] == {"wikidata": "Q16405824"}


def test_viaf_kokkuvote(monkeypatch):
    monkeypatch.setattr(enrichment, "_fetch_viaf", lambda v: {
        "name.label": "Theodorus Praetorius", "name.aliases": ["Theodor Praetorius"],
        "_linked_wikidata": "Q1", "_linked_gnd": "2"})
    s = candidates.candidate_summary("viaf", "123")
    assert s["label"] == "Theodorus Praetorius"
    assert s["links"] == {"wikidata": "Q1", "gnd": "2"}
    assert s["url"] == "https://viaf.org/viaf/123"


def test_tundmatu_skeem_ja_tork_on_none(monkeypatch):
    assert candidates.candidate_summary("aa", "1") is None
    monkeypatch.setattr(enrichment, "_wd_entity", lambda q: None)
    assert candidates.candidate_summary("wikidata", "Q1") is None
```

- [ ] **Step 2: Käivita — FAIL** (`ModuleNotFoundError: candidates`)

Run: `.venv/bin/pytest tests/test_candidates_summary.py -q`

- [ ] **Step 3: Refaktor `enrichment.py`**

`_fetch_wikidata`-st eralda entiteedi töötlus:

```python
def _fetch_wikidata(qid: str) -> Optional[dict]:
    """…(senine docstring)…"""
    if not re.fullmatch(r"Q\d+", qid):
        return None
    entity = _wd_entity(qid)
    if entity is None:
        return None
    return _wikidata_result(entity)


def _wikidata_result(entity: dict) -> Optional[dict]:
    """Isikuentiteedist rikastuse väljad (sildipäring sees). None = siltide tõrge."""
    # … senine keha alates `gender_ids = _wd_item_ids(entity, "P21")` kuni `return result` muutmata …
```

`_fetch_gnd`-st eralda lobidi päring:

```python
def _fetch_lobid_raw(gnd_id: str) -> Optional[dict]:
    """lobid.org toorvastus või None (tõrge/aegumine)."""
    url = f"https://lobid.org/gnd/{gnd_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=_LOBID_TIMEOUT) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning("GND lobid.org päring ebaõnnestus (%s): %s", url, e)
        return None


def _fetch_gnd(gnd_id: str) -> Optional[dict]:
    """…(senine docstring)…"""
    raw = _fetch_lobid_raw(gnd_id)
    if raw is None:
        return _fetch_gnd_dnb(gnd_id)
    return _parse_lobid(raw)
```

Run: `.venv/bin/pytest tests/test_enrichment_*.py tests/test_gnd_seotud_id.py -q` → PASS (käitumine muutumata).

- [ ] **Step 4: Loo `server/prosopography/candidates.py`**

```python
"""Isikupaneeli kandidaatide kokkuvõtted (spekk §4.1).

Kokkuvõte ehitatakse SAMADEST parseritest mis rikastus (`enrichment`), et
paneel näitaks täpselt seda, mis kaardile loomisel kirjutatakse. Lukke siin
ei võeta — ainult loetakse välisallikaid ja VUTT-i indekseid.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Optional

from . import enrichment
from .enrichment import natural_name_order
from .ext_ids import normalize_ext_id

_WD_NAME_LANGS = ("et", "en", "de", "la", "sv", "mul")
_MAX_REFS = 15
_BUDGET_S = 8.0


def _date_unit(r: dict, prefix: str) -> dict:
    place = r.get(f"{prefix}.place")
    return {"date": r.get(f"{prefix}.date"), "precision": r.get(f"{prefix}.precision"),
            "place": place if isinstance(place, dict) and place.get("label") else None}


def _fields(r: dict) -> dict:
    occ = r.get("_occupations") or ([{"label": r["_occupation_label"]}]
                                    if r.get("_occupation_label") else [])
    return {"birth": _date_unit(r, "birth"), "death": _date_unit(r, "death"),
            "occupations": [{"id": o.get("id"), "label": o.get("label")} for o in occ if o.get("label")]}


def _links(r: dict) -> dict:
    return {k.removeprefix("_linked_"): v for k, v in r.items()
            if k in ("_linked_wikidata", "_linked_gnd", "_linked_viaf") and v}


def _names_plain(label: Optional[str], aliases) -> list:
    out = [{"text": label, "lang": None, "kind": "label"}] if label else []
    out += [{"text": a, "lang": None, "kind": "alias"} for a in aliases or [] if a and a != label]
    return out


def _wikidata(qid: str) -> Optional[dict]:
    if not re.fullmatch(r"Q\d+", qid or ""):
        return None
    entity = enrichment._wd_entity(qid)
    if entity is None:
        return None
    r = enrichment._wikidata_result(entity)
    if r is None:
        return None
    labels = entity.get("labels") or {}
    names = [{"text": labels[l]["value"], "lang": l, "kind": "label"}
             for l in _WD_NAME_LANGS if (labels.get(l) or {}).get("value")]
    for l in _WD_NAME_LANGS:
        for a in (entity.get("aliases") or {}).get(l, []):
            if a.get("value"):
                names.append({"text": a["value"], "lang": l, "kind": "alias"})
    descs = entity.get("descriptions") or {}
    description = next((descs[l]["value"] for l in ("et", "en", "de")
                        if (descs.get(l) or {}).get("value")), None)
    links = {}
    for prop, key in (("P227", "gnd"), ("P214", "viaf")):
        vals = enrichment._wd_best_values(entity, prop)
        if vals and isinstance(vals[0], str):
            links[key] = normalize_ext_id(key, vals[0])
    return {"label": names[0]["text"] if names else qid, "names": names,
            "description": description, **_fields(r),
            "url": f"https://www.wikidata.org/wiki/{qid}", "links": links}


def _gnd(gnd_id: str) -> Optional[dict]:
    raw = enrichment._fetch_lobid_raw(gnd_id)
    url = f"https://explore.gnd.network/gnd/{gnd_id}"
    if raw is not None:
        r = enrichment._parse_lobid(raw)
        label = r.get("name.label")
        names = _names_plain(label, [natural_name_order(v) for v in raw.get("variantName") or []])
        info = raw.get("biographicalOrHistoricalInformation") or []
        return {"label": label or gnd_id, "names": names,
                "description": info[0] if info else None, **_fields(r),
                "url": url, "links": _links(r)}
    r = enrichment._fetch_gnd_dnb(gnd_id)
    if r is None:
        return None
    return {"label": r.get("name.label") or gnd_id,
            "names": _names_plain(r.get("name.label"), r.get("name.aliases")),
            "description": None, **_fields(r), "url": url, "links": _links(r)}


def _viaf(viaf_id: str) -> Optional[dict]:
    r = enrichment._fetch_viaf(viaf_id)
    if r is None:
        return None
    return {"label": r.get("name.label") or viaf_id,
            "names": _names_plain(r.get("name.label"), r.get("name.aliases")),
            "description": None, **_fields(r),
            "url": f"https://viaf.org/viaf/{viaf_id}", "links": _links(r)}


_BUILDERS = {"wikidata": _wikidata, "gnd": _gnd, "viaf": _viaf}


def candidate_summary(scheme: str, ext_id: str) -> Optional[dict]:
    """Ühe viite kokkuvõte; tundmatu skeem või allika tõrge → None."""
    builder = _BUILDERS.get(scheme)
    if builder is None:
        return None
    ext_id = normalize_ext_id(scheme, ext_id)
    if not ext_id:
        return None
    try:
        return builder(ext_id)
    except Exception:
        enrichment.logger.warning("Kandidaadi kokkuvõte ebaõnnestus: %s:%s", scheme, ext_id, exc_info=True)
        return None
```

- [ ] **Step 5: PASS + täis pytest + commit**

Run: `.venv/bin/pytest tests/test_candidates_summary.py -q` → PASS; `.venv/bin/pytest tests/ -q` → PASS

```bash
git add server/prosopography/enrichment.py server/prosopography/candidates.py tests/test_candidates_summary.py
git commit -m "feat(prosopo): kandidaadi kokkuvõte isikupaneelile (Wikidata/GND/VIAF)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `POST /prosopography/candidates`

**Files:**
- Modify: `server/prosopography/candidates.py` (+ `candidates()`)
- Modify: `server/prosopography/router.py`
- Test: `tests/test_candidates_endpoint.py`

**Interfaces:**
- Consumes: `candidate_summary` (Task 1); `person_crud._find_by_external_id`, `person_crud._resolve_owner`; `person_search.list_persons`.
- Produces: `candidates.candidates(name: str, refs: list[dict]) -> dict` → `{"results": [{"scheme","id","ok": bool,"summary": dict|None,"error": str|None,"existing_person_id": str|None}], "similar_persons": [{"id","label","birth_year","death_year","work_count"}]}`
- Produces: `POST /prosopography/candidates` (editor+), keha `{name, refs: [{scheme, id}]}`; > 15 viidet → lõigatakse 15-ni; vigane kuju → 400.

- [ ] **Step 1: Ebaõnnestuvad testid**

```python
"""POST /prosopography/candidates (spekk §4.1): osaline tõrge, eelarve, olemasolu."""
import time

import pytest

from server.prosopography import candidates


@pytest.fixture
def kokkuvotted(monkeypatch):
    vastused = {("wikidata", "Q1"): {"label": "A", "names": [], "links": {}},
                ("gnd", "2"): None}
    monkeypatch.setattr(candidates, "candidate_summary", lambda s, i: vastused.get((s, i)))
    monkeypatch.setattr(candidates, "_similar", lambda name: [])
    return vastused


def test_osaline_tork_margitakse_viitele(prosopo_env, kokkuvotted):
    r = candidates.candidates("A", [{"scheme": "wikidata", "id": "Q1"}, {"scheme": "gnd", "id": "2"}])
    ok, bad = r["results"]
    assert ok["ok"] is True and ok["summary"]["label"] == "A"
    assert bad == {"scheme": "gnd", "id": "2", "ok": False, "summary": None,
                   "error": "source_unavailable", "existing_person_id": None}


def test_olemasolev_kaart_id_jargi(prosopo_env, kokkuvotted):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    r = candidates.candidates("A", [{"scheme": "wikidata", "id": "Q1"}])
    assert r["results"][0]["existing_person_id"] == "vutt:Paaa"


def test_eelarve_uletamisel_tagastatakse_joudnu(prosopo_env, monkeypatch):
    def aeglane(s, i):
        if i == "Q2":
            time.sleep(0.5)
        return {"label": i, "names": [], "links": {}}
    monkeypatch.setattr(candidates, "candidate_summary", aeglane)
    monkeypatch.setattr(candidates, "_similar", lambda name: [])
    monkeypatch.setattr(candidates, "_BUDGET_S", 0.2)
    r = candidates.candidates("x", [{"scheme": "wikidata", "id": "Q1"},
                                    {"scheme": "wikidata", "id": "Q2"}])
    assert r["results"][0]["ok"] is True
    assert r["results"][1] == {"scheme": "wikidata", "id": "Q2", "ok": False, "summary": None,
                               "error": "timeout", "existing_person_id": None}


def test_viiteid_loigatakse_15_ni(prosopo_env, kokkuvotted):
    refs = [{"scheme": "wikidata", "id": f"Q{i}"} for i in range(20)]
    assert len(candidates.candidates("x", refs)["results"]) == 15


def test_route_kuju_ja_oigus(client, login, prosopo_env, kokkuvotted):
    token = login("editor", "editorpass")
    h = {"Authorization": f"Bearer {token}"}
    assert client.post("/prosopography/candidates", json={"name": "A", "refs": "x"},
                       headers=h).status_code == 400
    r = client.post("/prosopography/candidates",
                    json={"name": "A", "refs": [{"scheme": "wikidata", "id": "Q1"}]}, headers=h)
    assert r.status_code == 200 and r.json()["results"][0]["ok"] is True
    assert client.post("/prosopography/candidates", json={"name": "A", "refs": []}).status_code in (401, 403)
```

- [ ] **Step 2: Käivita — FAIL**

- [ ] **Step 3: Lisa `candidates.py` lõppu**

```python
# Moodulitasandi executor: kokkuvõtete päringud on I/O-ootel, mitte CPU-l.
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="candidates")


def _similar(name: str) -> list:
    """Nimepõhine VUTT-i vaste (sama mis vormi SimilarPersonsWarning)."""
    from .person_search import list_persons
    if len((name or "").strip()) < 3:
        return []
    res = list_persons(q=name.strip(), limit=5)
    return [{k: e.get(k) for k in ("id", "label", "birth_year", "death_year", "work_count")}
            for e in res.get("results") or [] if e.get("record_status") != "tombstone"]


def _existing(scheme: str, ext_id: str) -> Optional[str]:
    from .person_crud import _find_by_external_id, _resolve_owner
    found = _find_by_external_id(scheme, ext_id)
    return _resolve_owner(found["id"]) if found else None


def candidates(name: str, refs: list) -> dict:
    """Kuni 15 viite kokkuvõtted paralleelselt, koguaja eelarvega; iga viite
    tõrge märgitakse sellele viitele, teised tulevad."""
    refs = [r for r in refs if isinstance(r, dict) and r.get("scheme") and r.get("id")][:_MAX_REFS]
    futures = [_executor.submit(candidate_summary, r["scheme"], str(r["id"])) for r in refs]
    wait(futures, timeout=_BUDGET_S)
    results = []
    for ref, fut in zip(refs, futures):
        scheme, ext_id = ref["scheme"], normalize_ext_id(ref["scheme"], str(ref["id"]))
        if not fut.done():
            summary, error = None, "timeout"
        else:
            summary = fut.result() if fut.exception() is None else None
            error = None if summary is not None else "source_unavailable"
        results.append({"scheme": scheme, "id": ext_id, "ok": summary is not None,
                        "summary": summary, "error": error,
                        "existing_person_id": _existing(scheme, ext_id)})
    return {"results": results, "similar_persons": _similar(name)}
```

(Testis `test_osaline_tork…` on `ext_id` "2" ja "Q1" — `normalize_ext_id` jätab need samaks.)

- [ ] **Step 4: Route `router.py`-sse (rea `@router.post("/persons/create")` ette)**

```python
@router.post("/candidates")
def prosopography_candidates(data: dict = Body(...), user=Depends(require_role("editor"))):
    """Isikupaneeli kandidaatide kokkuvõtted (spekk §4.1). Sync def — võrk
    käib threadpoolis (ADR 0002); lukke ei võeta."""
    from .candidates import candidates
    name, refs = data.get("name") or "", data.get("refs")
    if not isinstance(name, str) or not isinstance(refs, list):
        raise HTTPException(status_code=400, detail="invalid_candidates_request")
    return candidates(name, refs)
```

(Impordi `Body` `fastapi`-st, kui puudub.)

- [ ] **Step 5: PASS + täis pytest + commit**

```bash
git add server/prosopography/candidates.py server/prosopography/router.py tests/test_candidates_endpoint.py
git commit -m "feat(prosopo): POST /prosopography/candidates — kokkuvõtted, olemasolu, sarnased

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Kliendi puhtad funktsioonid — nimevalik ja grupeerimine

**Files:**
- Create: `src/prosopography/panel/candidateNames.ts`, `src/prosopography/panel/candidateGroups.ts`, `src/prosopography/panel/types.ts`
- Test: `src/prosopography/panel/__tests__/candidateNames.test.ts`, `src/prosopography/panel/__tests__/candidateGroups.test.ts`

**Interfaces:**
- Produces (`types.ts`):

```ts
export type SourceScheme = 'wikidata' | 'gnd' | 'viaf';
export interface CandidateName { text: string; lang: string | null; kind: 'label' | 'alias' }
export interface CandidatePlace { id: string | null; label: string }
export interface CandidateDate { date: string | null; precision: string | null; place: CandidatePlace | null }
export interface CandidateSummary {
  label: string; names: CandidateName[]; description: string | null;
  birth: CandidateDate; death: CandidateDate;
  occupations: { id: string | null; label: string }[];
  url: string; links: Partial<Record<SourceScheme, string>>;
}
export interface CandidateResult {
  scheme: SourceScheme; id: string; ok: boolean; summary: CandidateSummary | null;
  error: 'source_unavailable' | 'timeout' | null; existing_person_id: string | null;
}
export interface SourceRef { scheme: SourceScheme; id: string; label: string; description?: string }
export interface CandidateGroup {
  key: string;                       // stabiilne: esimese liikme `${scheme}:${id}`
  members: CandidateResult[];        // otsingu järjekorras
  ids: Partial<Record<SourceScheme, string>>;
  existingPersonIds: string[];       // kordusteta
}
```

- Produces: `nameMatches(query: string, text: string): boolean`; `chooseCardName(query: string, names: CandidateName[], fallback: string): { chosen: string; matched: string[]; others: string[] }`.
- Produces: `groupCandidates(results: CandidateResult[]): CandidateGroup[]`.

- [ ] **Step 1: Testid (nimevalik — spekk §5.2 tabel)**

```ts
import { describe, it, expect } from 'vitest';
import { chooseCardName, nameMatches } from '../candidateNames';
import type { CandidateName } from '../types';

const LUDEN: CandidateName[] = [
  { text: 'Lorenz Luden', lang: 'et', kind: 'label' },
  { text: 'Laurentius Ludenius', lang: 'mul', kind: 'alias' },
];

describe('nameMatches — sõna-eesliide', () => {
  it('iga otsitud sõna on mõne sõna algus', () => {
    expect(nameMatches('Luden', 'Laurentius Ludenius')).toBe(true);
    expect(nameMatches('laur lud', 'Laurentius Ludenius')).toBe(true);
    expect(nameMatches('denius', 'Laurentius Ludenius')).toBe(false);
  });
  it('NFC, tõstutundetu, ß = ss', () => {
    expect(nameMatches('GROSS', 'Johann Groß')).toBe(true);
    expect(nameMatches('müller', 'Müller')).toBe(true);
  });
});

describe('chooseCardName — spekk §5.2', () => {
  it('täpne täisnimi', () => {
    expect(chooseCardName('Laurentius Ludenius', LUDEN, 'Lorenz Luden').chosen).toBe('Laurentius Ludenius');
  });
  it('nimeosa → täisnimi, mis sisaldab', () => {
    expect(chooseCardName('Ludenius', LUDEN, 'Lorenz Luden').chosen).toBe('Laurentius Ludenius');
  });
  it('mitu sobivat → keelejärjestus la → mul → de → en → et', () => {
    expect(chooseCardName('Luden', LUDEN, 'Lorenz Luden').chosen).toBe('Laurentius Ludenius');
  });
  it('ainult põhinimi sobib', () => {
    expect(chooseCardName('Lorenz', LUDEN, 'Lorenz Luden').chosen).toBe('Lorenz Luden');
  });
  it('ükski ei sobi → põhinimi, mitte otsitud sõna', () => {
    expect(chooseCardName('jurist', LUDEN, 'Lorenz Luden').chosen).toBe('Lorenz Luden');
  });
  it('valimata nimed lähevad others-i, kordusteta', () => {
    const r = chooseCardName('Ludenius', [...LUDEN, { text: 'Lorenz Luden', lang: 'de', kind: 'alias' }], 'Lorenz Luden');
    expect(r.others).toEqual(['Lorenz Luden']);
    expect(r.matched).toEqual(['Laurentius Ludenius']);
  });
});
```

- [ ] **Step 2: Testid (grupeerimine)**

```ts
import { describe, it, expect } from 'vitest';
import { groupCandidates } from '../candidateGroups';
import type { CandidateResult } from '../types';

const r = (scheme: any, id: string, links = {}, existing: string | null = null): CandidateResult => ({
  scheme, id, ok: true, error: null, existing_person_id: existing,
  summary: { label: id, names: [], description: null, birth: { date: null, precision: null, place: null },
             death: { date: null, precision: null, place: null }, occupations: [], url: '', links },
});

describe('groupCandidates', () => {
  it('seotud ID-d ühendavad kolm allikat üheks', () => {
    const g = groupCandidates([r('wikidata', 'Q1', { gnd: '2', viaf: '3' }), r('gnd', '2'), r('viaf', '3')]);
    expect(g).toHaveLength(1);
    expect(g[0].ids).toEqual({ wikidata: 'Q1', gnd: '2', viaf: '3' });
  });
  it('ühendamine töötab ka kaudselt (GND → WD, VIAF → GND)', () => {
    const g = groupCandidates([r('gnd', '2', { wikidata: 'Q1' }), r('viaf', '3', { gnd: '2' }), r('wikidata', 'Q1')]);
    expect(g).toHaveLength(1);
  });
  it('ilma viiteta sama nimi = kaks kandidaati (nime järgi ei ühendata)', () => {
    expect(groupCandidates([r('wikidata', 'Q1'), r('gnd', '2')])).toHaveLength(2);
  });
  it('olemasolevad kaardid kogutakse kordusteta; ebaõnnestunud viide jääb oma grupiks', () => {
    const bad: CandidateResult = { scheme: 'viaf', id: '9', ok: false, summary: null, error: 'timeout', existing_person_id: null };
    const g = groupCandidates([r('wikidata', 'Q1', {}, 'vutt:Pa'), r('gnd', '2', { wikidata: 'Q1' }, 'vutt:Pa'), bad]);
    expect(g[0].existingPersonIds).toEqual(['vutt:Pa']);
    expect(g[1].members[0].ok).toBe(false);
  });
});
```

- [ ] **Step 3: Käivita — FAIL**

Run: `npx vitest run src/prosopography/panel`

- [ ] **Step 4: `candidateNames.ts`**

```ts
/**
 * Kaardi nime valik isikupaneelis (spekk §5.2).
 *
 * Sobivus = sõna-eesliide: iga otsitud sõna peab olema täisnime MÕNE sõna
 * algus („Luden" sobib „Ludenius"-ega, „denius" mitte). Sama loogika mis
 * Meili prefiksotsingul.
 */
import type { CandidateName } from './types';

const KEELEJÄRJESTUS = ['la', 'mul', 'de', 'en', 'et'];

function normaliseeri(s: string): string {
  return s.normalize('NFC').toLocaleLowerCase('et').replace(/ß/g, 'ss');
}

function sõnad(s: string): string[] {
  return normaliseeri(s).split(/[\s.,;:()\-–—'"„“]+/u).filter(Boolean);
}

export function nameMatches(query: string, text: string): boolean {
  const otsitud = sõnad(query);
  if (otsitud.length === 0) return false;
  const nimeSõnad = sõnad(text);
  return otsitud.every(o => nimeSõnad.some(n => n.startsWith(o)));
}

function keeleJärk(lang: string | null): number {
  const i = lang ? KEELEJÄRJESTUS.indexOf(lang) : -1;
  return i === -1 ? KEELEJÄRJESTUS.length : i;
}

export function chooseCardName(query: string, names: CandidateName[], fallback: string) {
  const unikaalsed: CandidateName[] = [];
  const nähtud = new Set<string>();
  for (const n of names) {
    const k = normaliseeri(n.text);
    if (!n.text.trim() || nähtud.has(k)) continue;
    nähtud.add(k);
    unikaalsed.push(n);
  }
  const sobivad = unikaalsed
    .filter(n => nameMatches(query, n.text))
    .sort((a, b) => keeleJärk(a.lang) - keeleJärk(b.lang));
  const chosen = sobivad[0]?.text ?? fallback;
  const valitud = normaliseeri(chosen);
  return {
    chosen,
    matched: sobivad.map(n => n.text),
    others: unikaalsed.map(n => n.text).filter(t => normaliseeri(t) !== valitud),
  };
}
```

- [ ] **Step 5: `candidateGroups.ts`**

```ts
/**
 * Kandidaadid = identiteedid (spekk §6): viited, mis üksteisele viitavad
 * (Wikidata P227/P214, GND sameAs, VIAF lingid), on üks rida. Nime järgi EI
 * ühendata — vale ühendamine on halvem kui kaks rida.
 */
import type { CandidateGroup, CandidateResult, SourceScheme } from './types';

const võti = (s: string, id: string) => `${s}:${id}`;

export function groupCandidates(results: CandidateResult[]): CandidateGroup[] {
  const vanem = new Map<string, string>();
  const leia = (k: string): string => {
    while (vanem.get(k) !== k) {
      const v = vanem.get(k)!;
      vanem.set(k, vanem.get(v)!);
      k = v;
    }
    return k;
  };
  const ühenda = (a: string, b: string) => {
    if (!vanem.has(a)) vanem.set(a, a);
    if (!vanem.has(b)) vanem.set(b, b);
    const ra = leia(a), rb = leia(b);
    if (ra !== rb) vanem.set(rb, ra);
  };
  for (const r of results) {
    const k = võti(r.scheme, r.id);
    if (!vanem.has(k)) vanem.set(k, k);
    for (const [s, id] of Object.entries(r.summary?.links ?? {})) {
      if (id) ühenda(k, võti(s, id));
    }
  }
  const grupid = new Map<string, CandidateGroup>();
  for (const r of results) {
    const juur = leia(võti(r.scheme, r.id));
    let g = grupid.get(juur);
    if (!g) {
      g = { key: võti(r.scheme, r.id), members: [], ids: {}, existingPersonIds: [] };
      grupid.set(juur, g);
    }
    g.members.push(r);
    g.ids[r.scheme as SourceScheme] ??= r.id;
    for (const [s, id] of Object.entries(r.summary?.links ?? {})) {
      if (id) g.ids[s as SourceScheme] ??= id;
    }
    if (r.existing_person_id && !g.existingPersonIds.includes(r.existing_person_id)) {
      g.existingPersonIds.push(r.existing_person_id);
    }
  }
  return [...grupid.values()];
}
```

- [ ] **Step 6: PASS + commit**

Run: `npx vitest run src/prosopography/panel` → PASS; `npm run typecheck` → PASS

```bash
git add src/prosopography/panel
git commit -m "feat(prosopo): isikupaneeli puhas loogika — nimevalik (§5.2) ja grupeerimine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Otsing ja kandidaatide teenus

**Files:**
- Modify: `src/services/wikidataService.ts` (+ `searchWikidataPersonsFulltext`)
- Create: `src/prosopography/panel/searchSources.ts`
- Modify: `src/prosopography/services/prosopographyService.ts` (+ `fetchCandidates`)
- Test: `src/prosopography/panel/__tests__/searchSources.test.ts`

**Interfaces:**
- Produces: `searchWikidataPersonsFulltext(query: string, lang: string): Promise<WikidataSearchResult[]>` — `action=query&list=search&srsearch=<q> haswbstatement:P31=Q5&srlimit=7`, siis `wbgetentities` (`props=labels|descriptions`, keeled `lang|en|de`) siltideks.
- Produces: `searchPersonSources(query: string, lang: string): Promise<{ refs: SourceRef[]; failed: SourceScheme[] }>` — Wikidata kiir- + täistekst (ühendatud, Q järgi kordusteta, kiirotsing ees), GND, VIAF paralleelselt; kokku ≤ 15 viidet (Wikidata ≤ 7, GND ≤ 4, VIAF ≤ 4); allikas, mille päring kukkus → `failed`.
- Produces: `fetchCandidates(name: string, refs: {scheme: string; id: string}[], token: string): Promise<{ results: CandidateResult[]; similar_persons: SimilarPerson[] }>`; `interface SimilarPerson { id: string; label: string; birth_year: number | null; death_year: number | null; work_count: number }`.

- [ ] **Step 1: Test (ühendamine + tõrge)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/wikidataService', () => ({
  searchWikidata: vi.fn(async () => [{ id: 'Q1', label: 'Lorenz Luden', url: '' }]),
  searchWikidataPersonsFulltext: vi.fn(async () => [
    { id: 'Q1', label: 'Lorenz Luden', url: '' }, { id: 'Q7', label: 'Johann Luden', url: '' }]),
}));
vi.mock('../../../services/gndService', () => ({
  searchGnd: vi.fn(async () => { throw new Error('lobid maas'); }),
}));
vi.mock('../../../services/viafService', () => ({
  searchViaf: vi.fn(async () => [{ id: 'VIAF:3', viafId: '3', label: 'Luden, Lorenz', url: '' }]),
}));

import { searchPersonSources } from '../searchSources';

describe('searchPersonSources', () => {
  beforeEach(() => vi.clearAllMocks());
  it('ühendab Wikidata kaks otsingut kordusteta, kiirotsing ees; märgib kukkunud allika', async () => {
    const r = await searchPersonSources('Luden', 'et');
    expect(r.refs.map(x => `${x.scheme}:${x.id}`)).toEqual(['wikidata:Q1', 'wikidata:Q7', 'viaf:3']);
    expect(r.failed).toEqual(['gnd']);
  });
});
```

(NB: `searchGnd`/`searchViaf` neelavad praegu ise vead ja tagastavad `[]`; `searchPersonSources` kasutab `Promise.allSettled` ning märgib `failed`-iks ainult `rejected`. Test mockib `rejected` juhu.)

- [ ] **Step 2: Käivita — FAIL**

- [ ] **Step 3: `searchWikidataPersonsFulltext` `wikidataService.ts`-sse**

```ts
/**
 * Täistekstiotsing ainult inimeste hulgast (`haswbstatement:P31=Q5`).
 * Leiab ka nimeosa järgi keskelt aliasest („Ludenius" → Laurentius Ludenius),
 * mida `wbsearchentities` (prefiksotsing) ei leia — vt spekk §5.1.
 */
export async function searchWikidataPersonsFulltext(query: string, lang: string = 'et'): Promise<WikidataSearchResult[]> {
  if (!query || query.trim().length < 2) return [];
  const sp = new URLSearchParams({
    action: 'query', list: 'search', srsearch: `${query.trim()} haswbstatement:P31=Q5`,
    srlimit: '7', format: 'json', origin: '*',
  });
  const r = await fetchWithTimeout(`${WIKIDATA_API_URL}?${sp.toString()}`, { timeout: 15000 });
  if (!r.ok) throw new Error('Wikidata fulltext search failed');
  const ids: string[] = ((await r.json())?.query?.search ?? []).map((s: any) => s.title).filter((t: string) => /^Q\d+$/.test(t));
  if (ids.length === 0) return [];
  const langs = [...new Set([lang, 'en', 'de'])].join('|');
  const lp = new URLSearchParams({
    action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions',
    languages: langs, format: 'json', origin: '*',
  });
  const lr = await fetchWithTimeout(`${WIKIDATA_API_URL}?${lp.toString()}`, { timeout: 15000 });
  const ent = lr.ok ? (await lr.json())?.entities ?? {} : {};
  const pick = (o: any) => o?.[lang]?.value ?? o?.en?.value ?? o?.de?.value;
  return ids.map(id => ({
    id,
    label: pick(ent[id]?.labels) ?? id,
    description: pick(ent[id]?.descriptions),
    url: `https://www.wikidata.org/wiki/${id}`,
  }));
}
```

- [ ] **Step 4: `searchSources.ts`**

```ts
/**
 * Isikupaneeli otsing brauseris (lobid ei ole serverist alati kättesaadav).
 * Tulemus on viidete loend kandidaatide päringu jaoks; kukkunud allikas
 * märgitakse, et paneel saaks seda näidata (mitte vaikselt kaotada).
 */
import { searchWikidata, searchWikidataPersonsFulltext } from '../../services/wikidataService';
import { searchGnd } from '../../services/gndService';
import { searchViaf } from '../../services/viafService';
import type { SourceRef, SourceScheme } from './types';

export async function searchPersonSources(query: string, lang: string) {
  const [wdKiire, wdTäis, gnd, viaf] = await Promise.allSettled([
    searchWikidata(query, lang), searchWikidataPersonsFulltext(query, lang),
    searchGnd(query), searchViaf(query),
  ]);
  const failed: SourceScheme[] = [];
  const wd = new Map<string, SourceRef>();
  for (const res of [wdKiire, wdTäis]) {
    if (res.status !== 'fulfilled') continue;
    for (const x of res.value) {
      if (!wd.has(x.id)) wd.set(x.id, { scheme: 'wikidata', id: x.id, label: x.label, description: x.description });
    }
  }
  if (wdKiire.status === 'rejected' && wdTäis.status === 'rejected') failed.push('wikidata');
  const gndRefs: SourceRef[] = gnd.status === 'fulfilled'
    ? gnd.value.map(g => ({ scheme: 'gnd' as const, id: g.gndId ?? g.id.replace(/^GND:/i, ''), label: g.label, description: g.description }))
    : (failed.push('gnd'), []);
  const viafRefs: SourceRef[] = viaf.status === 'fulfilled'
    ? viaf.value.map(v => ({ scheme: 'viaf' as const, id: v.viafId ?? v.id.replace(/^VIAF:/i, ''), label: v.label, description: v.description }))
    : (failed.push('viaf'), []);
  const refs = [...[...wd.values()].slice(0, 7), ...gndRefs.slice(0, 4), ...viafRefs.slice(0, 4)];
  return { refs, failed };
}
```

(Kontrolli `GndSearchResult`/`ViafSearchResult` väljanimed (`gndId`, `viafId`) — kui erinevad, kohanda.)

- [ ] **Step 5: `fetchCandidates` `prosopographyService.ts`-sse**

```ts
export interface SimilarPerson { id: string; label: string; birth_year: number | null; death_year: number | null; work_count: number }

export async function fetchCandidates(
  name: string, refs: { scheme: string; id: string }[], token: string,
): Promise<{ results: import('../panel/types').CandidateResult[]; similar_persons: SimilarPerson[] }> {
  const resp = await fetchWithTimeout(`${BASE}/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ name, refs }),
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`fetchCandidates: ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 6: PASS + väravad + commit**

Run: `npx vitest run src/prosopography/panel && npm run typecheck`

```bash
git add src/services/wikidataService.ts src/prosopography/panel/searchSources.ts src/prosopography/panel/__tests__/searchSources.test.ts src/prosopography/services/prosopographyService.ts
git commit -m "feat(prosopo): isikupaneeli otsing (Wikidata kiir+täistekst, GND, VIAF) ja kandidaatide teenus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `PersonAddPanel`

**Files:**
- Create: `src/prosopography/components/PersonAddPanel.tsx`
- Modify: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json` (`panel.*`)
- Test: `src/prosopography/components/__tests__/PersonAddPanel.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `searchPersonSources` (Task 4), `fetchCandidates` (Task 4), `groupCandidates`, `chooseCardName` (Task 3), `createPersonChecked`, `PersonConflictError` (PR 1, `prosopographyService.ts`).
- Produces:

```ts
export interface PersonAddPanelProps {
  initialQuery: string;
  token: string;
  lang: 'et' | 'en';
  context?: { work_id: string; role?: string };
  /** Isik on valitud (olemasolev) või loodud. */
  onDone: (person: { id: string; label: string; created: boolean }) => void;
  onClose: () => void;
  /** Kui antud, avatakse selle viitega kandidaat kohe lahti (valija välise tulemuse klikk). */
  focusRef?: { scheme: 'wikidata' | 'gnd' | 'viaf'; id: string };
}
```

**Käitumine (kõik peab olema testitud või koodis nähtav):**
- Esmane otsing käivitub `initialQuery`-ga mount'il; otsinguväli (debounce 400 ms) käivitab uue otsingu. Otsingu jada: `searchPersonSources` → `fetchCandidates(query, refs)` → `groupCandidates(results)`. Iga uus otsing tühistab vana tulemuse (järjekorranumber, nagu `EntityPicker`-is `searchIdRef`).
- **„VUTT-is juba olemas"** plokk alati esimesena: `similar_persons` + gruppide `existingPersonIds` (kordusteta; sildi saab `similar_persons`-ist või grupi `summary.label`-ist). Nupp „Vali see" → `onDone({ id, label, created: false })`.
- **„Allikatest"**: iga grupp üks rida — nimi (`chooseCardName(query, kõigi liikmete names, esimese ok liikme label).chosen`), eluaastad (`birth.date`/`death.date` aasta või „fl." puudub), allikamärgid (`WD`/`GND`/`VIAF`, link `summary.url` uude tabi), „sobis: <matched[0]> (nimevariant)" kui `matched[0] !== label`. Kui grupil on `existingPersonIds` → rea asemel „juba VUTT-is" + „Vali see".
- Lahti klõpsates: sünd/surm iga liikme kaupa **koos allikaga, kui liikmed erinevad** (nt „1592 (WD) · 1593 (GND)"), kohad, ametid (kuni 6), kirjeldus; nime rippmenüü (sobinud ees, siis `others`); nupp **„Loo ja vali"** → `createPersonChecked({ name: valitud, identifiers: [...grupi ids], aliases: others ilma valituta (≤ 30), context, created_via: 'picker' })` → `onDone({ id, label, created: true })` + teade `panel.createdNotice`.
- 409 `exists` → `onDone({ id: existingPersonIds[0], label, created: false })`; 409 `split` → teade `panel.splitConflict` + mõlemad ID-d `/persons/<id>` linkidena, midagi ei looda ega valita.
- Ebaõnnestunud viide (ok=false) → rida „<allikas> ei vastanud" (hall); `failed` allikad otsingust → üks rida „<allikas> otsing ebaõnnestus".
- **„Ei leia allikatest"** plokk: nimi (eeltäidetud `initialQuery`), märkus; kui `context` → info „fl. <aasta?> (sellest teosest)" — AASTAT paneel ei tea, näita ainult „seotakse selle teosega"; nupp „Loo ja vali" → `createPersonChecked({ name, note, context, created_via: 'picker' })`.
- Paneel: `fixed inset-y-0 right-0 w-full sm:w-[28rem] z-[1300] bg-white shadow-2xl flex flex-col`, taustakate `fixed inset-0 bg-black/30 z-[1300]`; Esc ja taustaklikk → `onClose`; fookus otsinguväljal mount'il.
- **Hook-reeglid:** iga `useEffect`/`useCallback` sõltuvusloend täielik (lint lävi 43, varu 0).

- [ ] **Step 1: jsdom test**

```tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../panel/searchSources', () => ({
  searchPersonSources: vi.fn(async () => ({
    refs: [{ scheme: 'wikidata', id: 'Q1', label: 'Lorenz Luden' }, { scheme: 'gnd', id: '2', label: 'Luden' }],
    failed: ['viaf'],
  })),
}));
vi.mock('../../services/prosopographyService', async () => {
  class PersonConflictError extends Error {
    constructor(public conflict: string, public existingPersonIds: string[]) { super('c'); }
  }
  return {
    PersonConflictError,
    createPersonChecked: (...a: any[]) => create(...a),
    fetchCandidates: vi.fn(async () => ({
      similar_persons: [{ id: 'vutt:Pold', label: 'Laurentius Ludenius', birth_year: 1592, death_year: 1654, work_count: 12 }],
      results: [
        { scheme: 'wikidata', id: 'Q1', ok: true, error: null, existing_person_id: null,
          summary: { label: 'Lorenz Luden', names: [{ text: 'Lorenz Luden', lang: 'et', kind: 'label' },
                     { text: 'Laurentius Ludenius', lang: 'mul', kind: 'alias' }],
                     description: 'jurist', birth: { date: '1592-01-01', precision: 'year', place: null },
                     death: { date: null, precision: null, place: null }, occupations: [],
                     url: 'https://www.wikidata.org/wiki/Q1', links: { gnd: '2' } } },
        { scheme: 'gnd', id: '2', ok: false, error: 'timeout', existing_person_id: null, summary: null },
      ],
    })),
  };
});

import PersonAddPanel from '../PersonAddPanel';

describe('PersonAddPanel', () => {
  beforeEach(() => create.mockReset());

  it('olemasolev isik on ees ja „Vali see" valib ta', async () => {
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    const btn = await screen.findAllByText('panel.selectExisting');
    fireEvent.click(btn[0]);
    expect(onDone).toHaveBeenCalledWith({ id: 'vutt:Pold', label: 'Laurentius Ludenius', created: false });
  });

  it('WD + GND on üks kandidaat ja nimeks sobinud variant', async () => {
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('candidate-row')).toHaveLength(1));
    expect(screen.getByTestId('candidate-row').textContent).toContain('Laurentius Ludenius');
  });

  it('„Loo ja vali" saadab kõik grupi ID-d ja valimata nimed aliasteks', async () => {
    create.mockResolvedValue({ id: 'vutt:Pnew', name: { label: 'Laurentius Ludenius' } });
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()}
                           context={{ work_id: 'w1', role: 'praeses' }} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'vutt:Pnew', label: 'Laurentius Ludenius', created: true }));
    expect(create.mock.calls[0][0]).toEqual({
      name: 'Laurentius Ludenius', identifiers: [{ scheme: 'wikidata', id: 'Q1' }, { scheme: 'gnd', id: '2' }],
      aliases: ['Lorenz Luden'], context: { work_id: 'w1', role: 'praeses' }, created_via: 'picker',
    });
  });

  it('409 split ei vali midagi', async () => {
    const { PersonConflictError } = (await import('../../services/prosopographyService')) as any;
    create.mockRejectedValue(new PersonConflictError('split', ['vutt:Pa', 'vutt:Pb']));
    const onDone = vi.fn();
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={onDone} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('candidate-row'));
    fireEvent.click(await screen.findByText('panel.createAndSelect'));
    await screen.findByText('panel.splitConflict');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('kukkunud allikas on nähtav', async () => {
    render(<PersonAddPanel initialQuery="Ludenius" token="t" lang="et" onDone={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByText(/panel.sourceSearchFailed/)).toBeTruthy();
  });
});
```

(t-mock tagastab võtme; komponent kasutab võtmeid `panel.selectExisting`, `panel.createAndSelect`, `panel.splitConflict`, `panel.sourceSearchFailed` jne — vaikeväärtusteta, et test oleks võtme-põhine.)

- [ ] **Step 2: Käivita — FAIL**

- [ ] **Step 3: Kirjuta komponent** eelneva „Käitumine" loendi järgi (üks fail, ~300 rida; alamkomponendid samas failis: `ExistingBlock`, `CandidateRow`, `NoSourceBlock`). Grupirea lahti/kinni olek ja valitud nimi hoitakse `Record<groupKey, …>` olekus. `focusRef` korral avatakse grupp, mille `ids[focusRef.scheme] === focusRef.id`.

- [ ] **Step 4: i18n — `panel` plokk mõlemasse `prosopography.json`-i**

| võti | et | en |
|---|---|---|
| `panel.title` | Lisa isik | Add a person |
| `panel.searchPlaceholder` | Otsi nime järgi (ka nimeosa) | Search by name (partial names work) |
| `panel.existingTitle` | VUTT-is juba olemas | Already in VUTT |
| `panel.selectExisting` | Vali see | Select |
| `panel.sourcesTitle` | Allikatest | From authority files |
| `panel.matchedVariant` | sobis: {{name}} (nimevariant) | matched: {{name}} (name variant) |
| `panel.alreadyInVutt` | juba VUTT-is | already in VUTT |
| `panel.nameOnCard` | Nimi kaardil | Name on the card |
| `panel.createAndSelect` | Loo ja vali | Create and select |
| `panel.sourceNoResponse` | {{source}} ei vastanud | {{source}} did not respond |
| `panel.sourceSearchFailed` | {{source}} otsing ebaõnnestus | {{source}} search failed |
| `panel.noSourceTitle` | Ei leia allikatest | Not found in authority files |
| `panel.noSourceHint` | Loo isik ilma välise ID-ta; kaart läheb ülevaatusele. | Create the person without an external ID; the card will be reviewed. |
| `panel.note` | Märkus | Note |
| `panel.linkedToWork` | Seotakse selle teosega | Will be linked to this work |
| `panel.createdNotice` | Isik loodud. Andmed täituvad allikast taustal; kaart ootab ülevaatust. | Person created. Data is filled in from the source in the background; the card awaits review. |
| `panel.splitConflict` | Allikad viitavad kahele eri VUTT-i kaardile — teata adminile, kaardid tuleb liita. | The sources point to two different VUTT cards — tell an admin; the cards need to be merged. |
| `panel.searching` | Otsin… | Searching… |
| `panel.noResults` | Allikatest ei leitud kedagi | Nothing found in authority files |
| `panel.openButton` | Lisa isik… | Add person… |
| `panel.manualForm` | Täida vorm käsitsi | Fill in the form manually |

Eluaastad kuvatakse sümbolitega nagu `PersonCard`-is (`*1592 †1654`) — eraldi sünni/surma võtmeid ei ole.

- [ ] **Step 5: PASS + väravad + commit**

Run: `npx vitest run src/prosopography/components/__tests__/PersonAddPanel.test.tsx && npm run typecheck && npm test && npm run lint:ci`

```bash
git add src/prosopography/components/PersonAddPanel.tsx src/prosopography/components/__tests__/PersonAddPanel.test.tsx src/locales/et/prosopography.json src/locales/en/prosopography.json
git commit -m "feat(prosopo): isikupaneel — kandidaadid, olemasolevad, loo ja vali

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Valija integratsioon (`EntityPicker`) + teose kontekst

**Files:**
- Modify: `src/components/EntityPicker.tsx`, `src/components/MetadataModal.tsx`, `src/components/UploadMetaForm.tsx`
- Test: `src/components/__tests__/EntityPicker.panel.test.tsx` (jsdom)

**Interfaces:**
- Consumes: `PersonAddPanel` (Task 5).
- Produces: `EntityPickerProps.personContext?: { work_id: string; role?: string }`.

**Muudatused:**
- Isikurežiimis (`isPersonSearch && token`):
  - „Loo uus isik ↗" (`<Link target="_blank" to="/persons/new…">`) → nupp **„Lisa isik…"** (`t('prosopography.panel.openButton')` → et „Lisa isik…", en „Add person…"; võti `common` või `prosopography` nimeruumis — EntityPicker kasutab `common`-it, lisa sinna) → avab `PersonAddPanel` `initialQuery={inputValue}`.
  - Välise tulemuse klikk (`handleSelect` GND/VIAF/Wikidata harud) **isikurežiimis** → avab paneeli `focusRef={{ scheme, id }}` ega loo midagi. PR 1 `looVoiLeia` eemaldatakse (paneel on nüüd ainus loomistee valijast).
  - `onDone({id, label})` → `onChange({ id, label, source: 'local', entity_type: 'person', labels: { et: label } })`, `setInputValue(label)`, paneel kinni.
- Tokenita või mitte-isikurežiimis: nuppu ei ole, käitumine muutumata.
- `MetadataModal`: creators-reas `personContext={{ work_id: <teose id>, role: creator.role }}` (kontrolli, mis nime all teose `work_id` modaalis on — nt `workId` prop või `metaForm.id`); publisher: `role: 'publisher'`.
- `UploadMetaForm`: kui upload'i meta kannab `work_id` (loe `GET /admin/upload/{id}/meta` vastusest `m.work_id`, salvesta olekusse), anna `personContext={{ work_id, role }}`; muidu jäta ära.

- [ ] **Step 1: jsdom test**

```tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('../../prosopography/components/PersonAddPanel', () => ({
  default: (p: any) => (
    <div data-testid="panel" data-query={p.initialQuery} data-ctx={JSON.stringify(p.context ?? null)}>
      <button onClick={() => p.onDone({ id: 'vutt:Pnew', label: 'X', created: true })}>done</button>
    </div>
  ),
}));
vi.mock('../../prosopography/services/prosopographyService', () => ({ listPersons: vi.fn(async () => ({ results: [] })), getPerson: vi.fn() }));
vi.mock('../../services/wikidataService', () => ({ searchWikidata: vi.fn(async () => []), getEntityLabels: vi.fn(async () => ({})) }));
vi.mock('../../services/gndService', () => ({ searchGnd: vi.fn(async () => []) }));
vi.mock('../../services/viafService', () => ({ searchViaf: vi.fn(async () => []) }));

import EntityPicker from '../EntityPicker';

describe('EntityPicker — isikupaneel', () => {
  it('„Lisa isik…" avab paneeli kontekstiga ja valik läheb onChange-i', async () => {
    const onChange = vi.fn();
    render(<EntityPicker type="person" value="" onChange={onChange} defaultPersonSearch showPersonToggle token="t"
                         personContext={{ work_id: 'w1', role: 'praeses' }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ludenius' } });
    fireEvent.focus(screen.getByRole('textbox'));
    fireEvent.click(await screen.findByText('prosopography.panel.openButton'));
    const panel = await screen.findByTestId('panel');
    expect(panel.dataset.query).toBe('Ludenius');
    expect(JSON.parse(panel.dataset.ctx!)).toEqual({ work_id: 'w1', role: 'praeses' });
    fireEvent.click(screen.getByText('done'));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'vutt:Pnew', label: 'X', source: 'local' }));
  });

  it('tokenita nuppu ei ole', async () => {
    render(<EntityPicker type="person" value="" onChange={vi.fn()} defaultPersonSearch showPersonToggle />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ludenius' } });
    fireEvent.focus(screen.getByRole('textbox'));
    expect(screen.queryByText('prosopography.panel.openButton')).toBeNull();
  });
});
```

(Kui `EntityPicker` vajab rippmenüü avamiseks muud sündmust, kohanda testi — eesmärk: nupp nähtav pärast sisestust.)

- [ ] **Step 2–4:** FAIL → teosta → PASS; väravad (`npm run typecheck && npm test && npm run lint:ci` ≤ 43).

- [ ] **Step 5: Commit**

```bash
git add src/components/EntityPicker.tsx src/components/MetadataModal.tsx src/components/UploadMetaForm.tsx src/components/__tests__/EntityPicker.panel.test.tsx src/locales
git commit -m "feat(prosopo): valija avab isikupaneeli samal lehel; teose kontekst kaasa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `/persons/new` paneeliga

**Files:**
- Modify: `src/prosopography/pages/PersonEditPage.tsx`
- Delete (kui kasutuseta): `src/prosopography/components/personForm/EnrichmentSearch.tsx`
- Test: `src/prosopography/pages/__tests__/PersonEditPage.new.test.tsx` (jsdom) — kui lehe renderdamine testis on liiga raske (kontekstid), testi ainult eraldatud komponenti `NewPersonStart` (vt allpool).

**Muudatus:**
- `isNew` korral näidatakse enne vormi **`NewPersonStart`** (uus väike komponent samas kaustas): renderdab `PersonAddPanel`-i sisu lehel (mitte külgpaneelina — prop `inline` paneelile: kui `inline`, ei renderdata taustakatet ega `fixed` klasse) `initialQuery = ?name=` URL-ist.
  - `onDone({ id, created: false })` → `navigate('/persons/' + encodeURIComponent(id))`.
  - `onDone({ id, created: true })` → `navigate('/persons/' + encodeURIComponent(id) + '/edit')` (kaart on loodud, taustarikastus käib; kasutaja jätkab muutmisvaates).
  - „Täida vorm käsitsi" link → peidab stardi ja näitab praegust tühja vormi (loomine siis `createPersonChecked({card})`, PR 1).
- `EnrichmentSearch` eemaldatakse uue isiku voost; kui tal teisi kasutajaid ei ole (`grep -rn EnrichmentSearch src`), kustuta fail.
- Paneeli `inline` prop lisatakse Task 5 komponenti (`inline?: boolean`).

- [ ] Samm-sammult: test (vähemalt: `NewPersonStart` onDone created=false → navigate `/persons/<id>`; created=true → `/persons/<id>/edit`) → FAIL → teosta → PASS → väravad → commit:

```bash
git commit -m "feat(prosopo): /persons/new alustab isikupaneeliga

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lõppkontroll

- [ ] `.venv/bin/pytest tests/ -q` → PASS
- [ ] `npm run typecheck && npm test && npm run lint:ci` → PASS, lint ≤ 43
- [ ] `grep -rn "looVoiLeia\|persons/new?name" src --include=*.tsx` → tühi (valija ei ava enam uut tabi)
- [ ] Tootmistest pärast deploy'd: teose metaandmetes „Lisa isik…" → otsi „Ludenius" → Lorenz Luden üks rida WD+GND märgiga, eluaastad näha, nimeks „Laurentius Ludenius" → Loo ja vali → isik lahtris, paneel kinni; `/persons/new?name=Hezel` → Hezel on „VUTT-is juba olemas".
