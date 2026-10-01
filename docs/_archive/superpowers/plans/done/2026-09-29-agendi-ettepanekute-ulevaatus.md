# Agendi ettepanekute ülevaatuse lihtsustus — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Eesmärk:** agendi ameti- ja haridusettepaneku ülevaatus on ainult Kinnita / Lükka tagasi (rea kaupa või „Kinnita kõik"); agent pakub vajadusel ise uue registrikirje; tõendid on isikulehel joonealuste viidetena näha.

**Arhitektuur:** server hindab iga rea elava kaardi ja registri vastu (`review_state`) ning kinnitab kolmes sammus: eelkontroll ilma kirjutamiseta → registrikirjed atomaarse `registries.ensure`-ga → kaart üks kord `update_person`-iga. MCP lisab kirjanduse tõendile loetava `citation`-i. Frontend kirjutab paneeli ümber lihtsaks otsusevaateks ja näitab tõendeid ühise `evidenceRef` abilise kaudu.

**Tehnika:** FastAPI + sqlite (ootel ettepanekud), registrid JSON-failides `data/config/` all (`save_config_with_git`), MCP-pakett `vutt_mcp`, React 19 + TS + vitest.

**Spekk:** `docs/superpowers/specs/2026-09-28-agendi-ettepanekute-ulevaatus-design.md` (loe enne alustamist läbi). ADR-id: `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md`, `docs/decisions/0059-ameti-ja-asutusregistri-voti.md`.

## Üldised piirangud

- Koodikommentaarid eesti keeles. UI tekst mõlemas keeles korraga (`src/locales/et/prosopography.json` JA `src/locales/en/prosopography.json`) — `fallbackLng` on väljas, valvurid `localeParity.test.ts` ja `translationKeysResolve.test.ts`.
- Kood, loetelu, kinnitamine ja tagasilükkamine: `require_role("superadmin")`; paneel nähtav ainult `isAtLeast(user?.role, 'superadmin')`. Rolli võrdlus ALATI `is_at_least`/`isAtLeast`, mitte `==`.
- Autoriteetne registrifail kirjutatakse AINULT `save_config_with_git`-iga (ADR 0040).
- `registries.put` jääb muutmata (registrilehe ülekirjutus on tahtlik).
- Tõend on ainult `vutt_page` või `literature` (ADR 0058 täiendus 2026-09-28); `citation` ≤ 500 märki.
- Blokeeriv I/O `async def` sees keelatud — router kutsub `run_in_threadpool`-iga.
- Python: ALATI `.venv/bin/pytest`; MCP-testid tööpuus `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests`.
- Frontendi väravad: `npm run typecheck`, `npm test`, `npm run lint:ci` (hoiatuste arv ei tohi kasvada).
- Komponenditest vajab failipäist `/** @vitest-environment jsdom */`.
- Tagasilükkamise keha kasutab sama välja nime mis kinnitus: `{proposal_id, selected}` (spekk ütleb „sama kuju mis apply" ja nimetab välja `indices`; olemasolev apply kasutab `selected` — järgime olemasolevat).

## Ülevaatuse fookus

1. **Sama uus registrivõti kahel real eri sisuga** ühes ettepanekus → esitus lükatakse tagasi (`registry_entry_mismatch`), muidu looks esimene rida kirje ja teine kukuks kinnitusel. Test: ülesanne 2.
2. **Kaks valitud rida on sama uus fakt** („Kinnita kõik") → eelkontroll annab `duplicate_entry`, registrisse ega kaardile ei kirjutata midagi. Test: ülesanne 5.
3. **Vana ootel ettepanek** (`new_registry_candidate` ilma võtme ja `*_entry`-ta, `ambiguous`) → loetelu ei kuku, rida on `blocked` põhjusega `registry_key_missing` / `ambiguous_match`. Test: ülesanne 4.
4. **Kaardilt kustutati vahepeal kirje** (indeksid nihkusid) → „juba kaardil" rida leitakse sisu järgi, teisi ridu see ei blokeeri. Test: ülesanne 4.
5. **Vana tõend ohtliku või puuduva URL-iga** (Meniuse kaardil on veebitõendid; `url` võib olla mis tahes string) → isikulehel näidatakse teksti, linki ainult `http(s)`-URL-ile ja `vutt_page`-ile. Test: ülesanne 7.

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/prosopography/registries.py` | + `same_entry`, `check_ensure`, `ensure` (atomaarne loomine luku all) |
| `server/prosopography/enrichment_proposals.py` | leping (`*_entry`, `citation`), esituse registrikontroll, rea hindamine `_merge_row`, `review_state`, uus `apply_selected` (3 sammu, `ApplyError`), `reject_selected` |
| `server/prosopography/router.py` | viis otspunkti superadmin; `…/reject`; apply-vea kuju |
| `mcp/vutt_mcp/library/tools.py` | `literature_citations` asendab `unknown_doc_ids`-i |
| `mcp/vutt_mcp/server.py` | `_check_literature_evidence` kirjutab `citation`-i; tööriistade juhis |
| `src/prosopography/services/prosopographyService.ts` | tüübid, `applyEnrichmentProposal` ilma parandusteta, `rejectEnrichmentProposal`, `EnrichmentApplyError` |
| `src/prosopography/utils/evidenceRef.ts` (uus) | puhas tõend → {link, pealkiri, koht, katke}; `evidenceWorkIds` |
| `src/prosopography/hooks/useWorkTitles.ts` (uus) | teoste pealkirjad `getWorkTitles` kaudu |
| `src/prosopography/components/EvidenceList.tsx` (uus) | tõendite loend (paneel + isikuvorm, valikuline eemaldamine) |
| `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx` | ümber kirjutatud otsusevaade |
| `src/prosopography/components/personForm/RegistryCandidatePicker.tsx`, `RegistryEntryForm.tsx` | kustutatakse (mujal kasutust ei ole — kontrollitud) |
| `src/prosopography/pages/PersonEditPage.tsx` | paneel superadminile; „N tõendit" → `EvidenceList` eemaldamisega |
| `src/prosopography/pages/PersonDetailPage.tsx` | joonealused viited ametite ja hariduse all |
| `docs/decisions/0058-…md`, `0059-…md` | täiendused |

---

### Ülesanne 1: `registries.ensure` — atomaarne registrikirje loomine

**Failid:**
- Muuda: `server/prosopography/registries.py` (lisa `put`-i järele)
- Test: `tests/test_prosopo_registries.py`

**Liidesed:**
- Toodab: `registries.same_entry(a: dict, b: dict) -> bool`; `registries.check_ensure(kind: str, key: str, data: dict) -> dict` (tagastab kirje, mida kinnitus kasutaks; viskab `RegistryError("registry_conflict")` / `RegistryError("duplicate_id")` / `validate_entry` vead; ei kirjuta); `registries.ensure(kind: str, key: str, data: dict, username: str) -> tuple[dict, bool]` (`created`). `data` on registri kirjekuju ILMA `key`-ta.

- [ ] **Samm 1: kirjuta kukkuvad testid** — lisa faili `tests/test_prosopo_registries.py` lõppu (fixture `files` on olemas ja mockib `save_config_with_git`-i):

```python
def test_ensure_loob_puuduva_kirje(files):
    tmp, saved = files
    entry, created = registries.ensure("occupation", "valipreester", {
        "id": "Q1368286", "labels": {"et": "välipreester", "en": "military chaplain"},
        "variants": ["Feldprediger"]}, "super")
    assert created is True and entry["labels"]["et"] == "välipreester"
    assert registries.load("occupation")["valipreester"]["id"] == "Q1368286"
    assert len(saved) == 1


def test_ensure_sama_q_kood_seob_ilma_kirjutamata(files):
    tmp, saved = files
    registries.put("occupation", "kaplan", {"id": "Q208762", "labels": {"et": "kaplan"}}, "a")
    entry, created = registries.ensure("occupation", "kaplan", {
        "id": "Q208762", "labels": {"et": "Kaplan (muu nimi)"}}, "super")
    assert created is False and entry["labels"] == {"et": "kaplan"}
    assert len(saved) == 1          # ainult put


@pytest.mark.parametrize("olemas, uus", [
    ({"id": "Q1", "labels": {"et": "kaplan"}}, {"id": "Q2", "labels": {"et": "kaplan"}}),
    ({"id": "Q1", "labels": {"et": "kaplan"}}, {"labels": {"et": "kaplan"}}),
    ({"labels": {"et": "kaplan"}}, {"labels": {"et": "välipreester"}}),
])
def test_ensure_erinev_kirje_samal_votmel_on_konflikt(files, olemas, uus):
    tmp, saved = files
    registries.put("occupation", "kaplan", olemas, "a")
    with pytest.raises(registries.RegistryError, match="registry_conflict"):
        registries.ensure("occupation", "kaplan", uus, "super")
    assert len(saved) == 1


def test_ensure_q_koodita_kirjed_vorreldakse_nime_jargi_tostutundetult(files):
    registries.put("occupation", "kaplan", {"labels": {"et": "Kaplan"}}, "a")
    entry, created = registries.ensure("occupation", "kaplan", {"labels": {"et": "kaplan "}}, "s")
    assert created is False


def test_ensure_q_kood_teisel_votmel_on_duplikaat(files):
    registries.put("occupation", "kaplan", {"id": "Q208762", "labels": {"et": "kaplan"}}, "a")
    with pytest.raises(registries.RegistryError, match="duplicate_id"):
        registries.ensure("occupation", "valipreester", {"id": "Q208762", "labels": {"et": "x"}}, "s")


def test_check_ensure_ei_kirjuta(files):
    tmp, saved = files
    clean = registries.check_ensure("occupation", "notar", {"labels": {"et": "notar"}})
    assert clean["labels"] == {"et": "notar"} and saved == []
    assert "notar" not in registries.load("occupation")


def test_ensure_samaaegne_loomine_ei_kirjuta_ule(files):
    """Kaks lõime loovad sama võtme eri Q-koodiga: üks võidab, teine saab konflikti."""
    import threading
    tulemused = []

    def loo(qid):
        try:
            tulemused.append(registries.ensure("occupation", "kaplan",
                                               {"id": qid, "labels": {"et": "kaplan"}}, "s")[1])
        except registries.RegistryError as error:
            tulemused.append(str(error))

    lõimed = [threading.Thread(target=loo, args=(q,)) for q in ("Q10", "Q20")]
    for t in lõimed:
        t.start()
    for t in lõimed:
        t.join()
    assert sorted(map(str, tulemused)) == ["True", "registry_conflict"]
```

Kontrolli, et faili päises on `import pytest` (kui ei ole, lisa).

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `.venv/bin/pytest tests/test_prosopo_registries.py -q`
Oodatud: FAIL — `AttributeError: module ... has no attribute 'ensure'`.

- [ ] **Samm 3: kirjuta teostus** — `server/prosopography/registries.py`, `put`-i järele:

```python
def same_entry(a: dict, b: dict) -> bool:
    """Sama kirje: sama Q-kood; kui Q-koodi pole kummalgi, sama eestikeelne nimi."""
    if a.get("id") or b.get("id"):
        return a.get("id") == b.get("id")
    def nimi(entry: dict) -> str:
        return str((entry.get("labels") or {}).get("et") or "").strip().casefold()
    return bool(nimi(a)) and nimi(a) == nimi(b)


def _ensure_decision(entries: dict, kind: str, key: str, data: dict) -> tuple[dict, bool]:
    """Ühine otsus kinnituse eelkontrollile ja `ensure`-ile: (kirje, kas luua)."""
    clean = validate_entry(kind, key, data, places=_places() if kind == "institution" else None)
    existing = entries.get(key)
    if isinstance(existing, dict):
        if same_entry(existing, clean):
            return existing, False
        raise RegistryError("registry_conflict")
    if len(entries) >= _MAX_ENTRIES:
        raise RegistryError("registry_full")
    if clean["id"] and any(isinstance(v, dict) and v.get("id") == clean["id"]
                           for v in entries.values()):
        raise RegistryError("duplicate_id")
    return clean, True


def check_ensure(kind: str, key: str, data: dict) -> dict:
    """`ensure`-i reegel ilma kirjutamata (agendi ettepaneku eelkontroll)."""
    return _ensure_decision(load(kind), kind, key, data)[0]


def ensure(kind: str, key: str, data: dict, username: str) -> tuple[dict, bool]:
    """Loob kirje, kui võtit pole; sama kirje korral seob. Erinevalt `put`-ist ei
    kirjuta kunagi olemasolevat üle: lugemine, võrdlus ja kirjutus on ühe luku all,
    muidu võiks samaaegne kinnitus vahepeal loodud kirje üle kirjutada."""
    with _LOCK:
        entries = load(kind)
        entry, create = _ensure_decision(entries, kind, key, data)
        if not create:
            return entry, False
        entries[key] = entry
        save_config_with_git(_path(kind), entries, username,
                             message=f"Register {kind}: lisa {key} (agendi ettepanek)")
        return entry, True
```

- [ ] **Samm 4: käivita, peab läbima**

Run: `.venv/bin/pytest tests/test_prosopo_registries.py -q`
Oodatud: kõik PASS.

- [ ] **Samm 5: commit**

```bash
git add server/prosopography/registries.py tests/test_prosopo_registries.py
git commit -m "feat(prosopography): registries.ensure — atomaarne registrikirje loomine"
```

---

### Ülesanne 2: esituse leping — `*_entry` ja `citation`

**Failid:**
- Muuda: `server/prosopography/enrichment_proposals.py` (`_ITEM_KEYS`, `_EVIDENCE_KEYS`, `_validate_item`, `submit`, uued abilised)
- Test: `tests/test_prosopo_enrichment_proposals.py`

**Liidesed:**
- Tarbib: `registries.load`, `registries.validate_entry`, `registries._places` (ülesanne 1 fail).
- Toodab: `_ENTRY_FIELDS = (("occupation", "occupation_entry", "occupation_key"), ("institution", "institution_entry", "institution_key"))`; `_split_entry(entry: dict) -> tuple[str, dict]`. Talletatud ettepanekus on `*_entry` lepingu kujul (koos `key`-ga) ja `*_key` on serveri täidetud.

- [ ] **Samm 1: kirjuta kukkuvad testid** — faili lõppu. Registrifailid tulevad `tmp_path`-ist:

```python
@pytest.fixture
def registrid(tmp_path, monkeypatch):
    config = tmp_path / "config"
    config.mkdir(exist_ok=True)
    (config / "occupations.json").write_text(json.dumps({
        "kaplan": {"id": "Q208762", "labels": {"et": "kaplan"}, "variants": []}}))
    (config / "institutions.json").write_text(json.dumps({}))
    (config / "places.json").write_text(json.dumps({"tartu": {"id": "Q13972"}}))
    monkeypatch.setattr(proposals, "DATA_CONFIG_DIR", str(config))
    monkeypatch.setattr(registries, "DATA_CONFIG_DIR", str(config))
    monkeypatch.setattr(registries, "PLACES_FILE", str(config / "places.json"))
    monkeypatch.setattr(proposals, "PLACES_FILE", str(config / "places.json"))
    saved = []

    def write(path, data, username, message=None):
        saved.append(path)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        return {"success": True}

    monkeypatch.setattr(registries, "save_config_with_git", write)
    return config, saved


def _uus_amet(**extra):
    item = {"kind": "occupation", "match_status": "new_registry_candidate",
            "raw_occupation": "Feldprediger",
            "occupation_entry": {"key": "valipreester", "id": "Q1368286",
                                 "labels": {"et": "välipreester", "en": "military chaplain"},
                                 "variants": ["Feldprediger"]},
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]}
    item.update(extra)
    return item


def _esita(client, login, prosopo_env, items):
    card = prosopo_env.write("abc", occupations=[], education=[])
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    return client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc", "base_updated_at": card["updated_at"],
        "items": items}), token


