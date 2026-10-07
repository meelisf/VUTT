# Kirjaotsing (#526 samm 1) — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eraldi Meili indeks `kirjad` (üks dokument kirja-osa kohta, koos täistekstiga) ja `/search` lüliti **Täistekst | Kirjad**, mis otsib kirju autori, adressaadi, dateeringu, kohtade ja keele järgi.

**Architecture:** Kirjadokumendid tuletab puhas funktsioon `meili_doc.build_letter_documents` sama teose juba ehitatud lehedokumentidest (ligipääsuväljad + puhastatud tekst ühest allikast). Live-sünk kirjutab mõlemasse indeksisse; seed ehitab mõlemad nullist. Tenant-token annab `kirjad`-ile sama reegli mis `teosed`-ile. Frontend: `SearchPage` hargneb `unit=letters` järgi eraldi `LettersSearch` komponendiks.

**Tech Stack:** Python 3.12 / FastAPI / urllib Meili REST; React 19 + TS + Tailwind; vitest; pytest.

**Spec:** `docs/superpowers/specs/2026-10-07-kirjaotsing-design.md`

## Global Constraints

- Koodikommentaarid eesti keeles; UI-tekstid et + en korraga (`localeParity.test.ts`).
- Uus indekseeritav väli ainult `server/meili_doc.py`-s; seaded ainult `server/meili_settings.py`-s.
- Kirjade indeksi väljanimed ingliskeelsed (ADR 0065), `teosed` ei muutu.
- Ligipääsufilter tuleb ÜHEST funktsioonist; `generate_work_scoped_meili_token` `kirjad`-i ei saa.
- Meili osaline uuendus = PUT; POST asendab dokumendi.
- Aegunute kustutus alles pärast upsert-task'i `succeeded`-i; iga tõrge → sünk `False`.
- Teose aasta EI dateeri kirja (`index_dating` `year_range` varuvariant ei kehti).
- Osade kirjutus ainult `work_parts` kaudu `metadata_lock`-i all (ADR 0057).
- Python: `.venv/bin/pytest`; frontend: `npm run typecheck`, `npm test`, `npm run lint:ci`.
- Number-sisendid `type="text" inputMode="numeric"`.

## Review Focus

1. Kirjal on ainult `title`/`incipit` (nimed, dateering puuduvad) → tulemuse rida ei ole tühi (Task 8 test).
2. Leht kuulub kahte kirja → mõlemad dokumendid sisaldavad lehe teksti (Task 1 test).
3. Kirja `pages` sisaldab tüve, mille pilti enam pole (sünk hilineb) → tüvi jäetakse vahele, ei viska (Task 1 test).
4. Kasutaja lülitab režiimi aktiivse filtriga → teise režiimi filter ei jää URL-i (Task 8 test).
5. Anonüümne kasutaja, kirjad piiratud kogus → token-reegel välistab (Task 3 test, mock).

---

### Task 1: `build_letter_documents` + kirjade seaded

**Files:**
- Modify: `server/meili_settings.py` (lõppu)
- Modify: `server/meili_doc.py` (uus funktsioon faili lõppu)
- Test: `tests/test_meili_letters_doc.py` (uus)

**Interfaces:**
- Produces: `LETTERS_INDEX_NAME = "kirjad"`, `LETTERS_SEARCHABLE_ATTRIBUTES`, `LETTERS_FILTERABLE_ATTRIBUTES`, `LETTERS_SORTABLE_ATTRIBUTES`, `LETTERS_OPTIONAL_FIELDS` (meili_settings);
  `build_letter_documents(meta: dict, page_documents: list[dict], people_data: dict) -> list[dict]` (meili_doc).

