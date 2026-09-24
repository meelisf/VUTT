# Isiku lisamise voog — PR 1: serveri alus — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iga uus isikukaart saab serveripoolse ülevaatusmärke, ID-ga kaardid rikastatakse taustal (ainult tühjad väljad), välise ID duplikaadid on kõigis kirjutusteedes lukuga välistatud, ja vorm/valija loovad isiku ühe sammuga uue otspunkti kaudu.

**Architecture:** Kõik kaardikirjutused käivad läbi `_save_person_locked` (salvestus + `ext_id_index` samas kriitilises sektsioonis). ID-sid lisavad teed võtavad enne `person_lock`-i globaalse `ext_id_claim_lock`-i. Rikastuse loogika on kahes moodulis: `auto_enrich.py` (puhtad funktsioonid: koondamine, vastuolud, kaardile rakendamine, lõppolek) ja `auto_enrich_runner.py` (võrk, lukud, executor, käivitustaaste).

**Tech Stack:** Python 3.12 / FastAPI / pytest (`.venv/bin/pytest`); React 19 + TypeScript / vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-isiku-lisamise-voog-design.md` (rev 4) — §3.1, §4.2, §4.3, §4.4, §4.6, §7.2, §7.3, §8 p1, §9.

## Global Constraints

- Koodikommentaarid eesti keeles.
- Python: ALATI `.venv/bin/pytest` / `.venv/bin/python` (süsteemi `python3`-l puuduvad sõltuvused).
- Blokeeriv I/O `async def` sees keelatud (ADR 0002): sync `def` route või `run_in_threadpool`.
- Välisallika päringut (Wikidata/GND/VIAF/AA) ei tehta KUNAGI ühegi luku all (spekk §4.6).
- Lukkude järjekord: `ext_id_claim_lock` → (`merge_operation_lock`) → `person_lock`, mitte kunagi vastupidi.
- `review` on serveri väli: kliendi `review` ja iga `review.*` väljarada visatakse ära KÕIGIS kliendi kirjutusteedes (`strip_server_fields`).
- Automaatrikastus täidab ainult tühja; erandid ainult lisamise suunas: `name.aliases` (ühend) ja `identifiers` (seotud ID-d). Konflikti kaardiga ega allikatevahelist vastuolu ei rakendata.
- Iga lõppenud rikastuskatse eemaldab `enrich_pending`-i (spekk §4.3 lõppolekute tabel).
- Funktsiooni eemaldamisel/ümbernimetamisel kontrolli `server/__init__.py` ja `server/prosopography/ops.py` re-eksporte (`__all__`).
- Frontendi värav: `npm run typecheck`, `npm test`, `npm run lint:ci` (lävi 43 ei tohi tõusta).
- i18n: uus võti mõlemasse keelde korraga (ADR 0011).
- Commit'i lõpp: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Pärandduplikaadiga kaardi salvestamine** (tootmises 52 AA-numbrit ja mitu WD-ID-d kahel kaardil): vormi salvestus muutmata ID-dega ei tohi anda 409 — kontrollitakse ainult LISANDUNUD ID-sid. Test: Task 2.
2. **Normaliseerimata kujul sama ID** (`GND:123` vs `123`) loomisel → ikkagi 409 `exists`. Test: Task 5.
3. **Vana avatud vorm** (enne PR-i laetud, `review` võti puudub või on `null`) salvestab → olemasolev `review` jääb alles. Test: Task 3.
4. **Metaandmete salvestus Wikidata kättesaamatuse ajal**: stub-kaardi loomine ei tee võrgupäringut sünkroonselt (rikastus on taustal) — salvestus ei aeglustu. Test: Task 7.
5. **Käivitustaaste tombstone-kaardiga**: `enrich_pending`-iga kaart, mis on vahepeal liidetud, ei lähe rikastusse ega saa kirjutust. Test: Task 6.

Teadlik jääk (spekk ei käsitle, siin ei parandata): `entity_labels_ops.sync_prosopography_labels` kirjutab kõik kaardid ilma lukuta üle (olemasolev kadunud-uuenduse risk, võib üle kirjutada ka samaaegse `review`-muudatuse). Registreerida #240 alla.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/prosopography/locks.py` | + `ext_id_claim_lock` |
| `server/prosopography/person_crud.py` | `_save_person_locked`, `strip_server_fields`, `IdentifierConflict`, `_check_identifiers_free`, `_apply_card_update` (eraldatud `update_person`-ist), `_new_person_skeleton`, `create_person_checked`, `restore_person`; ümbertehtud `add_identifier`, `apply_enrichment`, `update_person`, `ensure_prosopo_for_entity`/`ensure_prosopo_stubs` |
| `server/prosopography/indices.py` | `_update_index_entry` ei puuduta enam `ext_id_index`-i |
| `server/prosopography/merge_ops.py` | `merge_person` võtab `ext_id_claim_lock`-i |
| `server/prosopography/enrichment.py` | `fetch_remote(scheme, ext_id)` eraldatud `fetch_and_diff`-ist |
| `server/prosopography/auto_enrich.py` (uus) | puhas: `aggregate`, `apply_to_card`, `finish_review`, `new_review` |
| `server/prosopography/auto_enrich_runner.py` (uus) | `run_auto_enrichment`, `schedule_auto_enrichment`, `recover_pending` |
| `server/prosopography/router.py` | `POST /persons/create`; vana `POST ""` delegeerib; `/restore` → `restore_person`; 409/400 kaardistused |
| `server/main.py` | lifespan: `recover_pending` taustalõimes |
| `server/metadata_ops.py`, `server/upload/import_work.py` | stub'ide kontekst (`work_id`) |
| `src/prosopography/services/prosopographyService.ts` | `createPersonChecked`, `PersonConflictError` |
| `src/components/EntityPicker.tsx` | kolm `createPerson` kutset → `createPersonChecked` |
| `src/prosopography/pages/PersonEditPage.tsx` | uus isik ühe sammuga (`card`) |
| `docs/decisions/0048-ulevaatusmarge-on-serveri-vali.md` (uus), `docs/decisions/README.md`, `CLAUDE.md` | ADR + invariant |
| `tests/conftest.py` | + fixture `prosopo_env` |
| `tests/test_prosopo_save_ext_index.py`, `tests/test_prosopo_id_claim.py`, `tests/test_prosopo_review_field.py`, `tests/test_auto_enrich.py`, `tests/test_prosopo_create_checked.py`, `tests/test_auto_enrich_runner.py`, `tests/test_prosopo_stub_review.py` (uued) | testid |

---

### Task 1: Ühine salvestus — `ext_id_index` samas kriitilises sektsioonis

**Files:**
- Modify: `server/prosopography/person_crud.py` (kõik `state.save_with_git(_id_to_path(...` kohad failis)
- Modify: `server/prosopography/indices.py:_update_index_entry`
- Modify: `tests/conftest.py` (uus fixture)
- Test: `tests/test_prosopo_save_ext_index.py` (uus)

**Interfaces:**
- Produces: `person_crud._save_person_locked(person: dict, username: str, message: str) -> None` — kutsuja hoiab `person_lock(person["id"])`-i; kirjutab faili gitiga JA kutsub `ext_id_index.update_for_person(person)`.
- Produces: fixture `prosopo_env` → `SimpleNamespace(dir: Path, write(nanoid, **fields) -> dict, read(nanoid) -> dict)`.
- Muutus: `indices._update_index_entry(person)` EI kutsu enam `ext_id_index.update_for_person`-i.

- [ ] **Step 1: Lisa fixture `tests/conftest.py` lõppu**

```python
@pytest.fixture
def prosopo_env(tmp_path, monkeypatch):
    """Isoleeritud prosopograafia: kaardid tmp-kaustas, git = failikirjutus, indeksid tmp-is.

    Patch käib `server.prosopography.ops` fassaadil — `sync_from_facade` kannab
    selle domeenimoodulitesse (vt `_compat._SYNC_NAMES`).
    """
    import json as _json
    from types import SimpleNamespace
    from server.prosopography import ops, ext_id_index

    d = tmp_path / "prosopography"
    d.mkdir()
    cfg = tmp_path / "config"
    cfg.mkdir()
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_DIR", str(d))
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_INDEX_FILE", str(cfg / "prosopography_index.json"))
    monkeypatch.setattr(ops, "PERSON_TO_WORKS_FILE", str(cfg / "person_to_works.json"))
    monkeypatch.setattr(ops, "PERSON_ALIASES_FILE", str(cfg / "person_aliases.json"))
    monkeypatch.setattr(ops, "WORK_COLLECTIONS_INDEX_FILE", str(cfg / "work_collections_index.json"))

    def fake_save(path, content, username, message=None, additional_files=None):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        for p, c in additional_files or []:
            with open(p, "w", encoding="utf-8") as f:
                f.write(c)
        return {"success": True}

    monkeypatch.setattr(ops, "save_with_git", fake_save)
    ext_id_index.invalidate()

    def write(nanoid, **fields):
        card = {
            "id": f"vutt:P{nanoid}", "name": {"label": f"Isik {nanoid}", "aliases": []},
            "identifiers": [], "updated_at": "2026-01-01T00:00:00+00:00",
            "record_status": "draft", "merged_into": None, **fields,
        }
        (d / f"{nanoid}.json").write_text(_json.dumps(card, ensure_ascii=False), encoding="utf-8")
        ext_id_index.invalidate()
        return card

    def read(nanoid):
        return _json.loads((d / f"{nanoid}.json").read_text(encoding="utf-8"))

    yield SimpleNamespace(dir=d, write=write, read=read)
    ext_id_index.invalidate()
```

- [ ] **Step 2: Kirjuta ebaõnnestuv võidujooksutest `tests/test_prosopo_save_ext_index.py`**

```python
"""Väliste ID-de indeksisse ei kirjutata aegunud kaardiversiooni (spekk §4.6, ADR 0048).

Varem kutsus iga kirjutustee `_update_index_entry`-t PÄRAST `person_lock`-i
vabastamist ja `ext_id_index.update_for_person` kustutas isiku kõik võtmed ning
lisas need talle antud koopiast. Järjestus:
  1. A (ID-sid mittemuutev salvestus) salvestab vana ID-loendiga, vabastab luku;
  2. B lisab ID ja uuendab indeksi;
  3. A hilinenud indeksiuuendus kirjutab vana loendi tagasi → B ID kaob indeksist;
  4. järgmine loomine peab ID-d vabaks → duplikaat.
"""
import threading

from server.prosopography import ext_id_index, indices, person_crud


def test_hilinenud_indeksiuuendus_ei_kustuta_vahepeal_lisatud_id(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    monkeypatch.setattr("server.prosopography.enrichment.fetch_and_diff",
                        lambda *a, **k: {"auto_filled": {}, "conflicts": []})

    originaal = indices._update_index_entry
    kaivitatud = {"b": False}

    def konks(person):
        # A on salvestanud ja lukust väljas; B lisab ID enne A indeksiuuendust.
        if not kaivitatud["b"]:
            kaivitatud["b"] = True
            t = threading.Thread(target=person_crud.add_identifier,
                                 args=("vutt:Paaa", "gnd", "123", "b"))
            t.start()
            t.join()
        originaal(person)

    monkeypatch.setattr(indices, "_update_index_entry", konks)

    kaart = person_crud.get_person("vutt:Paaa")
    person_crud.update_person("vutt:Paaa", {"notes": "A", "updated_at": kaart["updated_at"]}, "a")

    assert kaivitatud["b"]
    assert ext_id_index.find_person_id("gnd", "123") == "vutt:Paaa"
```