def test_uus_registrikirje_talletatakse_ja_voti_taidetakse(client, login, prosopo_env, registrid):
    response, token = _esita(client, login, prosopo_env, [_uus_amet()])
    assert response.status_code == 200, response.text
    item = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                      headers=_headers(token)).json()[0]["items"][0]
    assert item["occupation_key"] == "valipreester"
    assert item["occupation_entry"]["key"] == "valipreester"
    assert "valipreester" not in registries.load("occupation")


@pytest.mark.parametrize("muudatus, viga", [
    ({"match_status": "matched"}, "registry_entry_requires_new_candidate"),
    ({"occupation_key": "muu"}, "registry_entry_key_mismatch"),
    ({"occupation_entry": {"key": "kaplan", "labels": {"et": "kaplan"}}}, "registry_key_exists: kaplan"),
    ({"occupation_entry": {"key": "uus", "id": "Q208762", "labels": {"et": "x"}}},
     "registry_id_exists: Q208762 on kirjel kaplan"),
    ({"occupation_entry": {"key": "Vale Võti", "labels": {"et": "x"}}}, "invalid_registry_entry"),
    ({"occupation_entry": {"key": "uus", "labels": {}}}, "invalid_registry_entry"),
    ({"kind": "education", "raw_institution": "AGC"}, "invalid_registry_entry"),
])
def test_vigane_registrikirje_lukatakse_esitusel_tagasi(
        client, login, prosopo_env, registrid, muudatus, viga):
    response, _ = _esita(client, login, prosopo_env, [_uus_amet(**muudatus)])
    assert response.status_code == 400
    assert viga in response.json()["detail"]
    assert response.json()["detail"].startswith("items[0]")


def test_asutusekirje_vajab_liiki(client, login, prosopo_env, registrid):
    item = {"kind": "education", "match_status": "new_registry_candidate",
            "raw_institution": "Academia Rostochiensis",
            "institution_entry": {"key": "rostocki-ulikool", "labels": {"et": "Rostocki ülikool"}},
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]}
    response, _ = _esita(client, login, prosopo_env, [item])
    assert response.status_code == 400 and "invalid_type" in response.json()["detail"]


def test_sama_uus_voti_kahel_real_eri_sisuga(client, login, prosopo_env, registrid):
    teine = _uus_amet(occupation_entry={"key": "valipreester", "labels": {"et": "välipreester"}})
    response, _ = _esita(client, login, prosopo_env, [_uus_amet(), teine])
    assert response.status_code == 400
    assert response.json()["detail"].startswith("items[1]: registry_entry_mismatch")


def test_sama_uus_voti_kahel_real_sama_sisuga_lubatud(client, login, prosopo_env, registrid):
    response, _ = _esita(client, login, prosopo_env, [_uus_amet(), _uus_amet(date_from={"date": "1629"})])
    assert response.status_code == 200, response.text


def test_toend_lubab_citationi():
    proposals._validate_item(_item(evidence=[{
        "source_kind": "literature", "source_id": "DOC1", "locator": "lk 3",
        "citation": "Donecker 2012, An Itinerant Sheep"}]))
```

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py -q -k "registrikirje or uus_voti or asutusekirje or citation"`
Oodatud: FAIL (handoff 403-t ei ole veel, aga `invalid_item: tundmatud võtmed ['occupation_entry']`). Märkus: handoff superadminile töötab juba praegu (superadmin ⊇ editor).

- [ ] **Samm 3: kirjuta teostus** — `enrichment_proposals.py`:

Konstandid:

```python
_ITEM_KEYS = {"kind", "raw_occupation", "raw_institution", "occupation_key",
              "institution_key", "place_key", "date_from", "date_to", "evidence",
              "match_status", "existing_index", "edu_type", "occupation_variant",
              "institution_variant", "occupation_entry", "institution_entry"}
_EVIDENCE_KEYS = {"source_kind", "source_id", "locator", "work_id", "page",
                  "printed_page", "part_id", "quote", "citation"}
# Rea uus registrikirje: (registri liik, kirje väli, võtmeväli).
_ENTRY_FIELDS = (("occupation", "occupation_entry", "occupation_key"),
                 ("institution", "institution_entry", "institution_key"))
```

`_validate_item`-i lõppu (pärast tõendite tsüklit):

```python
    for _, field, key_field in _ENTRY_FIELDS:
        entry = item.get(field)
        if entry is None:
            continue
        if field == "occupation_entry" and item["kind"] != "occupation":
            raise ProposalError("invalid_registry_entry: occupation_entry ainult kind=occupation real")
        if (not isinstance(entry, dict) or not isinstance(entry.get("key"), str)
                or not entry["key"]):
            raise ProposalError(f"invalid_registry_entry: {field} peab olema objekt mittetühja key-ga")
        if item["match_status"] != "new_registry_candidate":
            raise ProposalError(
                f"registry_entry_requires_new_candidate: {field} nõuab "
                "match_status=new_registry_candidate")
        if item.get(key_field) not in (None, entry["key"]):
            raise ProposalError(
                f"registry_entry_key_mismatch: {key_field} peab puuduma või võrduma {field}.key-ga")
```

Uued abilised (`_check_vutt_pages`-i järele):

```python
def _split_entry(entry: dict) -> tuple[str, dict]:
    """Lepingus on `key` kirje sees (agendile lihtsam); registri kirjekujus võtit ei
    ole ja `validate_entry` lükkaks selle tagasi (`unknown_fields`)."""
    return entry["key"], {k: v for k, v in entry.items() if k != "key"}


def _check_registry_entries(items: list) -> None:
    """Uus registrikirje peab olema kehtiv ja registris veel puuduma. Viga suunab
    agenti olemasolevat kirjet kasutama; sama võti ühes ettepanekus = sama sisu."""
    from . import registries
    seen: dict = {}
    for index, item in enumerate(items):
        for kind, field, _ in _ENTRY_FIELDS:
            if not item.get(field):
                continue
            key, data = _split_entry(item[field])
            try:
                clean = registries.validate_entry(
                    kind, key, data,
                    places=registries._places() if kind == "institution" else None)
                entries = registries.load(kind)
            except registries.RegistryError as error:
                raise ProposalError(
                    f"items[{index}]: invalid_registry_entry: {field}: {error}") from None
            if key in entries:
                raise ProposalError(f"items[{index}]: registry_key_exists: {key} — kasuta seda")
            owner = next((k for k, v in entries.items() if clean["id"]
                          and isinstance(v, dict) and v.get("id") == clean["id"]), None)
            if owner:
                raise ProposalError(
                    f"items[{index}]: registry_id_exists: {clean['id']} on kirjel {owner}")
            if seen.setdefault((kind, key), clean) != clean:
                raise ProposalError(
                    f"items[{index}]: registry_entry_mismatch: {key} on ettepanekus eri sisuga")
```

`submit`-is, kohe pärast `_validate_item`-tsüklit ja ENNE `payload = json.dumps(...)`:

```python
    _check_registry_entries(items)
    for item in items:
        for _, field, key_field in _ENTRY_FIELDS:
            if item.get(field):
                item[key_field] = item[field]["key"]
```

- [ ] **Samm 4: käivita, peab läbima**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py -q`
Oodatud: kõik PASS (vanad testid ka — `apply` pole veel muudetud).

- [ ] **Samm 5: commit**

```bash
git add server/prosopography/enrichment_proposals.py tests/test_prosopo_enrichment_proposals.py
git commit -m "feat(prosopography): agendi ettepanek võib kanda uut registrikirjet"
```

---

### Ülesanne 3: rikastuse töövoog ainult superadminile

**Failid:**
- Muuda: `server/prosopography/router.py` (neli olemasolevat otspunkti: `/enrichment-handoff`, `/enrichment-handoff/{person_id}`, `GET /enrichment-proposals/{person_id}`, `/enrichment-proposals/{person_id}/apply`)
- Muuda: `tests/test_prosopo_enrichment_proposals.py`, `tests/test_prosopo_mcp_workflow.py`

**Liidesed:** ei muuda funktsioonide signatuure.

- [ ] **Samm 1: kirjuta kukkuv test** — faili `tests/test_prosopo_enrichment_proposals.py` lõppu:

```python
@pytest.mark.parametrize("method, path", [
    ("post", "/prosopography/enrichment-handoff"),
    ("post", "/prosopography/enrichment-handoff/vutt:Pabc"),
    ("get", "/prosopography/enrichment-proposals/vutt:Pabc"),
    ("post", "/prosopography/enrichment-proposals/vutt:Pabc/apply"),
])
@pytest.mark.parametrize("user, password", [("editor", "editorpass"), ("admin", "adminpass")])
def test_rikastuse_otspunktid_on_ainult_superadminile(client, login, prosopo_env, method, path, user, password):
    prosopo_env.write("abc")
    token = login(user, password)
    response = getattr(client, method)(path, headers=_headers(token),
                                       **({"json": {"proposal_id": "x", "selected": [0]}} if method == "post" else {}))
    assert response.status_code == 403
```

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py -q -k superadminile`
Oodatud: FAIL (editor saab 200/400, mitte 403).

- [ ] **Samm 3: teostus** — `router.py`: neljas nimetatud otspunktis `require_role("editor")` → `require_role("superadmin")`. Lisa esimese otspunkti kohale kommentaar:

```python
# Agendi rikastuse töövoog on ainult superadminil, kuni see on silutud (spekk
# 2026-09-28). Rolli langetamine = need viis otspunkti (kaks koodi, loetelu,
# apply, reject) + paneeli nähtavus PersonEditPage'is.
```

- [ ] **Samm 4: vii olemasolevad testid üle**

```bash
sed -i "s/login(\"editor\", \"editorpass\")/login(\"superadmin\", \"superpass\")/g; s/login('editor', 'editorpass')/login('superadmin', 'superpass')/g" \
  tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py
```

Siis käsitsi:
- `test_ettepanek_on_kasutaja_oma_mitte_seansi` ja `test_kinnitamine_nouab_sama_kasutajat_ja_varsket_versiooni`: „teine kasutaja" (`admin`) saab nüüd 403, mitte tühja loendit. Asenda HTTP-kontroll otsekutsega, mis tõestab sama invariandi (ettepanek on kasutaja oma):
  ```python
  assert proposals.list_pending("vutt:Pabc", "admin") == []
  ```
  ja kinnitamise puhul `proposals.apply_selected(proposal_id, "vutt:Pabc", "admin", "", [0])` → `pytest.raises(proposals.ProposalError, match="proposal_not_found")`.
- `test_prosopo_mcp_workflow.py`: `other_token = login("admin", ...)` rida ja selle `assert ... == []` asenda `assert proposals.list_pending(card["id"], "admin") == []`-ga.
- `contrib` sisselogimine samas testis: kui kontrollib 403-t, jääb samaks.

- [ ] **Samm 5: käivita**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py -q`
Oodatud: kõik PASS.

- [ ] **Samm 6: commit**

```bash
git add server/prosopography/router.py tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py
git commit -m "feat(prosopography): agendi rikastuse töövoog ainult superadminile"
```

---

### Ülesanne 4: rea hindamine elava kaardi vastu ja `review_state`

**Failid:**
- Muuda: `server/prosopography/enrichment_proposals.py` (`_check_links`, `_card_item`, uus `_planned_entries`, `_merge_row`, `_review_state`, `list_pending`)
- Test: `tests/test_prosopo_enrichment_proposals.py`

**Liidesed:**
- Tarbib: `registries.check_ensure` (ülesanne 1), `_ENTRY_FIELDS`, `_split_entry` (ülesanne 2).
- Toodab: `_merge_row(item: dict, occupations: list, education: list) -> str` — muudab loendite KOOPIAID kohapeal, tagastab `"applicable"` või `"already_present"`, viskab `ProposalError(<põhjus>)`. Põhjused: `registry_key_missing`, `ambiguous_match`, `duplicate_entry`, `unresolved_existing_entry`, `registry_conflict: <võti>`, `duplicate_id: <võti>`, `unknown_occupation_key` jt `_check_links`-ist. `list_pending` lisab igale reale `review_state: {"state": "applicable"|"already_present"|"blocked", "reason"?: str}` ja `registry_ids: {<võtmeväli>: <Q>}`.

- [ ] **Samm 1: kirjuta kukkuvad testid** (kasutab ülesande 2 fixture'it `registrid`):

```python
def _loetelu(client, token):
    return client.get("/prosopography/enrichment-proposals/vutt:Pabc", headers=_headers(token)).json()


