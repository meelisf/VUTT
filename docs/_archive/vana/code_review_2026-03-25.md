# Koodibaasi review — 2026-03-25

Tehtud: automaatne koodibaasi audit. Leitud 18 probleemi kolmes kategoorias.

---

## KRIITILISED (3)

---

### K1 — `alert()` kasutamine save-vigade jaoks

**Mõju:** Blokeerib UI täielikult, on tõlkimata/hardcoded eesti keeles, halb UX. Tootmises jõutav iga kord kui auth-sessioon on aegunud.

**Asukohad:**
- `src/services/pageService.ts:68` — hardcoded `"Salvestamine ebaõnnestus"` alert
- `src/components/TextEditor.tsx:356, 376` — save error alertid
- `src/components/MetadataModal.tsx:419, 424` — metaandmete salvestamise vead
- `src/pages/Workspace.tsx:174, 179` — `"Salvestamiseks pead olema sisse logitud"` (auth check)

**Mida teha:**
Asendada toast-tüüpi inline veakuvamisega. `ConfirmModal` komponent on juba olemas — kas luua `Toast`/`ErrorBanner` komponent või kasutada olemasolevat mustrit. Auth-vead Workspace'is peaks suunama login-vormi juurde, mitte kuvama alerti.

---

### K2 — `asyncio.get_event_loop()` on deprecated Python 3.12-s

**Mõju:** Praegu tekitab deprecation warning, tulevikus võib tõsta `RuntimeError`. Server jookseb Python 3.12-l.

**Asukoht:**
- `server/main.py:836`

```python
# Praegu (vale):
loop = asyncio.get_event_loop()
pages = await loop.run_in_executor(None, add_image_page, ...)

# Peaks olema:
loop = asyncio.get_running_loop()
pages = await loop.run_in_executor(None, add_image_page, ...)
```

**Mida teha:** Üherealine fix — `get_event_loop()` → `get_running_loop()`.

---

### K3 — Otsene `localStorage.getItem('vutt_token')` möödub `UserContext`-ist

**Mõju:** Kui token uuendatakse või kustutatakse UserContexti kaudu, loevad need komponendid endiselt stale väärtust otse localStorage-ist. Auth-state ei ole sünkroonis.

**Asukohad:**
- `src/hooks/useMetadataSuggestions.ts:33`
- `src/components/BulkTagsPicker.tsx:183`
- `src/components/CollectionEditor.tsx:118`
- `src/pages/Dashboard.tsx:408, 446, 481`

**Mida teha:**
Igas kohas asendada otsene localStorage-lugemine:
```tsx
// Praegu (vale):
const token = localStorage.getItem('vutt_token');

// Peaks olema:
const { authToken } = useUser();
```

---

## OLULISED (8)

---

### O1 — `/verify-token` endpoint kasutab body tokenit, mitte Bearer päist

**Mõju:** Patternide ebakonsistentsus — kõik muud endpointid kasutavad Bearer autentimist (Bearer migratsioon on tehtud), aga `/verify-token` loeb tokenit endiselt POST body väljast. Tulevikus segab arendajaid.

**Asukohad:**
- `server/main.py:119–125` — backend loeb `data.get("token")`
- `src/contexts/UserContext.tsx:37–42` — frontend saadab `{ token }` body-s