- [ ] **Step 3: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_prosopo_save_ext_index.py -v`
Expected: FAIL — `assert None == 'vutt:Paaa'` (A kirjutas vana ID-loendi tagasi).

- [ ] **Step 4: Lisa `_save_person_locked` `person_crud.py`-sse (pärast `_id_to_path`)**

```python
def _save_person_locked(person: dict, username: str, message: str) -> None:
    """Kaardi salvestus + väliste ID-de indeks SAMAS kriitilises sektsioonis (ADR 0048).

    Kutsuja PEAB hoidma `person_lock(person["id"])`-i (ID-lisavas teel ka
    `ext_id_claim_lock`-i). Indeks uuendatakse just salvestatud koopiast — luku
    järel tehtud uuendus võiks kirjutada aegunud ID-loendi tagasi ja kustutada
    vahepeal teise tee lisatud ID (spekk §4.6).
    """
    state.save_with_git(
        _id_to_path(person["id"]),
        json.dumps(person, ensure_ascii=False, indent=2),
        username,
        message=message,
    )
    ext_id_index.update_for_person(person)
```

- [ ] **Step 5: Asenda `person_crud.py`-s iga kaardisalvestus**

Kõik kohad kujul `state.save_with_git(_id_to_path(X), json.dumps(Y, ensure_ascii=False, indent=2), username, message=M)` luku sees → `_save_person_locked(Y, username, M)`. Kohad: `create_person`, `update_person`, `add_identifier`, `upload_person_image`, `delete_person_image`, `apply_enrichment`, `bulk_update_occupation`. `create_person` salvestab praegu ILMA lukuta — mässi salvestus `with person_lock(person_id):` sisse.

- [ ] **Step 6: Eemalda `ext_id_index` uuendus `indices._update_index_entry`-st**

`server/prosopography/indices.py` `_update_index_entry`-s kustuta read `from . import ext_id_index` ja `ext_id_index.update_for_person(person)`; docstringi lõik „Ühtlasi hoiab väliste ID-de pöördindeksit…" asenda:

```python
    """Uuendab ühe kirje prosopography_index.json-s.

    Väliste ID-de indeksit (`ext_id_index`) SIIN EI uuendata: see käib
    `person_crud._save_person_locked`-is salvestusega samas kriitilises
    sektsioonis (ADR 0048). See funktsioon jookseb luku järel ja võib saada
    aegunud koopia — otsinguindeksile on see talutav, duplikaadikontrollile mitte.
    """
```

- [ ] **Step 7: Leia teised `_update_index_entry` kutsujad väljaspool `person_crud`-i**

Run: `grep -rn "_update_index_entry" server --include=*.py | grep -v "def _update_index_entry\|person_crud.py\|ops.py"`
Expected: ainult `server/prosopography/router.py` `/restore` (Task 2 teeb selle ümber). Kui leidub muid, mis kaardi ID-sid muudavad → lisa neile `_save_person_locked`.

- [ ] **Step 8: Käivita test + prosopograafia testid**

Run: `.venv/bin/pytest tests/test_prosopo_save_ext_index.py tests/test_prosopo_ext_id_index.py tests/test_person_locks.py tests/test_prosopography_git.py -q`
Expected: PASS. Kui `test_person_locks.py` monkeypatchib `ops._update_index_entry` ja eeldab ext-uuendust sealt — kohanda testi `_save_person_locked` peale.

- [ ] **Step 9: Täis pytest + commit**

Run: `.venv/bin/pytest tests/ -q` → PASS

```bash
git add server/prosopography/person_crud.py server/prosopography/indices.py tests/conftest.py tests/test_prosopo_save_ext_index.py
git commit -m "fix(prosopo): ext_id_index uuendus salvestusega samas kriitilises sektsioonis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: ID-lukk ja duplikaadikontroll kõigis ID-lisavates teedes

**Files:**
- Modify: `server/prosopography/locks.py`
- Modify: `server/prosopography/person_crud.py` (`add_identifier`, `update_person`; uus `restore_person`, `IdentifierConflict`, `_check_identifiers_free`)
- Modify: `server/prosopography/merge_ops.py:merge_person`
- Modify: `server/prosopography/router.py` (`/identifiers`, `PUT /{id}`, `/restore`)
- Test: `tests/test_prosopo_id_claim.py` (uus)

**Interfaces:**
- Consumes: `_save_person_locked` (Task 1), `prosopo_env` (Task 1).
- Produces: `locks.ext_id_claim_lock: threading.RLock`
- Produces: `person_crud.IdentifierConflict(Exception)` atribuutidega `kind: Literal["exists","split"]`, `person_ids: list[str]`
- Produces: `person_crud._check_identifiers_free(person_id: Optional[str], identifiers: list[dict]) -> None` — kutsuja hoiab `ext_id_claim_lock`-i; viskab `IdentifierConflict`.
- Produces: `person_crud.restore_person(person_id: str, restored: dict, username: str) -> dict`
- Produces: router abi `_identifier_conflict_http(e: IdentifierConflict) -> HTTPException` (409, detail `{"error": "identifier_conflict", "conflict": kind, "existing_person_ids": [...], "existing_person_id": ids[0] kui exists}`)

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid `tests/test_prosopo_id_claim.py`**

```python
"""Väline ID ei tohi sattuda kahele kaardile ühegi kirjutustee kaudu (spekk §4.6)."""
import pytest

from server.prosopography import person_crud
from server.prosopography.person_crud import IdentifierConflict


@pytest.fixture(autouse=True)
def vorguta(monkeypatch):
    monkeypatch.setattr("server.prosopography.enrichment.fetch_and_diff",
                        lambda *a, **k: {"auto_filled": {}, "conflicts": []})


def test_add_identifier_teise_kaardi_id_ga_on_konflikt(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "123"}])
    prosopo_env.write("bbb")
    with pytest.raises(IdentifierConflict) as e:
        person_crud.add_identifier("vutt:Pbbb", "gnd", "GND:123", "u")
    assert (e.value.kind, e.value.person_ids) == ("exists", ["vutt:Paaa"])
    assert prosopo_env.read("bbb")["identifiers"] == []


def test_update_person_lisatud_id_teiselt_kaardilt_on_konflikt(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    b = prosopo_env.write("bbb")
    with pytest.raises(IdentifierConflict):
        person_crud.update_person("vutt:Pbbb", {
            "identifiers": [{"scheme": "wikidata", "id": "Q1"}],
            "updated_at": b["updated_at"]}, "u")


def test_parandduplikaat_ei_blokeeri_salvestust(prosopo_env):
    """Tootmises on ~52 AA-d kahel kaardil: muutmata ID-dega salvestus peab läbi minema."""
    prosopo_env.write("aaa", identifiers=[{"scheme": "album_academicum", "id": "AA:1"}])
    b = prosopo_env.write("bbb", identifiers=[{"scheme": "album_academicum", "id": "AA:1"}])
    uus = person_crud.update_person("vutt:Pbbb", {
        "notes": "x", "identifiers": b["identifiers"], "updated_at": b["updated_at"]}, "u")
    assert uus["notes"] == "x"


def test_liidetud_kaardi_id_omanik_on_sihtkaart(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "9"}],
                      record_status="tombstone", merged_into="vutt:Pccc")
    prosopo_env.write("ccc", identifiers=[{"scheme": "gnd", "id": "9"}])
    prosopo_env.write("bbb")
    with pytest.raises(IdentifierConflict) as e:
        person_crud.add_identifier("vutt:Pbbb", "gnd", "9", "u")
    assert e.value.person_ids == ["vutt:Pccc"]


def test_restore_ei_too_tagasi_teisele_kaardile_laeinud_id(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "5"}])
    b = prosopo_env.write("bbb")
    vana = {**b, "identifiers": [{"scheme": "gnd", "id": "5"}]}
    with pytest.raises(IdentifierConflict):
        person_crud.restore_person("vutt:Pbbb", vana, "admin")


def test_add_identifier_ei_tee_vorgupaeringut_luku_all(prosopo_env, monkeypatch):
    from server.prosopography.locks import ext_id_claim_lock, person_lock
    prosopo_env.write("aaa")
    nahtud = {}

    def fetch(*a, **k):
        nahtud["person_vaba"] = person_lock("vutt:Paaa").acquire(blocking=False)
        if nahtud["person_vaba"]:
            person_lock("vutt:Paaa").release()
        nahtud["claim_vaba"] = ext_id_claim_lock.acquire(blocking=False)
        if nahtud["claim_vaba"]:
            ext_id_claim_lock.release()
        return {"auto_filled": {}, "conflicts": []}

    monkeypatch.setattr("server.prosopography.enrichment.fetch_and_diff", fetch)
    person_crud.add_identifier("vutt:Paaa", "gnd", "7", "u")
    assert nahtud == {"person_vaba": True, "claim_vaba": True}
```

Märkus: `ext_id_claim_lock` on `RLock` — sama lõim saaks ta ka luku sees `acquire`-ida; seepärast mõõdab test `person_lock`-i (tavaline `Lock`) JA `claim`-i eraldi, ning `add_identifier` peab `fetch_and_diff`-i kutsuma alles pärast mõlema vabastamist.

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_prosopo_id_claim.py -v`
Expected: FAIL — `ImportError: cannot import name 'IdentifierConflict'`.

- [ ] **Step 3: Lisa lukk `server/prosopography/locks.py` lõppu**

```python
# Väliste ID-de „broneerimise" lukk (spekk §4.6, ADR 0048). Iga tee, mis lisab
# kaardile välise ID, hoiab seda üle kontrolli, salvestuse ja ext_id_index-i
# uuenduse — ühe isiku lukk ei kaitse TEIST kaarti. Järjekord: see lukk enne
# person_lock-i, mitte kunagi vastupidi. RLock: loomine võib seest kutsuda
# stub-teed, mis sama lukku uuesti küsib. Protsessilokaalne — mitme workeri
# korral vaja protsessideülest lukku.
ext_id_claim_lock = threading.RLock()
```

- [ ] **Step 4: Lisa `person_crud.py`-sse konflikt ja kontroll (pärast `_find_by_external_id`)**

```python
class IdentifierConflict(Exception):
    """Väline ID on juba teisel kaardil. `split` = ID-d on ERI kaartidel."""

    def __init__(self, kind: str, person_ids: list):
        super().__init__(f"{kind}: {', '.join(person_ids)}")
        self.kind = kind
        self.person_ids = person_ids


def _resolve_owner(person_id: str) -> Optional[str]:
    """Liidetud kaardi omanik on liitmise siht (ahel, max 5 sammu)."""
    for _ in range(5):
        person = get_person(person_id)
        if person is None:
            return None
        target = person.get("merged_into")
        if not target:
            return person_id
        person_id = target
    return person_id


def _check_identifiers_free(person_id: Optional[str], identifiers: list) -> None:
    """Kutsuja hoiab `ext_id_claim_lock`-i. Viskab IdentifierConflict, kui mõni
    antud ID on teisel (aktiivsel) kaardil. `person_id=None` = uus kaart."""
    owners: list = []
    for ident in _normalize_identifiers(identifiers or []):
        if not isinstance(ident, dict):
            continue
        found = _find_by_external_id(ident.get("scheme"), ident.get("id"))
        if not found:
            continue
        owner = _resolve_owner(found["id"])
        if owner and owner != person_id and owner not in owners:
            owners.append(owner)
    if owners:
        raise IdentifierConflict("exists" if len(owners) == 1 else "split", owners)


def _added_identifiers(old: list, new: list) -> list:
    """Uues loendis olevad ID-d, mida vanas ei olnud (normaliseeritud võrdlus)."""
    vana = {(i.get("scheme"), i.get("id")) for i in _normalize_identifiers(old or [])
            if isinstance(i, dict)}
    return [i for i in _normalize_identifiers(new or [])
            if isinstance(i, dict) and (i.get("scheme"), i.get("id")) not in vana]