def test_review_state_kolm_olekut(client, login, prosopo_env, registrid):
    config, _ = registrid
    card = prosopo_env.write("abc", occupations=[
        {"label": "Feldprediger", "occupation_key": "kaplan", "id": "Q208762"}], education=[])
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).json()["code"]
    ev = [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]
    items = [
        {"kind": "occupation", "match_status": "already_present", "raw_occupation": "Feldprediger",
         "occupation_key": "kaplan", "evidence": ev},
        _uus_amet(),
        {"kind": "occupation", "match_status": "ambiguous", "raw_occupation": "Pastor", "evidence": ev},
    ]
    assert client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc", "base_updated_at": card["updated_at"],
        "items": items}).status_code == 200
    rows = _loetelu(client, token)[0]["items"]
    assert rows[0]["review_state"] == {"state": "already_present"}
    assert rows[1]["review_state"] == {"state": "applicable"}
    assert rows[1]["registry_labels"]["occupation_key"] == "välipreester"
    assert rows[1]["registry_ids"]["occupation_key"] == "Q1368286"
    assert rows[2]["review_state"]["state"] == "blocked"
    assert rows[2]["review_state"]["reason"] == "ambiguous_match"


def test_vana_ettepanek_ilma_votmeta_on_blokeeritud(client, login, prosopo_env, registrid):
    """Enne muudatust talletatud rida: new_registry_candidate ilma võtme ja kirjeta."""
    prosopo_env.write("abc", occupations=[], education=[])
    token = login("superadmin", "superpass")
    with proposals._db() as db:
        db.execute("INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
                   ("old", "vutt:Pabc", "superadmin", "fp", "v", 1, 9999999999, json.dumps([
                       {"kind": "occupation", "match_status": "new_registry_candidate",
                        "raw_occupation": "Notarius", "evidence": [
                            {"source_kind": "vutt_page", "work_id": "w1", "page": 1}]}])))
    row = _loetelu(client, token)[0]["items"][0]
    assert row["review_state"] == {"state": "blocked", "reason": "registry_key_missing"}


def test_ambiguous_votmega_on_blokeeritud():
    item = _item(match_status="ambiguous")
    with pytest.raises(proposals.ProposalError, match="ambiguous_match"):
        proposals._merge_row(item, [], [])


def test_juba_kaardil_leitakse_sisu_jargi_kui_indeks_nihkus(registrid):
    """Agent nägi kaplanit indeksil 1; toimetaja kustutas vahepeal indeksi 0."""
    occupations = [{"label": "Feldprediger", "occupation_key": "kaplan", "id": "Q208762"}]
    item = {"kind": "occupation", "match_status": "already_present", "existing_index": 1,
            "raw_occupation": "Feldprediger", "occupation_key": "kaplan",
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 7}]}
    assert proposals._merge_row(item, occupations, []) == "already_present"
    assert occupations[0]["evidence"] == item["evidence"]


def test_juba_kaardil_mitu_vastet_on_blokeeritud(registrid):
    occupations = [{"label": "a", "occupation_key": "kaplan"}, {"label": "b", "occupation_key": "kaplan"}]
    item = {"kind": "occupation", "match_status": "already_present", "raw_occupation": "a",
            "occupation_key": "kaplan", "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 7}]}
    with pytest.raises(proposals.ProposalError, match="unresolved_existing_entry"):
        proposals._merge_row(item, occupations, [])


def test_uus_fakt_mis_on_kaardil_on_duplikaat(registrid):
    occupations = [{"label": "Feldprediger", "occupation_key": "kaplan"}]
    item = {"kind": "occupation", "match_status": "matched", "raw_occupation": "Feldprediger",
            "occupation_key": "kaplan", "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 7}]}
    with pytest.raises(proposals.ProposalError, match="duplicate_entry"):
        proposals._merge_row(item, occupations, [])


def test_registrikonflikt_parast_esitust_blokeerib_rea(registrid):
    config, _ = registrid
    registries.put("occupation", "valipreester", {"id": "Q999", "labels": {"et": "muu"}}, "a")
    with pytest.raises(proposals.ProposalError, match="registry_conflict: valipreester"):
        proposals._merge_row({**_uus_amet(), "occupation_key": "valipreester"}, [], [])
```

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py -q -k "review_state or vana_ettepanek or ambiguous or juba_kaardil or duplikaat or registrikonflikt"`
Oodatud: FAIL (`_merge_row` puudub, `review_state` puudub).

- [ ] **Samm 3: teostus.**

`_check_links` saab plaanitud kirjed (uue kirje võtit registris veel ei ole):

```python
def _check_links(item: dict, planned: Optional[dict] = None) -> None:
    planned = planned or {}
    if item.get("institution_key") and item.get("place_key"):
        raise ProposalError("institution_and_place_are_exclusive")
    if item["kind"] == "education" and (item.get("occupation_key") or item.get("place_key")):
        raise ProposalError("invalid_education_links")
    for key, filename in (
        ("occupation_key", os.path.join(DATA_CONFIG_DIR, "occupations.json")),
        ("institution_key", os.path.join(DATA_CONFIG_DIR, "institutions.json")),
        ("place_key", PLACES_FILE),
    ):
        if item.get(key):
            entry = planned.get(key) or _registry_entry(filename, item[key])
            if entry is None:
                raise ProposalError(f"unknown_{key}")
            variant_key = key.removesuffix("_key") + "_variant"
            if item.get(variant_key) and item[variant_key] not in (entry.get("variants") or []):
                raise ProposalError(f"unknown_{variant_key}")
    if item.get("occupation_variant") and not item.get("occupation_key"):
        raise ProposalError("occupation_variant_requires_key")
    if item.get("institution_variant") and not item.get("institution_key"):
        raise ProposalError("institution_variant_requires_key")
```

`_card_item(item: dict, planned: Optional[dict] = None)` — asenda kaks `_registry_entry(...)` lugemist kujuga `(planned or {}).get("occupation_key") or _registry_entry(...)` (ja sama `institution_key`-ga).

Uued funktsioonid (`_same_legacy_fact`-i järele):

```python
def _planned_entries(item: dict) -> dict:
    """Rea uued registrikirjed kujul võtmeväli → kirje, mida kinnitus kasutaks."""
    from . import registries
    planned = {}
    for kind, field, key_field in _ENTRY_FIELDS:
        if item.get(field):
            key, data = _split_entry(item[field])
            try:
                planned[key_field] = registries.check_ensure(kind, key, data)
            except registries.RegistryError as error:
                raise ProposalError(f"{error}: {key}") from None
    return planned


def _merge_row(item: dict, occupations: list, education: list) -> str:
    """Kannab rea kaardi loendite KOOPIASSE. Sihtkirje leitakse sisu järgi —
    `existing_index` on agendi vihje ja nihkub, kui kaardilt midagi kustutatakse."""
    if item["match_status"] == "ambiguous":
        raise ProposalError("ambiguous_match")
    key_field = "occupation_key" if item["kind"] == "occupation" else "institution_key"
    if not item.get(key_field):
        raise ProposalError("registry_key_missing")
    planned = _planned_entries(item)
    _check_links(item, planned)
    target = occupations if item["kind"] == "occupation" else education
    candidate = _card_item(item, planned)
    matching = [i for i, e in enumerate(target)
                if isinstance(e, dict) and _same_fact(e, candidate, item["kind"])]
    legacy = [i for i, e in enumerate(target)
              if isinstance(e, dict) and _same_legacy_fact(e, candidate, item["kind"])]
    if item["match_status"] != "already_present":
        if matching or legacy:
            raise ProposalError("duplicate_entry")
        target.append(candidate)
        return "applicable"
    hits = matching or legacy
    if len(hits) != 1:
        raise ProposalError("unresolved_existing_entry")
    existing = target[hits[0]]
    links = {}
    if not matching:
        # Pärandrida (sõnastus ilma registriseoseta) saab seose, sõnastus jääb.
        for key in ("occupation_key", "institution_key", "place_key", "id", "institution_id"):
            if candidate.get(key) and not existing.get(key):
                links[key] = candidate[key]
    evidence = existing.get("evidence") or []
    target[hits[0]] = {**existing, **links, "evidence": evidence + [
        source for source in item["evidence"] if source not in evidence]}
    return "already_present"


def _review_state(item: dict, person: Optional[dict]) -> dict:
    """Serveri otsus paneelile — klient olekut ise ei arvuta."""
    if person is None:
        return {"state": "blocked", "reason": "person_not_found"}
    try:
        state = _merge_row(item, list(person.get("occupations") or []),
                           list(person.get("education") or []))
    except ProposalError as error:
        return {"state": "blocked", "reason": str(error)}
    return {"state": state}
```

`list_pending` — asenda rea-tsükli keha (vana `_check_links` + `review_error` kaob):

```python
def list_pending(person_id: str, username: str, session_fingerprint: str = "") -> list[dict]:
    """Toimetaja näeb ainult enda algatatud ettepanekuid — igas oma seansis (#492)."""
    from .person_crud import get_person
    person = get_person(person_id)
    if person is not None and (person.get("record_status") == "tombstone" or person.get("merged_into")):
        person = None
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        rows = db.execute(
            "SELECT * FROM proposal WHERE person_id=? AND username=? AND applied_at IS NULL ORDER BY created_at DESC",
            (person_id, username),
        ).fetchall()
    result = []
    for row in rows:
        items = json.loads(row["payload"])
        for item in items:
            item["review_state"] = _review_state(item, person)
            labels, ids = {}, {}
            for key, filename in (
                ("occupation_key", os.path.join(DATA_CONFIG_DIR, "occupations.json")),
                ("institution_key", os.path.join(DATA_CONFIG_DIR, "institutions.json")),
                ("place_key", PLACES_FILE),
            ):
                if not item.get(key):
                    continue
                new = next((item[f] for _, f, k in _ENTRY_FIELDS if k == key and item.get(f)), None)
                entry = new or _registry_entry(filename, item[key])
                if entry:
                    names = entry.get("labels") or {}
                    label = names.get("et") or names.get("en") or entry.get("label")
                    if label:
                        labels[key] = label
                    if entry.get("id"):
                        ids[key] = entry["id"]
            item["registry_labels"] = labels
            item["registry_ids"] = ids
            if item.get("institution_key"):
                institution = item.get("institution_entry") or _registry_entry(
                    os.path.join(DATA_CONFIG_DIR, "institutions.json"), item["institution_key"])
                item["institution_place_key"] = institution.get("place_key") if institution else None
        result.append({"proposal_id": row["id"], "person_id": person_id,
                       "base_updated_at": row["base_updated_at"],
                       "created_at": row["created_at"], "expires_at": row["expires_at"],
                       "items": items})
    return result
```

`_registry_label` jääb kasutuseta → kustuta. Vana test `test_isikukood_lubab_mitu_esitust…` kontrollib `review_error == "unknown_occupation_key"` → muuda:
```python
    assert pending.json()[0]["items"][0]["review_state"] == {"state": "blocked", "reason": "unknown_occupation_key"}
```

- [ ] **Samm 4: käivita**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py -q`
Oodatud: uued PASS; vanad apply-testid PASS (apply pole veel muudetud; `_check_links`/`_card_item` on tagasiühilduvad).

- [ ] **Samm 5: commit**

```bash
git add server/prosopography/enrichment_proposals.py tests/test_prosopo_enrichment_proposals.py
git commit -m "feat(prosopography): ettepaneku rida hinnatakse elava kaardi vastu (review_state)"
```

---

### Ülesanne 5: kinnitus kolmes sammus ja tagasilükkamine

**Failid:**
- Muuda: `server/prosopography/enrichment_proposals.py` (`apply_selected` ümber, uus `reject_selected`, `ApplyError`, `_open_proposal`, `_check_selection`, `_close_rows`)
- Muuda: `server/prosopography/router.py` (apply keha ja vead, uus reject-otspunkt)
- Test: `tests/test_prosopo_enrichment_proposals.py`, `tests/test_prosopo_mcp_workflow.py`

**Liidesed:**
- Tarbib: `_merge_row`, `_ENTRY_FIELDS`, `_split_entry`, `registries.ensure`.
- Toodab: `apply_selected(proposal_id: str, person_id: str, username: str, session_fingerprint: str, selected: list[int]) -> dict` (uuendatud kaart); `reject_selected(proposal_id: str, person_id: str, username: str, selected: list[int]) -> dict` (`{"proposal_id", "remaining": int}`); `class ApplyError(ProposalError)` atribuudiga `created: list[str]`. HTTP: `POST /prosopography/enrichment-proposals/{person_id}/apply` keha `{proposal_id, selected}`; `POST …/reject` sama kehaga; apply-viga pärast registrikirjete loomist → 409 `detail = {"error": str, "created_registry_entries": [võtmed]}`.

- [ ] **Samm 1: kustuta parandusmehhanismi testid** — need kontrollivad eemaldatavat `corrections`-i: `test_toimetaja_lahendab_mitmetahendusliku_vaste_registrivalikuga`, `test_parandus_ei_voimalda_valitud_reast_valjuda`, `test_toimetaja_parandab_aja_ja_toendi_koos_kinnitamisega`, `test_vigane_toimetaja_kuupaev_ei_muuda_kaarti`. `test_kinnitamine_keeldub_puuduvast_registrist_ja_vananenud_kaardist` ja `test_kinnitamine_nouab_sama_kasutajat_ja_varsket_versiooni` kontrollivad ettepaneku-taseme `stale_person`-it kinnitusel — muuda need nii, et kaardi muutus vahepeal EI blokeeri (vt samm 2 test) ja puuduv registrivõti annab `items[0]: unknown_occupation_key` (400).

- [ ] **Samm 2: kirjuta kukkuvad testid:**

```python
def _esitatud(client, login, prosopo_env, items, **card):
    card = prosopo_env.write("abc", **{"occupations": [], "education": [], **card})
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).json()["code"]
    assert client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc", "base_updated_at": card["updated_at"],
        "items": items}).status_code == 200
    return token, _loetelu(client, token)[0]["proposal_id"]


