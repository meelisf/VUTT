# Isikuettepanek kõigile sisuväljadele — 2. osa (#834) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agent saab esitada nimevariandi, nime (ADR 0083), staatuse, konfessiooni, tegutsemisaja, seose ja identifikaatori ettepaneku.

**Architecture:** 1. osa `server/prosopography/enrichment_kinds.py` laiendus: `_KEYS`, `validate`, `_APPLY` uute liikidega. Loendiliigid on lisavad. Vastastikune seos: marsruuteri PUT-i järelsamm tõstetakse abifunktsiooni, mida kutsub ka kinnituse otspunkt.

**Tech Stack:** nagu 1. osa.

**Spec:** `docs/superpowers/specs/2026-11-18-isikuettepanek-koik-valjad-design.md` (jaotis „2. osa").

## Global Constraints

- Kõik 1. osa piirangud (eesti kommentaarid, i18n mõlemas keeles, kirillitsa keeld, Python 3.9 valvur: `Optional`, mitte `X | None`, väravad järjest).
- Uued liigid: `alias`, `name`, `status`, `confession`, `floruit`, `relation`, `identifier`. Skalaarliik on ainult `floruit` (kuni üks rida); loendiliike võib olla mitu, aga sama väärtusega kaks rida → `duplicate_kind`.
- `identifier`: ainult ID salvestus, võrgupäringut ei tehta. `scheme` ∈ `{"wikidata", "gnd", "viaf", "album_academicum"}` (`ext_ids._PREFIXES` võtmed); `id` läbib `normalize_ext_id`.
- `name.type` ∈ `person_names.NAME_TYPES`; `status.id`/`confession.id` ∈ `VOCABULARIES_FILE` `seisused`/`konfessioonid` `id`-d.
- Loendiridade tõendit kaardile ei salvestata; `floruit.evidence` salvestatakse (vorm kannab `floruit_evidence` läbi).

## Review Focus

1. **Seose kinnitus ilma teise kaardi uuenduseta** — kinnitatud `relation` `target_id`-ga peab lisama B-le `reciprocal_auto` rea nagu käsitsi salvestus (Task 2 test).
2. **ID juba teisel isikul** — `blocked: duplicate_id` ülevaatusel, mitte 500 kinnitusel (Task 2 test).
3. **Nimi, mis on juba aliasena** — `normalize_name_obj` tõstab liigiga nime aliastest välja; topelt ei teki (Task 2 test).
4. **Sõnastikuväline Q-kood staatusena** — esitusel `unknown_vocabulary_id` (Task 1 test).
5. **Tegutsemisaja tõend käsitsi salvestusel** — säilib (Task 4 valvur).

---

### Task 1: Valideerimine

**Files:** Modify `server/prosopography/enrichment_kinds.py`, `server/prosopography/enrichment_proposals.py` (`duplicate_kind` võti loendiliikidel = liik + väärtus). Test `tests/test_prosopo_enrichment_kinds.py`.

**Interfaces:** Produces `LIST_KINDS = ("alias", "name", "status", "confession", "relation", "identifier")`, `SCALAR_KINDS` + `"floruit"`, `NEW_KINDS` sisaldab kõiki; `row_key(item) -> tuple` (duplikaadikontrolliks: skalaaril `(kind, lang)`, loendil `(kind, normaliseeritud väärtus)`).

Võtmed: `alias {kind, value, evidence}`, `name {kind, label, type, from?, to?, evidence}`, `status|confession {kind, id, evidence}`, `floruit {kind, year_from?, year_to?, evidence}` (vähemalt üks; aasta int 1000–2100, `from ≤ to`), `relation {kind, name, type, type_id?, target_id?, evidence}` (`type_id` Q-kood; `target_id` = `valid_person_id`), `identifier {kind, scheme, id, evidence}`. Tekstid ≤ 300 märki, kirillitsa keelatud.

- [ ] Testid: kehtivad read iga liigi kohta; vigased: `unknown_vocabulary_id` (staatus Q999), `invalid_name_type`, `invalid_floruit` (tühi / from>to), `invalid_scheme`, `invalid_person_id` (target_id "x"), `cyrillic_not_allowed` (alias „Хорн"); HTTP: kaks sama aliast → `duplicate_kind`, kaks eri aliast → 200.
- [ ] Run `.venv/bin/pytest tests/test_prosopo_enrichment_kinds.py -q` → FAIL; teosta; → PASS (ka `test_prosopo_enrichment_proposals.py`).
- [ ] Commit `feat(isikuettepanek): 2. osa liikide valideerimine (#834)`.

### Task 2: Olek, kinnitus, vastastikune seos

**Files:** Modify `server/prosopography/enrichment_kinds.py` (`_APPLY`), `server/prosopography/router.py` (PUT järelsamm → `_after_person_save(person_id, old_relations, person, username)`; kinnituse otspunkt loeb vanad seosed enne ja kutsub sama). Test `tests/test_prosopo_enrichment_kinds.py`.

Reeglid: alias — olemas tõstutundetult → `already_present`, muidu lisatakse `name.aliases` lõppu. `name` — sama `label`+`type` `name.names`-is → `already_present`, muidu lisatakse `{label, type, from, to}`. status/confession — sama `id` → `already_present`, muidu `{id, label: labels.et, labels}` sõnastikust. floruit — nagu kuupäev: tühi → `applicable`, samad aastad → `already_present` (tõend lisandub), muu → `conflict` (`current` = praegune objekt). relation — `target_id` olemas ja elav (`get_person`, mitte tombstone/`merged_into`), muidu `blocked: unknown_person`; sama `target_id` (selleta sama `name`) → `already_present`, muidu lisatakse `{name, type, type_id?, target_id?}`. identifier — sama skeem+ID → `already_present`; `ext_id_index.find_person_id(scheme, id)` teine isik → `blocked: duplicate_id`; sama skeem teine ID → `conflict` (asendab), muidu lisatakse `{scheme, id, checked_at: None}`.

- [ ] Testid: iga liigi `applicable` → kinnitus kirjutab; `already_present` juhud; `test_seose_kinnitus_lisab_vastastikuse_rea` (B kaardil pärast kinnitust `{"target_id": "vutt:Pabc", "reciprocal_auto": True}`); `test_id_teisel_isikul_blocked`; `test_nimi_aliasena_ei_dubleeri` (alias „Gripenhielm" + `name` „Gripenhielm" ennobled → aliases ei sisalda, names sisaldab); `test_floruit_conflict`.
- [ ] Run → FAIL; teosta; → PASS (`tests/test_prosopo_enrichment_kinds.py tests/test_prosopo_enrichment_proposals.py tests/ -k reciprocal`).
- [ ] Commit `feat(isikuettepanek): 2. osa olek ja kinnitus, kinnitus sünkroonib vastastikused seosed (#834)`.

### Task 3: MCP

**Files:** Modify `mcp/vutt_mcp/server.py` (docstring), `mcp/vutt_mcp/persons.py` (`enrichment_context` + `statuses`, `confessions`, `floruit`, `relations`). Test `mcp/tests/test_persons.py`.

- [ ] Test: kontekst sisaldab nelja uut võtit; juhis ≤ 2048 (olemasolev).
- [ ] Teosta: docstringi liigid ja reeglid (lisav, ID ainult salvestus, staatus/konfessioon suletud sõnastikust — `list_filter_values` ei anna neid, nimekiri docstringis puudub → agent loeb `get_person_enrichment_context`-ist olemasolevad ja kasutab Q-koode; vale kood → serveri veateade loetleb lubatud).
- [ ] Run `.venv/bin/pytest mcp/tests -q` → PASS; commit `feat(mcp): isikuettepaneku 2. osa liigid (#834)`.

Server: `unknown_vocabulary_id` veateade loetleb lubatud `id: et-silt` paarid (agent ei näe sõnastikku muidu).

### Task 4: Vorm ja isikuleht (tegutsemisaeg)

**Files:** Modify `src/prosopography/components/personForm/{types.ts,helpers.ts}` (`floruit_evidence`), `src/prosopography/pages/PersonEditPage.tsx` (tõendiplokk ka `floruit_evidence`-ile), `src/prosopography/pages/PersonDetailPage.tsx` (floruit-plokis `marks`-viide). Tests: `scalarEvidence.test.ts` (+ floruit ringsõit ja muutmisel kadu), `PersonDetailEvidence.test.tsx` (+ floruit `sup`).

- [ ] Testid → FAIL; teosta; → PASS; typecheck; commit `feat(isikuvorm): tegutsemisaja tõend (#834)`.

### Task 5: Ülevaatuspaneel

**Files:** Modify `src/prosopography/utils/enrichmentKinds.ts` (`FIELD_KINDS` + 7 liiki), `src/prosopography/services/prosopographyService.ts` (väljad `label`, `type`, `type_id`, `target_id`, `scheme`, `id`, `name`, `year_from`, `year_to`, `from`, `to`), `AgentFieldRow.tsx`, lokaalid. Test `AgentEnrichmentPanel.kinds.test.tsx`.

Kuva: alias „Nimevariant: X"; name „Nimi (aadeldamine): X 1650–"; status/confession sõnastiku silt (`registry_labels` puudub → `list_pending` lisab `vocab_label`; või server paneb `label` reale) — **server lisab `list_pending`-is reale `display_label`** sõnastikust; floruit „Tegutses 1640–1660"; relation „Seos: õpetaja → Nimi" (+ link `/persons/<target_id>`); identifier „Wikidata Q123".

- [ ] Testid → FAIL; teosta (i18n et+en); → PASS; commit `feat(isikuvorm): paneel 2. osa ridadele (#834)`.

### Task 6: ADR, väravad, PR

- [ ] ADR 0058 täiendus „2. osa"; CLAUDE.md lause laiendus.
- [ ] Väravad järjest (typecheck, npm test, lint ≤ 41, pytest tests/, pytest mcp/tests).
- [ ] Commit, PR (Closes #834).