```

Lisa importi: `from .locks import ext_id_claim_lock, person_lock`.

- [ ] **Step 5: Tee `add_identifier` ümber — lukk ainult kirjutuse ümber, võrk pärast**

```python
def add_identifier(person_id: str, scheme: str, ext_id: str, username: str) -> tuple:
    """Lisab identifikaatori; rikastuse eelvaade (võrk) PÄRAST lukke (spekk §4.6)."""
    from .enrichment import fetch_and_diff

    sync_from_facade()
    ext_id = normalize_ext_id(scheme, ext_id)
    with ext_id_claim_lock, person_lock(person_id):
        person = get_person(person_id)
        if person is None:
            raise KeyError(person_id)
        existing = _normalize_identifiers(person.get("identifiers") or [])
        if not any(i.get("scheme") == scheme and i.get("id") == ext_id for i in existing):
            _check_identifiers_free(person_id, [{"scheme": scheme, "id": ext_id}])
            existing.append({"scheme": scheme, "id": ext_id, "checked_at": None})
        person["identifiers"] = existing
        person["updated_at"] = datetime.now(timezone.utc).isoformat()
        person["updated_by"] = username
        name = (person.get("name") or {}).get("label") or person_id
        _save_person_locked(person, username, f"Prosopo identifikaator: {name} [{person_id}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
    diff = fetch_and_diff(scheme, ext_id, person)
    return person, diff
```

- [ ] **Step 6: `update_person` — ID-lukk, kui `identifiers` on kehas**

`update_person`-i algus: asenda `with person_lock(person_id):` järgmisega ja lisa kontroll kohe pärast `data["identifiers"] = _normalize_identifiers(...)` rida:

```python
    from contextlib import nullcontext
    claim = ext_id_claim_lock if "identifiers" in data else nullcontext()
    with claim, person_lock(person_id):
```

```python
        if "identifiers" in data:
            data["identifiers"] = _normalize_identifiers(data["identifiers"])
            # Ainult LISANDUNUD ID-d: pärandduplikaat (sama AA kahel kaardil)
            # ei tohi kaardi tavasalvestust blokeerida.
            _check_identifiers_free(
                person_id, _added_identifiers(person.get("identifiers"), data["identifiers"]))
```

- [ ] **Step 7: `restore_person` `person_crud.py`-sse**

```python
def restore_person(person_id: str, restored: dict, username: str) -> dict:
    """Taastab kaardi varasemale seisule (git). ID-lisav tee: võib tuua tagasi ID,
    mis on vahepeal teisele kaardile läinud — seega ID-lukk + kontroll."""
    sync_from_facade()
    with ext_id_claim_lock, person_lock(person_id):
        current = get_person(person_id) or {}
        restored = {**restored, "id": person_id}
        restored["identifiers"] = _normalize_identifiers(restored.get("identifiers") or [])
        _check_identifiers_free(
            person_id, _added_identifiers(current.get("identifiers"), restored["identifiers"]))
        restored["updated_at"] = datetime.now(timezone.utc).isoformat()
        restored["updated_by"] = username
        name = (restored.get("name") or {}).get("label") or person_id
        _save_person_locked(restored, username, f"Prosopo taastamine: {name} [{person_id}]")
    _indices()._update_index_entry(restored)
    _indices()._update_aliases_entry(restored)
    return restored
```

Lisa `restore_person` ja `IdentifierConflict` `__all__`-i (`person_crud.py` lõpus) ning `server/prosopography/ops.py` re-eksporti.

- [ ] **Step 8: `merge_person` — ID-lukk kõige välimisena**

`server/prosopography/merge_ops.py`:

```python
    with ext_id_claim_lock, merge_operation_lock:
```

(asenda `with merge_operation_lock:`; import `from .locks import ext_id_claim_lock, merge_operation_lock, person_lock`).

- [ ] **Step 9: Router — 409 kaardistus + `/restore` → `restore_person`**

`server/prosopography/router.py` üles (importide järele):

```python
def _identifier_conflict_http(e) -> HTTPException:
    """IdentifierConflict → 409 (spekk §4.2: exists | split)."""
    detail = {"error": "identifier_conflict", "conflict": e.kind,
              "existing_person_ids": e.person_ids}
    if e.kind == "exists":
        detail["existing_person_id"] = e.person_ids[0]
    return HTTPException(status_code=409, detail=detail)
```

- `/identifiers` route: lisa `except IdentifierConflict as e: raise _identifier_conflict_http(e)`.
- `PUT /{person_id}` route: lisa sama `except` ENNE `except ValueError`-it.
- `/restore` route: asenda `now = … save_with_git … _update_index_entry … _update_aliases_entry` plokk:

```python
    try:
        person = await run_in_threadpool(restore_person, person_id, person, user["username"])
    except IdentifierConflict as e:
        raise _identifier_conflict_http(e)
    return {"status": "ok", "person": person}
```

Impordi `IdentifierConflict`, `restore_person` `person_crud`-ist.

- [ ] **Step 10: Testid**

Run: `.venv/bin/pytest tests/test_prosopo_id_claim.py tests/test_prosopo_save_ext_index.py -v` → PASS
Run: `.venv/bin/pytest tests/ -q` → PASS

- [ ] **Step 11: Commit**

```bash
git add server/prosopography/locks.py server/prosopography/person_crud.py server/prosopography/merge_ops.py server/prosopography/router.py server/prosopography/ops.py tests/test_prosopo_id_claim.py
git commit -m "fix(prosopo): väline ID ühel kaardil — ID-lukk kõigis ID-lisavates teedes

add_identifier ei tee enam võrgupäringut luku all; update_person kontrollib
ainult lisandunud ID-sid (pärandduplikaat ei blokeeri); restore ja merge
võtavad ID-luku.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `review` on serveri väli — `strip_server_fields` + `/enrich` identifiers keeld

**Files:**
- Modify: `server/prosopography/person_crud.py` (`update_person`, `apply_enrichment`)
- Modify: `server/prosopography/router.py` (`/enrich` route)
- Test: `tests/test_prosopo_review_field.py` (uus)

**Interfaces:**
- Produces: `person_crud.SERVER_FIELDS = ("review",)`; `person_crud.strip_server_fields(data: dict) -> dict`
- Produces: `apply_enrichment` viskab `ValueError("identifiers_via_enrich")`; router → 400.

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid**

```python
"""`review` on serveri väli (ADR 0048): klient ei saa seda ühestki teest muuta."""
import pytest

from server.prosopography import person_crud

REVIEW = {"state": "pending", "reasons": ["no_source"], "created_via": "picker"}


def test_update_person_ei_kirjuta_review_d(prosopo_env):
    k = prosopo_env.write("aaa", review=REVIEW)
    person_crud.update_person("vutt:Paaa", {
        "review": {"state": "done"}, "updated_at": k["updated_at"]}, "toimetaja")
    assert prosopo_env.read("aaa")["review"] == REVIEW


@pytest.mark.parametrize("keha", [{}, {"review": None}])
def test_vana_vorm_ilma_review_ta_jatab_margi_alles(prosopo_env, keha):
    k = prosopo_env.write("aaa", review=REVIEW)
    person_crud.update_person("vutt:Paaa", {**keha, "notes": "x",
                                             "updated_at": k["updated_at"]}, "u")
    assert prosopo_env.read("aaa")["review"] == REVIEW


@pytest.mark.parametrize("rada", ["review", "review.state", "review.reasons"])
def test_enrich_ei_kirjuta_review_d(prosopo_env, rada):
    prosopo_env.write("aaa", review=REVIEW)
    person_crud.apply_enrichment("vutt:Paaa", {rada: "done"}, "u")
    assert prosopo_env.read("aaa")["review"] == REVIEW


@pytest.mark.parametrize("rada", ["identifiers", "identifiers.0.id"])
def test_enrich_ei_muuda_identifiers_it(prosopo_env, rada):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "1"}])
    with pytest.raises(ValueError, match="identifiers_via_enrich"):
        person_crud.apply_enrichment("vutt:Paaa", {rada: []}, "u")
    assert prosopo_env.read("aaa")["identifiers"] == [{"scheme": "gnd", "id": "1"}]


def test_strip_server_fields():
    assert person_crud.strip_server_fields(
        {"review": 1, "review.state": 2, "reviewer": 3, "notes": 4}) == {"reviewer": 3, "notes": 4}
```

- [ ] **Step 2: Käivita — FAIL** (`AttributeError: strip_server_fields`)

Run: `.venv/bin/pytest tests/test_prosopo_review_field.py -v`

- [ ] **Step 3: Lisa `person_crud.py`-sse `SECRET_FIELDS` järele**

```python
# Serveri väljad (ADR 0048): kliendi saadetud väärtus visatakse ALATI ära —
# nii võti ise kui iga väljarada `võti.…` (apply_enrichment kirjutab radu).
# Muudavad ainult loomine, taustarikastus ja admini kinnitus.
SERVER_FIELDS = ("review",)


def strip_server_fields(data: dict) -> dict:
    """Koopia ilma serveriväljadeta. Kõik kliendi kirjutusteed kutsuvad seda."""
    return {
        k: v for k, v in (data or {}).items()
        if not any(k == f or k.startswith(f + ".") for f in SERVER_FIELDS)
    }
```

- [ ] **Step 4: `update_person` — esimene rida luku sees pärast `get_person`-i None-kontrolli**

```python
        data = strip_server_fields(data)
```

(`None`-väärtusega `review` võti kaob samuti — `person.update` ei näe seda.)

- [ ] **Step 5: `apply_enrichment` — `approved_fields = dict(approved)` asemel**

```python
        approved_fields = strip_server_fields(approved)
        # ID-d ainult add_identifier kaudu (ID-lukk + duplikaadikontroll, §4.6).
        if any(k == "identifiers" or k.startswith("identifiers.") for k in approved_fields):
            raise ValueError("identifiers_via_enrich")
```

- [ ] **Step 6: Router `/enrich` — lisa `except ValueError`**

```python
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

- [ ] **Step 7: PASS + täis pytest + commit**

Run: `.venv/bin/pytest tests/test_prosopo_review_field.py -v` → PASS; `.venv/bin/pytest tests/ -q` → PASS

```bash
git add server/prosopography/person_crud.py server/prosopography/router.py tests/test_prosopo_review_field.py
git commit -m "feat(prosopo): review on serveri väli kõigis kliendi kirjutusteedes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `auto_enrich.py` — puhtad funktsioonid (koondamine, rakendamine, lõppolek)

**Files:**
- Modify: `server/prosopography/enrichment.py` (eralda `fetch_remote`)
- Create: `server/prosopography/auto_enrich.py`
- Test: `tests/test_auto_enrich.py` (uus)

**Interfaces:**
- Produces: `enrichment.fetch_remote(scheme: str, ext_id: str) -> Optional[dict]` (normaliseerib ID; tundmatu skeem → `None`)
- Produces: `auto_enrich.ENRICH_SCHEMES = ("wikidata", "gnd", "viaf", "album_academicum")`
- Produces: `auto_enrich.aggregate(sources: list[dict]) -> dict` — sisend `[{"scheme", "id", "remote"}]`; väljund `{"fields": {path: value}, "conflicts": [{"field", "values": [{"scheme", "value"}], "compatible": bool}], "linked": {scheme: id}}`
- Produces: `auto_enrich.apply_to_card(card: dict, agg: dict) -> list[str]` — muteerib kaarti, tagastab rakendatud väljad (`gender`, `birth.date`, `birth.place`, `death.date`, `death.place`, `occupations`, `confessions`, `statuses`, `name.aliases`, `aa_raw`)
- Produces: `auto_enrich.new_review(*, created_via: str, context: Optional[dict], has_enrichable_ids: bool, possible_duplicate: bool) -> dict`
- Produces: `auto_enrich.finish_review(review: dict, *, ids_left: bool, answered: list[str], failed: list[str], applied: list[str], conflicts: list[dict], possible_duplicate: bool) -> dict`

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid `tests/test_auto_enrich.py`**

```python
"""Automaatrikastuse puhas loogika (spekk §4.3)."""
from server.prosopography import auto_enrich as ae


def src(scheme, **remote):
    return {"scheme": scheme, "id": "x", "remote": remote}


def test_uhe_allika_valjad_kaardiradadeks():
    agg = ae.aggregate([src("wikidata", **{
        "gender": "M", "birth.date": "1592-01-01", "birth.precision": "year",
        "birth.place": {"id": "Q1", "label": "Greifswald"},
        "_occupations": [{"id": "Q2", "label": "jurist"}],
        "confession": {"id": "Q3", "label": "luterlane"},
        "name.aliases": ["Laurentius Ludenius"], "name.label": "ignoreeritakse"})])
    f = agg["fields"]
    assert f["gender"] == "M"
    assert f["birth"] == {"date": "1592-01-01", "precision": "year"}
    assert f["birth.place"] == {"id": "Q1", "label": "Greifswald", "labels": None, "source": "wikidata"}
    assert f["occupations"] == [{"id": "Q2", "label": "jurist"}]
    assert f["confessions"] == [{"id": "Q3", "label": "luterlane"}]
    assert f["name.aliases"] == ["Laurentius Ludenius"]
    assert "name.label" not in f and agg["conflicts"] == []


def test_allikatevaheline_vastuolu_jaab_taitmata():
    agg = ae.aggregate([
        src("wikidata", **{"birth.date": "1592-01-01", "birth.precision": "year"}),
        src("gnd", **{"birth.date": "1593-01-01", "birth.precision": "year"})])
    assert "birth" not in agg["fields"]
    assert agg["conflicts"] == [{"field": "birth.date", "compatible": False, "values": [
        {"scheme": "wikidata", "value": "1592-01-01"}, {"scheme": "gnd", "value": "1593-01-01"}]}]


def test_kokkusobiv_kuupaev_votab_tapsema():
    agg = ae.aggregate([
        src("gnd", **{"birth.date": "1592-01-01", "birth.precision": "year"}),
        src("wikidata", **{"birth.date": "1592-02-10", "birth.precision": "day"})])
    assert agg["fields"]["birth"] == {"date": "1592-02-10", "precision": "day"}
    assert agg["conflicts"][0]["compatible"] is True


def test_sama_vaartus_kahest_allikast_ei_ole_vastuolu():
    agg = ae.aggregate([src("wikidata", gender="M"), src("gnd", gender="M")])
    assert agg["fields"]["gender"] == "M" and agg["conflicts"] == []


def test_kohad_vorreldakse_id_jargi():
    agg = ae.aggregate([
        src("wikidata", **{"death.place": {"id": "Q9", "label": "Dorpat"}}),
        src("gnd", **{"death.place": {"id": "Q9", "label": "Tartu"}})])
    assert agg["fields"]["death.place"]["id"] == "Q9" and agg["conflicts"] == []


def test_ametid_uhendatakse():
    agg = ae.aggregate([
        src("wikidata", _occupations=[{"id": "Q2", "label": "jurist"}]),
        src("gnd", _occupation_label="Professor")])
    assert agg["fields"]["occupations"] == [{"id": "Q2", "label": "jurist"}, {"label": "Professor"}]


def test_seotud_id_d_ja_nende_vastuolu():
    agg = ae.aggregate([src("viaf", _linked_wikidata="Q1", _linked_gnd="5"),
                        src("wikidata", _linked_gnd="6")])
    assert agg["linked"] == {"wikidata": "Q1"}
    assert {c["field"] for c in agg["conflicts"]} == {"identifiers.gnd"}


def test_apply_taidab_ainult_tuhja():
    card = {"gender": "F", "birth": {"date": None}, "occupations": [],
            "name": {"label": "X", "aliases": ["A"]}}
    agg = {"fields": {"gender": "M", "birth": {"date": "1592-01-01", "precision": "year"},
                      "occupations": [{"label": "jurist"}], "name.aliases": ["a", "B"]},
           "conflicts": [], "linked": {}}
    applied = ae.apply_to_card(card, agg)
    assert card["gender"] == "F"
    assert card["birth"]["date"] == "1592-01-01" and card["birth"]["precision"] == "year"
    assert card["occupations"] == [{"label": "jurist"}]
    assert card["name"]["aliases"] == ["A", "B"]  # ühend, NFC+casefold dedup
    assert set(applied) == {"birth.date", "occupations", "name.aliases"}


def test_new_review():
    r = ae.new_review(created_via="picker", context={"work_id": "w", "role": "auctor"},
                      has_enrichable_ids=True, possible_duplicate=True)
    assert r == {"state": "pending", "reasons": ["enrich_pending", "possible_duplicate"],
                 "context": {"work_id": "w", "role": "auctor"}, "created_via": "picker",
                 "auto_filled": [], "source_conflicts": [], "failed_sources": [],
                 "done_by": None, "done_at": None}
    assert ae.new_review(created_via="form", context=None, has_enrichable_ids=False,
                         possible_duplicate=False)["reasons"] == ["no_source"]


def _pending(*extra):
    return ae.new_review(created_via="picker", context=None, has_enrichable_ids=True,
                         possible_duplicate="possible_duplicate" in extra)


def test_finish_review_tabel():
    kw = dict(conflicts=[], possible_duplicate=False)
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=[], applied=["gender"], **kw)
    assert r["reasons"] == ["auto_enriched"] and r["auto_filled"] == ["gender"]
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=["gnd"], applied=["gender"], **kw)
    assert r["reasons"] == ["auto_enriched", "enrich_failed"] and r["failed_sources"] == ["gnd"]
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=[], applied=[], **kw)
    assert r["reasons"] == ["nothing_to_fill"]
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=["gnd"], applied=[], **kw)
    assert r["reasons"] == ["nothing_to_fill", "enrich_failed"]
    r = ae.finish_review(_pending(), ids_left=True, answered=[], failed=["gnd"], applied=[], **kw)
    assert r["reasons"] == ["enrich_failed"]
    r = ae.finish_review(_pending(), ids_left=False, answered=[], failed=[], applied=[], **kw)
    assert r["reasons"] == []


def test_finish_review_sailitab_muud_pohjused_ja_lisab_duplikaadi():
    r = ae.finish_review(_pending("possible_duplicate"), ids_left=True, answered=["wikidata"],
                         failed=[], applied=[], conflicts=[{"field": "x"}], possible_duplicate=True)
    assert r["reasons"] == ["possible_duplicate", "nothing_to_fill"]
    assert r["source_conflicts"] == [{"field": "x"}]
```

- [ ] **Step 2: Käivita — FAIL** (`ModuleNotFoundError: auto_enrich`)

Run: `.venv/bin/pytest tests/test_auto_enrich.py -v`

- [ ] **Step 3: Eralda `fetch_remote` `enrichment.py`-s**

`fetch_and_diff`-i skeemiharud asenda:

```python
def fetch_remote(scheme: str, ext_id: str) -> Optional[dict]:
    """Ühe allika toorvastus (normaliseeritud ID-ga). None = tõrge või tundmatu skeem."""
    ext_id = normalize_ext_id(scheme, ext_id)
    if scheme == "wikidata":
        return _fetch_wikidata(ext_id)
    if scheme == "gnd":
        return _fetch_gnd(ext_id)
    if scheme in ("aa", "album_academicum"):
        return _fetch_aa(ext_id)
    if scheme == "viaf":
        return _fetch_viaf(ext_id)
    return None
```

ja `fetch_and_diff` algus:

```python
    if scheme not in ("wikidata", "gnd", "aa", "album_academicum", "viaf"):
        return {"auto_filled": {}, "conflicts": [], "error": f"Tundmatu skeem: {scheme}"}
    remote = fetch_remote(scheme, ext_id)
```

Run: `.venv/bin/pytest tests/test_enrichment_*.py -q` → PASS (käitumine muutumata).

- [ ] **Step 4: Loo `server/prosopography/auto_enrich.py`**

```python
"""Automaatrikastuse puhas loogika (spekk §4.3, ADR 0048).

Siin ei ole võrku, lukke ega faile — `auto_enrich_runner` teeb need. Reeglid:
  * täidetakse ainult tühja; erandid (ainult lisamise suunas): `name.aliases`
    ühendatakse, seotud ID-d (`linked`) lisab runner;
  * allikatevaheline vastuolu jääb täitmata ja läheb `conflicts`-i;
  * kokkusobiv kuupäev (vähem täpne on täpsema eesliide) → täpsem.
"""
from __future__ import annotations

import unicodedata
from typing import Optional

from .enrichment import _ühenda_variandid

ENRICH_SCHEMES = ("wikidata", "gnd", "viaf", "album_academicum")

_PREC_LEN = {"year": 4, "month": 7, "day": 10}
_PREC_RANK = {"year": 0, "month": 1, "day": 2}


def _norm(v) -> str:
    return unicodedata.normalize("NFC", str(v)).strip().casefold()


def _list_key(item: dict) -> str:
    return item.get("id") or _norm(item.get("label", ""))


def _date_unit(remote: dict, prefix: str) -> Optional[dict]:
    date = remote.get(f"{prefix}.date")
    if not date:
        return None
    return {"date": date, "precision": remote.get(f"{prefix}.precision") or "day"}


def _dates_compatible(a: dict, b: dict) -> Optional[dict]:
    """Tagastab täpsema, kui kokkusobivad; None, kui vastuolus."""
    lo, hi = sorted((a, b), key=lambda d: _PREC_RANK.get(d["precision"], 2))
    n = _PREC_LEN.get(lo["precision"], 10)
    return hi if lo["date"][:n] == hi["date"][:n] else None


def _place(value: dict, scheme: str) -> dict:
    return {"id": value.get("id"), "label": value.get("label"),
            "labels": value.get("labels"), "source": scheme}


def aggregate(sources: list) -> dict:
    """Koondab kõigi vastanud allikate ettepanekud enne ühtegi kirjutust."""
    scalars: dict = {}   # rada → [(scheme, väärtus)]
    lists: dict = {"occupations": [], "confessions": [], "statuses": []}
    aliases: list = []
    linked: dict = {}    # skeem → [(allikas, id)]

    for s in sources:
        scheme, r = s["scheme"], s.get("remote") or {}
        if r.get("gender"):
            scalars.setdefault("gender", []).append((scheme, r["gender"]))
        for prefix in ("birth", "death"):
            unit = _date_unit(r, prefix)
            if unit:
                scalars.setdefault(prefix, []).append((scheme, unit))
            place = r.get(f"{prefix}.place")
            if isinstance(place, dict) and place.get("label"):
                scalars.setdefault(f"{prefix}.place", []).append((scheme, _place(place, scheme)))
        if r.get("aa_raw"):
            scalars.setdefault("aa_raw", []).append((scheme, r["aa_raw"]))
        for occ in r.get("_occupations") or []:
            lists["occupations"].append({k: v for k, v in (("id", occ.get("id")), ("label", occ.get("label"))) if v})
        if r.get("_occupation_label") and not r.get("_occupations"):
            lists["occupations"].append({"label": r["_occupation_label"]})
        for key, target in (("confession", "confessions"), ("status", "statuses")):
            v = r.get(key)
            if isinstance(v, dict) and v.get("label"):
                lists[target].append({k: v[k] for k in ("id", "label") if v.get(k)})
        aliases.extend(r.get("name.aliases") or [])
        for lk, ls in (("_linked_wikidata", "wikidata"), ("_linked_gnd", "gnd")):
            if r.get(lk):
                linked.setdefault(ls, []).append((scheme, str(r[lk])))

    fields: dict = {}
    conflicts: list = []

    for path, vals in scalars.items():
        chosen, clash = vals[0][1], False
        for _, v in vals[1:]:
            if path in ("birth", "death"):
                merged = _dates_compatible(chosen, v)
                if merged is None:
                    clash = True
                    break
                chosen = merged
            elif path.endswith(".place"):
                same = (chosen.get("id") and chosen.get("id") == v.get("id")) or \
                       _norm(chosen.get("label")) == _norm(v.get("label"))
                if not same:
                    clash = True
                    break
            elif _norm(chosen) != _norm(v):
                clash = True
                break
        differs = path in ("birth", "death") and len({(v["date"], v["precision"]) for _, v in vals}) > 1
        if clash or differs:
            field = f"{path}.date" if path in ("birth", "death") else path
            shown = [{"scheme": sc, "value": (v["date"] if path in ("birth", "death") else v)} for sc, v in vals]
            conflicts.append({"field": field, "compatible": not clash, "values": shown})
        if not clash:
            fields[path] = chosen

    for path, items in lists.items():
        out, seen = [], set()
        for it in items:
            k = _list_key(it)
            if k and k not in seen:
                seen.add(k)
                out.append(it)
        if out:
            fields[path] = out

    if aliases:
        fields["name.aliases"] = _ühenda_variandid([], aliases) or []

    linked_out: dict = {}
    for ls, vals in linked.items():
        if len({v for _, v in vals}) == 1:
            linked_out[ls] = vals[0][1]
        else:
            conflicts.append({"field": f"identifiers.{ls}", "compatible": False,
                              "values": [{"scheme": sc, "value": v} for sc, v in vals]})
    return {"fields": fields, "conflicts": conflicts, "linked": linked_out}


def apply_to_card(card: dict, agg: dict) -> list:
    """Rakendab koondatud ettepanekud VÄRSKELE kaardile; ainult tühja. Muteerib."""
    f = agg.get("fields") or {}
    applied: list = []
    if "gender" in f and not card.get("gender"):
        card["gender"] = f["gender"]
        applied.append("gender")
    for prefix in ("birth", "death"):
        obj = card.get(prefix) if isinstance(card.get(prefix), dict) else {}
        if prefix in f and not obj.get("date"):
            obj = {**obj, "date": f[prefix]["date"], "precision": f[prefix]["precision"]}
            applied.append(f"{prefix}.date")
        if f"{prefix}.place" in f and not (obj.get("place") or {}).get("label"):
            obj = {**obj, "place": f[f"{prefix}.place"]}
            applied.append(f"{prefix}.place")
        if obj:
            card[prefix] = obj
    for path in ("occupations", "confessions", "statuses"):
        if path in f and not card.get(path):
            card[path] = f[path]
            applied.append(path)
    if "aa_raw" in f and not (card.get("aa_raw") or "").strip():
        card["aa_raw"] = f["aa_raw"]
        applied.append("aa_raw")
    if f.get("name.aliases"):
        name = card.setdefault("name", {})
        uus = _ühenda_variandid(name.get("aliases") or [], f["name.aliases"])
        if uus is not None:
            name["aliases"] = uus
            applied.append("name.aliases")
    return applied


def new_review(*, created_via: str, context: Optional[dict],
               has_enrichable_ids: bool, possible_duplicate: bool) -> dict:
    reasons = ["enrich_pending"] if has_enrichable_ids else ["no_source"]
    if possible_duplicate:
        reasons.append("possible_duplicate")
    return {"state": "pending", "reasons": reasons, "context": context,
            "created_via": created_via, "auto_filled": [], "source_conflicts": [],
            "failed_sources": [], "done_by": None, "done_at": None}


def finish_review(review: dict, *, ids_left: bool, answered: list, failed: list,
                  applied: list, conflicts: list, possible_duplicate: bool) -> dict:
    """Lõppolek (spekk §4.3 tabel). `enrich_pending` eemaldub ALATI."""
    r = {**review}
    reasons = [x for x in r.get("reasons") or [] if x != "enrich_pending"]
    if possible_duplicate and "possible_duplicate" not in reasons:
        reasons.append("possible_duplicate")
    if ids_left:
        if answered:
            reasons.append("auto_enriched" if applied else "nothing_to_fill")
        if failed:
            reasons.append("enrich_failed")
            r["failed_sources"] = list(dict.fromkeys((r.get("failed_sources") or []) + failed))
    r["reasons"] = reasons
    r["auto_filled"] = list(dict.fromkeys((r.get("auto_filled") or []) + applied))
    r["source_conflicts"] = (r.get("source_conflicts") or []) + conflicts
    return r
```

- [ ] **Step 5: Käivita — PASS**

Run: `.venv/bin/pytest tests/test_auto_enrich.py -v`
Kui `test_kokkusobiv_kuupaev_votab_tapsema` või `test_allikatevaheline_vastuolu_jaab_taitmata` kukub, kontrolli `aggregate` kuupäevaharu: vastuolu → `compatible: False`, välja ei ole; kokkusobiv erinev → `compatible: True`, väli = täpsem.

- [ ] **Step 6: Commit**

```bash
git add server/prosopography/enrichment.py server/prosopography/auto_enrich.py tests/test_auto_enrich.py
git commit -m "feat(prosopo): automaatrikastuse puhas loogika — koondamine, vastuolud, lõppolek

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `create_person_checked` + `POST /prosopography/persons/create`

**Files:**
- Modify: `server/prosopography/person_crud.py` (eralda `_new_person_skeleton`, `_apply_card_update`; uus `create_person_checked`)
- Modify: `server/prosopography/router.py` (uus route; vana `POST ""` delegeerib)
- Test: `tests/test_prosopo_create_checked.py` (uus)

**Interfaces:**
- Consumes: `ext_id_claim_lock`, `_check_identifiers_free`, `IdentifierConflict` (Task 2); `strip_server_fields` (Task 3); `auto_enrich.new_review`, `ENRICH_SCHEMES` (Task 4); `_save_person_locked` (Task 1).
- Produces: `person_crud.create_person_checked(*, username: str, created_via: str, name: Optional[str] = None, identifiers: Optional[list] = None, aliases: Optional[list] = None, note: Optional[str] = None, card: Optional[dict] = None, context: Optional[dict] = None) -> dict` — viskab `ValueError("card_and_fields")`, `ValueError("name_required")`, `IdentifierConflict`.
- Produces: `person_crud.set_enrichment_scheduler(fn: Callable[[str], None]) -> None` (Task 6 registreerib; vaikimisi no-op — hoiab `person_crud`-i runnerist sõltumatuna ja testid ilma lõimedeta).
- Produces: `POST /prosopography/persons/create` (editor+) → 200 kaart | 400 | 409 (`_identifier_conflict_http`).

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid**

```python
"""Isiku loomine ühe sammuga (spekk §4.2)."""
import pytest

from server.prosopography import person_crud
from server.prosopography.person_crud import IdentifierConflict


@pytest.fixture
def ajastatud(monkeypatch):
    jarjekord = []
    person_crud.set_enrichment_scheduler(jarjekord.append)
    yield jarjekord
    person_crud.set_enrichment_scheduler(lambda pid: None)


@pytest.fixture(autouse=True)
def sarnasusteta(monkeypatch):
    monkeypatch.setattr(person_crud, "_has_similar_name", lambda label, exclude=None: False)


def test_paneeli_loomine_margiga_ja_ajastatud(prosopo_env, ajastatud):
    p = person_crud.create_person_checked(
        username="u", created_via="picker", name="Laurentius Ludenius",
        identifiers=[{"scheme": "wikidata", "id": "Q1870103"}], aliases=["Lorenz Luden"],
        context={"work_id": "w1", "role": "praeses"})
    assert p["name"]["label"] == "Laurentius Ludenius"
    assert p["name"]["aliases"] == ["Lorenz Luden"]
    assert p["review"]["reasons"] == ["enrich_pending"]
    assert p["review"]["context"] == {"work_id": "w1", "role": "praeses"}
    assert ajastatud == [p["id"]]


def test_allikata_loomine_no_source_ja_ei_ajastata(prosopo_env, ajastatud):
    p = person_crud.create_person_checked(username="u", created_via="picker",
                                          name="Andreas Malmenius", note="respondent 1645")
    assert p["review"]["reasons"] == ["no_source"] and p["notes"] == "respondent 1645"
    assert ajastatud == []


def test_vormi_card_uhe_sammuga_ja_serveriväljad_maha(prosopo_env, ajastatud):
    p = person_crud.create_person_checked(username="u", created_via="form", card={
        "name": {"label": "X", "aliases": []}, "gender": "M", "notes": "n",
        "identifiers": [{"scheme": "gnd", "id": "GND:5"}],
        "review": {"state": "done"}, "id": "vutt:Phack", "created_by": "keegi"})
    kaart = prosopo_env.read(p["id"].removeprefix("vutt:P"))
    assert kaart["gender"] == "M" and kaart["identifiers"][0]["id"] == "5"
    assert kaart["review"]["state"] == "pending" and kaart["created_by"] == "u"
    assert p["id"] != "vutt:Phack"


def test_card_ja_tipuvali_korraga_on_viga(prosopo_env):
    with pytest.raises(ValueError, match="card_and_fields"):
        person_crud.create_person_checked(username="u", created_via="form",
                                          card={"name": {"label": "X"}}, name="Y")


def test_normaliseerimata_olemasolev_id_on_exists(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "123"}])
    with pytest.raises(IdentifierConflict) as e:
        person_crud.create_person_checked(username="u", created_via="picker", name="X",
                                          identifiers=[{"scheme": "gnd", "id": "GND:123"}])
    assert (e.value.kind, e.value.person_ids) == ("exists", ["vutt:Paaa"])