def _apply(client, token, proposal_id, selected):
    return client.post("/prosopography/enrichment-proposals/vutt:Pabc/apply", headers=_headers(token),
                       json={"proposal_id": proposal_id, "selected": selected})


def test_kinnitus_loob_registrikirje_ja_fakti(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    response = _apply(client, token, pid, [0])
    assert response.status_code == 200, response.text
    assert registries.load("occupation")["valipreester"]["id"] == "Q1368286"
    saved = prosopo_env.read("abc")["occupations"][0]
    assert saved["occupation_key"] == "valipreester" and saved["label"] == "Feldprediger"
    assert _loetelu(client, token) == []


def test_kinnitus_seob_vahepeal_loodud_sama_kirjega(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    registries.put("occupation", "valipreester", {"id": "Q1368286", "labels": {"et": "välipreester"}}, "a")
    assert _apply(client, token, pid, [0]).status_code == 200


def test_eelkontrolli_kukkumine_ei_loo_registrikirjet(client, login, prosopo_env, registrid):
    config, saved = registrid
    dup = {"kind": "occupation", "match_status": "matched", "raw_occupation": "Feldprediger",
           "occupation_key": "kaplan", "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 2}]}
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet(), dup, dict(dup)])
    response = _apply(client, token, pid, [0, 1, 2])
    assert response.status_code == 409
    assert response.json()["detail"].startswith("items[2]: duplicate_entry")
    assert "valipreester" not in registries.load("occupation") and saved == []
    assert prosopo_env.read("abc")["occupations"] == []


def test_kaardi_kukkumine_tagastab_loodud_registrikirjed(client, login, prosopo_env, registrid, monkeypatch):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    from server.prosopography import person_crud

    def kukub(*args, **kwargs):
        raise ValueError("conflict:uuem")
    monkeypatch.setattr(person_crud, "update_person", kukub)
    response = _apply(client, token, pid, [0])
    assert response.status_code == 409
    assert response.json()["detail"] == {"error": "stale_person",
                                         "created_registry_entries": ["valipreester"]}
    assert "valipreester" in registries.load("occupation")


def test_kaardi_muutus_vahepeal_ei_blokeeri_teisi_ridu(client, login, prosopo_env, registrid):
    ev = [{"source_kind": "vutt_page", "work_id": "w1", "page": 2}]
    items = [{"kind": "occupation", "match_status": "matched", "raw_occupation": "Kaplan",
              "occupation_key": "kaplan", "date_from": {"date": "1629"}, "evidence": ev}, _uus_amet()]
    token, pid = _esitatud(client, login, prosopo_env, items)
    card = prosopo_env.read("abc")
    prosopo_env.write("abc", **{**card, "notes": "käsitsi muudetud"})   # uus updated_at
    assert _apply(client, token, pid, [0]).status_code == 200
    assert _apply(client, token, pid, [0]).status_code == 200       # endine rida 1 on nüüd 0
    assert len(prosopo_env.read("abc")["occupations"]) == 2


def test_tagasilukkamine_eemaldab_rea_ja_sulgeb_tuhja(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet(), _uus_amet(date_from={"date": "1630"})])
    url = "/prosopography/enrichment-proposals/vutt:Pabc/reject"
    first = client.post(url, headers=_headers(token), json={"proposal_id": pid, "selected": [1]})
    assert first.status_code == 200 and first.json()["remaining"] == 1
    assert client.post(url, headers=_headers(token), json={"proposal_id": pid, "selected": [0]}).json()["remaining"] == 0
    assert _loetelu(client, token) == []
    assert prosopo_env.read("abc")["occupations"] == [] and "valipreester" not in registries.load("occupation")


def test_tagasilukkamine_on_ainult_superadminile(client, login, prosopo_env):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    assert client.post("/prosopography/enrichment-proposals/vutt:Pabc/reject", headers=_headers(token),
                       json={"proposal_id": "x", "selected": [0]}).status_code == 403