- [ ] **Step 1: testid** — `tests/test_meili_letters_doc.py`:
  - ainult `kind == "letter"`; `poem` ei anna dokumenti;
  - katkendlik `pages` (`["a-002","a-004"]`) → `letter_text` = lk 2 + lk 4 tekst teose järjekorras, `first_page == 2`, `page_count == 2`;
  - leht kahes kirjas → mõlemas;
  - tüvi, mida lehedokumentides pole → vahele, ilma veata; kõik tüved puuduvad → dokumenti pole;
  - `is_public`/`collections_hierarchy` võetakse lehedokumendist (lehedoc `is_public: False` → kiri `False`, `collections_hierarchy: ["x"]` → `["x"]`; meta `collections` ei mõjuta);
  - dateering vahemik `{"start":"1684","end":"1686"}` → `date_start == 16840101`, `date_end == 16861231`, `date_sort == 16840101`, `dating` kantud; dateeringuta → `date_*` võtmeid pole (ka kui meta `year` on 1700);
  - autor/adressaat: `authors == ["Spener"]`, `author_ids == ["vutt:P1"]`; ID-ta isik → `authors`-is, `author_ids`-is mitte;
  - `names_text` sisaldab aliast `people_data`-st (`{"vutt:P1": ["Spenerus"]}` kuju nagu `get_creator_aliases` ootab);
  - koht ID-ta → `place_from == "Frankfurt"`, `place_from_id` puudub;
  - `abstract` = `abstract_et` + `abstract_en`;
  - **leping:** iga `LETTERS_SEARCHABLE_ATTRIBUTES` väli on alati olemas (ka minimaalsel kirjal); iga dokumendi võti, mis on filterable/sortable, on kas alati olemas või `LETTERS_OPTIONAL_FIELDS`-is; iga filterable/sortable väli, mis puudub minimaalsel kirjal, on `LETTERS_OPTIONAL_FIELDS`-is.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_meili_letters_doc.py -q` → FAIL (import).
- [ ] **Step 3: seaded**

```python
# --- Kirjade indeks (#526, ADR 0065) — ingliskeelsed väljanimed, teosed-ist sõltumatu ---
LETTERS_INDEX_NAME = "kirjad"

LETTERS_SEARCHABLE_ATTRIBUTES = [
    "names_text", "title", "incipit", "abstract", "place_from", "place_to",
    "letter_text", "archive_refs_text", "work_title",
]
LETTERS_FILTERABLE_ATTRIBUTES = [
    "id", "work_id", "is_public", "collections_hierarchy",
    "authors", "addressees", "author_ids", "addressee_ids",
    "date_start", "date_end", "place_from", "place_to", "place_from_id", "place_to_id",
    "languages",
]
LETTERS_SORTABLE_ATTRIBUTES = ["date_sort"]
# Väljad, mis võivad dokumendist puududa (lünk andmetes, mitte viga).
LETTERS_OPTIONAL_FIELDS = {
    "author_ids", "addressee_ids", "place_from_id", "place_to_id",
    "dating", "date_start", "date_end", "date_sort", "languages",
}
```

- [ ] **Step 4: funktsioon** (`meili_doc.py`)

```python
def _stem_of(page_doc):
    return os.path.splitext(os.path.basename(page_doc.get('lehekylje_pilt') or ''))[0]


