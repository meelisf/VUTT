# Isiku seoste võrgustik — backend (PR 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serveripoolne isiku seoste võrgustik (`GET /prosopography/{id}/network`) üle kõigi
`person_to_works` rollide, ühe reeglitabeliga seose liigi jaoks, ja sama ehitaja `/persons`
seoste kaardile.

**Architecture:** Kolm uut/muudetud osa:
1. **Teose faktide read-model:** `works_creators_index.json` saab kirje igale teosele ning
   väljad `location` ja `genres`. Kirjutab ainult `update_work_facts`, mida kutsutakse
   tingimusteta. Vana `update_works_creators_index` kaob.
2. **Puhas reeglimoodul** `network_rules.py`: rollipaar → (liik, suund).
3. **Ehitaja** `network.py`: loeb read-modelid (`person_to_works`, teoste faktid,
   `work_collections_index`, isikuindeks, isikukaardid) ja annab spekis kirjeldatud vastuse.

`get_person_relation_network_ids` ja `get_person_map_markers` kasutavad sama ehitajat.

**Tech Stack:** Python 3.12, FastAPI, pytest (`.venv/bin/pytest`). Kõik read-modelid on JSON-failid.

**Spec:** `docs/superpowers/specs/2026-09-26-isiku-seoste-vaade-design.md`

## Global Constraints

- Koodikommentaarid **eesti keeles** (CLAUDE.md).
- Testid ALATI `.venv/bin/pytest`, mitte süsteemi `python3`.
- Blokeeriv I/O ei tohi olla `async def` sees (ADR 0002): uus route on sync `def`.
- Tuletatud indeksid on nullist taastatavad (ADR 0007): rebuild ja inkrementaalne uuendus
  kasutavad **sama kirje-ehitajat** `_work_facts_entry(meta)`.
- Kogusid ja `restricted`-lippu **ei kopeerita** teoste indeksisse. Need loetakse
  `work_collections_index.json`-ist (`_load_work_collections()`) + `is_work_public`.
- `server/cache.py`-sse kasutajapõhist vastust ei panda (ADR 0042). Selles PR-is cache'i
  üldse ei lisata (YAGNI; mõõdetakse Task 7-s).
- Piiratud teose pealkiri ei ole salajane: `restricted: true`, pealkiri kaasas
  (`POST /prosopography/work-titles` poliitika).
- Funktsiooni eemaldamisel kontrolli re-eksporte: `server/prosopography/ops.py`,
  `state.py`, `_compat._SYNC_NAMES`, `server/__init__.py`.