def test_id_ainult_card_is_kontrollitakse_samuti(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    with pytest.raises(IdentifierConflict):
        person_crud.create_person_checked(username="u", created_via="form", card={
            "name": {"label": "X"}, "identifiers": [{"scheme": "wikidata", "id": "Q1"}]})


def test_split_kui_id_d_eri_kaartidel(prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}])
    prosopo_env.write("bbb", identifiers=[{"scheme": "gnd", "id": "2"}])
    with pytest.raises(IdentifierConflict) as e:
        person_crud.create_person_checked(username="u", created_via="picker", name="X",
            identifiers=[{"scheme": "wikidata", "id": "Q1"}, {"scheme": "gnd", "id": "2"}])
    assert e.value.kind == "split" and set(e.value.person_ids) == {"vutt:Paaa", "vutt:Pbbb"}


def test_sarnane_nimi_lisab_possible_duplicate(prosopo_env, monkeypatch):
    monkeypatch.setattr(person_crud, "_has_similar_name", lambda label, exclude=None: True)
    p = person_crud.create_person_checked(username="u", created_via="picker", name="X")
    assert p["review"]["reasons"] == ["no_source", "possible_duplicate"]


def test_route_409_exists(client, login, prosopo_env):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "123"}])
    token = login("editor", "editorpass")
    r = client.post("/prosopography/persons/create", json={
        "name": "X", "identifiers": [{"scheme": "gnd", "id": "123"}], "created_via": "picker"},
        headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 409
    assert r.json()["detail"]["existing_person_id"] == "vutt:Paaa"
```

- [ ] **Step 2: Käivita — FAIL** (`AttributeError: create_person_checked`)

Run: `.venv/bin/pytest tests/test_prosopo_create_checked.py -v`

- [ ] **Step 3: Eralda `_new_person_skeleton` `create_person`-ist**

`create_person` kehast tõsta `person = {...}` sõnastiku ehitus (ridadelt `nanoid = state.generate_nanoid()` kuni `"source_data": {},\n    }`) muutmata kujul uude funktsiooni:

```python
def _new_person_skeleton(data: dict, username: str) -> dict:
    """Uue kaardi põhi (ei salvesta). Väljade kuju on sama mis create_person-il."""
    nanoid = state.generate_nanoid()
    person_id = f"vutt:P{nanoid}"
    now = datetime.now(timezone.utc).isoformat()
    person = {
        # … senine sõnastik muutmata …
    }
    return person