**Kontekst:** Intentionaalne otsus (endpoint verifitseerib iseennast, ei saa `get_user()` dependency't kasutada), aga peaks olema kommenteeritud miks, et tulevased arendajad ei "parandaks" seda ilmaasjata.

**Mida teha:** Lisa selgitav kommentaar mõlemas failis miks see erand eksisteerib.

---

### O2 — 16 bare `except:` klauslit backend-is

**Mõju:** Bare `except:` püüab kinni ka `SystemExit` ja `KeyboardInterrupt` — takistab serveri puhtast sulgemisest ja peidab muud vead.

**Asukohad (peamised):**
- `server/git_ops.py:280, 350, 628`
- `server/meilisearch_ops.py:87, 98, 160, 386, 411`
- `server/utils.py:172`
- `server/people_ops.py:23`
- `server/metadata_handler.py:34`
- `server/cache.py:196, 205, 206`
- `server/main.py:260`

**Mida teha:** Asendada kõik `except:` → `except Exception:`. Ühe grep+replace töö:
```bash
# Leia kõik:
grep -n "^\s*except:\s*$" server/*.py
```

---

### O3 — `getWorkFullText` on surnud kood

**Mõju:** Eksporteeritud funktsioon pole kusagil kasutusel, lisab segadust ja suurust.

**Asukoht:**
- `src/services/searchService.ts:764–794`

**Kontekst:** Allalaadimine käib server-side `/download/{work_id}` endpointi kaudu (`DownloadModal`). See funktsioon dubleerib seda kasutult.

**Mida teha:** Kustuta funktsioon `searchService.ts`-ist (764–794).

---

### O4 — `availableWorks` SearchPage-is ei deduplitseeri

**Mõju:** Sama teos võib ilmuda filtri nimekirjas mitu korda (üks kirje lehe kohta, mis matchis). Teadaolev bug.

**Asukoht:**
- `src/pages/SearchPage.tsx:63–71`

**Probleem:**
```tsx
// uniqueWorkIds arvutatakse aga ei kasutata deduplikatsiooniks:
const uniqueWorkIds = new Set(results.hits.map(h => h.work_id));
// availableWorks on endiselt mittededuplikeeritud
```

**Mida teha:** Kasuta `uniqueWorkIds` Set-i filtreerimiseks enne `availableWorks` ehitamist.

---

### O5 — Hardcoded eesti string `HistoryTab`-is

**Mõju:** Ingliskeelne kasutaja näeb eestikeelset teksti diff-vaates.

**Asukoht:**
- `src/components/editor/HistoryTab.tsx:284`

```tsx
// Praegu:
"Ainult tehnilised muudatused (ajatempleid uuendatud)"

// Peaks olema tõlkevõti, nt:
t('history.onlyTimestampChanges')
```

**Mida teha:** Lisa tõlkevõti mõlemasse locale faili (`et/workspace.json` ja `en/workspace.json`) ja kasuta `t()`.

---

### O6 — TOCTOU aken bulk-operatsioonides

**Mõju:** Kaks samaaegselt käivat bulk-operatsiooni (`bulk-collection`, `bulk-tags`, `bulk-genre`) võivad lugeda sama stale `_metadata.json` seisu ja kirjutada teineteise muudatused üle.

**Asukoht:**
- `server/main.py:706–729` (bulk-collection)
- Sama pattern `bulk-tags` ja `bulk-genre` endpointides

**Kontekst:** Risk on madal tüüpilises kasutuses (admin teeb bulk ops ükshaaval), aga arhitektuuriline ebakonsistentsus.

**Mida teha:** Dokumenteerida kommentaaris, et bulk-operatsioonid ei ole mõeldud samaaegse kasutuse jaoks, või lisada `work_id`-põhine lukk.

---

### O7 — `print()` logimise asemel backend-is

**Mõju:** ~35 `print()` kõnet `people_ops.py`, `meilisearch_ops.py`, `registration.py`, `utils.py`, `auth.py` jne ei jõua `logs/vutt.log` faili. Operatiivinfo läheb ainult stdout-i (Docker logs), mitte roteerivasse logifaili.

**Kontekst:** `config.py` `get_logger(__name__)` on olemas ja kasutusel `git_ops.py`, `upload_ops.py`, `image_server.py`-s — muudes failides pole järjepidevalt kasutusele võetud.

**Peamised failid:**
- `server/people_ops.py` (~12 print-i)
- `server/meilisearch_ops.py` (~15 print-i)
- `server/registration.py` (~3 print-i)
- `server/utils.py` (~5 print-i)

**Mida teha:** Lisa igasse faili `logger = get_logger(__name__)` ja asenda `print(...)` → `logger.info(...)` / `logger.error(...)`.

---

### O8 — `useQCodeMaps` hook loeb ja kirjutab URLi params korraga

**Mõju:** Hook vastab `results` muutustele (URL normaliseerimiseks) ja muudab ise `searchParams`-i. SearchPage kasutab sama `useSearchParams`. Potentsiaalne kahekordne render-pass igal otsingul. Praegu stabiilne tänu `changed` guard-ile, aga arhitektuuriliselt habras.

**Asukoht:**
- `src/pages/search/hooks/useQCodeMaps.ts:31, 173–222`

**Mida teha:** Kaalumisel — normaliseerimisloogika eraldamine eraldi `useEffect`-i, mis käivitub ainult siis kui URL sisaldab label-põhiseid parameetreid (mitte Q-koode).

---

## ETTEPANEKUD (7)

---

### E1 — `contributor` roll on defineeritud aga `/save` ei luba seda kasutada

**Mõju:** Kui kasutajale on määratud `contributor` roll (pending edits workflow), lükkab `/save` endpoint nende salvestused tagasi 401-ga. Vaikne blokeerimine ilma selge veateate või suunamiseta review-voogu.

**Asukohad:**
- `server/registration.py:215` — uued kasutajad luuakse `editor` rolliga (intentionaalne, aga põhjus dokumenteerimata)
- `server/main.py` — `/save` nõuab `editor` miinimumrolli

**Mida teha:** Selgitada kas `contributor` roll on tegelikult kasutusel. Kui ei ole → eemaldada rollist dokumendid ja kood. Kui on → implementeerida pending-edits voog ja vastav UX.

---

### E2 — `aria-label` atribuudid on tõlkimata eesti keeles

**Mõju:** Screen reader kasutajad saavad eestikeelse labeli sõltumata valitud keelest.

**Asukohad:**
- `src/pages/Dashboard.tsx:550` — `aria-label="Tühjenda otsing"`
- `src/pages/SearchPage.tsx:103` — sama
- `src/prosopography/pages/PersonsPage.tsx:242` — sama

**Mida teha:** Lisa `common` namespace'i võti (nt `form.clearSearch`) ja kasuta `t('common:form.clearSearch')`.

---

### E3 — `crossLangTypeMap` ja `crossLangGenreMap` on eemaldatavad

**Mõju:** Surnud kood (fallback) kui andmed on korras.

**Asukoht:**
- `src/components/AdvancedFilters.tsx:195–206`

**Mida teha:** Kontrollida et kõigil teostel on `type_ids` ja `genre_ids` indekseeritud → seejärel eemaldada mõlemad cross-lang kaardid.

---

### E4 — Ripuv `ocr_requested` kommentaar

**Mõju:** Segadusttekitav jäänuk, ei ole tegevusplaan.

**Asukoht:**
- `server/main.py:449`
```python
# ocr_requested = form.get('ocr_requested', 'false').lower() == 'true'  # tulevikuks
```

**Mida teha:** Loo GitHub issue (või lisa link olemasolevale) ja eemalda kommentaar koodist.

---

### E5 — `getWorkStatuses` käivitab N paralleelset Meilisearch päringut

**Mõju:** Suurel teose valimil (nt 100+ teost korraga) võib tekitada Meilisearchi ülekoormuse.

**Asukoht:**
- `src/services/workService.ts:11–43`

**Mida teha:** Kasutada Meilisearch `work_id IN [id1, id2, ...]` filter-süntaksit ühe päringu jaoks (Meilisearch toetab seda).

---

### E6 — Kaks `CollapsibleSection` komponenti sama nimega

**Mõju:** Ei ole bug, aga segadusttekitav — erinevad API-d, erinevad asukohad.

**Asukohad:**
- `src/components/CollapsibleSection.tsx` — `SearchFilters` kasutab
- `src/prosopography/components/personForm/CollapsibleSection.tsx` — `PersonEditPage` kasutab, ekspordib kaks komponenti

**Mida teha:** Kaaluda ümber nimetamist (nt `ProsopoCollapsibleSection` või `ControlledCollapsibleSection`).

---

### E7 — `Dashboard.tsx` ja `TextEditor.tsx` on 1000+ rida

**Mõju:** Keerulisem lugeda ja muuta.

**Asukohad:**
- `src/pages/Dashboard.tsx` — ~1067 rida, 15 hook-kõnet, haldab bulk-operatsioonid + filtrid + paginatsiooni
- `src/components/TextEditor.tsx` — ~1055 rida

**Mida teha:** Dashboard: bulk-operatsioonid saab eraldada `useBulkOperations` hook-i. TextEditor: toolbar-loogika eraldatav. Ei ole kiire — teha siis kui muudatusi läheb vaja.

---

## Prioriteetjärjekord

| # | Kiirus | Keerukus | Mõju |
|---|--------|---------|------|
| K3 — localStorage bypass | Kiire | Madal | Kõrge |
| K2 — get_event_loop | Kiire | Triviaalne | Kõrge |
| O5 — HistoryTab tõlkimata string | Kiire | Triviaalne | Madal |
| O3 — surnud kood getWorkFullText | Kiire | Triviaalne | Madal |
| O2 — bare except: | Kiire | Madal | Keskmine |
| K1 — alert() asendamine | Keskmine | Keskmine | Kõrge |
| O7 — print vs logger | Keskmine | Madal | Keskmine |
| O4 — availableWorks dedup | Keskmine | Madal | Keskmine |
| E2 — aria-label tõlge | Kiire | Triviaalne | Madal |
| O1 — verify-token kommentaar | Kiire | Triviaalne | Madal |
| E4 — ocr_requested kommentaar | Kiire | Triviaalne | Madal |
| E1 — contributor roll | Pikk | Kõrge | Kõrge |
| O6 — TOCTOU bulk | Pikk | Kõrge | Madal |
| O8 — useQCodeMaps refactor | Pikk | Kõrge | Madal |
| E3 — crossLangTypeMap eemaldamine | Keskmine | Madal | Madal |
| E5 — getWorkStatuses batch | Pikk | Keskmine | Madal |
| E6 — CollapsibleSection rename | Pikk | Madal | Madal |
| E7 — Dashboard/TextEditor jagamine | Pikk | Kõrge | Madal |