def test_apply_ei_voota_enam_parandusi(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    response = client.post("/prosopography/enrichment-proposals/vutt:Pabc/apply", headers=_headers(token),
                           json={"proposal_id": pid, "selected": [0], "corrections": {}})
    assert response.status_code == 400
```

Märkus `prosopo_env.write` kohta: kontrolli `tests/conftest.py:292` fixture'ist, kas `write` võtab kaardi väljad kwargs'ina ja annab uue `updated_at`-i; kui ei anna, sea `updated_at` testis ise uueks väärtuseks.

`tests/test_prosopo_mcp_workflow.py` — lisa samasse testi pärast olemasolevat kinnitust (registrifixture mockib `save_config_with_git`-i, muidu proovib ta tmp-kataloogis git-commitit teha):

```python
    def write(path, data, username, message=None):
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        return {"success": True}
    monkeypatch.setattr(registries, "save_config_with_git", write)

    fresh = json.loads((await mcp.call_tool("get_person_enrichment_context",
                                            {"person_id": card["id"]})).content[0].text)["updated_at"]
    new_item = {"kind": "occupation", "match_status": "new_registry_candidate",
                "raw_occupation": "Feldprediger",
                "occupation_entry": {"key": "valipreester", "labels": {"et": "välipreester", "en": "military chaplain"},
                                     "variants": ["Feldprediger"]},
                "evidence": [{"source_kind": "literature", "source_id": "book1", "locator": "lk 9"}]}
    await mcp.call_tool("submit_person_enrichment_proposal", {
        "handoff_code": handoff.json()["code"], "person_id": card["id"],
        "base_updated_at": fresh, "items": [new_item]})
    pending = client.get(url, headers={"Authorization": f"Bearer {token}"}).json()[0]
    assert pending["items"][0]["review_state"] == {"state": "applicable"}
    done = client.post(f"{url}/apply", headers={"Authorization": f"Bearer {token}"},
                       json={"proposal_id": pending["proposal_id"], "selected": [0]})
    assert done.status_code == 200, done.text
    assert json.loads((registry / "occupations.json").read_text())["valipreester"]["labels"]["et"] == "välipreester"
    assert prosopo_env.read("abc")["occupations"][-1]["occupation_key"] == "valipreester"
```

(`citation`-i kontroll lisatakse samasse testi alles ülesandes 6.)

- [ ] **Samm 3: käivita, peab kukkuma**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py -q`
Oodatud: uued testid FAIL (reject 404/405, apply loob fakti ilma registrikirjeta → `unresolved_match` jne).

- [ ] **Samm 4: teostus — `enrichment_proposals.py`.** Asenda kogu `apply_selected` järgmisega:

```python
class ApplyError(ProposalError):
    """Kinnitus kukkus pärast registrikirjete loomist. Kirjed jäävad alles — nad on
    iseseisvad ja järgmine katse seob nendega (`ensure`)."""

    def __init__(self, message: str, created: list[str]):
        super().__init__(message)
        self.created = created


def _open_proposal(db, proposal_id: str, person_id: str, username: str):
    row = db.execute(
        "SELECT * FROM proposal WHERE id=? AND person_id=? AND username=? AND applied_at IS NULL AND expires_at>?",
        (proposal_id, person_id, username, int(time.time())),
    ).fetchone()
    if row is None:
        raise ProposalError("proposal_not_found")
    return row


def _check_selection(selected, count: int) -> None:
    if (not isinstance(selected, list) or not selected or len(selected) > MAX_ITEMS
            or any(not isinstance(i, int) or isinstance(i, bool) or not 0 <= i < count
                   for i in selected)
            or len(set(selected)) != len(selected)):
        raise ProposalError("invalid_selection")


def _close_rows(db, proposal_id: str, items: list, selected: list[int]) -> int:
    """Eemaldab otsustatud read; tühi ettepanek suletakse."""
    remaining = [item for index, item in enumerate(items) if index not in set(selected)]
    if remaining:
        db.execute("UPDATE proposal SET payload=? WHERE id=? AND applied_at IS NULL",
                   (json.dumps(remaining, ensure_ascii=False), proposal_id))
    else:
        db.execute("UPDATE proposal SET applied_at=? WHERE id=? AND applied_at IS NULL",
                   (int(time.time()), proposal_id))
    return len(remaining)


def apply_selected(proposal_id: str, person_id: str, username: str,
                   session_fingerprint: str, selected: list[int]) -> dict:
    """Kinnitus kolmes sammus: eelkontroll (ei kirjuta) → registrikirjed → kaart üks kord.
    Kõik-või-mitte-midagi kaardi suhtes, mitte registri suhtes (vt `ApplyError`)."""
    from . import registries
    from .person_crud import get_person, update_person

    with _db() as db:
        row = _open_proposal(db, proposal_id, person_id, username)
        items = json.loads(row["payload"])
        _check_selection(selected, len(items))
        person = get_person(person_id)
        if person is None or person.get("record_status") == "tombstone" or person.get("merged_into"):
            raise ProposalError("person_not_found")
        occupations = list(person.get("occupations") or [])
        education = list(person.get("education") or [])
        # 1. Eelkontroll elava kaardi ja registri vastu; kaardi loendid ehitatakse koopiasse.
        for index in selected:
            try:
                _merge_row(items[index], occupations, education)
            except ProposalError as error:
                raise ProposalError(f"items[{index}]: {error}") from None
        created: list[str] = []
        try:
            # 2. Registrikirjed. Vahepeal loodud sama kirje seotakse, erinev kukub.
            for index in selected:
                for kind, field, _ in _ENTRY_FIELDS:
                    if not items[index].get(field):
                        continue
                    key, data = _split_entry(items[index][field])
                    try:
                        _, was_created = registries.ensure(kind, key, data, username)
                    except registries.RegistryError as error:
                        raise ProposalError(f"items[{index}]: {error}: {key}") from None
                    if was_created:
                        created.append(key)
            # 3. Kaart. update_person kontrollib versiooni isikuluku all teist korda.
            try:
                updated = update_person(person_id, {
                    "updated_at": person["updated_at"],
                    "occupations": occupations, "education": education,
                }, username)
            except ValueError as error:
                if str(error).startswith("conflict:"):
                    raise ProposalError("stale_person") from None
                raise ProposalError(str(error)) from None
        except ProposalError as error:
            if created:
                raise ApplyError(str(error), created) from None
            raise
        _close_rows(db, proposal_id, items, selected)
    return updated


def reject_selected(proposal_id: str, person_id: str, username: str,
                    selected: list[int]) -> dict:
    """Toimetaja lükkab read tagasi; kaarti ega registrit ei puudutata."""
    with _db() as db:
        row = _open_proposal(db, proposal_id, person_id, username)
        items = json.loads(row["payload"])
        _check_selection(selected, len(items))
        remaining = _close_rows(db, proposal_id, items, selected)
    return {"proposal_id": proposal_id, "remaining": remaining}
```

NB: testis `test_kaardi_kukkumine…` mockitakse `person_crud.update_person`; kuna `apply_selected` impordib funktsiooni sisse (`from .person_crud import … update_person`), võtab ta mockitud versiooni. Ära muuda importi mooduli tasemele.

- [ ] **Samm 5: teostus — `router.py`.** Asenda apply-otspunkt ja lisa reject:

```python
async def _decision_body(request: Request) -> dict:
    """Kinnituse ja tagasilükkamise ühine keha {proposal_id, selected}."""
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 128_000:
            raise HTTPException(status_code=413, detail="apply_request_too_large")
    try:
        data = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="invalid_apply_request")
    if (not isinstance(data, dict) or set(data) != {"proposal_id", "selected"}
            or not isinstance(data["proposal_id"], str)):
        raise HTTPException(status_code=400, detail="invalid_apply_request")
    return data


_APPLY_CONFLICTS = ("stale_person", "duplicate_entry", "unresolved_existing_entry",
                    "registry_conflict", "duplicate_id")


@router.post("/enrichment-proposals/{person_id}/apply")
async def prosopography_apply_enrichment_proposal(
    person_id: str, request: Request, user=Depends(require_role("superadmin")),
):
    """Toimetaja kinnitab valitud read oma sessioonis; MCP ei saa seda kutsuda."""
    if not enrichment_proposals.valid_person_id(person_id):
        raise HTTPException(status_code=400, detail="invalid_person_id")
    data = await _decision_body(request)
    try:
        return await run_in_threadpool(
            enrichment_proposals.apply_selected, data["proposal_id"], person_id,
            user["username"], request.state.session_fingerprint, data["selected"],
        )
    except enrichment_proposals.ApplyError as e:
        raise HTTPException(status_code=409, detail={
            "error": str(e), "created_registry_entries": e.created})
    except enrichment_proposals.ProposalError as e:
        status = 409 if any(code in str(e) for code in _APPLY_CONFLICTS) else 400
        raise HTTPException(status_code=status, detail=str(e))


@router.post("/enrichment-proposals/{person_id}/reject")
async def prosopography_reject_enrichment_proposal(
    person_id: str, request: Request, user=Depends(require_role("superadmin")),
):
    """Eemaldab read ettepanekust; kaart ja register jäävad puutumata."""
    if not enrichment_proposals.valid_person_id(person_id):
        raise HTTPException(status_code=400, detail="invalid_person_id")
    data = await _decision_body(request)
    try:
        return await run_in_threadpool(
            enrichment_proposals.reject_selected, data["proposal_id"], person_id,
            user["username"], data["selected"],
        )
    except enrichment_proposals.ProposalError as e:
        raise HTTPException(status_code=400, detail=str(e))
```

`ApplyError` peab olema `except`-is ENNE `ProposalError`-it (alamklass).

- [ ] **Samm 6: käivita**

Run: `.venv/bin/pytest tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py tests/test_prosopo_registries.py -q`
Oodatud: kõik PASS.

- [ ] **Samm 7: commit**

```bash
git add server/prosopography/enrichment_proposals.py server/prosopography/router.py tests/test_prosopo_enrichment_proposals.py tests/test_prosopo_mcp_workflow.py
git commit -m "feat(prosopography): kinnitus loob registrikirje, vananemine rea tasemel, tagasilükkamine"
```

---

### Ülesanne 6: MCP — loetav kirjanduse viide ja agendi juhis

**Failid:**
- Muuda: `mcp/vutt_mcp/library/tools.py` (`unknown_doc_ids` → `literature_citations`)
- Muuda: `mcp/vutt_mcp/server.py` (`_check_literature_evidence`, kahe tööriista docstring)
- Test: `mcp/tests/test_persons.py`, `tests/test_prosopo_mcp_workflow.py`

**Liidesed:**
- Toodab: `literature_citations(settings: LibrarySettings, doc_ids: set[str]) -> dict[str, str] | None` — `{doc_id: format_citation(...)}` ainult kogus olevatele; `None` = kogu pole masinas.

- [ ] **Samm 1: kirjuta kukkuv test** — `mcp/tests/test_persons.py`, pärast `test_kirjanduse_toend_peab_olema_kogu_doc_id`:

```python
async def test_kirjanduse_toendile_lisatakse_kogu_viide(tmp_path, monkeypatch):
    """Agendi oma `citation` kirjutatakse üle kogu rea põhjal."""
    from vutt_mcp.library.schema import connect, create_schema

    db = tmp_path / "kogu.db"
    conn = connect(db)
    create_schema(conn)
    conn.execute("INSERT INTO documents (doc_id, parent_key, title, year, creators_json) "
                 "VALUES ('DOC1', 'P1', 'An Itinerant Sheep', '2012', ?)",
                 (json.dumps([["Stefan Donecker", "author"]]),))
    conn.commit()
    conn.close()
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(db))

    class ProposalClient(FakeClient):
        def api_post_once(self, path, json_body):
            self.posts.append((path, json_body))
            return {"proposal_id": "prop1", "status": "pending"}

    client = ProposalClient()
    server = build_server(client=client, base_url=BASE)
    item = _kirjanduse_ettepanek("DOC1")
    item["evidence"][0]["citation"] = "agendi oma"
    await server.call_tool("submit_person_enrichment_proposal", {
        "handoff_code": "c", "person_id": "vutt:Pabc", "base_updated_at": "t", "items": [item]})
    sent = client.posts[0][1]["items"][0]["evidence"][0]
    assert sent["citation"] == "Donecker 2012, An Itinerant Sheep"
```

Kontrolli `creators_json` kuju `format_citation`-i järgi (`for n, _ in doc.creators` → paaride list); kui `json` pole faili päises imporditud, lisa. `tests/test_prosopo_mcp_workflow.py`: lisa ülesandes 5 kirjeldatud rida `assert pending["items"][0]["evidence"][0]["citation"].endswith("Raamat")`.

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests/test_persons.py -q -k kirjanduse`
Oodatud: FAIL — `citation == "agendi oma"`.

- [ ] **Samm 3: teostus.** `mcp/vutt_mcp/library/tools.py` — asenda `unknown_doc_ids`:

```python
def literature_citations(settings: LibrarySettings, doc_ids: set[str]) -> dict[str, str] | None:
    """Kogus olevate doc_id-de loetav viide; puuduvaid vastuses pole. None = kogu
    pole selles masinas olemas.

    Server ei näe kirjanduskogu (see elab agendi masinas), seega kontrollib ja
    tsiteerib ettepaneku `literature`-tõendi siin enne saatmist."""
    if not library_available(settings):
        return None
    if not doc_ids:
        return {}
    conn = _ava(settings)
    try:
        kohataited = ",".join("?" * len(doc_ids))
        return {
            r["doc_id"]: fmt.format_citation(_doc_row(r))
            for r in conn.execute(
                f"SELECT * FROM documents WHERE doc_id IN ({kohataited})", list(doc_ids))
        }
    finally:
        conn.close()
```

Lisa `_doc_row` importi `from .query import (...)` loendisse. Kontrolli `grep -rn unknown_doc_ids mcp/`: pärast muudatust ei tohi jääda ühtki viidet.

`mcp/vutt_mcp/server.py` — `_check_literature_evidence`:

```python
def _check_literature_evidence(items: list) -> None:
    """`literature`-tõend peab olema kirjanduskogu päris doc_id (server kogu ei näe).
    Igale tõendile kirjutatakse loetav `citation` kogu reast — doc_id (Zotero võti)
    on toimetajale loetamatu; agendi oma viide asendatakse."""
    from .library.config import load_library_settings
    from .library.tools import literature_citations

    sources = [source for item in items if isinstance(item, dict)
               for source in (item.get("evidence") or []) if isinstance(source, dict)
               and source.get("source_kind") == "literature"]
    if not sources:
        return
    doc_ids = {source.get("source_id") for source in sources}
    if any(not isinstance(doc_id, str) or not doc_id for doc_id in doc_ids):
        raise VuttError("literature-tõendi source_id peab olema list_literature'i doc_id.")
    citations = literature_citations(load_library_settings(), doc_ids)
    if citations is None:
        raise VuttError(
            "Kirjanduskogu ei ole selles masinas saadaval, literature-tõendit ei saa "
            "kontrollida. Kasuta vutt_page tõendit või jäta kirje esitamata.")
    unknown = doc_ids - set(citations)
    if unknown:
        raise VuttError(
            f"Tundmatu kirjanduskogu doc_id {sorted(unknown)}: source_id peab olema "
            "list_literature'i doc_id, mitte pealkiri. Kui allikat kogus ei ole, ära "
            "esita seda tõendina — ütle kasutajale, et allikas on väärt lisamist "
            "(autor, pealkiri, aasta, URL), ta lisab selle kirjanduskogusse.")
    for source in sources:
        source["citation"] = citations[source["source_id"]][:500]
```

Tööriistade juhis. `search_enrichment_registry` docstring — asenda viimane lõik („Variant või osaline tabamus…") järgmisega:

```text
        VALI LÄHIM OLEMASOLEV KIRJE: kõige täpsem, mis veel sobib
        („Feldprediger" → kaplan). Kui täpsemat pole, sobib laiem (vaimulik);
        detail jääb raw_occupation'i allika sõnastuses. Mitme võrdse vaste korral
        ära vali pimesi. Kui registry_available=false, pole register kasutusel
        ja tühi loend EI tähenda uut kirjet.
```

`submit_person_enrichment_proposal` docstring — asenda `existing_index` rida ja lisa pärast `occupation_key…` punkti:

```text
        - existing_index: valikuline vihje (sama liigi kirje indeks
          get_person_enrichment_context'is); server leiab kirje SISU järgi
        - occupation_entry / institution_entry: UUS registrikirje, ainult kui
          ükski olemasolev ei sobi ka laiemalt. {"key": "valipreester",
          "labels": {"et": ..., "en": ...}, "id": "Q…" (kui Wikidatas on),
          "variants": [allika sõnastus]}; institution_entry lisaks "type" ja
          valikuline "place_key". Nõuab match_status="new_registry_candidate";
          vastav *_key puudub või võrdub key-ga. Liiga detailne amet ei ole
          registrikirje põhjus — vali lähim olemasolev.
        - ambiguous rida toimetaja kinnitada ei saa — lahenda vaste ise.
```

ja lause „Toimetaja otsustab VUTT-i vormis iga rea eraldi." → „Toimetaja ainult kinnitab või lükkab rea tagasi; parandused teeb ta hiljem kaardil — esita seega kohe õige võti ja aeg." Literature-tõendi näitesse lisa: „`citation` täidab MCP ise kirjanduskogust".

- [ ] **Samm 4: käivita**

Run: `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests -q && .venv/bin/pytest tests/test_prosopo_mcp_workflow.py -q`
Oodatud: kõik PASS (sh `test_meili_contract`, `test_server_smoke`).

- [ ] **Samm 5: commit**

```bash
git add mcp/vutt_mcp/library/tools.py mcp/vutt_mcp/server.py mcp/tests/test_persons.py tests/test_prosopo_mcp_workflow.py
git commit -m "feat(mcp): kirjanduse tõend saab loetava viite; juhis: lähim registrikirje, uus erandina"
```

---

### Ülesanne 7: frontendi teenus, tõendiviide ja pealkirjad

**Failid:**
- Muuda: `src/prosopography/services/prosopographyService.ts`
- Loo: `src/prosopography/utils/evidenceRef.ts`, `src/prosopography/utils/__tests__/evidenceRef.test.ts`
- Loo: `src/prosopography/hooks/useWorkTitles.ts`
- Loo: `src/prosopography/components/EvidenceList.tsx`

**Liidesed:**
- Toodab (teenus): `EnrichmentEvidence` + `citation?: string`; `EnrichmentRegistryEntry = { key: string; id?: string | null; labels: Record<string, string>; variants?: string[]; type?: string; place_key?: string | null }`; `EnrichmentItem` + `occupation_entry?`, `institution_entry?`, `registry_ids?: Record<string, string>`, `review_state: { state: 'applicable' | 'already_present' | 'blocked'; reason?: string }` (`review_error` eemaldatud); `applyEnrichmentProposal(personId, proposalId, selected: number[], token): Promise<ProsopoRecord>`; `rejectEnrichmentProposal(personId, proposalId, selected: number[], token): Promise<{ remaining: number }>`; `class EnrichmentApplyError extends Error { created: string[] }`. `EnrichmentCorrection` eemaldatakse.
- Toodab (abiline): `evidenceRef(source: EnrichmentEvidence, titleOf: (workId: string) => string | undefined, pageLabel: string): { href: string | null; external: boolean; title: string; locator: string; quote: string }`; `evidenceWorkIds(entries: Array<{ evidence?: unknown }>): string[]`.
- Toodab (hook): `useWorkTitles(workIds: string[], token?: string): Record<string, string>`.
- Toodab (komponent): `EvidenceList({ evidence, titleOf, onRemove? }: { evidence: EnrichmentEvidence[]; titleOf: (id: string) => string | undefined; onRemove?: (index: number) => void })`.

- [ ] **Samm 1: kirjuta kukkuv test** `src/prosopography/utils/__tests__/evidenceRef.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { evidenceRef, evidenceWorkIds } from '../evidenceRef';

const titles: Record<string, string> = { w1: 'Consuetudines' };
const titleOf = (id: string) => titles[id];

describe('evidenceRef', () => {
  it('VUTT-i leht: link teose lehele, pealkiri, trükise number eelistatud', () => {
    expect(evidenceRef({ source_kind: 'vutt_page', work_id: 'w1', page: 5, printed_page: '3',
      quote: 'Notarius publicus' }, titleOf, 'lk')).toEqual({
      href: '/work/w1/5', external: false, title: 'Consuetudines', locator: 'lk 3', quote: 'Notarius publicus' });
  });
  it('tundmatu teos: pealkirja asemel work_id', () => {
    expect(evidenceRef({ source_kind: 'vutt_page', work_id: 'zz', page: 2 }, titleOf, 'lk').title).toBe('zz');
  });
  it('kirjandus: citation + locator; vanal tõendil source_id', () => {
    expect(evidenceRef({ source_kind: 'literature', source_id: 'ABC', citation: 'Donecker 2012, X',
      locator: 'lk 4' }, titleOf, 'lk')).toMatchObject({ href: null, title: 'Donecker 2012, X', locator: 'lk 4' });
    expect(evidenceRef({ source_kind: 'literature', source_id: 'ABC', locator: 'lk 4' }, titleOf, 'lk').title).toBe('ABC');
  });
  it('vana veebitõend: link ainult http(s) URL-ile', () => {
    expect(evidenceRef({ source_kind: 'external', url: 'https://sok.riksarkivet.se/x' }, titleOf, 'lk'))
      .toMatchObject({ href: 'https://sok.riksarkivet.se/x', external: true });
    expect(evidenceRef({ source_kind: 'external', url: 'javascript:alert(1)' }, titleOf, 'lk'))
      .toMatchObject({ href: null, title: 'javascript:alert(1)' });
  });
  it('pikk katke lühendatakse', () => {
    const ref = evidenceRef({ source_kind: 'vutt_page', work_id: 'w1', page: 1, quote: 'x'.repeat(300) }, titleOf, 'lk');
    expect(ref.quote.length).toBeLessThanOrEqual(161);
    expect(ref.quote.endsWith('…')).toBe(true);
  });
  it('evidenceWorkIds kogub unikaalsed work_id-d', () => {
    expect(evidenceWorkIds([{ evidence: [{ source_kind: 'vutt_page', work_id: 'a' }, { source_kind: 'vutt_page', work_id: 'a' }] },
      { evidence: [{ source_kind: 'literature', source_id: 'L' }] }, {}])).toEqual(['a']);
  });
});
```

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `npx vitest run src/prosopography/utils/__tests__/evidenceRef.test.ts`
Oodatud: FAIL — moodulit ei leita.

- [ ] **Samm 3: teostus.** `src/prosopography/utils/evidenceRef.ts`:

```ts
import type { EnrichmentEvidence } from '../services/prosopographyService';

const QUOTE_MAX = 160;

export interface EvidenceRef {
  href: string | null;
  /** Välislink (vana veebitõend) avaneb uues aknas; VUTT-i leht on sisemine marsruut. */
  external: boolean;
  title: string;
  locator: string;
  quote: string;
}

/** Tõend → loetav viide. Linki antakse ainult VUTT-i lehele ja http(s)-URL-ile:
 *  vanadel kaartidel on veebitõendeid, mille `url` on vaba string. */
export function evidenceRef(source: EnrichmentEvidence,
  titleOf: (workId: string) => string | undefined, pageLabel: string): EvidenceRef {
  const quote = source.quote && source.quote.length > QUOTE_MAX
    ? `${source.quote.slice(0, QUOTE_MAX)}…` : (source.quote ?? '');
  if (source.source_kind === 'vutt_page' && source.work_id) {
    const page = source.printed_page || (source.page ? String(source.page) : '');
    return {
      href: `/work/${encodeURIComponent(source.work_id)}/${source.page ?? 1}`, external: false,
      title: titleOf(source.work_id) || source.work_id,
      locator: page ? `${pageLabel} ${page}` : '', quote,
    };
  }
  const url = source.url && /^https?:\/\//i.test(source.url) ? source.url : null;
  return {
    href: url, external: Boolean(url),
    title: source.citation || source.source_id || source.url || source.source_kind,
    locator: source.locator ?? '', quote,
  };
}

/** Kõigi kirjete tõendite unikaalsed work_id-d (pealkirjade päringuks). */
export function evidenceWorkIds(entries: Array<{ evidence?: unknown }>): string[] {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!Array.isArray(entry?.evidence)) continue;
    for (const source of entry.evidence as EnrichmentEvidence[]) {
      if (source?.source_kind === 'vutt_page' && source.work_id) ids.add(source.work_id);
    }
  }
  return [...ids];
}
```

`src/prosopography/hooks/useWorkTitles.ts`:

```ts
import { useEffect, useState } from 'react';
import { getWorkTitles } from '../services/prosopographyService';

/** Teoste pealkirjad tõendiviidetele. Server annab pealkirja ka kaitstud teosele;
 *  puuduv pealkiri → kutsuja näitab work_id-d. */
export function useWorkTitles(workIds: string[], token?: string): Record<string, string> {
  const key = [...new Set(workIds)].sort().join('|');
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!key) { setTitles({}); return; }
    let alive = true;
    void getWorkTitles(key.split('|'), token).then(map => {
      if (alive) setTitles(Object.fromEntries(Object.entries(map).map(([id, info]) => [id, info.title || id])));
    });
    return () => { alive = false; };
  }, [key, token]);
  return titles;
}
```

`src/prosopography/components/EvidenceList.tsx`:

```tsx
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { EnrichmentEvidence } from '../services/prosopographyService';
import { evidenceRef } from '../utils/evidenceRef';