```

`create_person` muutub:

```python
def create_person(data: dict, username: str) -> dict:
    """Madala taseme loomine (ilma ID-kontrolli ja ülevaatusmärketa) — ainult
    create_person_checked ja testid kasutavad. Uus kood kutsub create_person_checked-i."""
    sync_from_facade()
    person = _new_person_skeleton(data, username)
    os.makedirs(state.PROSOPOGRAPHY_DIR, exist_ok=True)
    fill_person_labels_from_registry(person)
    name = (person.get("name") or {}).get("label") or person["id"]
    with person_lock(person["id"]):
        _save_person_locked(person, username, f"Prosopo loomine: {name} [{person['id']}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
    return person
```

- [ ] **Step 4: Eralda `_apply_card_update` `update_person`-ist**

`update_person` luku seest tõsta read alates `for key in ("id", "created_at", "created_by", …) + SECRET_FIELDS: data.pop(key, None)` kuni päritolukoha plokini (`person["origin"] = {**origin, "place": None, …}`) KAASA ARVATUD uude funktsiooni; `person["updated_at"] = now` / `person["updated_by"] = username` jäävad `update_person`-i:

```python
def _apply_card_update(person: dict, data: dict, now: str) -> None:
    """Kliendi kaardisisu rakendamine (update_person JA create_person_checked).

    Viskab kliendi serverivälja, ankrud, pärandvälja; normaliseerib ID-d;
    kinnitab tõlke; rikastab päritolukoha. Muteerib `person`-it.
    """
    # … tõstetud read muutmata; `person["updated_at"] = now` ja
    # `person["updated_by"] = username` jäävad kutsujasse …
```

`update_person` kutsub selle asemel `_apply_card_update(person, data, now)` ja seab seejärel `updated_at`/`updated_by`. Task 2 ID-kontroll (`_check_identifiers_free(... _added_identifiers ...)`) jääb `update_person`-i, ENNE `_apply_card_update`-i kutset, arvutatuna `_normalize_identifiers(data["identifiers"])` pealt.

Run: `.venv/bin/pytest tests/test_prosopo_*.py -q` → PASS (refaktor ei muuda käitumist).

- [ ] **Step 5: Lisa `create_person_checked` + planeerija + sarnasus**

```python
_enrichment_scheduler = lambda person_id: None  # noqa: E731 — Task 6 registreerib


def set_enrichment_scheduler(fn) -> None:
    """auto_enrich_runner registreerib käivitusel; testid asendavad."""
    global _enrichment_scheduler
    _enrichment_scheduler = fn


def _has_similar_name(label: str, exclude: Optional[str] = None) -> bool:
    """Nimepõhine sarnasus (sama mis vormi SimilarPersonsWarning). Server otsustab
    ise — kliendi väidet `possible_duplicate` kohta ei usaldata (spekk §4.2)."""
    from .person_search import list_persons
    if len((label or "").strip()) < 3:
        return False
    res = list_persons(q=label.strip(), limit=5)
    return any(r.get("id") != exclude and r.get("record_status") != "tombstone"
               for r in res.get("results") or [])


def create_person_checked(*, username: str, created_via: str, name: Optional[str] = None,
                          identifiers: Optional[list] = None, aliases: Optional[list] = None,
                          note: Optional[str] = None, card: Optional[dict] = None,
                          context: Optional[dict] = None) -> dict:
    """Uue kaardi AINUS loomistee (spekk §4.2): üks allikas (card VÕI tipuväljad),
    lõplik kaart enne kontrolli, ID-lukk üle kontrolli + salvestuse, ülevaatusmärge,
    rikastus järjekorda alles pärast salvestust."""
    from .auto_enrich import ENRICH_SCHEMES, new_review

    sync_from_facade()
    if card is not None and any(v is not None for v in (name, identifiers, aliases, note)):
        raise ValueError("card_and_fields")

    now = datetime.now(timezone.utc).isoformat()
    if card is not None:
        label = ((card.get("name") or {}).get("label") or "").strip()
        person = _new_person_skeleton({"name": label}, username)
        _apply_card_update(person, strip_server_fields(dict(card)), now)
    else:
        label = (name or "").strip()
        person = _new_person_skeleton({"name": label, "notes": note}, username)
        person["identifiers"] = _normalize_identifiers(identifiers or [])
        person["name"]["aliases"] = [a for a in dict.fromkeys(aliases or []) if a and a != label]
    if not (person.get("name") or {}).get("label"):
        raise ValueError("name_required")

    enrichable = any(isinstance(i, dict) and i.get("scheme") in ENRICH_SCHEMES
                     for i in person.get("identifiers") or [])
    person["review"] = new_review(created_via=created_via, context=context,
                                  has_enrichable_ids=enrichable,
                                  possible_duplicate=_has_similar_name(label))
    os.makedirs(state.PROSOPOGRAPHY_DIR, exist_ok=True)
    fill_person_labels_from_registry(person)
    with ext_id_claim_lock:
        # Kontroll käib just salvestatavate (normaliseeritud) ID-de peal.
        _check_identifiers_free(None, person.get("identifiers") or [])
        with person_lock(person["id"]):
            _save_person_locked(person, username,
                                f"Prosopo loomine: {label} [{person['id']}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
    if enrichable:
        _enrichment_scheduler(person["id"])
    return person
```

Lisa `create_person_checked`, `set_enrichment_scheduler` `__all__`-i ja `ops.py` re-eksporti.

- [ ] **Step 6: Router — uus route ja vana delegeerib**

`server/prosopography/router.py` rea `@router.post("")` ette:

```python
_ALLOWED_CREATED_VIA = ("picker", "form")


@router.post("/persons/create")
async def prosopography_create_checked(request: Request, user=Depends(require_role("editor"))):
    """Isiku loomine ühe sammuga (spekk §4.2): paneel saadab tipuväljad, vorm `card`-i."""
    data = await request.json()
    created_via = data.get("created_via") if data.get("created_via") in _ALLOWED_CREATED_VIA else "form"
    try:
        person = await run_in_threadpool(
            lambda: create_person_checked(
                username=user["username"], created_via=created_via,
                name=data.get("name"), identifiers=data.get("identifiers"),
                aliases=data.get("aliases"), note=data.get("note"),
                card=data.get("card"), context=data.get("context")))
    except IdentifierConflict as e:
        raise _identifier_conflict_http(e)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    enrich_entity_labels_from_person_async(person)
    return person
```

Vana `prosopography_create` keha: `create_person(data, …)` → `create_person_checked(username=…, created_via="form", name=data.get("name"), identifiers=data.get("identifiers"), note=data.get("notes"))` + samad `except`-id. (`birth_year`/`death_year` vanast kehast ei kasutata — ainus kutsuja oli frontend, mis Task 8-s läheb üle.)

- [ ] **Step 7: PASS + täis pytest + commit**

Run: `.venv/bin/pytest tests/test_prosopo_create_checked.py -v` → PASS; `.venv/bin/pytest tests/ -q` → PASS

```bash
git add server/prosopography/person_crud.py server/prosopography/router.py server/prosopography/ops.py tests/test_prosopo_create_checked.py
git commit -m "feat(prosopo): isiku loomine ühe sammuga — ID-kontroll, ülevaatusmärge (spekk §4.2)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Taustarikastus — runner, executor, käivitustaaste

**Files:**
- Create: `server/prosopography/auto_enrich_runner.py`
- Modify: `server/main.py` (lifespan)
- Test: `tests/test_auto_enrich_runner.py` (uus)

**Interfaces:**
- Consumes: `fetch_remote` (Task 4), `aggregate`, `apply_to_card`, `finish_review`, `ENRICH_SCHEMES` (Task 4); `ext_id_claim_lock`, `_check_identifiers_free`/`_find_by_external_id`/`_resolve_owner` (Task 2); `_save_person_locked` (Task 1); `set_enrichment_scheduler` (Task 5).
- Produces: `run_auto_enrichment(person_id: str) -> Optional[dict]` (sünkroonne, testitav), `schedule_auto_enrichment(person_id: str) -> None`, `recover_pending() -> int`, `start() -> None` (registreerib planeerija + käivitab taaste taustalõimes).

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid**

```python
"""Taustarikastus (spekk §4.3): võrk lukust väljas, ID kehtivus, lõppolek, taaste."""
from server.prosopography import auto_enrich_runner as runner
from server.prosopography.auto_enrich import new_review

PENDING = new_review(created_via="picker", context=None, has_enrichable_ids=True,
                     possible_duplicate=False)


def remote(monkeypatch, vastused):
    monkeypatch.setattr(runner, "fetch_remote", lambda s, i: vastused.get((s, i)))


def test_taidab_tuhjad_ja_seab_lopu(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}],
                      gender=None, birth={"date": None}, review=PENDING)
    remote(monkeypatch, {("wikidata", "Q1"): {"gender": "M", "birth.date": "1592-01-01",
                                               "birth.precision": "year"}})
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["gender"] == "M" and k["birth"]["date"] == "1592-01-01"
    assert k["review"]["reasons"] == ["auto_enriched"]
    assert set(k["review"]["auto_filled"]) == {"gender", "birth.date"}


def test_paringu_ajal_eemaldatud_id_andmeid_ei_rakendata(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}],
                      gender=None, review=PENDING)

    def fetch(s, i):
        # Kasutaja eemaldab eksliku ID päringu ajal.
        k = prosopo_env.read("aaa")
        prosopo_env.write("aaa", **{**k, "identifiers": []})
        return {"gender": "M"}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["gender"] is None and k["review"]["reasons"] == []


def test_paringu_ajal_liidetud_kaardile_ei_kirjutata(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}], review=PENDING)

    def fetch(s, i):
        k = prosopo_env.read("aaa")
        prosopo_env.write("aaa", **{**k, "record_status": "tombstone", "merged_into": "vutt:Pzzz"})
        return {"gender": "M"}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    before = prosopo_env.read("aaa")
    runner.run_auto_enrichment("vutt:Paaa")
    assert prosopo_env.read("aaa") == {**before, "record_status": "tombstone", "merged_into": "vutt:Pzzz"}


def test_vahepealne_kasitsi_muudatus_jaab_alles(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}],
                      gender=None, notes=None, review=PENDING)

    def fetch(s, i):
        k = prosopo_env.read("aaa")
        prosopo_env.write("aaa", **{**k, "notes": "käsitsi", "gender": "F"})
        return {"gender": "M"}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert (k["notes"], k["gender"]) == ("käsitsi", "F")
    assert k["review"]["reasons"] == ["nothing_to_fill"]


def test_osaline_onnestumine(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"},
                                          {"scheme": "gnd", "id": "5"}],
                      gender=None, review=PENDING)
    remote(monkeypatch, {("wikidata", "Q1"): {"gender": "M"}})
    runner.run_auto_enrichment("vutt:Paaa")
    r = prosopo_env.read("aaa")["review"]
    assert r["reasons"] == ["auto_enriched", "enrich_failed"] and r["failed_sources"] == ["gnd"]


def test_seotud_id_teisel_kaardil_ei_lisata(prosopo_env, monkeypatch):
    prosopo_env.write("bbb", identifiers=[{"scheme": "gnd", "id": "5"}])
    prosopo_env.write("aaa", identifiers=[{"scheme": "viaf", "id": "9"}], review=PENDING)
    remote(monkeypatch, {("viaf", "9"): {"_linked_gnd": "5", "_linked_wikidata": "Q7"}})
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert {(i["scheme"], i["id"]) for i in k["identifiers"]} == {("viaf", "9"), ("wikidata", "Q7")}
    assert "possible_duplicate" in k["review"]["reasons"]
    assert "identifiers" in k["review"]["auto_filled"]


def test_voork_ei_ole_luku_all(prosopo_env, monkeypatch):
    from server.prosopography.locks import person_lock
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}], review=PENDING)
    vaba = {}

    def fetch(s, i):
        vaba["v"] = person_lock("vutt:Paaa").acquire(blocking=False)
        if vaba["v"]:
            person_lock("vutt:Paaa").release()
        return {}

    monkeypatch.setattr(runner, "fetch_remote", fetch)
    runner.run_auto_enrichment("vutt:Paaa")
    assert vaba["v"] is True


def test_taaste_ajastab_ainult_pooleli_aktiivsed(prosopo_env, monkeypatch):
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q1"}], review=PENDING)
    prosopo_env.write("bbb", review={**PENDING, "reasons": ["auto_enriched"]})
    prosopo_env.write("ccc", review=PENDING, record_status="tombstone", merged_into="vutt:Paaa")
    prosopo_env.write("ddd")
    ajastatud = []
    monkeypatch.setattr(runner, "schedule_auto_enrichment", ajastatud.append)
    assert runner.recover_pending() == 1 and ajastatud == ["vutt:Paaa"]
```

- [ ] **Step 2: Käivita — FAIL** (`ModuleNotFoundError: auto_enrich_runner`)

Run: `.venv/bin/pytest tests/test_auto_enrich_runner.py -v`

- [ ] **Step 3: Loo `server/prosopography/auto_enrich_runner.py`**

```python
"""Taustarikastus (spekk §4.3, ADR 0048): võrk ja lukud; loogika on auto_enrich-is.

Järjekord: allikad VÄLJASPOOL lukke → ID-lukk + person_lock → kaart uuesti,
ID-de kehtivus, rakendamine, review, üks salvestus. `enrich_pending` märge on
töö püsiv jälg: iga lõppenud katse eemaldab selle, käivitusel korratakse jäänuid.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from . import state
from ._compat import sync_from_facade
from .auto_enrich import ENRICH_SCHEMES, aggregate, apply_to_card, finish_review
from .enrichment import fetch_remote
from .ext_ids import normalize_ext_id
from .locks import ext_id_claim_lock, person_lock

logger = logging.getLogger(__name__)

# Kaks lõime: välisallikad on aeglased, aga koormus on väike (loomise tempo).
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="auto-enrich")


def _crud():
    from . import person_crud
    return person_crud


def _is_dead(card: Optional[dict]) -> bool:
    return card is None or bool(card.get("merged_into")) or card.get("record_status") == "tombstone"


def _pairs(card: dict) -> set:
    return {(i.get("scheme"), normalize_ext_id(i.get("scheme"), i.get("id")))
            for i in card.get("identifiers") or [] if isinstance(i, dict)}


def run_auto_enrichment(person_id: str) -> Optional[dict]:
    crud = _crud()
    sync_from_facade()
    card = crud.get_person(person_id)
    if _is_dead(card):
        return None
    targets = [(s, i) for s, i in _pairs(card) if s in ENRICH_SCHEMES and i]

    # 1. Võrk — ühegi luku all EI OLE.
    answered, failed = [], []
    for scheme, ext_id in targets:
        try:
            remote = fetch_remote(scheme, ext_id)
        except Exception:
            logger.warning("Automaatrikastus: %s %s:%s ebaõnnestus", person_id, scheme, ext_id, exc_info=True)
            remote = None
        if remote is None:
            failed.append((scheme, ext_id))
        else:
            answered.append({"scheme": scheme, "id": ext_id, "remote": remote})

    # 2–3. Lukkude all: värske kaart, kehtivus, rakendamine, üks salvestus.
    with ext_id_claim_lock, person_lock(person_id):
        card = crud.get_person(person_id)
        if _is_dead(card):
            return None
        alles = _pairs(card)
        answered = [a for a in answered if (a["scheme"], a["id"]) in alles]
        failed = [f for f in failed if f in alles]
        ids_left = any(p in alles for p in targets)

        agg = aggregate(answered)
        applied = apply_to_card(card, agg)
        dup = False
        have = {s for s, _ in alles}
        for scheme, ext_id in agg["linked"].items():
            if scheme in have:
                continue
            found = crud._find_by_external_id(scheme, ext_id)
            owner = crud._resolve_owner(found["id"]) if found else None
            if owner and owner != person_id:
                dup = True
                continue
            card.setdefault("identifiers", []).append({"scheme": scheme, "id": normalize_ext_id(scheme, ext_id), "checked_at": None})
            if "identifiers" not in applied:
                applied.append("identifiers")

        review = card.get("review") or {}
        card["review"] = finish_review(
            review, ids_left=ids_left,
            answered=[a["scheme"] for a in answered], failed=[s for s, _ in failed],
            applied=applied, conflicts=agg["conflicts"], possible_duplicate=dup)
        author = card.get("created_by") or "Automaatne"
        card["updated_at"] = datetime.now(timezone.utc).isoformat()
        card["updated_by"] = author
        name = (card.get("name") or {}).get("label") or person_id
        crud._save_person_locked(card, author, f"Automaatne rikastus: {name} [{person_id}]")
    crud._indices()._update_index_entry(card)
    crud._indices()._update_aliases_entry(card)
    return card


def _run_safely(person_id: str) -> None:
    try:
        run_auto_enrichment(person_id)
    except Exception:
        # enrich_pending jääb alles → järgmine käivitus kordab.
        logger.error("Automaatrikastus kukkus: %s", person_id, exc_info=True)


def schedule_auto_enrichment(person_id: str) -> None:
    _executor.submit(_run_safely, person_id)


def recover_pending() -> int:
    """Ajastab kaardid, kus `enrich_pending` jäi (katse ei jõudnud lõpule)."""
    sync_from_facade()
    n = 0
    for path in glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                card = json.load(f)
        except Exception:
            continue
        if _is_dead(card) or "enrich_pending" not in ((card.get("review") or {}).get("reasons") or []):
            continue
        schedule_auto_enrichment(card["id"])
        n += 1
    return n


def start() -> None:
    """Lifespan: registreeri planeerija ja käivita taaste taustalõimes."""
    _crud().set_enrichment_scheduler(schedule_auto_enrichment)

    def _taaste():
        try:
            n = recover_pending()
            if n:
                logger.info("Automaatrikastus: %d pooleliolevat kaarti järjekorda", n)
        except Exception:
            logger.error("Automaatrikastuse taaste ebaõnnestus", exc_info=True)

    threading.Thread(target=_taaste, daemon=True, name="auto-enrich-recover").start()
```

`recover_pending` testis kasutab `runner.schedule_auto_enrichment` monkeypatchi — `recover_pending` peab kutsuma moodulitasandi nime (nagu ülal), mitte kinni püütud viidet.

- [ ] **Step 4: Käivita — PASS**

Run: `.venv/bin/pytest tests/test_auto_enrich_runner.py -v`

- [ ] **Step 5: Lifespan — `server/main.py`**

Rea `threading.Thread(target=rebuild_indices, daemon=True).start()` järele:

```python
    # Isikukaartide automaatrikastus (ADR 0048): planeerija + pooleliolevate taaste.
    from .prosopography import auto_enrich_runner
    auto_enrich_runner.start()
```

- [ ] **Step 6: Täis pytest + commit**

Run: `.venv/bin/pytest tests/ -q` → PASS

```bash
git add server/prosopography/auto_enrich_runner.py server/main.py tests/test_auto_enrich_runner.py
git commit -m "feat(prosopo): taustarikastus — võrk lukust väljas, ID kehtivus, lõppolek, taaste

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Serveri stub'id läbi sama loomistee

**Files:**
- Modify: `server/prosopography/person_crud.py` (`ensure_prosopo_for_entity`, `ensure_prosopo_stubs`)
- Modify: `server/metadata_ops.py:206-208`, `server/upload/import_work.py:439-443`
- Test: `tests/test_prosopo_stub_review.py` (uus)

**Interfaces:**
- Consumes: `create_person_checked`, `IdentifierConflict` (Task 5/2).
- Produces: `ensure_prosopo_stubs(updates: dict, username: str, work_id: Optional[str] = None) -> dict`; `ensure_prosopo_for_entity(entity: dict, username: str, work_id: Optional[str] = None, role: Optional[str] = None) -> dict`.

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid**

```python
"""Metaandmete salvestuse/impordi stub'id saavad märke ja rikastuse (spekk §4.4)."""
import pytest

from server.prosopography import person_crud


@pytest.fixture
def ajastatud():
    j = []
    person_crud.set_enrichment_scheduler(j.append)
    yield j
    person_crud.set_enrichment_scheduler(lambda pid: None)


@pytest.fixture(autouse=True)
def sarnasusteta(monkeypatch):
    monkeypatch.setattr(person_crud, "_has_similar_name", lambda label, exclude=None: False)


def test_stub_saab_margi_konteksti_ja_ei_tee_voorku(prosopo_env, ajastatud, monkeypatch):
    monkeypatch.setattr("server.prosopography.enrichment.fetch_remote",
                        lambda *a: pytest.fail("stub-tee ei tohi sünkroonselt võrku minna"))
    out = person_crud.ensure_prosopo_stubs(
        {"creators": [{"id": "Q1870103", "label": "Lorenz Luden", "source": "wikidata", "role": "praeses"}]},
        "u", work_id="w1")
    pid = out["creators"][0]["id"]
    kaart = prosopo_env.read(pid.removeprefix("vutt:P"))
    assert kaart["review"]["created_via"] == "server_stub"
    assert kaart["review"]["context"] == {"work_id": "w1", "role": "praeses"}
    assert ajastatud == [pid]


def test_olemasolev_id_seotakse_ilma_uue_kaardita(prosopo_env, ajastatud):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "5"}])
    out = person_crud.ensure_prosopo_for_entity({"id": "GND:5", "label": "X", "source": "gnd"}, "u")
    assert out["id"] == "vutt:Paaa" and ajastatud == []