def build_letter_documents(meta, page_documents, people_data):
    """Kirja-osad → `kirjad`-indeksi dokumendid (#526, ADR 0065).

    Tuletatakse SAMA teose juba ehitatud lehedokumentidest: ligipääsuväljad ja
    puhastatud tekst tulevad sealt, kust teosed-is — kaks indeksit ei saa neis
    lahku minna. Leht, mis kuulub kahte kirja, läheb mõlemasse.
    """
    if not page_documents:
        return []
    by_stem = {_stem_of(d): d for d in page_documents}
    first = page_documents[0]
    work_id = first['work_id']
    docs = []
    for part in meta.get('parts') or []:
        if not isinstance(part, dict) or part.get('kind') != 'letter':
            continue
        pages = [by_stem[s] for s in part.get('pages') or [] if s in by_stem]
        if not pages:
            continue
        pages.sort(key=lambda d: d['lehekylje_number'])
        creators = [c for c in part.get('creators') or [] if isinstance(c, dict)]
        def _names(role):
            return [c.get('name') or c.get('id') for c in creators if c.get('role') == role]
        def _ids(role):
            return [c['id'] for c in creators if c.get('role') == role and c.get('id')]
        names = [c.get('name') or '' for c in creators]
        aliases = get_creator_aliases(creators, people_data) or []
        doc = {
            'id': f"{work_id}__{part['id']}",
            'work_id': work_id,
            'part_id': part['id'],
            'is_public': first.get('is_public'),
            'collections_hierarchy': first.get('collections_hierarchy') or [],
            'title': normalize_eszett(part.get('title') or ''),
            'incipit': normalize_eszett(part.get('incipit') or ''),
            'abstract': normalize_eszett(' '.join(
                x for x in (part.get('abstract_et'), part.get('abstract_en')) if x)),
            'authors': _names('auctor'),
            'addressees': _names('addressee'),
            'names_text': normalize_eszett(' '.join(n for n in names + list(aliases) if n)),
            'place_from': (part.get('place') or {}).get('label') or '',
            'place_to': (part.get('place_to') or {}).get('label') or '',
            'letter_text': '\n'.join(
                t for d in pages for t in (d.get('lehekylje_tekst'), d.get('marginaalia_tekst')) if t),
            'first_page': pages[0]['lehekylje_number'],
            'page_count': len(pages),
            'work_title': first.get('title') or '',
            'archive_refs_text': first.get('archive_refs_text') or '',
            'needs_review': bool(part.get('needs_review')),
        }
        for key, role in (('author_ids', 'auctor'), ('addressee_ids', 'addressee')):
            ids = _ids(role)
            if ids:
                doc[key] = ids
        for key, src in (('place_from_id', 'place'), ('place_to_id', 'place_to')):
            pid = (part.get(src) or {}).get('id')
            if pid:
                doc[key] = pid
        if part.get('languages'):
            doc['languages'] = part['languages']
        # Teose aasta EI dateeri kirja → year_range=None (ainult kirja enda dateering).
        if part.get('dating'):
            d = index_dating({'dating': part['dating']}, None)
            if d['dating']:
                doc.update(d)
        docs.append(doc)
    return docs
