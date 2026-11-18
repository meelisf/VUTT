# Isikuettepanek kõigile sisuväljadele — 1. osa (#834) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent saab MCP kaudu esitada sünni, surma, päritolu, soo ja eluloo (et/en + „Allikad") ettepaneku; toimetaja kinnitab rea kaupa isikuvormis.

**Architecture:** Olemasolev isikuettepanek (`server/prosopography/enrichment_proposals.py`, ADR 0058) saab uued realiigid. Liigiloogika (valideerimine, olek, kaardile kandmine) elab uues moodulis `enrichment_kinds.py`; `_validate_item`, `list_pending` ja `apply_selected` delegeerivad sinna liigi järgi. Kinnitus jääb üheks `update_person`-iks. Frontend: paneel kuvab liike, isikuvorm kannab skalaarvälja tõendi läbi, isikuleht näitab joonealuseid viiteid.

**Tech Stack:** FastAPI/Python 3.12 (pytest), React 19 + TS (vitest, jsdom ainult `*.test.tsx`), MCP pakett `vutt_mcp`.

**Spec:** `docs/superpowers/specs/2026-11-18-isikuettepanek-koik-valjad-design.md`

## Global Constraints

- Koodikommentaarid eesti keeles.
- i18n: iga uus võti korraga `et` JA `en` (ADR 0011; `localeParity.test.ts`).
- Kirillitsa keelatud kõigis kaardile minevates väljades ja `biography.text`-is; lubatud ainult `citation`, `locator`, `sources_add[].text` (#833, `_check_no_cyrillic` laiendus).
- `MAX_BODY_BYTES = 128_000`, `MAX_BIOGRAPHY_CHARS = 40_000`, `MAX_ITEMS = 20` (muutmata), MCP `MAX_ENRICHMENT_CHARS = 150_000`.
- Eluloo räsi = `prosopo_biography_fields.text_hash` (12 hex, `strip()`-itud); välja nimi `base_hash`.
- Tõlkeankruid (`biography_et_src`, `biography_en_src`) ettepaneku kinnitus EI kirjuta.
- MCP juhis `instructions.py` ≤ 2048 märki (`test_instructions.py`).
- Väravad järjest, mitte paralleelselt; iteratsioonil ainult muudetud failide testid (`npx vitest run <fail>`, `.venv/bin/pytest <fail>`).
- Uued realiigid: `birth`, `death`, `origin`, `gender`, `biography`. Ühes ettepanekus kuni üks rida iga skalaarliigi ja iga `biography.lang` kohta (`duplicate_kind`).

## Review Focus

1. **Käsitsi vormi salvestus pärast kinnitust** — toimetaja kinnitab sünni tõendiga, avab vormi, muudab ametit, salvestab: `birth.evidence` peab alles jääma (Task 5 valvur).
2. **Elulugu muutus pärast esitust** — toimetaja parandab elulugu käsitsi, siis vaatab ettepanekut: rida `blocked: stale_biography`, mitte vaikne üle kirjutamine (Task 2 test).
3. **Sama fakt kahelt agendilt / juba kaardil** — sünniaasta sama, täpsus sama: `already_present`, kinnitus lisab ainult tõendi, kaardil ei teki topelt-tõendit (Task 2 test).
4. **Päritolu kinnitamine, kui kaardil on vana `birth.place`** (ADR 0084): kinnitus seab `origin.place`, `birth.place` jääb puutumata ega teki teist seost (Task 3 test).
5. **Ingliskeelne elulugu eestikeelse lingitekstiga / vene tsitaadiga** — kirillitsa → `cyrillic_not_allowed`; lingiteksti keelt server ei kontrolli (juhis) — Task 1 test ainult kirillitsale.

---

### Task 1: Uute realiikide valideerimine

**Files:**
- Create: `server/prosopography/enrichment_kinds.py`
- Modify: `server/prosopography/enrichment_proposals.py` (`_validate_item` dispatch, `submit` ühe-rea-liigi-kohta kontroll, `MAX_BODY_BYTES`, `_check_vutt_pages` loeb ka eluloo lingid)
- Test: `tests/test_prosopo_enrichment_kinds.py`

**Interfaces:**
- Produces:
  - `SCALAR_KINDS = ("birth", "death", "origin", "gender")`, `NEW_KINDS = SCALAR_KINDS + ("biography",)`
  - `validate(item: dict) -> None` — viskab `ProposalError("<kood>: …")`
  - `biography_links(text: str) -> list[dict]` — tagastab `[{"source_kind": "vutt_page", "work_id": str, "page": int}]` absoluut- (`https://vutt.utlib.ut.ee/work/<id>/<lk>`) ja suhtelistest (`/work/<id>/<lk>`) linkidest
  - `submit`-is: `kind in NEW_KINDS` → `enrichment_kinds.validate`, muidu vana tee; `_check_vutt_pages` arvestab `biography_links(item["text"])`.

Võtmekomplektid: `birth {kind, date, evidence}`, `death {kind, date, place_key?, evidence}`, `origin {kind, place_key, evidence}`, `gender {kind, value, evidence}`, `biography {kind, lang, text, base_hash, sources_add?}`. `date` = olemasolev `_DATE_KEYS` kontroll (kasuta sama abifunktsiooni, mis `date_from`-ile — tõsta see `_validate_date(key, value)`-ks). `evidence` = olemasolev tõendikontroll (tõsta `_validate_evidence(evidence)`-ks). `place_key` peab olema `PLACES_FILE`-is. `sources_add` kirje: `{work_id, part_id?, page?, printed_page?, note?}` või `{text, note?}` või `{source_kind: "literature", source_id, locator}` (MCP asendab viimase `text`-iga enne saatmist — server lükkab `source_kind`-iga kirje tagasi: `literature_not_resolved`); kuni 10 kirjet.

- [ ] **Step 1: Kirjuta testid** (`tests/test_prosopo_enrichment_kinds.py`, `proposals._validate_item` otse, nagu `test_vene_allikas_viitena_on_lubatud`):

```python
OK_EVIDENCE = [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]

@pytest.mark.parametrize("item", [
    {"kind": "birth", "date": {"date": "1755", "precision": "year"}, "evidence": OK_EVIDENCE},
    {"kind": "death", "date": {"date": "1807-03-02", "precision": "day"}, "place_key": "Tartu", "evidence": OK_EVIDENCE},
    {"kind": "origin", "place_key": "Tartu", "evidence": OK_EVIDENCE},
    {"kind": "gender", "value": "M", "evidence": OK_EVIDENCE},
    {"kind": "biography", "lang": "et", "base_hash": text_hash(""),
     "text": "Professor ([VUTT, *Oratio*, 3](https://vutt.utlib.ut.ee/work/w1/3)).",
     "sources_add": [{"text": "Levitski 1902: Биографический словарь I, lk 106."}]},
])
def test_kehtiv_rida(item, places): proposals._validate_item(item)

@pytest.mark.parametrize("item,kood", [
    ({"kind": "birth", "date": {"date": "1755"}, "evidence": []}, "evidence_required"),
    ({"kind": "birth", "date": {"date": "1755"}, "evidence": OK_EVIDENCE, "place_key": "Tartu"}, "invalid_item"),
    ({"kind": "origin", "place_key": "Atlantis", "evidence": OK_EVIDENCE}, "unknown_place_key"),
    ({"kind": "gender", "value": "X", "evidence": OK_EVIDENCE}, "invalid_gender"),
    ({"kind": "biography", "lang": "de", "text": "x ([V](/work/w1/1))", "base_hash": "0"*12}, "invalid_lang"),
    ({"kind": "biography", "lang": "et", "text": "ilma viiteta", "base_hash": "0"*12}, "citation_required"),
    ({"kind": "biography", "lang": "et", "text": "<b>x</b> ([V](/work/w1/1))", "base_hash": "0"*12}, "html_not_allowed"),
    ({"kind": "biography", "lang": "en", "text": "Хорн ([V](/work/w1/1))", "base_hash": "0"*12}, "cyrillic_not_allowed"),
    ({"kind": "biography", "lang": "et", "text": "x"*40_001 + " ([V](/work/w1/1))", "base_hash": "0"*12}, "biography_too_long"),
])
def test_vigane_rida(item, kood, places):
    with pytest.raises(proposals.ProposalError, match=kood): proposals._validate_item(item)
```

Lisa `submit`-i tasemel (olemasolev HTTP-fixture `test_prosopo_enrichment_proposals.py` stiilis): kaks `birth` rida → 400 `duplicate_kind`; eluloo link `/work/w1/999` → 400 `page_out_of_range`; 60 KB elulugu → 200 (mahupiir tõstetud). `places` fixture kirjutab `PLACES_FILE`-i `{"Tartu": {"id": "Q13972", "labels": {"et": "Tartu", "en": "Tartu"}}}`.

- [ ] **Step 2:** `.venv/bin/pytest tests/test_prosopo_enrichment_kinds.py -q` → FAIL (moodulit pole).
- [ ] **Step 3:** Teosta `enrichment_kinds.validate`, `biography_links`, dispatch ja `MAX_BODY_BYTES = 128_000`. HTML-kontroll: `re.search(r"<[A-Za-z/!]", text)`. Kirillitsa: kasuta olemasolevat `_KIRILLITSA`-t (`biography.text`, `place_key` ei saa olla, `sources_add[].text` LUBATUD).
- [ ] **Step 4:** `.venv/bin/pytest tests/test_prosopo_enrichment_kinds.py tests/test_prosopo_enrichment_proposals.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(isikuettepanek): sünni, surma, päritolu, soo ja eluloo ridade valideerimine (#834)`.

### Task 2: Olek ja kinnitus uutele liikidele

**Files:**
- Modify: `server/prosopography/enrichment_kinds.py`, `server/prosopography/enrichment_proposals.py` (`list_pending`, `_review_state`, `apply_selected`)
- Test: `tests/test_prosopo_enrichment_kinds.py`

**Interfaces:**
- Consumes: Task 1 `NEW_KINDS`.
- Produces:
  - `review_state(item: dict, person: dict, patch: dict) -> dict` — `{"state": "applicable"|"already_present"|"conflict"|"replace"|"blocked", "reason"?: str, "current"?: Any}`; `patch` on sama ettepaneku eelmiste ridade poolt muudetud kaardiväljade koopia (nagu `occupations`/`education` koopiad).
  - `apply(item: dict, person: dict, patch: dict) -> None` — kirjutab `patch`-i võtmed `birth`, `death`, `origin`, `gender`, `biography_et`/`biography_en`, `sources`; viskab `ProposalError` blokeeritud real.
  - `apply_selected`: `update_person(person_id, {"updated_at": …, "occupations": …, "education": …, **patch}, username)`.

Reeglid (spec „Olek ülevaatusel"): kuupäeva võrdus = sama `date` ja `precision`; `already_present` lisab tõendi duplikaatideta, `is_circa`/`calendar`/`bound` kantakse ainult tühja kohta; `conflict.current` = praegune väärtus kuvamiseks; elulugu: `base_hash != text_hash(current)` → `blocked: stale_biography`, tühi praegune → `applicable`, muidu `replace`; `sources_add` lisatakse lõppu, duplikaat = sama `work_id`+`page` või sama `text`. `death.place` = koharegistri kirje kujul, mida vorm kirjutab (`{"id", "label", "labels"}` — vt `normalize_person_facts`). `origin` = `{**praegune_origin, "place": place_key, "evidence": …}`; `birth.place`-i ei puudutata.

- [ ] **Step 1: Kirjuta testid** (`prosopo_env`-fixture + `apply_selected`, nagu olemasolevad kinnitustestid):
  - `test_sund_tuhjale_kaardile_applicable_ja_kinnitus_kirjutab_toendi` — pärast kinnitust `person["birth"]["date"] == "1755"` ja `person["birth"]["evidence"] == OK_EVIDENCE`.
  - `test_sama_sund_already_present_lisab_ainult_toendi` — kaardil `1755/year` tõendiga A; ettepanek tõendiga A+B → olek `already_present`, pärast kinnitust `evidence == [A, B]`.
  - `test_erinev_sund_on_conflict_ja_kinnitus_asendab` — kaardil `1754`; olek `conflict`, `current["date"] == "1754"`; pärast kinnitust `1755`.
  - `test_elulugu_replace_ja_stale` — kaardil `"Vana."`; `base_hash=text_hash("Vana.")` → `replace`; kaart vahepeal `"Uus."` → `blocked`, `reason == "stale_biography"`, `apply_selected` → `ProposalError` `stale_biography`.
  - `test_eluloo_kinnitus_ei_kirjuta_ankrut_ja_lisab_allikad_duplikaatideta` — kaardil `biography_en_src` olemas ja `sources=[{"text": "A"}]`; `sources_add=[{"text":"A"},{"text":"B"}]` → `sources == [{"text":"A"},{"text":"B"}]`, `biography_en_src` muutmata.
  - `test_mitu_liiki_uks_kinnitus_uks_commit` — `birth` + `origin` + `biography` ühes valikus → üks git commit (`git_ops` commit'ide arv +1).
  - `test_kadunud_koht_blocked` — `place_key` eemaldatud registrist pärast esitust → `blocked: unknown_place_key`.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_prosopo_enrichment_kinds.py -q` → uued testid FAIL.
- [ ] **Step 3:** Teosta `review_state`, `apply`; `list_pending` ja `apply_selected` kutsuvad neid `kind in NEW_KINDS` korral, `patch` dict kõrvuti `occupations`/`education` koopiatega.
- [ ] **Step 4:** `.venv/bin/pytest tests/test_prosopo_enrichment_kinds.py tests/test_prosopo_enrichment_proposals.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(isikuettepanek): uute liikide olek ja kinnitus (conflict, eluloo asendus räsi vastu) (#834)`.

### Task 3: Kaart säilitab skalaarvälja tõendi

**Files:**
- Modify (kui test näitab kadu): `server/prosopography/person_crud.py` (`_apply_card_update` päritolu rikastus), `server/prosopography/registries.py` (`normalize_person_facts`)
- Test: `tests/test_prosopo_enrichment_kinds.py`

**Interfaces:**
- Consumes: Task 2 `apply`.
- Produces: `update_person` säilitab `birth.evidence`, `death.evidence`, `origin.evidence` muutmata kujul.

- [ ] **Step 1: Kirjuta testid:**
  - `test_update_person_sailitab_skalaartoendi` — `update_person(pid, {"updated_at": …, "birth": {…, "evidence": OK_EVIDENCE}, "origin": {"place": "Tartu", "evidence": OK_EVIDENCE}}, "t")` → `get_person(pid)["birth"]["evidence"] == OK_EVIDENCE` ja sama `origin`-il.
  - `test_paritolu_kinnitus_ei_loo_birth_place_seost` — kaardil vana `birth.place={"id": "Q1", "label": "Riga"}`; `origin` ettepaneku kinnitus → `origin.place == "Tartu"`, `birth.place` võrdub algsega (ADR 0084).
- [ ] **Step 2:** `.venv/bin/pytest tests/test_prosopo_enrichment_kinds.py -k "sailitab or birth_place" -q` → FAIL või PASS; FAIL korral parandus.
- [ ] **Step 3:** Paranda kohas, mis `origin`/`birth` uuesti ehitab (`evidence` kaasa).
- [ ] **Step 4:** Sama käsk → PASS; lisaks `.venv/bin/pytest tests/ -q -k prosopo` → PASS.
- [ ] **Step 5:** Commit `fix(isikukaart): skalaarvälja tõend säilib salvestusel (#834)`.

### Task 4: MCP — skeem, kontekst, juhis

**Files:**
- Modify: `mcp/vutt_mcp/server.py` (`submit_person_enrichment_proposal` docstring + `_check_literature_evidence` ka `sources_add`-ile), `mcp/vutt_mcp/persons.py` (`enrichment_context`, `MAX_ENRICHMENT_CHARS`), `mcp/vutt_mcp/instructions.py`
- Test: `mcp/tests/test_persons_enrichment.py` (olemasolev) või uus `mcp/tests/test_enrichment_kinds.py`

**Interfaces:**
- Consumes: serveri leping Task 1–2.
- Produces:
  - `enrichment_context` lisab võtmed `gender`, `origin`, `biography_et`, `biography_en`, `biography_et_hash`, `biography_en_hash` (MCP arvutab sama algoritmiga: `sha256(text.strip()).hexdigest()[:12]`; MCP ei impordi `server`-it — kopeeri funktsioon ja lisa leping-test, mis testis impordib `server.prosopo_biography_fields.text_hash` ja võrdleb).
  - `sources_add` kirje `{source_kind: "literature", source_id, locator}` → MCP asendab `{"text": f"{citation}, {locator}"}`-iga (citation `literature_citations` kaudu); tundmatu `source_id` → sama viga mis `literature`-tõendil.

- [ ] **Step 1: Kirjuta testid:** konteksti uued võtmed ja räsi võrdsus serveri `text_hash`-iga (`"  Tekst\n"`); `sources_add` literature → `text` sisaldab citation'it ja locator'it; juhise pikkus ≤ 2048 (olemasolev test).
- [ ] **Step 2:** `.venv/bin/pytest mcp/tests -q` → uued FAIL.
- [ ] **Step 3:** Teosta. Docstringi lisa liigid (võtmed nagu Task 1), olekute tähendus, eluloo reeglid: kirjuta välja keeles, ka lingitekst samas keeles; viited tekstis nagu olemasolevates eludes (`([VUTT, *pealkiri*, lk](…/work/<id>/<lk>))`, lühiviide + `sources_add`); terve uus tekst, `base_hash` kontekstist; vene keel ainult viites. Juhisesse üks rida, nt `- Isikukaardi väljad (sünd, surm, päritolu, elulugu…): submit_person_enrichment_proposal.` — mahu jaoks lühenda vajadusel olemasolevat rida.
- [ ] **Step 4:** `.venv/bin/pytest mcp/tests -q` → PASS.
- [ ] **Step 5:** Commit `feat(mcp): isikuettepaneku uued liigid, eluloo räsi kontekstis (#834)`.

### Task 5: Isikuvorm kannab skalaarvälja tõendi

**Files:**
- Modify: `src/prosopography/components/personForm/types.ts` (`DateDraft.evidence?`, `FormDraft.origin_evidence?`), `src/prosopography/components/personForm/helpers.ts` (`recordToDraft`, `draftToPayload`), eluandmete plokk isikuvormis (komponent, mis renderdab `draft.birth`/`draft.death`/`origin_place` — leia `PersonEditPage.tsx`-ist)
- Test: `src/prosopography/components/personForm/__tests__/helpers.evidence.test.ts`

**Interfaces:**
- Produces: `draftToPayload(recordToDraft(p)).birth.evidence` võrdub `p.birth.evidence` (sama `death`, `origin`).

- [ ] **Step 1: Kirjuta test** `säilitab sünni, surma ja päritolu tõendi ringsõidul` — record, millel kõigil kolmel `evidence`; `draftToPayload(recordToDraft(rec), rec)` → kolm `evidence` loendit `toEqual` algsetega; teine test: tõendi eemaldamine mustandist (`draft.birth.evidence = []`) → payloadis `birth.evidence` puudub või `[]`.
- [ ] **Step 2:** `npx vitest run src/prosopography/components/personForm/__tests__/helpers.evidence.test.ts` → FAIL.
- [ ] **Step 3:** Teosta; vormis `EvidenceList` (`onRemove`) sünni, surma ja päritolu välja all, ainult kui tõendeid on.
- [ ] **Step 4:** Sama käsk → PASS.
- [ ] **Step 5:** Commit `feat(isikuvorm): sünni, surma ja päritolu tõend säilib ja on eemaldatav (#834)`.

### Task 6: Ülevaatuspaneel uutele liikidele

**Files:**
- Modify: `src/prosopography/services/prosopographyService.ts` (`EnrichmentItem` liitlik tüüp uute liikidega, `review_state.state` uued väärtused, `current?`), `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx`, `src/locales/{et,en}/prosopography.json` (`agentEnrichment.*`)
- Test: `src/prosopography/components/personForm/__tests__/AgentEnrichmentPanel.kinds.test.tsx` (`/** @vitest-environment jsdom */`)

**Interfaces:**
- Consumes: Task 2 olekud ja `current`.

Rea kuva: `birth` → „Sünd 1755", `death` → „Surm 2.3.1807, Tartu", `origin` → „Päritolu: Tartu" (registri silt keele järgi — `registry_labels` nagu ametil, `list_pending` täidab ka `place_key` sildi), `gender` → „Sugu: mees". `conflict` → „praegu: 1754 → ettepanek: 1755" ja olekumärk. `biography` → „Elulugu (et)" + kokkupandav sõnataseme erinevus (`textDiff` `src/utils/textDiff.ts`, renderdus nagu `BiographySection`-is) + `sources_add` loend. Uued põhjuskoodid `reasonText`-is: `stale_biography`, `unknown_place_key`.

- [ ] **Step 1: Kirjuta test:** paneel, kus read `birth` (conflict, current 1754), `origin` (applicable), `biography` (replace) → tekst „1754" ja „1755" mõlemad nähtaval; „Elulugu" rida avamisel näitab lisatud sõna `ins`-märgistusega; `blocked` rida (stale_biography) ei ole „Kinnita kõik" valikus.
- [ ] **Step 2:** `npx vitest run src/prosopography/components/personForm/__tests__/AgentEnrichmentPanel.kinds.test.tsx` → FAIL.
- [ ] **Step 3:** Teosta; i18n võtmed mõlemasse keelde.
- [ ] **Step 4:** Sama käsk + `npx vitest run src/locales` → PASS.
- [ ] **Step 5:** Commit `feat(isikuvorm): ülevaatuspaneel kuvab sünni, surma, päritolu, soo ja eluloo ridu (#834)`.

### Task 7: Isikulehe joonealused viited

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx` (päis ~rida 515–620: sünd/surm; `StructuredInfoCard` päritolu rida ~165; `evidenceWorkIds` sisend ~356)
- Test: `src/prosopography/pages/__tests__/PersonDetailPage.evidence.test.tsx` (jsdom)

- [ ] **Step 1: Kirjuta test:** isik, kellel `birth.evidence` (vutt_page w1/3) ja `origin.evidence` → päises sünni järel `sup` „1" ja viide teose pealkirjaga; päritolu real `sup`; tõendita isik → `sup` puudub.
- [ ] **Step 2:** `npx vitest run src/prosopography/pages/__tests__/PersonDetailPage.evidence.test.tsx` → FAIL.
- [ ] **Step 3:** Teosta: päis kogub oma `notes` (sama `evidenceRef`) ja renderdab viited kuupäevade all `text-xs`; päritolu rida kasutab olemasolevat `marks(person.origin)`; `evidenceWorkIds` saab ka `[person.birth, person.death, person.origin]`.
- [ ] **Step 4:** Sama käsk → PASS.
- [ ] **Step 5:** Commit `feat(isikuleht): sünni, surma ja päritolu tõend joonealuse viitena (#834)`.

### Task 8: ADR, dokumendid, väravad

**Files:**
- Modify: `docs/decisions/0058-mcp-esitab-ainult-ootel-prosopo-ettepaneku.md` (täiendus „2026-11-18 (#834): kõik sisuväljad, 1. osa"), `CLAUDE.md` (MCP ettepanekute lõik: „isik — amet, haridus, sünd, surm, päritolu, sugu, elulugu"), `mcp/README.md` kui seal on tööriistade loend

- [ ] **Step 1:** Kirjuta ADR täiendus: realiigid, olekud (`conflict` = toimetaja otsus asendada), eluloo asendus `base_hash` vastu, tõend skalaarvälja küljes (vorm kannab läbi), vene keele keeld, `sources_add`, mahupiirid.
- [ ] **Step 2:** Väravad järjest: `npm run typecheck` → 0 viga; `npm test` → PASS; `npm run lint:ci` → hoiatusi ≤ 41; `.venv/bin/pytest tests/ -q` → PASS; `.venv/bin/pytest mcp/tests -q` → PASS.
- [ ] **Step 3:** Commit `docs(adr-0058): täiendus — isikuettepaneku kõik sisuväljad, 1. osa (#834)`.
- [ ] **Step 4:** PR main-i: kirjeldus + „Closes" EI (issue jääb 2. osaks lahti), viide #834.