```

- [ ] **Step 2: Käivita — FAIL** (`TypeError: unexpected keyword 'work_id'` / `KeyError: 'review'`)

Run: `.venv/bin/pytest tests/test_prosopo_stub_review.py -v`

- [ ] **Step 3: Asenda `ensure_prosopo_for_entity` loomisosa**

`existing = _find_by_external_id(scheme, eid)` järel:

```python
    if existing:
        return {**entity, "id": existing["id"]}

    label = (entity.get("label") or entity.get("name") or eid).strip()
    context = {"work_id": work_id, "role": role or entity.get("role")} if work_id else None
    try:
        stub = create_person_checked(
            username=username, created_via="server_stub", name=label,
            identifiers=[{"scheme": scheme, "id": eid}], context=context)
    except IdentifierConflict as e:
        # Võidujooks: keegi lõi sama ID-ga kaardi vahepeal. `split` ei saa siin
        # tekkida (üks ID), aga kui tekib, jäta entiteet sidumata ja logi.
        if e.kind == "exists":
            return {**entity, "id": e.person_ids[0]}
        state.logger.warning("Stub: %s:%s konflikt %s", scheme, eid, e.person_ids)
        return entity
    return {**entity, "id": stub["id"]}
```

Signatuur: `def ensure_prosopo_for_entity(entity: dict, username: str, work_id: Optional[str] = None, role: Optional[str] = None) -> dict:`.

`ensure_prosopo_stubs(updates, username, work_id=None)`: iga `ensure_prosopo_for_entity(c, username)` kutse → `ensure_prosopo_for_entity(c, username, work_id=work_id)` (creators: `role` tuleb `c.get("role")`-st funktsiooni sees; tags → `role="subject"`; publisher → `role="publisher"`).

- [ ] **Step 4: Kutsujad annavad `work_id`**

`server/metadata_ops.py` rea `updates = ensure_prosopo_stubs(updates, username)` asemel:

```python
        updates = ensure_prosopo_stubs(updates, username, work_id=_read_work_id(meta_path))