```

  Kontrolli `get_creator_aliases` tagastustüüpi (`meili_doc.py:296`) ja kohanda.
- [ ] **Step 5:** testid → PASS.
- [ ] **Step 6:** commit `feat(meili): kirjadokumendid lehedokumentidest (#526)`.

### Task 2: Live-sünk mõlemasse indeksisse

**Files:**
- Modify: `server/meilisearch_ops.py` (`_delete_extra_pages`, `_upsert_work_documents`, `sync_work_to_meilisearch`, `delete_work_from_meilisearch`, `update_collection_is_public_async`, uus `_ensure_letters_index`, uued `_meili_post`, `sync_letters`)
- Modify: `server/main.py:107` (start `_ensure_letters_index`)
- Test: `tests/test_meili_letters_sync.py` (uus)

**Interfaces:**
- Consumes: `build_letter_documents`, `LETTERS_*`.
- Produces: `sync_letters(work_id: str, letter_docs: list[dict]) -> bool`; `delete_work_letters(work_id) -> bool`; `_ensure_letters_index() -> None`.

- [ ] **Step 1: testid** (mock `urllib.request.urlopen` tabeliga URL+meetod → vastus; tundmatu päring → `pytest.fail`):
  - `sync_letters("w", [doc_a])`: POST `/indexes/kirjad/documents` → task 1 succeeded → POST `/indexes/kirjad/documents/delete` filtriga `work_id = "w" AND NOT id IN ["w__a"]` → succeeded → `True`;
  - upsert-task `failed` → kustutust EI tehta, `False`;
  - kustutus-task `failed` → `False`;
  - `sync_letters("w", [])` → ainult delete `work_id = "w"` → `True`;
  - `sync_work_to_meilisearch` kui pilte pole (`build_work_documents` → `[]`) → `delete_work_letters` kutsutakse ENNE `return False`;
  - `sync_work_to_meilisearch` kirjaga teosel kutsub `sync_letters` ja tulemus on `pages_ok and letters_ok` (kirjade tõrge → `False`);
  - liik `letter` → `poem` (meta muutub) → `sync_letters(work_id, [])` → kustutus;
  - `delete_work_from_meilisearch` kustutab mõlemast indeksist;
  - `update_collection_is_public_async`: teosed PUT (juba #561) + `POST /indexes/kirjad/documents/fetch` (`filter: work_id = "w"`, `fields: ["id"]`) tagastab ka aegunud `w__old` → PUT `/indexes/kirjad/documents` `[{"id":"w__a","is_public":False},{"id":"w__old","is_public":False}]`;
  - `_ensure_letters_index` PATCH-ib `/indexes/kirjad/settings` LETTERS_* väärtustega (indeks luuakse settings-PATCH-iga automaatselt).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: teostus**
  - `_meili_request(method, path, body) -> dict | None` — üks abiline (Authorization, JSON, `MEILI_TIMEOUT`), viga → `None` + log.
  - `_delete_extra_pages` tagastab `bool` (puudub kustutatav → `True`; tõrge → `False`); `_upsert_work_documents` tagastab `send_ok and delete_ok`.
  - `sync_letters`: upsert → `wait_for_task` → alles siis delete `work_id = "{w}" AND NOT id IN [...]` (tühja loendiga ainult `work_id = "{w}"`) → `wait_for_task`.
  - `sync_work_to_meilisearch`: loe `_metadata.json` (`json.load`) kirjade jaoks; `if not documents: delete_work_letters(work_id_from_meta_or_slug); return False`; muidu `pages_ok = _upsert_work_documents(...)`, `letters_ok = sync_letters(work_id, build_letter_documents(meta, documents, people_data))`, `return bool(pages_ok) and letters_ok`.
  - `delete_work_from_meilisearch`: + `delete_work_letters`.
  - `update_collection_is_public_async`: iga teose kohta `fetch` id-d kirjadest, PUT `{id, is_public}` (pakk).
  - `_ensure_letters_index`: PATCH `/indexes/kirjad/settings` `{searchableAttributes, filterableAttributes, sortableAttributes, pagination: {maxTotalHits: 10000}, faceting: {maxValuesPerFacet: MAX_VALUES_PER_FACET}}`; `main.py` lifespan'is samas lõimes `_ensure_filterable_attributes` kõrval.
- [ ] **Step 4:** PASS + `.venv/bin/pytest tests/ -q -x`.
- [ ] **Step 5:** commit `feat(meili): kirjad-indeksi live-sünk (#526)`.

### Task 3: Tenant-token

**Files:** Modify `server/meilisearch_ops.py` (`generate_meili_token`); Test `tests/test_meilisearch_ops.py`.

**Interfaces:** Produces `_access_rule(user) -> dict` (`{}` admin, muidu `{"filter": "..."}`).

- [ ] **Step 1: testid:** iga rolli (anon, contributor `allowed_collections=["c1"]`, contributor ilma, admin) puhul `payload["searchRules"]["kirjad"] == payload["searchRules"]["teosed"]` ja võtmed `== {"teosed","kirjad"}`; mock-teos piiratud kogus: anonüümne reegel sisaldab `is_public = true` ja mitte `c1`; `generate_work_scoped_meili_token` → `set(searchRules) == {"teosed"}`.
- [ ] **Step 2:** FAIL. **Step 3:** `rule = _access_rule(user); search_rules = {"teosed": rule, LETTERS_INDEX_NAME: rule}`. **Step 4:** PASS. **Step 5:** commit.

### Task 4: Seed-tee

**Files:** Modify `scripts/1-1_consolidate_data.py`, `scripts/2-1_upload_to_meili.py`, `scripts/server_seed_data.sh` (hoiatustekst); Test `tests/test_seed_letters.py`.

- [ ] **Step 1: test:** `create_meilisearch_data_per_page()` tmp `BASE_DIR`-iga (kiri-osaga teos) kirjutab `OUTPUT_FILE` kõrvale `kirjad.jsonl` ühe dokumendiga, mis on võrdne `build_letter_documents`-i väljundiga (sama funktsioon). Vaata olemasolevat 1-1 testi mustrit (`grep -rl consolidate tests/`).
- [ ] **Step 2:** FAIL. **Step 3:** 1-1: sama tsükli sees `letters.extend(build_letter_documents(meta_raw, pages, people_data))`, kirjuta `LETTERS_OUTPUT_FILE = os.path.join(os.path.dirname(OUTPUT_FILE), 'kirjad.jsonl')`. 2-1: refaktoreeri `_create_index(name, settings)` + `_upload(name, path)`; kutsu teosed ja kirjad. **Step 4:** PASS. **Step 5:** commit.

### Task 5: Isikunime levitamine osadesse

**Files:** Modify `server/work_parts.py` (uus `relabel_person`), `server/prosopography/person_crud.py` (`_propagate_name_to_works`); Test `tests/test_propagate_name_to_works.py`.

**Interfaces:** Produces `work_parts.relabel_person(work_dir: str, person_id: str, new_label: str, username: str) -> bool`.

- [ ] **Step 1: testid:** isik ainult kirja osas (`parts[0].creators=[{"id":PID,"name":"Vana","role":"auctor"}]`, teose `creators` tühi) → pärast `_propagate_name_to_works` on osa `name == uus`; `relabel_person` kasutab `_write`-i (mock `bulk_update_works` kutsutakse) ; isikut pole → `False`, kirjutust ei toimu.
- [ ] **Step 2:** FAIL. **Step 3:**

```python
def relabel_person(work_dir, person_id, new_label, username):
    """Isikukaardi nimemuutus osade creators-isse (ADR 0057: ainult luku all)."""
    with open(os.path.join(work_dir, "_metadata.json"), encoding="utf-8") as f:
        if not any(c.get("id") == person_id and c.get("name") != new_label
                   for p in json.load(f).get("parts") or [] for c in p.get("creators") or []):
            return False
    def mutate(parts, _stems):
        for p in parts:
            for c in p.get("creators") or []:
                if c.get("id") == person_id:
                    c["name"] = new_label
        return parts, True
    _write(work_dir, username, f"Prosopo nime uuendus osades ({person_id}): {new_label}", mutate)
    return True
```

  `_propagate_name_to_works`: tsüklis pärast teose-väljade kontrolli kogu `parts_dirs`, kus osas esineb `person_id`; pärast olemasolevat commit'i kutsu iga kohta `relabel_person` (try/except + log — üks vigane teos ei peata teisi). Varajane `return` `if not changed_files` liigub pärast osade käsitlust.
- [ ] **Step 4:** PASS. **Step 5:** commit.

### Task 6: Frontend andmekiht

**Files:** Modify `src/contexts/MeilisearchContext.tsx`, `src/config.ts`; Create `src/services/letterSearch.ts`, `src/services/__tests__/letterSearch.test.ts`.

**Interfaces:**
- Produces: `useMeiliLettersIndex(): Index | null`; `LETTERS_INDEX = 'kirjad'`;
  `type LetterFilters = { authors: string[]; addressees: string[]; placeFrom: string[]; placeTo: string[]; languages: string[]; yearStart?: number; yearEnd?: number; sort: 'relevance'|'date_asc'|'date_desc' }`;
  `buildLetterFilter(f: LetterFilters, scope: SelectionScope | undefined): string[]`;
  `searchLetters(index: Index, q: string, f: LetterFilters, scope, page: number): Promise<LetterSearchResult>`;
  `type LetterHit` (dokumendi väljad + `_formatted`).

- [ ] **Step 1: testid:** `buildLetterFilter` sisaldab `scopeClauses(scope)` klausleid; töökollektsioon `workSetIds: null` → viskab; `yearStart:1685,yearEnd:1685` → `date_end >= 16850101` ja `date_start <= 16851231`; autorid → `authors IN ["A", "B"]`; jutumärk nimes escape'itakse (`"` → `\"`).
- [ ] **Step 2:** FAIL. **Step 3:** teostus; `searchLetters`: `hitsPerPage: 20, page, facets: ['authors','addressees','place_from','place_to','languages'], attributesToHighlight: ['letter_text','abstract','title','incipit','authors','addressees','place_from','place_to'], attributesToCrop: ['letter_text','abstract'], cropLength: 30, highlightPreTag: '<mark>', highlightPostTag: '</mark>', sort: date_* → ['date_sort:asc'|'date_sort:desc']`, ilma päringuta vaikimisi `date_asc`. Context: `lettersIndex` state, `installToken` paneb mõlemad sama tokeniga.
- [ ] **Step 4:** PASS + typecheck. **Step 5:** commit.

### Task 7: Workspace `?part=`

**Files:** Modify `src/components/TextEditor.tsx` (algvahekaart), `src/components/editor/WorkPartsPanel.tsx` (avamine + laiendus); Test `src/components/editor/__tests__/WorkPartsPanel.test.tsx`.

- [ ] **Step 1: test:** `MemoryRouter initialEntries={['/work/w/3?part=p2']}` → paneel avatud ja `p2` rida `aria-expanded="true"`.
- [ ] **Step 2:** FAIL. **Step 3:** paneel loeb `useSearchParams().get('part')`; kui osa on laetud ja id leidub → `setOpen(true)`, `setExpanded(new Set([id]))`, kerib rea nähtavale (olemasolev `scrollTo` loogika `hereId` asemel `focusId`). TextEditor: `const initialTab = searchParams.get('part') ? 'annotate' : 'edit'`; kasutaja `default_tab` ei kirjuta seda üle, kui `part` on URL-is.
- [ ] **Step 4:** PASS. **Step 5:** commit.

### Task 8: Kirjade otsingu UI

**Files:**
- Modify: `src/pages/SearchPage.tsx` (praegune komponent → `FullTextSearch`, uus `SearchPage` hargneb `unit` järgi; lüliti ka täisteksti režiimi ülemisse ritta)
- Create: `src/pages/search/SearchUnitToggle.tsx`, `src/pages/search/searchUnit.ts` (puhas URL-loogika), `src/pages/search/letters/LettersSearch.tsx`, `LetterFilters.tsx`, `LetterResults.tsx`, `letterDisplay.ts` (puhas kuvaloogika), `useLetterSearch.ts`
- Modify: `src/locales/{et,en}/search.json`
- Test: `src/pages/search/__tests__/searchUnit.test.ts`, `src/pages/search/letters/__tests__/letterDisplay.test.ts`, `src/pages/search/letters/__tests__/LetterResults.test.tsx` (jsdom)

**Interfaces:**
- `switchUnitParams(prev: URLSearchParams, unit: 'text'|'letters'): URLSearchParams` — säilitab AINULT `q`, kogu tokeni (`readSelectionToken`-i võti `useCollectionUrlSync`-ist) ja seab/eemaldab `unit`.
- `letterHeadline(hit: LetterHit, t): string` — `autor → adressaat · dateering · koht → koht`; kõik puuduvad → `title` → `incipit` (80 märki) → `t('letters.pageFallback', {page})`.
- `formatLetterDating(dating): string | null` — vahemik `start–end`, muidu `start`, `source_text` eelistatud kui olemas.
- `letterSnippet(hit): string | null` — `_formatted.letter_text`, kui see sisaldab `<mark>`; muidu `_formatted.abstract`, kui sisaldab; muidu `null`.

- [ ] **Step 1: testid:** `switchUnitParams` mõlemas suunas (`author`, `scope`, `p`, `la`, `lys` kaovad; `q`, kogu, jäävad); `letterHeadline` täis- ja varukuva ahel; `formatLetterDating` vahemik; `letterSnippet` nimevaste → `null`; `LetterResults` renderdab varukuva ja lingi `/work/w/6?part=p1`.
- [ ] **Step 2:** FAIL. **Step 3:** teostus. URL-parameetrid kirjade režiimis: `q`, `la` (autorid, koma), `lad` (adressaadid), `lpf`, `lpt`, `llang`, `lys`, `lye`, `lsort`, `p`. `LettersSearch` ootab `useSelectionScope().ready`; viga → nähtav. Katke renderdatakse `<mark>`-iga ilma `dangerouslySetInnerHTML`-ita: tükelda `<mark>`/`</mark>` järgi, ülejäänu tekstina.
- [ ] **Step 4:** `npm test`, `npm run typecheck`, `npm run lint:ci`.
- [ ] **Step 5:** commit.

### Task 9: ADR, dokumentatsioon

**Files:** Create `docs/decisions/0065-kirjaindeks.md`; Modify `docs/decisions/README.md` (register), `CLAUDE.md` (Arhitektuur: indeks `kirjad`; Invariandid: üks lõik), spekk §2 („Esmane täitmine" = `server_seed_data.sh`).

- [ ] ADR sisu: kontekst, otsus (4 punkti speki §6-st), tagajärjed (uus kirjutustee peab kirjad kaasa võtma; `searchRules` peab `kirjad` sisaldama).
- [ ] Commit `docs: ADR 0065 kirjaindeks`.

### Lõpp

- [ ] `.venv/bin/pytest tests/ -q`, `npm test`, `npm run typecheck`, `npm run lint:ci`.
- [ ] Push, PR main'i vastu, CI roheline.