- Testides patchi prosopograafia teid **`ops`-fassaadil** (`monkeypatch.setattr(ops, "…")`)
  või conftest `prosopo_env` fikstuuriga. Otse `state`-i patchimine lekib testide vahel
  (`_compat.sync_from_facade`, vt #424 sessioon).
- Seose liigikoodid: `academic`, `dedicated`, `cotext`, `mention`, `printer`, `family`.
- Uus route PEAB olema `router.py`-s enne `@router.get("/{person_id:path}")`-i.

## Review Focus

1. **Isikukaart ilma indeksikirjeta (draft/tombstone/uus):** endpoint peab andma 404
   tundmatule ID-le, aga töötama olemasoleva kaardiga, millel on 0 seost (tühjad
   `persons`/`edges`, mitte 500). Test Task 5-s.
2. **Teos `person_to_works`-is, aga fakte pole (indeks vananenud või teos kustutatud):**
   serv jäetakse vahele, mitte KeyError. Invariant „iga `evidence.work_id` on `works`-is"
   peab kehtima. Test Task 4-s.
3. **`location` string või tühi string** (vanad kirjed, nt `o17ekb`: `"location": ""`):
   `_work_facts_entry` annab `location: None`, mitte `{"label": ""}`. Test Task 1-s.
4. **Sama isik mitme rolliga samas teoses** (Luden `aui`+`gratulator`): üks serv teose
   kohta, rollid koondatud. Mõlemad `person_to_works` kirjed ei tohi anda kahte serva.
   Test Task 4-s.
5. **Fookus mainib iseennast / on samas teoses mitmes rollis:** fookus ei tohi tekkida
   `persons`-isse ega serva teiseks otsaks. Test Task 4-s.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/prosopography/work_relations_ops.py` (muuda) | `_work_facts_entry`, `update_work_facts`, `remove_work_facts`, `build_works_creators_index` (kõik teosed), `_load_creators_index` jääb |
| `server/prosopography/indices.py` (muuda) | `update_person_to_works` ei kutsu enam vana kirjutajat |
| `server/prosopography/state.py`, `ops.py`, `_compat.py` (muuda) | re-eksportide vahetus |
| `server/metadata_ops.py`, `server/upload/import_work.py`, `server/routers/admin.py` (muuda) | `update_work_facts` / `remove_work_facts` kutse `update_work_collections` kõrval |
| `server/prosopography/network_rules.py` (uus) | puhas `classify_pair` |
| `server/prosopography/network.py` (uus) | `build_person_network`, pereservad |
| `server/prosopography/router.py` (muuda) | `GET /{person_id:path}/network` |
| `server/prosopography/relations.py`, `person_search.py` (muuda) | ühine ehitaja kaardil |
| `tests/test_work_facts_index.py` (uus), `tests/test_network_rules.py` (uus), `tests/test_person_network.py` (uus) | testid |
| `tests/test_work_relations_ops.py`, `tests/test_work_collections.py` (muuda) | migratsioon |
| `docs/decisions/0056-isikuseose-liik-rollipaarist.md` (uus) | ADR |

---

### Task 1: Teose faktide kirje ja kirjutaja

**Files:**
- Modify: `server/prosopography/work_relations_ops.py`
- Test: `tests/test_work_facts_index.py` (uus)

**Interfaces:**
- Produces:
  - `_work_facts_entry(meta: dict) -> dict`: `{"title": str, "year": int|None, "creators": [{"person_id", "roles"}], "location": {"id": str|None, "label": str}|None, "genres": [str]}`
  - `update_work_facts(meta: dict) -> None`: kirjutab/asendab `meta["id"]` kirje
  - `remove_work_facts(work_id: str) -> None`
  - `build_works_creators_index() -> None`: kirje **igale** `_metadata.json`-iga teosele

- [ ] **Step 1: Kirjuta failivad testid**

```python
# tests/test_work_facts_index.py
"""Teose faktide read-model (#461): üks kirje-ehitaja, kirje igale teosele."""
import json
from pathlib import Path
from unittest.mock import patch

from server.prosopography import work_relations_ops as wro

A = "vutt:Paaaaa"


def _meta(**kw):
    base = {"id": "w1", "title": "Disputatio", "year": 1658, "creators": [],
            "location": {"id": "Q435295", "label": "Altdorf bei Nürnberg", "source": "wikidata"},
            "genre": [{"id": "Q1123131", "label": "disputatsioon"}]}
    base.update(kw)
    return base


def _patches(tmp_path):
    return (patch.object(wro, "BASE_DIR", str(tmp_path / "data")),
            patch.object(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json")))


def _read(tmp_path):
    return json.loads((tmp_path / "wci.json").read_text(encoding="utf-8"))


def test_kirje_kannab_kohta_ja_zanreid():
    e = wro._work_facts_entry(_meta(creators=[{"id": A, "role": "praeses"}]))
    assert e == {"title": "Disputatio", "year": 1658,
                 "creators": [{"person_id": A, "roles": ["praeses"]}],
                 "location": {"id": "Q435295", "label": "Altdorf bei Nürnberg"},
                 "genres": ["disputatsioon"]}


def test_tuhi_voi_stringkoht():
    assert wro._work_facts_entry(_meta(location=""))["location"] is None
    assert wro._work_facts_entry(_meta(location=None))["location"] is None
    assert wro._work_facts_entry(_meta(location="Riga"))["location"] == {"id": None, "label": "Riga"}


def test_zanr_objekt_voi_puudub():
    assert wro._work_facts_entry(_meta(genre={"label": "kõne"}))["genres"] == ["kõne"]
    assert wro._work_facts_entry(_meta(genre=None))["genres"] == []


def test_loojateta_teos_saab_kirje(tmp_path):
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.update_work_facts(_meta(creators=[]))
    assert _read(tmp_path)["w1"]["creators"] == []


def test_update_asendab_ja_remove_eemaldab(tmp_path):
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.update_work_facts(_meta())
        wro.update_work_facts(_meta(title="Uus"))
        assert _read(tmp_path)["w1"]["title"] == "Uus"
        wro.remove_work_facts("w1")
        assert "w1" not in _read(tmp_path)


def test_rebuild_ja_update_annavad_sama_kirje(tmp_path):
    """ADR 0007: sama kirje-ehitaja mõlemas teel."""
    d = tmp_path / "data" / "slug-w1"
    d.mkdir(parents=True)
    meta = _meta(creators=[{"id": A, "role": "auctor"}])
    (d / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    p1, p2 = _patches(tmp_path)
    with p1, p2:
        wro.build_works_creators_index()
        rebuilt = _read(tmp_path)["w1"]
        (tmp_path / "wci.json").unlink()
        wro.update_work_facts(meta)
        assert _read(tmp_path)["w1"] == rebuilt
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_work_facts_index.py -q`
Expected: FAIL (`_work_facts_entry` puudub)

- [ ] **Step 3: Implementeeri** `work_relations_ops.py`-s. Asenda `update_works_creators_index`
  ja `build_works_creators_index` järgmisega; `_creators_to_entries`, loaderid ja
  `get_work_relations` jäävad.

```python
def _location_of(meta: dict) -> Optional[dict]:
    """Trükikoht {id, label} või None (tühi string ja puuduv = None)."""
    loc = meta.get("location")
    if isinstance(loc, dict):
        label = loc.get("label") or ""
        return {"id": loc.get("id"), "label": label} if (label or loc.get("id")) else None
    if isinstance(loc, str) and loc.strip():
        return {"id": None, "label": loc.strip()}
    return None


def _genres_of(meta: dict) -> list:
    g = meta.get("genre")
    items = g if isinstance(g, list) else ([g] if g else [])
    out = []
    for item in items:
        label = item.get("label") if isinstance(item, dict) else item
        if isinstance(label, str) and label:
            out.append(label)
    return out


def _work_facts_entry(meta: dict) -> dict:
    """Ühe teose kirje — ÜKS ehitaja nii rebuildile kui uuendusele (ADR 0007).

    Kogusid ja avalikkust siia ei kopeerita: need elavad work_collections_index.json-is,
    mida uuendatakse tingimusteta ka call_ptw=False teedel (#461).
    """
    return {
        "title": meta.get("title") or "",
        "year": meta.get("year"),
        "creators": _creators_to_entries(meta.get("creators") or []),
        "location": _location_of(meta),
        "genres": _genres_of(meta),
    }


def _write_entry(work_id: str, entry: Optional[dict]) -> None:
    with _creators_lock:
        index = _load_creators_index()
        if entry is None:
            index.pop(work_id, None)
        else:
            index[work_id] = entry
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)


def update_work_facts(meta: dict) -> None:
    """Kirjutab teose faktid. Kutsutakse tingimusteta update_work_collections kõrval."""
    work_id = meta.get("id") or meta.get("work_id")
    if work_id:
        _write_entry(work_id, _work_facts_entry(meta))


def remove_work_facts(work_id: str) -> None:
    if work_id:
        _write_entry(work_id, None)


def build_works_creators_index() -> None:
    """Ehitab indeksi nullist: kirje IGALE teosele, millel on _metadata.json."""
    index: dict = {}
    if os.path.exists(BASE_DIR):
        for entry in os.scandir(BASE_DIR):
            meta_path = os.path.join(entry.path, "_metadata.json")
            if not entry.is_dir() or not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue
            work_id = meta.get("id") or meta.get("work_id")
            if work_id:
                index[work_id] = _work_facts_entry(meta)
    with _creators_lock:
        atomic_write_json(WORKS_CREATORS_INDEX_FILE, index)
```

Uuenda mooduli päise dokstringi: indeksi kuju (lisaks `location`, `genres`) ja
kutsumiskohad (`update_work_facts` — `save_work_metadata`, `bulk_update_works`,
`import_work`; `remove_work_facts` — teose kustutus).

- [ ] **Step 4: Käivita, veendu et läbib**

Run: `.venv/bin/pytest tests/test_work_facts_index.py -q`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/work_relations_ops.py tests/test_work_facts_index.py
git commit -m "feat(prosopo): teose faktide kirje igale teosele — koht ja žanrid (#461)"
```

---

### Task 2: Vana kirjutaja eemaldus ja tingimusteta uuendusteed

**Files:**
- Modify: `server/prosopography/indices.py:321-325`, `state.py:23`, `ops.py:27-28`,
  `_compat.py:48-49`, `server/metadata_ops.py:18,169,302`,
  `server/upload/import_work.py:477-486`, `server/routers/admin.py:418-419`
- Modify: `tests/test_work_relations_ops.py` (`update_works_creators_index` testid)
- Test: `tests/test_work_facts_index.py` (lisa integratsioonitestid)

**Interfaces:**
- Consumes: `update_work_facts`, `remove_work_facts` (Task 1)
- Produces: teose faktid on värsked pärast iga metaandmete kirjutust, sh `call_ptw=False`

- [ ] **Step 1: Kirjuta failivad integratsioonitestid** (lisa `tests/test_work_facts_index.py` lõppu)

```python
# ── Uuendusteed (integratsioon) ───────────────────────────────────────────────

def _work_dir(tmp_path, meta):
    d = tmp_path / "data" / f"slug-{meta['id']}"
    d.mkdir(parents=True, exist_ok=True)
    (d / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    return d / "_metadata.json"


def _env(monkeypatch, tmp_path):
    """Metaandmete salvestus ilma giti ja Meilita; indeksid tmp-is."""
    from server import metadata_ops
    from server.prosopography import ops
    monkeypatch.setattr(wro, "BASE_DIR", str(tmp_path / "data"))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    monkeypatch.setattr(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json"))
    monkeypatch.setattr(ops, "WORK_COLLECTIONS_INDEX_FILE", str(tmp_path / "wc.json"))
    monkeypatch.setattr(metadata_ops, "sync_work_to_meilisearch", lambda *_a, **_k: None)
    # Git-kirjutus nagu tests/test_metadata_git_tulemus.py-s
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *_a, **_k: {"success": True})
    return metadata_ops


def test_call_ptw_true_ei_kustuta_uusi_valju(monkeypatch, tmp_path):
    """Vana update_works_creators_index kirjutas kirje üle ilma location/genres-ita."""
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta(creators=[{"id": A, "role": "auctor"}]))
    mo.save_work_metadata(str(path), {"title": "Uus pealkiri"}, "tester", "test",
                          sync_meili=False, call_ptw=True)
    e = _read(tmp_path)["w1"]
    assert e["title"] == "Uus pealkiri"
    assert e["location"] == {"id": "Q435295", "label": "Altdorf bei Nürnberg"}
    assert e["genres"] == ["disputatsioon"]


def test_loojateta_teos_ei_kao_call_ptw_true_jarel(monkeypatch, tmp_path):
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta(creators=[], tags=[{"id": A, "entity_type": "person", "label": "X"}]))
    mo.save_work_metadata(str(path), {"year": 1660}, "tester", "test", sync_meili=False, call_ptw=True)
    assert _read(tmp_path)["w1"]["year"] == 1660


def test_call_ptw_false_uuendab_fakte(monkeypatch, tmp_path):
    """Hulgi- ja jagamisteed kasutavad call_ptw=False — faktid peavad ikka uuenema."""
    mo = _env(monkeypatch, tmp_path)
    path = _work_dir(tmp_path, _meta())
    mo.save_work_metadata(str(path), {"location": {"id": "Q13972", "label": "Tartu"}},
                          "tester", "test", sync_meili=False, call_ptw=False)
    assert _read(tmp_path)["w1"]["location"] == {"id": "Q13972", "label": "Tartu"}
```

Signatuur (`server/metadata_ops.py:208`): `save_work_metadata(meta_path, updates, username,
git_message, *, background_tasks=None, sync_meili=True, call_ptw=True)`. Ilma
`background_tasks`-ita jookseb `update_person_to_works` sünkroonselt, seega test näeb
tausttöö mõju kohe. `update_work_collections` ja `update_person_to_works` jäävad
päris funktsioonideks: nende failid on `ops`-fassaadil tmp-i suunatud.

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_work_facts_index.py -q -k "call_ptw or loojateta_teos_ei"`
Expected: FAIL. `call_ptw_true` kaotab `location`-i (vana kirjutaja), `call_ptw_false` ei
uuenda üldse.

- [ ] **Step 3: Eemalda vana kutse** `indices.py` `update_person_to_works` lõpust:

```python
    # ENNE (eemalda terve plokk):
    try:
        state.update_works_creators_index(work_id, creators, title=title, year=year)
    except Exception:
        state.logger.exception("update_works_creators_index viga teose %s jaoks", work_id)
```

Asenda kommentaariga samas kohas:

```python
    # Teose faktid (works_creators_index) kirjutab AINULT update_work_facts, mida
    # metaandmete kirjutajad kutsuvad tingimusteta (#461). Siin kutsutud vana kirjutaja
    # kirjutas kirje üle ilma location/genres-ita ja kustutas loojateta teose.
```

- [ ] **Step 4: Vaheta re-ekspordid**
  - `state.py:23`: `from .work_relations_ops import update_work_facts, remove_work_facts, build_works_creators_index, get_work_relations`
  - `ops.py:27-28`: `update_works_creators_index = …` → `update_work_facts = state.update_work_facts` ja `remove_work_facts = state.remove_work_facts`; `__all__`-is `'update_works_creators_index'` → `'update_work_facts', 'remove_work_facts'`
  - `_compat.py` `_SYNC_NAMES`: `"update_works_creators_index"` → `"update_work_facts"`, lisa `"remove_work_facts"`
  - `grep -rn "update_works_creators_index" server/ mcp/ scripts/` → peab olema 0 vastet

- [ ] **Step 5: Lisa tingimusteta kutsed** `update_work_collections` kõrvale.

`server/metadata_ops.py:18`:
```python
from .prosopography.indices import update_person_to_works, update_work_collections
from .prosopography.work_relations_ops import update_work_facts
```
`metadata_ops.py:169` (bulk, muutunud teose kohta) ja `:302` (üksik), kohe pärast
`update_work_collections(...)`:
```python
        update_work_facts(meta)
```
`server/upload/import_work.py:486` järel (samas `try`-plokis):
```python
        from ..prosopography.work_relations_ops import update_work_facts
        update_work_facts({**metadata, "id": work_id})
```
`server/routers/admin.py:419` järel:
```python
    from ..prosopography.work_relations_ops import remove_work_facts
    remove_work_facts(work_id)
```

- [ ] **Step 6: Migreeri vanad testid** `tests/test_work_relations_ops.py`:
  - impordis `update_works_creators_index` → `update_work_facts`
  - `test_update_index_adds_new_work`: `update_work_facts({"id": "w2", "title": "Uus teos", "year": 1690, "creators": [{"id": A_ID, "role": "autor"}]})`; assertid jäävad
  - `test_update_index_removes_empty_work` → nimeta `test_update_index_hoiab_loojateta_teost`: pärast `update_work_facts({"id": "w1", "title": "X", "year": 1680, "creators": []})` on `"w1" in idx` ja `idx["w1"]["creators"] == []` (muutunud käitumine: spekk nõuab kirjet igale teosele)
  - kõik `build_works_creators_index` testid, mis eeldavad, et loojateta teos puudub: uuenda eeldust (kirje on olemas, `creators == []`)

- [ ] **Step 7: Käivita**

Run: `.venv/bin/pytest tests/test_work_facts_index.py tests/test_work_relations_ops.py tests/test_work_collections.py tests/test_backend_smoke.py -q`
Expected: kõik läbivad

- [ ] **Step 8: Commit**

```bash
git add server/ tests/
git commit -m "fix(prosopo): teose faktid uuenevad tingimusteta, vana kirjutaja eemaldatud (#461)"
```

---

### Task 3: Rollipaari reeglid

**Files:**
- Create: `server/prosopography/network_rules.py`
- Test: `tests/test_network_rules.py`

**Interfaces:**
- Produces:
  - `KINDS: tuple = ("academic", "dedicated", "family", "cotext", "mention", "printer")` (tugevuse järjekord)
  - `classify_pair(a_roles: Iterable[str], b_roles: Iterable[str]) -> tuple[str, Optional[str]]`: tagastab `(kind, direction)`, kus `direction ∈ {"ab", "ba", None}`

- [ ] **Step 1: Kirjuta failivad testid**

```python
# tests/test_network_rules.py
"""Seose liik rollipaarist (#461, ADR 0056). Kontrollnäited on päris andmetest."""
import logging

import pytest

from server.prosopography import network_rules as nr
from server.prosopography.network_rules import classify_pair


@pytest.mark.parametrize("a, b, expected", [
    # 1. academic
    (["praeses"], ["respondens"], ("academic", "ab")),
    (["respondens"], ["praeses"], ("academic", "ba")),
    (["aui"], ["auctor"], ("academic", "ab")),
    (["aui", "gratulator"], ["auctor"], ("academic", "ab")),   # järjekord: academic enne cotext
    # 2. dedicated
    (["auctor"], ["subject"], ("dedicated", "ab")),
    (["subject"], ["praeses"], ("dedicated", "ba")),
    (["gratulator"], ["respondens"], ("dedicated", "ab")),
    (["gratulator"], ["auctor"], ("dedicated", "ab")),
    (["creator"], ["subject"], ("dedicated", "ab")),           # puuduv roll = creator = looja
    # 3. cotext
    (["gratulator"], ["gratulator"], ("cotext", None)),
    (["aui"], ["gratulator"], ("cotext", None)),
    (["dedicator"], ["dedicator"], ("cotext", None)),
    (["dedicator"], ["subject"], ("cotext", None)),            # pühendus on nõrk (otsus 5)
    # 4. mention
    (["praeses"], ["mentioned"], ("mention", None)),
    (["mentioned"], ["mentioned"], ("mention", None)),
    (["subject"], ["subject"], ("mention", None)),
    # 5. printer
    (["auctor"], ["publisher"], ("printer", None)),
    (["subject"], ["publisher"], ("printer", None)),
])
def test_reeglitabel(a, b, expected):
    assert classify_pair(a, b) == expected


def test_kontrollnaited():
    # Dalinus auctor, Luden aui — „Oratio de pietate"
    assert classify_pair(["aui"], ["auctor"])[0] == "academic"
    # Dalinus gratulator, Luden aui — „De libertate politica oratio"
    assert classify_pair(["aui"], ["gratulator"])[0] == "cotext"
    # Schwäger auctor → Fischer subject (jy30do)
    assert classify_pair(["auctor"], ["subject"]) == ("dedicated", "ab")
    # Dau dedicator, kaaspühendaja dedicator
    assert classify_pair(["dedicator"], ["dedicator"])[0] == "cotext"
    # Dau praeses, Fischer mentioned (3ix06q lk 2)
    assert classify_pair(["praeses"], ["mentioned"])[0] == "mention"


def test_vastassuunaline_vaste_on_suunata():
    assert classify_pair(["auctor", "subject"], ["auctor", "subject"]) == ("dedicated", None)
    assert classify_pair(["praeses", "respondens"], ["praeses", "respondens"]) == ("academic", None)


FLIP = {"ab": "ba", "ba": "ab", None: None}
ROLES = ["praeses", "respondens", "auctor", "gratulator", "dedicator", "aui", "creator",
         "subject", "mentioned", "publisher", "tundmatu"]


@pytest.mark.parametrize("a", ROLES)
@pytest.mark.parametrize("b", ROLES)
def test_summeetria(a, b):
    """Fookuse vahetus ei muuda liiki ega tegelikku suunda."""
    k1, d1 = classify_pair([a], [b])
    k2, d2 = classify_pair([b], [a])
    assert k1 == k2 and d2 == FLIP[d1]


def test_tundmatu_roll_on_cotext_ja_logitakse_uks_kord(caplog):
    nr._logged_unknown.clear()
    with caplog.at_level(logging.WARNING):
        assert classify_pair(["xyz"], ["xyz"]) == ("cotext", None)
        assert classify_pair(["xyz"], ["auctor"]) == ("cotext", None)
    assert sum("xyz" in r.message for r in caplog.records) == 1
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_network_rules.py -q`
Expected: FAIL (`ModuleNotFoundError: network_rules`)

- [ ] **Step 3: Implementeeri**

```python
# server/prosopography/network_rules.py
"""Isikuseose liik rollipaarist (#461, ADR 0056).

ÜKS koht, kus rollipaar tõlgitakse seose liigiks. Reeglid kehtivad järjekorras;
esimene sobiv võidab. Suund: "ab" = a → b, "ba" = b → a, None = suunata.
Funktsioon on sümmeetriline: classify_pair(b, a) annab sama liigi ja pööratud suuna.
"""
from __future__ import annotations

from typing import Iterable, Optional

from ..config import get_logger

logger = get_logger(__name__)

KINDS = ("academic", "dedicated", "family", "cotext", "mention", "printer")

# `creator` on puuduva rolli vaikeväärtus (indices.py) — ka tema on looja.
CREATOR = frozenset({"praeses", "respondens", "auctor", "gratulator", "dedicator",
                     "editor", "aui", "creator"})
KNOWN = CREATOR | {"subject", "mentioned", "publisher"}

ACADEMIC_PAIRS = (("praeses", "respondens"), ("aui", "auctor"))
DEDICATED_CREATORS = CREATOR - {"dedicator"}   # pühendus on nõrk seos (spekk, otsus 5)
DEDICATED_PAIRS = tuple((c, "subject") for c in sorted(DEDICATED_CREATORS)) + (
    ("gratulator", "auctor"), ("gratulator", "respondens"))

_logged_unknown: set[str] = set()


def _direction(a: set, b: set, pairs) -> Optional[str] | bool:
    """"ab"/"ba"/None kui mõni paar sobib; False kui ükski ei sobi."""
    ab = any(p in a and q in b for p, q in pairs)
    ba = any(p in b and q in a for p, q in pairs)
    if ab and ba:
        return None
    if ab:
        return "ab"
    if ba:
        return "ba"
    return False


def classify_pair(a_roles: Iterable[str], b_roles: Iterable[str]) -> tuple[str, Optional[str]]:
    a_all, b_all = set(a_roles), set(b_roles)
    for role in (a_all | b_all) - KNOWN:
        if role not in _logged_unknown:
            _logged_unknown.add(role)
            logger.warning("Tundmatu roll seoste reeglites: %r (käsitletakse kaastekstina)", role)
    a, b = a_all & KNOWN, b_all & KNOWN

    d = _direction(a, b, ACADEMIC_PAIRS)
    if d is not False:
        return "academic", d
    d = _direction(a, b, DEDICATED_PAIRS)
    if d is not False:
        return "dedicated", d
    if (a & CREATOR and b & CREATOR) or _direction(a, b, (("dedicator", "subject"),)) is not False:
        return "cotext", None
    if "mentioned" in a or "mentioned" in b or ("subject" in a and "subject" in b):
        return "mention", None
    if "publisher" in a or "publisher" in b:
        return "printer", None
    return "cotext", None
```

- [ ] **Step 4: Käivita**

Run: `.venv/bin/pytest tests/test_network_rules.py -q`
Expected: kõik läbivad (sh 121 sümmeetria-juhtu)

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/network_rules.py tests/test_network_rules.py
git commit -m "feat(prosopo): isikuseose liik rollipaarist — üks reeglitabel (#461)"
```

---

### Task 4: Võrgustiku ehitaja

**Files:**
- Create: `server/prosopography/network.py`
- Test: `tests/test_person_network.py`

**Interfaces:**
- Consumes: `classify_pair` (Task 3); `_load_creators_index()` (`work_relations_ops`);
  `_load_person_to_works`, `_load_work_collections`, `_load_index`, `_collection_descendants`
  (`indices`); `get_person` (`person_crud`); `is_work_public` (`server.access_ops`);
  `get_cached_collections` (`server.cache`); `_load_places_cache`, `_get_place_coordinates`
  (`places_ops`)
- Produces: `build_person_network(person_id: str, collection: Optional[str] = None) -> Optional[dict]`.
  `None` = isikut ei ole. Muidu `{"focus", "persons", "works", "edges"}` spekis toodud kujul.

- [ ] **Step 1: Kirjuta failivad testid**

```python
# tests/test_person_network.py
"""build_person_network (#461): servad, invariandid, pereseosed, kogu, restricted."""
import json
from unittest import mock

import pytest

from server.prosopography import ops
from server.prosopography import work_relations_ops as wro

F, P, R, G, S, T = ("vutt:Pfocus", "vutt:Ppraes", "vutt:Presp", "vutt:Pgrat", "vutt:Psubj", "vutt:Pprint")
COLLECTIONS = {"agc": {"visibility": "public"}, "agc-sub": {"parent": "agc", "visibility": "public"},
               "salajane": {"visibility": "restricted"}}


@pytest.fixture
def net(tmp_path, monkeypatch, prosopo_env):
    """ptw + teoste faktid + kogud + indeks tmp-is; kaardid prosopo_env-is."""
    ptw = {
        F: [{"work_id": "w1", "role": "respondens"}, {"work_id": "w2", "role": "subject"},
            {"work_id": "w3", "role": "mentioned", "pages": [2]}, {"work_id": "w4", "role": "gratulator"},
            {"work_id": "w4", "role": "aui"}, {"work_id": "gone", "role": "auctor"}],
        P: [{"work_id": "w1", "role": "praeses"}, {"work_id": "w3", "role": "praeses"}],
        G: [{"work_id": "w2", "role": "auctor"}, {"work_id": "w4", "role": "gratulator"}],
        T: [{"work_id": "w1", "role": "publisher"}],
    }
    facts = {
        "w1": {"title": "Disputatio", "year": 1658, "creators": [], "location": {"id": "Q435295", "label": "Altdorf"}, "genres": ["disputatsioon"]},
        "w2": {"title": "Programma", "year": 1659, "creators": [], "location": None, "genres": []},
        "w3": {"title": "Salajane", "year": None, "creators": [], "location": {"id": "Q13972", "label": "Tartu"}, "genres": []},
        "w4": {"title": "Oratio", "year": 1660, "creators": [], "location": None, "genres": []},
    }
    wc = {"w1": ["agc-sub"], "w3": ["salajane"], "w4": ["agc"]}
    idx = {"entries": [
        {"id": F, "label": "Fookus", "birth_year": 1636, "death_year": 1705, "origin_place": "Lübeck",
         "origin_place_id": "Q2843", "origin_coordinates": {"lat": 53.87, "lon": 10.69}},
        {"id": P, "label": "Praeses"}, {"id": G, "label": "Gratulant"}, {"id": T, "label": "Trükkal"},
    ]}
    for name, data in (("ptw.json", ptw), ("wci.json", facts), ("wc.json", wc), ("idx.json", idx)):
        (tmp_path / name).write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(ops, "PERSON_TO_WORKS_FILE", str(tmp_path / "ptw.json"))
    monkeypatch.setattr(ops, "WORK_COLLECTIONS_INDEX_FILE", str(tmp_path / "wc.json"))
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_INDEX_FILE", str(tmp_path / "idx.json"))
    monkeypatch.setattr(wro, "WORKS_CREATORS_INDEX_FILE", str(tmp_path / "wci.json"))
    prosopo_env.write("focus")
    prosopo_env.write("praes")
    prosopo_env.write("grat")
    prosopo_env.write("print")
    with mock.patch("server.cache.get_cached_collections", return_value=COLLECTIONS), \
         mock.patch("server.access_ops.get_cached_collections", return_value=COLLECTIONS):
        yield prosopo_env


def _build(*a, **kw):
    from server.prosopography.network import build_person_network
    return build_person_network(*a, **kw)


def _edges(res, other):
    return [e for e in res["edges"] if other in (e["from"], e["to"])]


def test_tundmatu_isik_annab_none(net):
    assert _build("vutt:Pmissing") is None


def test_seosteta_isik_annab_tuhjad_loendid(net):
    net.write("lonely")
    res = _build("vutt:Plonely")
    assert res["persons"] == [] and res["edges"] == [] and res["works"] == []


def test_invariandid(net):
    res = _build(F)
    ids = {p["id"] for p in res["persons"]}
    works = {w["work_id"] for w in res["works"]}
    assert F not in ids
    for e in res["edges"]:
        assert F in (e["from"], e["to"])
        assert ({e["from"], e["to"]} - {F}) <= ids
        if e["evidence"]:
            assert e["evidence"]["work_id"] in works
    assert "gone" not in works          # ptw-s, aga faktid puuduvad → vahele


def test_liigid_ja_suunad(net):
    res = _build(F)
    (disp,) = [e for e in _edges(res, P) if e["evidence"]["work_id"] == "w1"]
    assert (disp["kind"], disp["from"], disp["to"], disp["directed"]) == ("academic", P, F, True)
    (ded,) = [e for e in _edges(res, G) if e["evidence"]["work_id"] == "w2"]
    assert (ded["kind"], ded["from"], ded["to"]) == ("dedicated", G, F)
    (men,) = [e for e in _edges(res, P) if e["evidence"]["work_id"] == "w3"]
    assert men["kind"] == "mention" and men["evidence"]["pages"] == [2]
    (prn,) = _edges(res, T)
    assert prn["kind"] == "printer"


def test_mitu_rolli_samas_teoses_uks_serv(net):
    res = _build(F)
    w4 = [e for e in _edges(res, G) if e["evidence"]["work_id"] == "w4"]
    assert len(w4) == 1
    assert sorted(w4[0]["roles"][F]) == ["aui", "gratulator"]
    assert w4[0]["kind"] == "cotext"


def test_teose_faktid_ja_restricted(net):
    res = _build(F)
    w = {x["work_id"]: x for x in res["works"]}
    assert w["w3"]["restricted"] is True and w["w3"]["title"] == "Salajane"
    assert w["w1"]["restricted"] is False
    assert w["w1"]["place"]["label"] == "Altdorf"
    disp = [e for e in _edges(res, P) if e["evidence"]["work_id"] == "w1"][0]
    assert disp["place"] == {"id": "Q435295", "kind": "print"} and disp["year"] == 1658


def test_kogu_filter_alamkogudega(net):
    res = _build(F, collection="agc")
    got = {e["evidence"]["work_id"] for e in res["edges"] if e["evidence"]}
    assert got == {"w1", "w4"}          # w1 on alamkogus agc-sub; w2/w3 välja


def test_pereseosed_mõlemast_suunast_uks_serv(net):
    net.write("focus", relations=[{"target_id": "vutt:Pfam", "type": "isa"}])
    net.write("fam", relations=[{"target_id": F, "type": "poeg"}])
    net.write("other", relations=[{"target_id": F, "type": "vend"}])
    net.write("dead", record_status="tombstone", relations=[{"target_id": F, "type": "x"}])
    res = _build(F)
    fam = [e for e in res["edges"] if e["kind"] == "family"]
    by_other = {({e["from"], e["to"]} - {F}).pop(): e for e in fam}
    assert set(by_other) == {"vutt:Pfam", "vutt:Pother"}
    recs = by_other["vutt:Pfam"]["records"]
    assert {(r["source_id"], r["type"]) for r in recs} == {(F, "isa"), ("vutt:Pfam", "poeg")}
    assert by_other["vutt:Pfam"]["directed"] is False and by_other["vutt:Pfam"]["evidence"] is None


def test_pereserv_summeetriline(net):
    net.write("focus", relations=[{"target_id": "vutt:Pfam", "type": "isa"}])
    net.write("fam", relations=[{"target_id": F, "type": "poeg"}])
    a = [e for e in _build(F)["edges"] if e["kind"] == "family"][0]
    b = [e for e in _build("vutt:Pfam")["edges"] if e["kind"] == "family"][0]
    assert (a["from"], a["to"], sorted(map(str, a["records"]))) == (b["from"], b["to"], sorted(map(str, b["records"])))


def test_fookus_ise_ei_tule_persons_isse(net):
    """Fookus mitmes rollis samas teoses (w4: aui + gratulator) ei tee iseendaga serva."""
    res = _build(F)
    assert all(F != p["id"] for p in res["persons"])
    assert all(not (e["from"] == F and e["to"] == F) for e in res["edges"])
```

`prosopo_env.write(nanoid, **fields)` loob kaardi `vutt:P{nanoid}` (vt `tests/conftest.py`).
Kui `get_person` vajab indeksikirjet, kontrolli `prosopo_env`-i. Fikstuur patchib
`PROSOPOGRAPHY_DIR` ja `save_with_git`, mitte ptw-d. Seepärast patchib `net` ptw, indeksi
ja kogude failid `ops`-fassaadil **pärast** `prosopo_env`-i: sama monkeypatch, hilisem võidab.

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_person_network.py -q`
Expected: FAIL (`ModuleNotFoundError: network`)

- [ ] **Step 3: Implementeeri**

```python
# server/prosopography/network.py
"""Isiku seoste võrgustik (#461): üks ehitaja isikulehele ja /persons seoste kaardile.

Allikad (kõik read-modelid, ADR 0007): person_to_works (rollid, mainimiste lehed),
works_creators_index (teose faktid), work_collections_index (kogud → filter ja
restricted), prosopography_index (isikute sildid, päritolu), isikukaardid (pereseosed).
Serv on alati fookuse ja teise isiku vahel, üks serv teose kohta (ego-võrgustik).
"""
from __future__ import annotations

import json
import os
from typing import Optional

from . import state
from ._compat import sync_from_facade
from .indices import _collection_descendants, _load_index, _load_person_to_works, _load_work_collections
from .network_rules import classify_pair
from .person_crud import get_person
from .places_ops import _get_place_coordinates, _load_places_cache
from .work_relations_ops import _load_creators_index


def _roles_by_work(ptw: dict) -> dict:
    """{work_id: {person_id: {"roles": set, "pages": set}}} — pöördindeks ühest päringust."""
    out: dict = {}
    for pid, entries in ptw.items():
        for e in entries or []:
            wid = e.get("work_id")
            if not wid:
                continue
            slot = out.setdefault(wid, {}).setdefault(pid, {"roles": set(), "pages": set()})
            slot["roles"].add(e.get("role") or "creator")
            slot["pages"].update(e.get("pages") or [])
    return out


def _person_view(entry: Optional[dict], pid: str, card: Optional[dict] = None) -> dict:
    """Isik vastuse jaoks: indeksikirjest, puudumisel kaardist."""
    e = entry or {}
    label = e.get("label") or ((card or {}).get("name") or {}).get("label") or pid
    origin = None
    if e.get("origin_place") or e.get("origin_place_id"):
        origin = {"place": e.get("origin_place"), "place_id": e.get("origin_place_id"),
                  "coordinates": e.get("origin_coordinates")}
    return {"id": pid, "label": label, "birth_year": e.get("birth_year"),
            "death_year": e.get("death_year"), "origin": origin}


def _place_coords(location: Optional[dict]) -> Optional[dict]:
    """Trükikoha koordinaadid kohtade registrist (Q-kood või silt → võti)."""
    if not location:
        return None
    places = _load_places_cache()
    key = None
    if location.get("id"):
        key = next((k for k, v in places.items() if isinstance(v, dict) and v.get("id") == location["id"]), None)
    if key is None and location.get("label") in places:
        key = location["label"]
    return _get_place_coordinates(key) if key else None


def _is_public(collections_of_work: list) -> bool:
    from ..access_ops import is_work_public
    return is_work_public({"collections": collections_of_work})


def _family_records(person_id: str, focus_card: dict) -> dict:
    """{teine_id: [{source_id, target_id, type}]} mõlemast suunast, tombstone'ideta."""
    recs: dict = {}

    def add(src: str, tgt: str, typ):
        other = tgt if src == person_id else src
        if other == person_id or not isinstance(other, str) or not other.startswith("vutt:P"):
            return
        rec = {"source_id": src, "target_id": tgt, "type": typ or None}
        if rec not in recs.setdefault(other, []):
            recs[other].append(rec)

    for r in focus_card.get("relations") or []:
        if isinstance(r, dict):
            add(person_id, r.get("target_id"), r.get("type"))
    for path in state._glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                other = json.load(f)
        except Exception:
            continue
        oid = other.get("id")
        if oid == person_id or other.get("record_status") == "tombstone":
            continue
        for r in other.get("relations") or []:
            if isinstance(r, dict) and r.get("target_id") == person_id:
                add(oid, person_id, r.get("type"))
    return recs


def build_person_network(person_id: str, collection: Optional[str] = None) -> Optional[dict]:
    sync_from_facade()
    card = get_person(person_id)
    if card is None:
        return None
    index = {e.get("id"): e for e in _load_index().get("entries", [])}
    facts = _load_creators_index()
    wc = _load_work_collections()
    allowed_cols = None
    if collection:
        from ..cache import get_cached_collections
        allowed_cols = _collection_descendants(collection, get_cached_collections() or {})

    by_work = _roles_by_work(_load_person_to_works())
    edges: list = []
    works: dict = {}
    others: set = set()
    focus_works = {w for w, members in by_work.items() if person_id in members}
    for wid in sorted(focus_works):
        fact = facts.get(wid)
        if fact is None:
            continue          # ptw vananenud või teos kustutatud — tõendita serva ei tehta
        cols = wc.get(wid) or []
        if allowed_cols is not None and not (allowed_cols & set(cols)):
            continue
        mine = by_work[wid][person_id]
        for oid, theirs in sorted(by_work[wid].items()):
            if oid == person_id:
                continue
            kind, direction = classify_pair(mine["roles"], theirs["roles"])
            if direction == "ab":
                frm, to, directed = person_id, oid, True
            elif direction == "ba":
                frm, to, directed = oid, person_id, True
            else:
                frm, to = sorted((person_id, oid))
                directed = False
            loc = fact.get("location")
            edges.append({
                "kind": kind, "from": frm, "to": to, "directed": directed,
                "roles": {person_id: sorted(mine["roles"]), oid: sorted(theirs["roles"])},
                "year": fact.get("year"),
                "place": {"id": loc.get("id"), "kind": "print"} if loc else None,
                "evidence": {"work_id": wid, "pages": sorted(mine["pages"] | theirs["pages"])},
            })
            others.add(oid)
            if wid not in works:
                works[wid] = {"work_id": wid, "title": fact.get("title") or "", "year": fact.get("year"),
                              "place": ({**loc, "coordinates": _place_coords(loc)} if loc else None),
                              "genres": fact.get("genres") or [], "restricted": not _is_public(cols)}

    for oid, recs in _family_records(person_id, card).items():
        frm, to = sorted((person_id, oid))
        edges.append({"kind": "family", "from": frm, "to": to, "directed": False, "records": recs,
                      "year": None, "place": None, "evidence": None})
        others.add(oid)

    persons = []
    for oid in sorted(others):
        entry = index.get(oid)
        persons.append(_person_view(entry, oid, None if entry else get_person(oid)))
    return {"focus": _person_view(index.get(person_id), person_id, card),
            "persons": persons, "works": list(works.values()), "edges": edges}
```

- [ ] **Step 4: Käivita**

Run: `.venv/bin/pytest tests/test_person_network.py tests/test_network_rules.py -q`
Expected: kõik läbivad. Kui `test_kogu_filter_alamkogudega` kukub, kontrolli, et
`server.cache.get_cached_collections` patch jõuab `network.py` lokaalsesse importi (import
on funktsiooni sees just selleks).

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/network.py tests/test_person_network.py
git commit -m "feat(prosopo): isiku seoste võrgustiku ehitaja — kõik rollid, pereseosed, kogu (#461)"
```

---

### Task 5: Endpoint

**Files:**
- Modify: `server/prosopography/router.py` (lisa route `prosopography_get_image` järele, enne `@router.get("/{person_id:path}")`)
- Test: `tests/test_person_network.py` (lisa)

**Interfaces:**
- Consumes: `build_person_network` (Task 4)
- Produces: `GET /prosopography/{person_id}/network?collection=<id>` → JSON; 404 tundmatule isikule

- [ ] **Step 1: Kirjuta failivad testid** (lisa `tests/test_person_network.py` lõppu)

```python
# ── Endpoint ──────────────────────────────────────────────────────────────────

@pytest.fixture
def client(net):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.prosopography import router as prosopography
    app = FastAPI()
    app.include_router(prosopography.router, prefix="/prosopography")
    return TestClient(app)


def test_endpoint_on_sync():
    import asyncio
    from server.prosopography import router as prosopography
    assert not asyncio.iscoroutinefunction(prosopography.prosopography_network)


def test_endpoint_vastus_ja_404(client):
    r = client.get(f"/prosopography/{F}/network")
    assert r.status_code == 200
    body = r.json()
    assert body["focus"]["id"] == F and {"persons", "works", "edges"} <= body.keys()
    assert client.get("/prosopography/vutt:Pmissing/network").status_code == 404


def test_endpoint_kogu_parameeter(client):
    body = client.get(f"/prosopography/{F}/network", params={"collection": "agc"}).json()
    assert {e["evidence"]["work_id"] for e in body["edges"] if e["evidence"]} == {"w1", "w4"}


def test_network_tee_ei_satu_isiku_route_i(client):
    """Üldine /{person_id:path} ei tohi neelata …/network teed isiku-ID-na."""
    r = client.get(f"/prosopography/{F}/network")
    assert "edges" in r.json()
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_person_network.py -q -k endpoint`
Expected: FAIL (`prosopography_network` puudub / 404)

- [ ] **Step 3: Implementeeri** `router.py`-s, kohe `prosopography_get_image` funktsiooni järel:

```python
@router.get("/{person_id:path}/network")
def prosopography_network(person_id: str, collection: Optional[str] = None):
    """Isiku seoste võrgustik (#461). Avalik; vastus ei sõltu kutsujast.

    Piiratud kogu teose pealkiri on kaasas märkega restricted (sama poliitika mis
    POST /work-titles). Sync def: loeb read-model faile (ADR 0002).
    """
    from .network import build_person_network
    result = build_person_network(person_id, collection=collection or None)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")
    return result
```

- [ ] **Step 4: Käivita**

Run: `.venv/bin/pytest tests/test_person_network.py tests/test_async_endpoint_offload.py -q`
Expected: kõik läbivad

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/router.py tests/test_person_network.py
git commit -m "feat(prosopo): GET /prosopography/{id}/network (#461)"
```

---

### Task 6: Üks tõde — /persons seoste kaart kasutab ehitajat

**Files:**
- Modify: `server/prosopography/relations.py:73-103` (`get_person_relation_network_ids`)
- Modify: `server/prosopography/person_search.py:462-472` (`get_person_map_markers`)
- Modify: `tests/test_work_collections.py:~280-300` (mock uue signatuuriga)
- Test: `tests/test_person_network.py` (lisa)

**Interfaces:**
- Consumes: `build_person_network` (Task 4)
- Produces: `get_person_relation_network_ids(person_id: str, collection: Optional[str] = None) -> list[str]`,
  mis tagastab fookuse esimesena + seotud isikud (sorteeritud), välja arvatud isikud, kelle
  kõik servad on `printer`

- [ ] **Step 1: Kirjuta failivad testid** (lisa `tests/test_person_network.py` lõppu)

```python
# ── Üks tõde: /persons seoste kaart ──────────────────────────────────────────

def _expected_ids(collection=None):
    res = _build(F, collection=collection)
    non_printer = {x for e in res["edges"] if e["kind"] != "printer" for x in (e["from"], e["to"])} - {F}
    return {F} | non_printer


@pytest.mark.parametrize("collection", [None, "agc", "agc-sub"])
def test_id_hulk_enne_koordinaadifiltrit(net, collection):
    from server.prosopography.relations import get_person_relation_network_ids
    ids = get_person_relation_network_ids(F, collection=collection)
    assert ids[0] == F
    assert set(ids) == _expected_ids(collection)
    assert T not in ids                      # ainult trükkal → väljas


@pytest.mark.parametrize("collection", [None, "agc"])
def test_markerid_on_koordinaadiga_osa(net, collection):
    res = ops.get_person_map_markers(related_to=F, collection=collection)
    mapped = {p["id"] for m in res["markers"] for p in m["persons"]}
    expected = _expected_ids(collection)
    if collection:
        # Fookus jääb piiratud kaardile ainult kogu liikmena (#460 vihje)
        from server.prosopography.indices import _persons_in_collection
        if F not in _persons_in_collection(collection):
            expected = expected - {F}
    with_coords = {e["id"] for e in json.loads(open(ops.PROSOPOGRAPHY_INDEX_FILE).read())["entries"]
                   if e.get("origin_coordinates")}
    assert mapped == expected & with_coords
    assert res["without_coordinates"] == len(expected - with_coords)
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_person_network.py -q -k "id_hulk or markerid"`
Expected: FAIL (`get_person_relation_network_ids() got an unexpected keyword argument 'collection'`)

- [ ] **Step 3: Asenda** `relations.py` `get_person_relation_network_ids`:

```python
def get_person_relation_network_ids(person_id: str, collection: Optional[str] = None) -> list[str]:
    """Seoste kaardi isikud: fookus + seotud isikud sama ehitajaga nagu isikulehel (#461).

    Välja jäävad isikud, kelle kõik servad on `printer` (trükkal on vaikimisi peidus).
    `collection` filtreerib ühiseid teoseid (alamkogudega); pereseosed jäävad alles.
    """
    from .network import build_person_network
    res = build_person_network(person_id, collection=collection)
    if res is None:
        return [person_id]
    others = {x for e in res["edges"] if e["kind"] != "printer" for x in (e["from"], e["to"])}
    others.discard(person_id)
    return [person_id, *sorted(others)]
```

Eemalda `_structured_relation_ids` ainult siis, kui `grep -rn "_structured_relation_ids" server tests`
näitab, et teda ei kasuta enam keegi. Muidu jäta ta alles. Kui eemaldad, uuenda ka
`relations.__all__`, `ops.py` ja `_compat._SYNC_NAMES`.

- [ ] **Step 4: Muuda** `person_search.py` `get_person_map_markers` algust:

```python
    sync_from_facade()
    if related_to:
        # Üks tõde (#461): kogu filtreerib ühiseid teoseid ehitajas, mitte isikuid
        # pärast (_persons_in_collection vaatab isiku KÕIKI teoseid ja andis teise hulga).
        network_ids = get_person_relation_network_ids(related_to, collection=collection)
        if collection:
            # Fookus jääb piiratud kaardile ainult kogu liikmena — muidu kaoks #460
            # tühja kaardi vihje „… kuulub teise kollektsiooni".
            if related_to not in _persons_in_collection(collection):
                network_ids = [i for i in network_ids if i != related_to]
        ids = list(dict.fromkeys([*(ids or []), *network_ids])) if ids else network_ids

    if collection and not related_to:
        collection_ids = _persons_in_collection(collection)
        if ids is not None:
            ids = [i for i in ids if i in collection_ids]
        else:
            ids = list(collection_ids)
```

(Asendab olemasolevad read `if related_to: …` ja `if collection: …`. `work_set_ids`
plokk jääb muutmata.)

- [ ] **Step 5: Uuenda vana test** `tests/test_work_collections.py` (~rida 293). Mock
  `get_person_relation_network_ids` peab aktsepteerima `collection`-i:
  `mock.patch.object(ops, "get_person_relation_network_ids", return_value=["vutt:Pfocus"])`
  töötab edasi (MagicMock võtab kõik argumendid). Kontrolli, et test läbib: fookus
  `c-other`-is, valitud `parent` → fookus eemaldatakse → markereid pole. Kui patch
  `ops`-il ei jõua `person_search`-i (import `from .relations import …`), patchi
  `server.prosopography.person_search.get_person_relation_network_ids`.

- [ ] **Step 6: Käivita**

Run: `.venv/bin/pytest tests/test_person_network.py tests/test_work_collections.py -q`
Expected: kõik läbivad

- [ ] **Step 7: Commit**

```bash
git add server/prosopography/relations.py server/prosopography/person_search.py tests/
git commit -m "refactor(prosopo): /persons seoste kaart kasutab võrgustiku ehitajat — üks tõde (#461)"
```

---

### Task 7: ADR, täiskomplekt, mõõtmine

**Files:**
- Create: `docs/decisions/0056-isikuseose-liik-rollipaarist.md`
- Modify: `docs/decisions/README.md` (registrisse rida), `CLAUDE.md` (Invariandid, üks lõik)

- [ ] **Step 1: Kirjuta ADR** (sama vorm nagu `docs/decisions/0055-*.md`: pealkiri, Staatus, Kontekst, Otsus, Tagajärjed)

```markdown
# 0056 — Isikuseose liik tuleneb rollipaarist ühes kohas; teose faktid ei kopeeri kogusid

**Staatus:** kehtib

## Kontekst

Isiku seosed arvutati kahes kohas eri reeglitega (`work_relations_ops` ainult `creators`,
`relations.get_person_relation_network_ids` + `_persons_in_collection`). Märksõna-isikud,
mainimised ja trükkalid jäid välja; kaardi ja isikulehe isikute hulk võis lahkneda.
`works_creators_index` uuenes ainult `call_ptw=True` teel ning kirjutati üle ilma uute
väljadeta (#461).

## Otsus

- Seose liik (`academic`, `dedicated`, `cotext`, `mention`, `printer`, `family`) tuleneb
  rollipaarist AINULT `server/prosopography/network_rules.py` `classify_pair`-is.
  Funktsioon on sümmeetriline: fookuse vahetus ei muuda liiki ega suunda.
- Võrgustiku ehitaja on üks (`network.build_person_network`); isikuleht ja `/persons`
  seoste kaart kasutavad sama.
- Teose faktid (`works_creators_index.json`) kirjutab AINULT `update_work_facts`, mida
  kutsutakse tingimusteta `update_work_collections` kõrval. Kogud ja avalikkus
  loetakse `work_collections_index.json`-ist; teoste indeksisse neid ei kopeerita.
- Trükikoht on `place.kind = "print"`, mitte kohtumiskoht.

## Tagajärjed

- Uus roll: lisa ta `network_rules.CREATOR`/`KNOWN`-i ja reeglitabelisse; muidu
  käsitletakse teda kaastekstina ja logitakse üks kord.
- Uus teose fakt, mida võrgustik vajab: lisa `_work_facts_entry`-sse (üks ehitaja
  rebuildile ja uuendusele, ADR 0007).
- #464 (teose osad) ja #465 (toimumiskoht) lisavad `evidence.part_id` ja
  `place.kind ∈ {event, sent_from}`, ilma vaateid muutmata.
```

- [ ] **Step 2: Lisa CLAUDE.md „Invariandid" alla** (pärast „Isikukaardi ülevaatus ja ID-d" lõiku):

```markdown
**Isiku seosed (ADR 0056)** — seose liik tuleneb rollipaarist AINULT
`network_rules.classify_pair`-is (sümmeetriline); võrgustiku ehitaja on üks
(`network.build_person_network`) nii isikulehele kui `/persons` seoste kaardile.
`works_creators_index.json` kirjutab AINULT `update_work_facts` (tingimusteta,
`update_work_collections` kõrval); kogud ja `restricted` tulevad
`work_collections_index.json`-ist. Trükikoht EI OLE kohtumiskoht.
```

- [ ] **Step 3: Täiskomplekt**

Run: `.venv/bin/pytest tests/ -q`
Expected: kõik läbivad (eelmine baas: 2681 passed)

Run: `grep -rn "update_works_creators_index" server/ mcp/ scripts/ tests/`
Expected: 0 vastet

- [ ] **Step 4: Mõõda ehitaja kiirust** kohalike andmetega pole mõtet (lokaalne `data/` ei
  peegelda tootmist). Pärast deploy'd serveris:

```bash
ssh vutt 'docker exec -w /app vutt-backend env PYTHONPATH=/app python3 -c "
import time
from server.prosopography.network import build_person_network
for pid in (\"vutt:P82rja6\", \"vutt:Pfxxxsc\", \"vutt:Pu837uz\"):
    t=time.perf_counter(); r=build_person_network(pid); dt=(time.perf_counter()-t)*1000
    print(pid, len(r[\"persons\"]), len(r[\"edges\"]), f\"{dt:.0f} ms\")
"'
```

Kui Vogel (`vutt:P82rja6`, 507 teost) on üle ~300 ms, on kallim osa `_family_records`
(kõigi kaartide skannimine). Siis lisa eraldi issue pereseoste pöördindeksi jaoks;
selles PR-is cache'i ei lisata.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0056-isikuseose-liik-rollipaarist.md docs/decisions/README.md CLAUDE.md
git commit -m "docs(adr): 0056 isikuseose liik rollipaarist, teose faktid (#461)"
```

- [ ] **Step 6: Deploy märkus PR-i kirjeldusse:** backend vajab `server_update.sh --no-cache`.
  Serveri start käivitab `rebuild_indices` → `build_works_creators_index` ehitab laiendatud
  indeksi. Seejärel Step 4 mõõtmine ja käsitsi kontroll:
  `curl -s https://vutt.utlib.ut.ee/api/files/prosopography/vutt:Pu837uz/network | python3 -m json.tool | head -40`
  (Schwäger peab olema `dedicated` servaga, `jy30do`).