interface Props {
  evidence: EnrichmentEvidence[];
  titleOf: (workId: string) => string | undefined;
  /** Isikuvormis saab tõendi eemaldada; muutmist ei ole (spekk 2026-09-28). */
  onRemove?: (index: number) => void;
}

export default function EvidenceList({ evidence, titleOf, onRemove }: Props) {
  const { t } = useTranslation('prosopography');
  return (
    <ul className="space-y-1 text-xs text-gray-600">
      {evidence.map((source, index) => {
        const ref = evidenceRef(source, titleOf, t('agentEnrichment.page'));
        return (
          <li key={index} className="flex items-start gap-2">
            <span className="flex-1 min-w-0">
              {ref.href && !ref.external
                ? <Link className="text-blue-700 underline" to={ref.href}>{ref.title}</Link>
                : ref.href
                  ? <a className="text-blue-700 underline" href={ref.href} target="_blank" rel="noopener noreferrer">{ref.title}</a>
                  : ref.title}
              {ref.locator && `, ${ref.locator}`}
              {ref.quote && <> — <q className="italic text-gray-500">{ref.quote}</q></>}
            </span>
            {onRemove && (
              <button type="button" onClick={() => onRemove(index)} aria-label={t('evidenceRemove')}
                className="text-gray-400 hover:text-red-500 shrink-0"><X size={12} /></button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
```

(`lucide-react` on juba kasutusel — `PersonEditPage` impordib `X`-i sealt.) Lisa `evidenceRemove` võti ülesandes 8 koos teiste lokaalivõtmetega; kuni selleni typecheck läbib, aga `translationKeysResolve` võib kukkuda — seepärast lisa see võti KOHE mõlemasse faili prosopography juurtasemele: et `"evidenceRemove": "Eemalda tõend"`, en `"evidenceRemove": "Remove evidence"`.

Teenus (`prosopographyService.ts`): uuenda tüüpe liidesebloki järgi; asenda `applyEnrichmentProposal` ja lisa:

```ts
/** Kinnitus kukkus pärast registrikirjete loomist: kirjed jäid alles, kaart muutmata. */
export class EnrichmentApplyError extends Error {
  created: string[];
  constructor(message: string, created: string[]) { super(message); this.created = created; }
}

export async function applyEnrichmentProposal(personId: string, proposalId: string,
  selected: number[], token: string): Promise<ProsopoRecord> {
  const response = await fetchWithTimeout(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ proposal_id: proposalId, selected }), timeout: 30000,
  });
  if (!response.ok) {
    const detail = await response.clone().json().then(body => body?.detail).catch(() => null);
    if (detail && typeof detail === 'object' && Array.isArray(detail.created_registry_entries)) {
      throw new EnrichmentApplyError(String(detail.error), detail.created_registry_entries);
    }
  }
  return enrichmentResponse(response);
}

export async function rejectEnrichmentProposal(personId: string, proposalId: string,
  selected: number[], token: string): Promise<{ proposal_id: string; remaining: number }> {
  const response = await fetchWithTimeout(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ proposal_id: proposalId, selected }), timeout: 15000,
  });
  return enrichmentResponse(response);
}
```

Timeout 30 s: kinnitus võib teha mitu git-commitit (registrikirjed + kaart). Kustuta `EnrichmentCorrection` ja `searchEnrichmentRegistry` + `EnrichmentRegistrySearch`/`EnrichmentRegistryCandidate` ALLES ülesandes 8, kui nende ainus kasutaja (`RegistryCandidatePicker`) on kustutatud.

- [ ] **Samm 4: käivita**

Run: `npx vitest run src/prosopography/utils/__tests__/evidenceRef.test.ts && npm run typecheck`
Oodatud: test PASS. Typecheck kukub `AgentEnrichmentPanel.tsx`-is (`review_error`, `corrections`) — see on oodatud ja parandatakse ülesandes 8; kui tahad rohelist commit'i, jäta `review_error?: string` ajutiselt tüüpi ja `applyEnrichmentProposal`-ile viies valikuline ignoreeritav parameeter `_corrections?: unknown`, mille ülesanne 8 eemaldab.

- [ ] **Samm 5: commit**

```bash
git add src/prosopography/services/prosopographyService.ts src/prosopography/utils/evidenceRef.ts src/prosopography/utils/__tests__/evidenceRef.test.ts src/prosopography/hooks/useWorkTitles.ts src/prosopography/components/EvidenceList.tsx src/locales/et/prosopography.json src/locales/en/prosopography.json
git commit -m "feat(prosopography): tõendiviite abiline, teoste pealkirjad ja tagasilükkamise teenus"
```

---

### Ülesanne 8: ülevaatuspaneel — Kinnita / Lükka tagasi

**Failid:**
- Kirjuta ümber: `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx`
- Kirjuta ümber: `src/prosopography/components/personForm/__tests__/AgentEnrichmentPanel.test.tsx`
- Kustuta: `src/prosopography/components/personForm/RegistryCandidatePicker.tsx`, `RegistryEntryForm.tsx` (ja nende testid, kui on: `ls src/prosopography/components/personForm/__tests__`)
- Muuda: `src/prosopography/services/prosopographyService.ts` (eemalda ülesande 7 ajutised jäänused, `EnrichmentCorrection`, `searchEnrichmentRegistry`, `EnrichmentRegistrySearch`, `EnrichmentRegistryCandidate` — kontrolli `grep -rn` et mujal kasutust ei ole)
- Muuda: `src/prosopography/pages/PersonEditPage.tsx:785` (nähtavus)
- Muuda: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json`

**Liidesed:**
- Tarbib: `applyEnrichmentProposal`, `rejectEnrichmentProposal`, `EnrichmentApplyError`, `EnrichmentItem.review_state`, `useWorkTitles`, `EvidenceList`, `evidenceWorkIds`.
- Props jääb samaks: `{ person, token, isDirty, onApplied }`.

- [ ] **Samm 1: kirjuta kukkuvad testid** — asenda kogu testifail:

```tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../relations/__tests__/testI18n';
import type { ProsopoRecord } from '../../../types';

const { handoff, list, apply, reject, titles } = vi.hoisted(() => ({
  handoff: vi.fn(), list: vi.fn(), apply: vi.fn(), reject: vi.fn(), titles: vi.fn(),
}));
vi.mock('../../../services/prosopographyService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/prosopographyService')>(
    '../../../services/prosopographyService');
  return {
    EnrichmentApplyError: actual.EnrichmentApplyError,
    createEnrichmentHandoff: handoff, listEnrichmentProposals: list,
    applyEnrichmentProposal: apply, rejectEnrichmentProposal: reject, getWorkTitles: titles,
  };
});
import AgentEnrichmentPanel from '../AgentEnrichmentPanel';
import { EnrichmentApplyError } from '../../../services/prosopographyService';

const person = { id: 'vutt:Pabc', updated_at: 'v1', occupations: [], education: [] } as unknown as ProsopoRecord;
const ev = (quote: string) => [{ source_kind: 'vutt_page', work_id: 'w1', page: 5, printed_page: '3', quote }];
const proposal = {
  proposal_id: 'p1', person_id: person.id, base_updated_at: 'v0', created_at: 1, expires_at: 9999999999,
  items: [
    { kind: 'occupation', match_status: 'matched', raw_occupation: 'Notarius publicus',
      occupation_key: 'notar', registry_labels: { occupation_key: 'notar' }, registry_ids: { occupation_key: 'Q189010' },
      review_state: { state: 'applicable' }, evidence: ev('Notarius publicus Wolgastensis') },
    { kind: 'occupation', match_status: 'new_registry_candidate', raw_occupation: 'Feldprediger',
      occupation_key: 'valipreester', occupation_entry: { key: 'valipreester', labels: { et: 'välipreester', en: 'military chaplain' }, variants: ['Feldprediger'] },
      registry_labels: { occupation_key: 'välipreester' }, review_state: { state: 'applicable' }, evidence: ev('Feldprediger') },
    { kind: 'education', match_status: 'already_present', raw_institution: 'Rostock', institution_key: 'rostock',
      registry_labels: { institution_key: 'Rostocki ülikool' }, review_state: { state: 'already_present' }, evidence: ev('Rostochii') },
    { kind: 'occupation', match_status: 'matched', raw_occupation: 'Pastor', occupation_key: 'pastor',
      registry_labels: {}, review_state: { state: 'blocked', reason: 'duplicate_entry' }, evidence: ev('Pastor') },
  ],
};

const renderPanel = (onApplied = vi.fn(), isDirty = false) => render(<MemoryRouter>
  <AgentEnrichmentPanel person={person} token="tok" isDirty={isDirty} onApplied={onApplied} /></MemoryRouter>);

beforeEach(() => {
  for (const fn of [handoff, list, apply, reject, titles]) fn.mockReset();
  list.mockResolvedValue([proposal]);
  titles.mockResolvedValue({ w1: { title: 'Consuetudines', year: 1632, restricted: false } });
  apply.mockResolvedValue({ ...person, updated_at: 'v2' });
  reject.mockResolvedValue({ proposal_id: 'p1', remaining: 3 });
  handoff.mockResolvedValue({ code: 'code-1', expires_at: 9999999999 });
});

describe('agendi ettepanekute ülevaatus', () => {
  it('näitab kolme olekut, registrikirjet, tõendit ja blokeeritud rea põhjust', async () => {
    renderPanel();
    expect(await screen.findAllByText('registris')).toHaveLength(2);   // read 0 ja 3
    expect(screen.getByText('uus registrisse')).toBeTruthy();
    expect(screen.getByText('juba kaardil')).toBeTruthy();
    expect(screen.getByText('Q189010')).toBeTruthy();
    expect(screen.getByText(/military chaplain/)).toBeTruthy();
    expect(await screen.findAllByText('Consuetudines')).toHaveLength(4);
    expect(screen.getByText(/Sama fakt on kaardil juba olemas/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Lisa tõend' })).toBeTruthy();
    const confirms = screen.getAllByRole('button', { name: 'Kinnita' });
    expect(confirms).toHaveLength(3);
    expect((confirms[2] as HTMLButtonElement).disabled).toBe(true);   // blokeeritud rida
  });

  it('Kinnita kutsub apply ühe reaga ja annab kaardi tagasi', async () => {
    const onApplied = vi.fn();
    renderPanel(onApplied);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Kinnita' }))[0]);
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'p1', [0], 'tok'));
    expect(onApplied).toHaveBeenCalledWith(expect.objectContaining({ updated_at: 'v2' }));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('Kinnita kõik saadab kõik mitte-blokeeritud read', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Kinnita kõik (3)' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith(person.id, 'p1', [0, 1, 2], 'tok'));
  });

  it('Lükka tagasi kutsub reject-i', async () => {
    renderPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Lükka tagasi' }))[3]);
    await waitFor(() => expect(reject).toHaveBeenCalledWith(person.id, 'p1', [3], 'tok'));
  });

  it('loodud registrikirjete teade', async () => {
    apply.mockRejectedValue(new EnrichmentApplyError('stale_person', ['valipreester']));
    renderPanel();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Kinnita' }))[1]);
    expect(await screen.findByText(/Registrikirjed valipreester loodi, kaarti ei muudetud/)).toBeTruthy();
  });

  it('salvestamata vorm lukustab otsused', async () => {
    renderPanel(vi.fn(), true);
    const confirms = await screen.findAllByRole('button', { name: 'Kinnita' });
    expect(confirms.every(button => (button as HTMLButtonElement).disabled)).toBe(true);
    expect((screen.getByRole('button', { name: 'Kinnita kõik (3)' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('kood kõigile isikutele', async () => {
    handoff.mockResolvedValue({ code: 'any-code', expires_at: 9999999999, scope: 'any', max_uses: 200 });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Kood kõigile isikutele' }));
    await waitFor(() => expect(handoff).toHaveBeenCalledWith(null, 'tok'));
    expect(await screen.findByText('any-code')).toBeTruthy();
  });
});
```

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `npx vitest run src/prosopography/components/personForm/__tests__/AgentEnrichmentPanel.test.tsx`
Oodatud: FAIL (vana paneel, puuduvad nupud ja tekstid).

- [ ] **Samm 3: lokaalivõtmed.** `agentEnrichment` plokis: kustuta võtmed `occupationSearch, institutionSearch, registryUnavailable, noRegistryMatches, askAdmin, multipleMatches, moreMatches, editorChoice, correctDetails, from, to, locator, quote, stale, noKey, registryMissing, originalWarning, registryMatch, matchedVariant, institutionPlace, noMappedPlace, applySelected, addEvidence, linkExisting, registryForm, status` (mõlemas keeles). Enne kustutamist: `grep -rn "agentEnrichment\.<võti>\|'<võti>'" src --include=*.tsx --include=*.ts` — ühtki kasutust väljaspool kustutatavaid faile ei tohi olla. `evidenceCount` jääb kuni ülesandeni 9.

Lisa `agentEnrichment` plokki (et / en):

```json
"confirm": "Kinnita", "addEvidenceShort": "Lisa tõend", "reject": "Lükka tagasi",
"confirmAll": "Kinnita kõik ({{count}})",
"badgeRegistry": "registris", "badgeNew": "uus registrisse", "badgePresent": "juba kaardil",
"newEntry": "Uus registrikirje", "variants": "variandid",
"rowCount": "{{count}} rida", "expiresShort": "aegub",
"rejected": "Rida lükati tagasi.",
"createdButNotSaved": "Registrikirjed {{keys}} loodi, kaarti ei muudetud. Proovi uuesti: kinnitus seob nüüd olemasolevate kirjetega.",
"reason": {
  "duplicate_entry": "Sama fakt on kaardil juba olemas.",
  "unresolved_existing_entry": "Kaardilt ei leitud üheselt kirjet, millele tõend lisada.",
  "registry_key_missing": "Registrivõti puudub; palu agendil valida registrikirje.",
  "ambiguous_match": "Agent ei valinud registrikirjet; palu tal vaste lahendada.",
  "registry_conflict": "Registris on sama võtmega teine kirje.",
  "duplicate_id": "See Q-kood on registris teisel kirjel.",
  "unknown_occupation_key": "Ametiregistris sellist kirjet pole.",
  "unknown_institution_key": "Asutuste registris sellist kirjet pole.",
  "unknown_place_key": "Kohtade registris sellist kirjet pole.",
  "person_not_found": "Isikut ei leitud.",
  "other": "Rida ei saa kinnitada."
}
```

```json
"confirm": "Confirm", "addEvidenceShort": "Add evidence", "reject": "Reject",
"confirmAll": "Confirm all ({{count}})",
"badgeRegistry": "in registry", "badgeNew": "new to registry", "badgePresent": "already on card",
"newEntry": "New registry entry", "variants": "variants",
"rowCount": "{{count}} rows", "expiresShort": "expires",
"rejected": "Row rejected.",
"createdButNotSaved": "Registry entries {{keys}} were created; the card was not changed. Try again: confirming now links to the existing entries.",
"reason": {
  "duplicate_entry": "The same fact is already on the card.",
  "unresolved_existing_entry": "No single matching card entry to add the evidence to.",
  "registry_key_missing": "No registry key; ask the agent to choose a registry entry.",
  "ambiguous_match": "The agent did not choose a registry entry; ask it to resolve the match.",
  "registry_conflict": "The registry has a different entry under the same key.",
  "duplicate_id": "This Q-code belongs to another registry entry.",
  "unknown_occupation_key": "No such entry in the occupation registry.",
  "unknown_institution_key": "No such entry in the institution registry.",
  "unknown_place_key": "No such entry in the place registry.",
  "person_not_found": "Person not found.",
  "other": "This row cannot be confirmed."
}
```

- [ ] **Samm 4: kirjuta paneel ümber** — `AgentEnrichmentPanel.tsx` terviktekst:

```tsx
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProsopoRecord } from '../../types';
import {
  applyEnrichmentProposal, createEnrichmentHandoff, EnrichmentApplyError, listEnrichmentProposals,
  rejectEnrichmentProposal, type EnrichmentDate, type EnrichmentItem, type EnrichmentProposal,
} from '../../services/prosopographyService';
import EvidenceList from '../EvidenceList';
import { useWorkTitles } from '../../hooks/useWorkTitles';
import { evidenceWorkIds } from '../../utils/evidenceRef';

interface Props {
  person: ProsopoRecord;
  token: string;
  isDirty: boolean;
  onApplied: (person: ProsopoRecord) => void;
}

// Põhjuse kood on serveri vea algus („registry_conflict: valipreester"); tundmatu → „other".
const KNOWN_REASONS = new Set(['duplicate_entry', 'unresolved_existing_entry', 'registry_key_missing',
  'ambiguous_match', 'registry_conflict', 'duplicate_id', 'unknown_occupation_key',
  'unknown_institution_key', 'unknown_place_key', 'person_not_found']);

const yearOf = (value?: EnrichmentDate | null) => value?.date?.slice(0, 4) ?? '';
const period = (item: EnrichmentItem) => {
  const from = yearOf(item.date_from), to = yearOf(item.date_to);
  return from || to ? `${from}–${to}` : '';
};

/** Ülevaatus = otsus: Kinnita või Lükka tagasi. Olek tuleb serverist (`review_state`),
 *  parandused tehakse pärast tavalises isikuvormis (spekk 2026-09-28). */
export default function AgentEnrichmentPanel({ person, token, isDirty, onApplied }: Props) {
  const { t } = useTranslation('prosopography');
  const tr = (key: string, options?: Record<string, unknown>) => t(`agentEnrichment.${key}`, options);
  const [proposals, setProposals] = useState<EnrichmentProposal[]>([]);
  const [code, setCode] = useState('');
  const [codeExpiry, setCodeExpiry] = useState(0);
  const [codeScope, setCodeScope] = useState<{ any: boolean; max: number }>({ any: false, max: 0 });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const titles = useWorkTitles(evidenceWorkIds(proposals.flatMap(p => p.items)), token);
  const titleOf = (id: string) => titles[id];

  const refresh = useCallback(async () => {
    try { setProposals(await listEnrichmentProposals(person.id, token)); }
    catch (err) { setError((err as Error).message); }
  }, [person.id, token]);

  useEffect(() => { setCode(''); setError(''); void refresh(); }, [refresh]);

  const createCode = async (anyPerson = false) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await createEnrichmentHandoff(anyPerson ? null : person.id, token);
      setCode(result.code); setCodeExpiry(result.expires_at);
      setCodeScope({ any: result.scope === 'any', max: result.max_uses ?? 0 });
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };

  const decide = async (proposal: EnrichmentProposal, indices: number[], confirm: boolean) => {
    if (busy || isDirty || !indices.length) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (confirm) {
        onApplied(await applyEnrichmentProposal(person.id, proposal.proposal_id, indices, token));
        setMessage(tr('saved'));
      } else {
        await rejectEnrichmentProposal(person.id, proposal.proposal_id, indices, token);
        setMessage(tr('rejected'));
      }
    } catch (err) {
      setError(err instanceof EnrichmentApplyError
        ? tr('createdButNotSaved', { keys: err.created.join(', ') })
        : (err as Error).message);
    } finally {
      // Ka vea järel: rea olek (nt vahepeal tekkinud duplikaat) tuleb serverist.
      await refresh();
      setBusy(false);
    }
  };

  const reasonText = (reason = '') => {
    const codeOf = reason.match(/^[a-z_]+/)?.[0] ?? '';
    return KNOWN_REASONS.has(codeOf) ? tr(`reason.${codeOf}`) : `${tr('reason.other')} (${reason})`;
  };

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4 space-y-3" aria-label={tr('title')}>
      <h3 className="font-semibold text-sm">{tr('title')}</h3>
      <p className="text-xs text-gray-600">{tr('intro')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void createCode()} disabled={busy || isDirty}
          className="px-3 py-1.5 rounded bg-blue-700 text-white text-sm disabled:opacity-50">{tr('createCode')}</button>
        <button type="button" onClick={() => void createCode(true)} disabled={busy}
          className="px-3 py-1.5 rounded border border-blue-700 text-blue-800 text-sm disabled:opacity-50">{tr('createCodeAny')}</button>
        <button type="button" onClick={() => void refresh()} disabled={busy}
          className="px-3 py-1.5 rounded border border-blue-300 text-sm disabled:opacity-50">{tr('refresh')}</button>
      </div>
      {isDirty && <p className="text-sm text-amber-800">{tr('unsaved')}</p>}
      {code && <div className="rounded border bg-white p-3 text-sm">
        <p>{codeScope.any ? tr('codeHelpAny', { max: codeScope.max }) : tr('codeHelp', { max: codeScope.max })}</p>
        <div className="flex items-center gap-2 mt-2">
          <code className="break-all select-all">{code}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(code)}
            className="shrink-0 px-2 py-1 rounded border text-xs">{tr('copy')}</button>
        </div>
        <p className="text-xs text-gray-500 mt-1">{tr('expires')}: {new Date(codeExpiry * 1000).toLocaleString()}</p>
      </div>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="text-sm text-green-700">{message}</p>}
      {proposals.length === 0 && <p className="text-sm text-gray-500">{tr('empty')}</p>}
      {proposals.map(proposal => {
        const open = proposal.items.map((item, index) => ({ item, index }))
          .filter(({ item }) => item.review_state?.state !== 'blocked').map(({ index }) => index);
        return <div key={proposal.proposal_id} className="rounded-lg border bg-white p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-gray-500">
              {tr('proposal')} · {tr('rowCount', { count: proposal.items.length })} · {new Date(proposal.created_at * 1000).toLocaleString()}
              {' · '}{tr('expiresShort')} {new Date(proposal.expires_at * 1000).toLocaleDateString()}
            </div>
            <button type="button" disabled={busy || isDirty || !open.length}
              onClick={() => void decide(proposal, open, true)}
              className="px-3 py-1.5 rounded bg-green-700 text-white text-sm disabled:opacity-50">
              {tr('confirmAll', { count: open.length })}
            </button>
          </div>
          {proposal.items.map((item, index) => {
            const keyField = item.kind === 'occupation' ? 'occupation_key' : 'institution_key';
            const entry = item.kind === 'occupation' ? item.occupation_entry : item.institution_entry;
            const raw = item.kind === 'occupation' ? item.raw_occupation : item.raw_institution;
            const name = item.registry_labels?.[keyField] || raw || '';
            const state = item.review_state?.state ?? 'blocked';
            const blocked = state === 'blocked';
            const badge = state === 'already_present' ? tr('badgePresent') : entry ? tr('badgeNew') : tr('badgeRegistry');
            const qid = item.registry_ids?.[keyField] ?? entry?.id;
            const institution = item.kind === 'occupation'
              ? item.registry_labels?.institution_key || item.raw_institution : '';
            return <div key={index} className="flex gap-3 items-start rounded border border-gray-200 p-3 text-sm">
              <div className="flex-1 min-w-0 space-y-1">
                <p>
                  <span className="text-gray-500 mr-1">{item.kind === 'occupation' ? tr('occupation') : tr('education')}</span>
                  <strong>{name}</strong>
                  {qid && <span className="ml-1 font-mono text-xs text-gray-500">{qid}</span>}
                  <span className={`ml-2 inline-block rounded-full px-2 text-xs ${state === 'already_present'
                    ? 'bg-amber-100 text-amber-800' : entry ? 'bg-green-100 text-green-800' : 'bg-sky-100 text-sky-800'}`}>{badge}</span>
                </p>
                <p className="text-xs text-gray-700">
                  {[raw && raw !== name ? `„${raw}"` : '', institution, item.kind === 'education' ? item.edu_type : '', period(item)]
                    .filter(Boolean).join(' · ')}
                </p>
                {entry && <p className="text-xs text-green-800">
                  ＋ {tr('newEntry')} <span className="font-mono">{entry.key}</span>: {Object.values(entry.labels).join(' / ')}
                  {entry.variants?.length ? ` · ${tr('variants')}: ${entry.variants.join(', ')}` : ''}
                </p>}
                <EvidenceList evidence={item.evidence} titleOf={titleOf} />
                {blocked && <p className="text-xs text-amber-800">{reasonText(item.review_state?.reason)}</p>}
              </div>
              <div className="flex gap-2 shrink-0">
                <button type="button" disabled={busy || isDirty || blocked}
                  onClick={() => void decide(proposal, [index], true)}
                  className="px-2.5 py-1 rounded bg-green-700 text-white text-xs disabled:bg-gray-400">
                  {state === 'already_present' ? tr('addEvidenceShort') : tr('confirm')}
                </button>
                <button type="button" disabled={busy || isDirty}
                  onClick={() => void decide(proposal, [index], false)}
                  className="px-2.5 py-1 rounded border text-xs text-red-700 disabled:opacity-50">{tr('reject')}</button>
              </div>
            </div>;
          })}
        </div>;
      })}
    </section>
  );
}
```

Märkus testi kohta: „juba kaardil" rea nupp on „Lisa tõend", seega `getAllByRole('button', {name: 'Kinnita'})` annab 3 nuppu (read 0, 1, 3) ja kolmas neist (rida 3) on blokeeritud — nagu test ootab. „Kaardil praegu" plokk kaob (kaart on vormis kohe all näha); võtmed `currentEntries`, `none` kustuta samas sammus, kui grep kinnitab, et mujal kasutust pole.

- [ ] **Samm 5: kustuta vanad komponendid ja teenuse jäägid**

```bash
git rm src/prosopography/components/personForm/RegistryCandidatePicker.tsx src/prosopography/components/personForm/RegistryEntryForm.tsx
grep -rn "RegistryCandidatePicker\|RegistryEntryForm\|searchEnrichmentRegistry\|EnrichmentCorrection\|EnrichmentRegistryCandidate\|EnrichmentRegistrySearch\|review_error" src
```

Eemalda teenusest leitud jäägid (ja ülesande 7 ajutised väljad). Oodatud grep-tulemus pärast: tühi.

- [ ] **Samm 6: paneel ainult superadminile** — `PersonEditPage.tsx`:

```tsx
  const isSuperadmin = isAtLeast(user?.role, 'superadmin');