```

ja faili abifunktsioon (moodulitasandil):

```python
def _read_work_id(meta_path: str):
    """Teose id stub-kaardi konteksti jaoks; puuduv/katkine fail → None (kontekst on valikuline)."""
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            return (json.load(f) or {}).get("id")
    except Exception:
        return None
```

(kontrolli, et `json` on `metadata_ops.py`-s imporditud.)

`server/upload/import_work.py`: `ensure_prosopo_stubs(metadata, username)` → `ensure_prosopo_stubs(metadata, username, work_id=work_id)`.

- [ ] **Step 5: PASS + täis pytest + commit**

Run: `.venv/bin/pytest tests/test_prosopo_stub_review.py -v` → PASS; `.venv/bin/pytest tests/ -q` → PASS

```bash
git add server/prosopography/person_crud.py server/metadata_ops.py server/upload/import_work.py tests/test_prosopo_stub_review.py
git commit -m "feat(prosopo): serveri stub'id läbi create_person_checked — märge, kontekst, rikastus

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Frontend — valija ja vorm uue otspunkti kaudu

**Files:**
- Modify: `src/prosopography/services/prosopographyService.ts`
- Modify: `src/components/EntityPicker.tsx:364-432`
- Modify: `src/prosopography/pages/PersonEditPage.tsx:221-231`
- Test: `src/prosopography/services/__tests__/createPersonChecked.test.ts` (uus)