```
(`isAdmin` kõrvale, rida ~94) ja rida 785:
```tsx
          {/* Agendi rikastus on ainult superadminil, kuni töövoog on silutud (spekk 2026-09-28). */}
          {!isNew && original && isSuperadmin && <AgentEnrichmentPanel
```

- [ ] **Samm 7: käivita väravad**

Run: `npx vitest run src/prosopography && npm run typecheck && npm run lint:ci && npx vitest run src/locales src/i18n 2>/dev/null; npm test`
Oodatud: kõik PASS, lint-hoiatuste arv ≤ lävi.

- [ ] **Samm 8: commit**

```bash
git add -A src/prosopography src/locales
git commit -m "feat(prosopography): agendi ettepanekute ülevaatus = Kinnita / Lükka tagasi"
```

---

### Ülesanne 9: tõendid isikulehel ja isikuvormis

**Failid:**
- Muuda: `src/prosopography/pages/PersonDetailPage.tsx` (`StructuredInfoCard` + `useWorkTitles`)
- Muuda: `src/prosopography/pages/PersonEditPage.tsx:836-837`, `:889-890`
- Muuda: `src/locales/et/prosopography.json`, `src/locales/en/prosopography.json`
- Test: `src/prosopography/pages/__tests__/PersonDetailEvidence.test.tsx` (uus)

**Liidesed:**
- Tarbib: `evidenceRef`, `evidenceWorkIds`, `useWorkTitles`, `EvidenceList`.
- Toodab: `StructuredInfoCard` props `{ person: ProsopoRecord; workTitles: Record<string, string> }`; ekspordi `StructuredInfoCard` nimeliselt testi jaoks (`export const StructuredInfoCard`).

- [ ] **Samm 1: kirjuta kukkuv test** `src/prosopography/pages/__tests__/PersonDetailEvidence.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../components/relations/__tests__/testI18n';
import { StructuredInfoCard } from '../PersonDetailPage';
import type { ProsopoRecord } from '../../types';

const person = {
  id: 'vutt:P1', name: { aliases: [] },
  occupations: [
    { label: 'notar', date_from: { date: '1617' }, evidence: [
      { source_kind: 'vutt_page', work_id: 'w1', page: 5, printed_page: '3', quote: 'Notarius publicus' }] },
    { label: 'kaplan', evidence: [
      { source_kind: 'literature', source_id: 'ABC', citation: 'Donecker 2012, X', locator: 'lk 3' },
      { source_kind: 'literature', source_id: 'OLD', locator: 'lk 4' }] },
    { label: 'pastor' },
  ],
  education: [{ institution: 'Rostock', evidence: [{ source_kind: 'external', url: 'javascript:x' }] }],
} as unknown as ProsopoRecord;

describe('isikulehe joonealused viited', () => {
  it('nummerdab tõendid läbivalt ja näitab viiteid ploki all', () => {
    const { container } = render(<MemoryRouter><StructuredInfoCard person={person} workTitles={{ w1: 'Consuetudines' }} /></MemoryRouter>);
    expect([...container.querySelectorAll('sup')].map(s => s.textContent)).toEqual(['1', '2,3', '4']);
    const link = screen.getByRole('link', { name: 'Consuetudines' });
    expect(link.getAttribute('href')).toBe('/work/w1/5');
    expect(screen.getByText(/Donecker 2012, X/)).toBeTruthy();
    expect(screen.getByText(/^OLD/)).toBeTruthy();                     // varukuju ilma citation-ita
    expect(screen.queryByRole('link', { name: 'javascript:x' })).toBeNull();
    expect(screen.getByText('Notarius publicus')).toBeTruthy();
  });
});
```

Kontrolli testI18n asukohta: `ls src/prosopography/components/relations/__tests__/testI18n*` (paneeli test impordib seda suhteliselt `'../../relations/__tests__/testI18n'`); paranda tee vastavalt. Kui `StructuredInfoCard` vajab konteksti (nt `useUser`), mocki see nagu olemasolevad lehetestid.

- [ ] **Samm 2: käivita, peab kukkuma**

Run: `npx vitest run src/prosopography/pages/__tests__/PersonDetailEvidence.test.tsx`
Oodatud: FAIL — `StructuredInfoCard` pole eksporditud.

- [ ] **Samm 3: teostus — isikuleht.** `StructuredInfoCard`:

```tsx
export const StructuredInfoCard: React.FC<{ person: ProsopoRecord; workTitles: Record<string, string> }> = ({ person, workTitles }) => {
```

Enne ametite rida lisa loendur (joonealused viited, spekk 2026-09-28 variant B):

```tsx
  // Joonealused viited: iga tõend saab läbiva numbri üle ametite JA hariduse.
  const notes: EvidenceRef[] = [];
  const marks = (entry: any): React.ReactNode => {
    const evidence: EnrichmentEvidence[] = Array.isArray(entry?.evidence) ? entry.evidence : [];
    if (!evidence.length) return null;
    const numbers = evidence.map(source => {
      notes.push(evidenceRef(source, id => workTitles[id], t('agentEnrichment.page')));
      return notes.length;
    });
    return <sup className="ml-0.5 text-blue-700">{numbers.join(',')}</sup>;
  };
```

Ameti reas `{period ? \` (${period})\` : ''}` järele lisa `{marks(o)}`; hariduse reas samamoodi `{marks(e)}`. Pärast hariduse `if`-plokki (enne `relations`):

```tsx
  if (notes.length > 0) {
    rows.push({
      label: t('evidenceSources'),
      wide: true,
      value: (
        <span className="block space-y-0.5 text-xs text-gray-600">
          {notes.map((ref, i) => (
            <span key={i} className="block">
              <span className="text-blue-700 mr-1">{i + 1}</span>
              {ref.href && !ref.external
                ? <Link to={ref.href} className="underline hover:text-gray-800">{ref.title}</Link>
                : ref.href
                  ? <a href={ref.href} target="_blank" rel="noopener noreferrer" className="underline">{ref.title}</a>
                  : ref.title}
              {ref.locator && `, ${ref.locator}`}
              {ref.quote && <> — <q className="italic">{ref.quote}</q></>}
            </span>
          ))}
        </span>
      ),
    });
  }
```

Impordid faili päisesse: `import { evidenceRef, evidenceWorkIds, type EvidenceRef } from '../utils/evidenceRef';`, `import type { EnrichmentEvidence } from '../services/prosopographyService';`, `import { useWorkTitles } from '../hooks/useWorkTitles';`.

`PersonDetailPage`-is (hookid ENNE esimest varajast `return`-i, nt `getLabel` järel):

```tsx
  const evidenceTitles = useWorkTitles(
    evidenceWorkIds([...(person?.occupations ?? []), ...(person?.education ?? [])]), token);
```

ja `<StructuredInfoCard person={person} />` → `<StructuredInfoCard person={person} workTitles={evidenceTitles} />`.

Lokaalivõti (juurtasemele): et `"evidenceSources": "Allikad"`, en `"evidenceSources": "Sources"`.

- [ ] **Samm 4: teostus — isikuvorm.** Mõlemas kohas (`PersonEditPage.tsx:836` ja `:889`) asenda

```tsx
                {!!item.evidence?.length &&
                  <p className="text-xs text-gray-500">{item.evidence.length} {t('agentEnrichment.evidenceCount')}</p>}
```

järgmisega:

```tsx
                {!!item.evidence?.length && <details className="text-xs">
                  <summary className="cursor-pointer text-gray-500">{item.evidence.length} {t('agentEnrichment.evidenceCount')}</summary>
                  <div className="mt-1">
                    <EvidenceList evidence={item.evidence as EnrichmentEvidence[]} titleOf={id => evidenceTitles[id]}
                      onRemove={canEdit ? sourceIndex => onChange({ ...item,
                        evidence: item.evidence!.filter((_, i) => i !== sourceIndex) }) : undefined} />
                  </div>
                </details>}
```

Komponendi hookide juurde (enne varajasi return'e):

```tsx
  const evidenceTitles = useWorkTitles(evidenceWorkIds([...draft.occupations, ...draft.education]), token);
```

Impordid: `EvidenceList` (`'../components/EvidenceList'`), `useWorkTitles`, `evidenceWorkIds`, `type EnrichmentEvidence`. Salvestus: `helpers.ts:317/326` saadab `evidence`-i edasi (`...(o.evidence ? { evidence } : {})`); `occupations`/`education` lähevad serverisse tervikuna, seega eemaldatud tõend kaob kaardilt. Viimase eemaldamisel jääb `evidence: []` — see on kahjutu (vaated kontrollivad `?.length`). Käsitsi kontroll tootmises: eemalda tõend → salvesta → isikulehel viidet pole.

- [ ] **Samm 5: käivita väravad**

Run: `npx vitest run src/prosopography && npm run typecheck && npm run lint:ci && npm test`
Oodatud: kõik PASS.

- [ ] **Samm 6: commit**

```bash
git add src/prosopography src/locales
git commit -m "feat(prosopography): tõendid isikulehel joonealuste viidetena ja vormis eemaldatavana"
```

---

### Ülesanne 10: ADR-täiendused ja lõppkontroll

**Failid:**
- Muuda: `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md`, `docs/decisions/0059-ameti-ja-asutusregistri-voti.md`

- [ ] **Samm 1: ADR 0058 lõppu:**

```markdown

## Täiendus 2026-09-29: ülevaatus on otsus, vananemine rea tasemel

- Ülevaatus = **Kinnita** või **Lükka tagasi** (rea kaupa või „Kinnita kõik");
  paranduste mehhanism (`corrections`) on eemaldatud. Toimetamine käib pärast
  kinnitamist tavalises isikuvormis.
- Kogu töövoog (kaks koodi, loetelu, apply, reject) on `require_role("superadmin")`
  ja paneel nähtav ainult superadminile, kuni töövoog on silutud.
- Ettepaneku tasemel `base_updated_at` kontroll kinnitamisel kaob. Iga rida hinnatakse
  kinnitamise hetkel elava kaardi vastu (`_merge_row`): uus fakt, mis on kaardil →
  `duplicate_entry`; „juba kaardil" sihtkirje leitakse SISU järgi (`existing_index`
  on vihje). Esitamisel jääb `stale_person` alles. Server arvutab loetelus iga rea
  `review_state`-i; klient olekut ise ei arvuta.
- Kinnitus: eelkontroll (ei kirjuta) → registrikirjed (`registries.ensure`) → kaart üks
  kord. Kõik-või-mitte-midagi kaardi suhtes, mitte registri suhtes: pärast kirjete
  loomist kukkunud kinnitus tagastab `created_registry_entries` ja kordus seob nendega.
- `literature`-tõend kannab loetavat `citation`-i; selle kirjutab MCP kirjanduskogu
  reast (agendi oma asendatakse).
```

- [ ] **Samm 2: ADR 0059 lõppu:**

```markdown

## Täiendus 2026-09-29: agent pakub registrikirje, see tekib kinnitusel

Ettepaneku rida võib kanda uut kirjet (`occupation_entry`, `institution_entry`;
`key` kirje sees). Esitusel kontrollitakse `validate_entry`-ga ja lükatakse tagasi, kui
võti või Q-kood on registris juba olemas (agent kasutab olemasolevat). Kirje luuakse
ALLES toimetaja kinnitusel, uue toiminguga `registries.ensure`: lugemine, võrdlus ja
kirjutus ühe luku all; sama kirje (sama Q, Q-koodita sama et-nimi) seotakse, erinev on
`registry_conflict`. `put` jääb registrilehe ülekirjutuseks. Agendi juhis: vali lähim
olemasolev kirje, uus on erand.
```

- [ ] **Samm 3: kogu värav**

Run: `.venv/bin/pytest tests/ -q -x && PYTHONPATH=$PWD .venv/bin/pytest mcp/tests -q && npm run typecheck && npm test && npm run lint:ci`
Oodatud: kõik PASS. Kui mõni muu test kukub (nt otsib `review_error`-it või `corrections`-it): `grep -rn "review_error\|corrections" tests src mcp` ja uuenda.

- [ ] **Samm 4: commit**

```bash
git add docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md docs/decisions/0059-ameti-ja-asutusregistri-voti.md
git commit -m "docs(adr): 0058/0059 täiendused — ülevaatus on otsus, registrikirje tekib kinnitusel"
```

**Deploy (pärast merge'i, kasutaja testib tootmises):** backend `ssh vutt && cd ~/VUTT && ./scripts/server_update.sh --no-cache` (Pythoni muudatus); frontend `npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/`. MCP: agendi masinas `pipx`-venv uuesti paigaldada (vt `mcp/README.md`). Seed/reindeksit ei ole vaja.