**Interfaces:**
- Consumes: `POST /prosopography/persons/create` (Task 5).
- Produces: `createPersonChecked(body: CreatePersonBody, token: string): Promise<ProsopoRecord>`; `class PersonConflictError extends Error { conflict: 'exists' | 'split'; existingPersonIds: string[] }`.

- [ ] **Step 1: Kirjuta ebaõnnestuv test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createPersonChecked, PersonConflictError } from '../prosopographyService';

afterEach(() => vi.unstubAllGlobals());

describe('createPersonChecked', () => {
  it('409 exists → PersonConflictError koos olemasoleva id-ga', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      detail: { error: 'identifier_conflict', conflict: 'exists',
                existing_person_ids: ['vutt:Paaa'], existing_person_id: 'vutt:Paaa' },
    }), { status: 409 })));
    const err = await createPersonChecked({ name: 'X', created_via: 'picker' }, 't').catch(e => e);
    expect(err).toBeInstanceOf(PersonConflictError);
    expect(err.conflict).toBe('exists');
    expect(err.existingPersonIds).toEqual(['vutt:Paaa']);
  });

  it('saadab keha muutmata', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'vutt:Pnew' }), { status: 200 }));
    vi.stubGlobal('fetch', f);
    await createPersonChecked({ card: { name: { label: 'X' } } as any, created_via: 'form' }, 't');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/prosopography\/persons\/create$/);
    expect(JSON.parse(init.body as string)).toEqual({ card: { name: { label: 'X' } }, created_via: 'form' });
  });
});
```

- [ ] **Step 2: Käivita — FAIL**

Run: `npx vitest run src/prosopography/services/__tests__/createPersonChecked.test.ts`
Expected: FAIL — `createPersonChecked` puudub.

- [ ] **Step 3: Lisa `prosopographyService.ts`-sse `createPerson` järele**

```ts
export interface CreatePersonBody {
  created_via: 'picker' | 'form';
  name?: string;
  identifiers?: { scheme: string; id: string }[];
  aliases?: string[];
  note?: string;
  card?: Partial<ProsopoRecord>;
  context?: { work_id: string; role?: string };
}

/** Välise ID konflikt loomisel (spekk §4.2): `exists` = üks kaart, `split` = ID-d eri kaartidel. */
export class PersonConflictError extends Error {
  constructor(public conflict: 'exists' | 'split', public existingPersonIds: string[]) {
    super(`person_conflict:${conflict}`);
  }
}

/** Isiku loomine ühe sammuga — ainus loomistee (server paneb ülevaatusmärke). */
export async function createPersonChecked(body: CreatePersonBody, token: string): Promise<ProsopoRecord> {
  const resp = await fetchWithTimeout(`${BASE}/persons/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify(body),
    timeout: 15000,
  });
  if (resp.status === 409) {
    const err = await resp.json().catch(() => ({}));
    const d = err?.detail ?? {};
    if (d.error === 'identifier_conflict') {
      throw new PersonConflictError(d.conflict, d.existing_person_ids ?? []);
    }
  }
  if (!resp.ok) throw new Error(`createPersonChecked: ${resp.status}`);
  return resp.json();
}
```

(Kontrolli `BASE` väärtust failis — kui see on juba `.../prosopography`, on URL `${BASE}/persons/create`.)

- [ ] **Step 4: `EntityPicker.tsx` — kolm `createPerson` kutset**

Lisa komponendi sisse abi:

```ts
  /** Loob kaardi ühe ID-ga või võtab olemasoleva (409 exists). split / muu viga → null. */
  const looVoiLeia = async (label: string, scheme: string, id: string) => {
    try {
      const record = await createPersonChecked({
        name: label, identifiers: [{ scheme, id }], created_via: 'picker',
      }, token!);
      return { id: record.id, label: record.name.label };
    } catch (e) {
      if (e instanceof PersonConflictError && e.conflict === 'exists') {
        const olemas = await getPerson(e.existingPersonIds[0]).catch(() => null);
        return { id: e.existingPersonIds[0], label: olemas?.name?.label ?? label };
      }
      return null;
    }
  };
```

ja iga haru (`GND`, `VIAF`, Wikidata) `try { const record = await createPerson(...); entity = {...record...} } catch { entity = {...fallback...} }` asemel:

```ts
        const r = await looVoiLeia(label, 'gnd', normalizeExtId('gnd', gndId));
        entity = r
          ? { id: r.id, label: r.label, source: 'local', entity_type: 'person', labels: { et: r.label } }
          : { id: result.id, label, source: 'gnd', labels: { et: label } };
```

(VIAF: `'viaf', normalizeExtId('viaf', viafId)`, fallback `source: 'viaf'`; Wikidata: `bestLabel`, `'wikidata', normalizeExtId('wikidata', result.id)`, `labels: multilingualLabels`, fallback `source: 'wikidata'`.) Impordi `createPersonChecked, PersonConflictError, getPerson`; eemalda `createPerson` import, kui see jääb kasutuseta.

- [ ] **Step 5: `PersonEditPage.tsx` — uus isik ühe sammuga**

`if (isNew) { const created = await createPerson(...); const payload = ...; await updatePerson(...); createdIdRef.current = created.id; }` asemel:

```ts
      if (isNew) {
        // Üks samm (spekk §4.2): kogu vormisisu salvestub ENNE taustarikastust —
        // create + update vahele sattunud rikastus andis varem versioonikonflikti.
        const payload = draftToPayload(draft, undefined, seisused, konfessioonid);
        const created = await createPersonChecked({ card: payload, created_via: 'form' }, token);
        createdIdRef.current = created.id;
      } else {
```

ja `catch`-is ENNE `if (e?.conflict)`:

```ts
      if (e instanceof PersonConflictError) {
        setError(t('form.identifierConflict',
          'Mõni välistest ID-dest on juba teisel kaardil: {{ids}}',
          { ids: e.existingPersonIds.join(', ') }));
      } else if (e?.conflict) {
```

- [ ] **Step 6: i18n — `form.identifierConflict` mõlemasse keelde**

`src/locales/et/prosopography.json` → `form.identifierConflict`: `"Mõni välistest ID-dest on juba teisel kaardil: {{ids}}"`; `src/locales/en/prosopography.json` → `"One of the external IDs is already on another card: {{ids}}"`. (Kontrolli, et `form` nimeruum on seal olemas; vastasel juhul kasuta sama nimeruumi, kus on `form.conflictError`.)

- [ ] **Step 7: Väravad**

Run: `npx vitest run src/prosopography/services/__tests__/createPersonChecked.test.ts` → PASS
Run: `npm run typecheck && npm test && npm run lint:ci` → PASS, hoiatusi ≤ 43.

- [ ] **Step 8: Commit**

```bash
git add src/prosopography/services/prosopographyService.ts src/prosopography/services/__tests__/createPersonChecked.test.ts src/components/EntityPicker.tsx src/prosopography/pages/PersonEditPage.tsx src/locales/et/prosopography.json src/locales/en/prosopography.json
git commit -m "feat(prosopo): valija ja vorm loovad isiku uue otspunkti kaudu (üks samm)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: ADR 0048 + CLAUDE.md invariant

**Files:**
- Create: `docs/decisions/0048-ulevaatusmarge-on-serveri-vali.md`
- Modify: `docs/decisions/README.md` (registri rida)
- Modify: `CLAUDE.md` (Invariandid)

- [ ] **Step 1: Kirjuta ADR**

```markdown
# 0048 — Ülevaatusmärge on serveri väli; automaatrikastus täidab ainult tühja

Kuupäev: 2026-09-24 · Staatus: kehtib · Seotud: #240, spekk `docs/superpowers/specs/2026-09-24-isiku-lisamise-voog-design.md`

## Kontekst

Isik tekib kolmel teel (vorm, valija, serveri stub) ja ükski ei rikastanud: juunist
2026 loodud 155 kaardist 19 olid täiesti tühjad, 15-l neist oli väline ID. Olemasolev
`verification_level` oli kõigil 2117 kaardil `draft` — ei eristanud midagi.
Vorm saadab kaardi tervikuna (`person.update`) ja `/enrich` kirjutab väljaradu
(`_deep_set`), seega iga kaardiväli on kliendilt kirjutatav, kui teisiti ei otsustata.
`ext_id_index` uuendati luku järel aegunud koopiast.

## Otsus

- `review` on SERVERI väli. Kõik kliendi kirjutusteed läbivad `strip_server_fields`-i
  (võti JA `review.*` rajad). Kirjutavad ainult `create_person_checked`, taustarikastus
  (`auto_enrich_runner`) ja admini kinnitus.
- Automaatrikastus täidab ainult tühja (erandid lisamise suunas: `name.aliases`,
  `identifiers`); konflikti kaardiga ega allikatevahelist vastuolu ei rakenda.
- Välisallika päringut ei tehta ühegi luku all. Iga lõppenud katse eemaldab
  `enrich_pending`-i; jäänud märge = katkenud katse, käivitusel korratakse.
- Väline ID on ühel kaardil: ID-lisavad teed hoiavad `ext_id_claim_lock`-i üle
  kontrolli, salvestuse ja `ext_id_index`-i uuenduse; järjekord ID-lukk → `person_lock`.
  `ext_id_index` uuendatakse KÕIGIS kirjutusteedes salvestusega samas kriitilises
  sektsioonis (`_save_person_locked`).
- `/enrich` ei muuda `identifiers`-it (400).
- Kinnitust hiljem uuesti ei avata.

## Tagajärjed

- Uus kaardikirjutus kutsub `_save_person_locked`-i, mitte `state.save_with_git`-i otse.
- Uus serveriväli → `SERVER_FIELDS`-i, mitte eraldi pop-reegel ühes kohas.
- Uus ID-lisav tee võtab `ext_id_claim_lock`-i ENNE `person_lock`-i.
- ÄRA kutsu `apply_enrichment`-i `person_lock`-i seest (tavaline `Lock` → ummikseis).
```

- [ ] **Step 2: Registri rida `docs/decisions/README.md` tabeli lõppu**

```markdown
| [0048](0048-ulevaatusmarge-on-serveri-vali.md) | Ülevaatusmärge on serveri väli; automaatrikastus täidab ainult tühja; väline ID ühel kaardil | kehtib |
```

- [ ] **Step 3: CLAUDE.md — lisa Invariandid alla (pärast „Eluloo keeleväljad" lõiku)**

```markdown
**Isikukaardi ülevaatus ja ID-d (ADR 0048)** — `review` on serveri väli: kõik kliendi
kirjutusteed läbivad `strip_server_fields`-i (ka `review.*` rajad). Kaardi salvestus
käib `_save_person_locked` kaudu — see uuendab `ext_id_index`-i samas kriitilises
sektsioonis. ID-lisav tee võtab `ext_id_claim_lock`-i ENNE `person_lock`-i.
Automaatrikastus täidab ainult tühja; välisallika päringut ei tehta luku all.
Uus isik ainult `create_person_checked` kaudu (`POST /prosopography/persons/create`).
```

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/0048-ulevaatusmarge-on-serveri-vali.md docs/decisions/README.md CLAUDE.md
git commit -m "docs: ADR 0048 — ülevaatusmärge serveri väli, automaatrikastus, väline ID ühel kaardil

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Lõppkontroll (pärast kõiki taske)

- [ ] `.venv/bin/pytest tests/ -q` → PASS
- [ ] `npm run typecheck && npm test && npm run lint:ci` → PASS, lint ≤ 43
- [ ] `grep -rn "state.save_with_git(\s*_id_to_path" server/prosopography/person_crud.py` → ainult `_save_person_locked`-i sees
- [ ] `grep -rn "createPerson(" src --include=*.tsx` → tühi (kõik läksid `createPersonChecked`-ile)
- [ ] Tootmistest pärast deploy'd: loo valijast Wikidata-isik → ~2 s pärast on kaardil eluaastad ja `review.reasons = ["auto_enriched"]`; loo sama isik uuesti → valija valib olemasoleva.
