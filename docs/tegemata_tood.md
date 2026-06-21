# Tegemata tööd / Tehniline võlg

Siia kogutakse teadaolevad parandused ja puhtamad lahendused, mis on praegu edasi lükatud.

---

## `find_directory_by_id` — slug-match ilma `sanitize_id`-ta

**Fail:** `server/utils.py`, funktsioon `find_directory_by_id`, step 4

**Probleem:**  
Praegune kood võrdleb: `sanitize_id(entry.name) == target_id`  
`sanitize_id` stripib lõpus olevad alakriipsud ja teeb muid teisendusi, mistõttu slugid nagu `1633-19-..._precatione_` (lõpus `_`) ei leia vastet — kuigi kataloog täpselt selle nimega eksisteerib.

**Tagajärg:**  
Slug-põhised pildi-URLid (nt `/{slug}/pilt.jpg`) saavad 403, kui slug lõpeb alakriipsuga. Praegu toimib asi tänu `translate_path` fallback-ile `image_server.py`-s, mis teeb `os.path.join(DIRECTORY, *parts)` otse.

**Soovituslik parandus:**  
Step 4 peaks kasutama otse kataloognime, mitte `sanitize_id` versiooni:
```python
# Praegu (vale):
if sanitize_id(entry.name) == target_id:

# Parem:
if entry.name == target_id:
```

Kaaluda tuleks, kas `sanitize_id` kasutamine step 4-s oli algselt mõeldud mingil põhjusel (nt URL-dekooditav nimi vs. failisüsteem) — kui ei, siis otse-võrdlus on õige.

---

## Meilisearch `lehekylje_pilt` — slug vs. NanoID

**Failid:** `scripts/1-1_consolidate_data.py`, `server/meilisearch_ops.py`

**Probleem:**  
`lehekylje_pilt` väli Meilisearchis sisaldab slug-põhist teed (`slug/pilt.jpg`), mitte NanoID-põhist (`nanoid/pilt.jpg`). NanoID on nüüd kanooniline viide, slug on ebastabiilne (muudetav).

**Tagajärg:**  
Image server peab tegema slug → kataloog tõlkimise iga pildi-päringu puhul (aeglane, cache-miss). Slug muutumise korral lähevad pildi-URLid katki.

**Soovituslik parandus:**  
Uuendada `lehekylje_pilt` Meilisearchi indekseerimise käigus NanoID + failinimeks. Nõuab reindekseerimist (`server_seed_data.sh`).

---

## Tehniline võlg — koodibaasi dubleerimine ja fallbackid

Analüüsitud 2026-06-07, vt `docs/codebase_duplication_fallback_review_2026-06-07.md`.

### ✅ P1: Backend LinkedEntity utiliidid konsolideeritud (2026-06-08)

`scripts/1-1_consolidate_data.py` impordib nüüd LinkedEntity funktsioonid `server/utils.py`-st (fake-package mustriga, väldib `__init__.py` kõrvalefekte). Eemaldati ~130 rida duplikaatkoodi. `labels.json` kanooniline register laaditakse indekseerimise käigus ja edastatakse `get_labels_by_lang` väljakutsetele — indeks ja runtime näitavad nüüd samu kanoonilisi silte. 13/13 testi rohelised.

### P1: Frontend label fallback ühtlustamine

`labelUtils.ts`, `metadataUtils.ts` ja `server/cache.py` kasutavad eri fallback-ahelaid. Kanooniline peaks olema `UI keel → et → en → la → de → raw Q-kood`. Vt review dok lõik "Keele fallbackid".

### P2: Frontendi normaliseerijad tugevdada

`normalizePage` / `normalizeWork` (`meiliService.ts`) ei kata kõiki erijuhte mis `pageService.ts` ja `workService.ts` teevad (`page_tags_object`, `languages` fallback). Enne asendamist täiendada jagatud normaliseerijaid. Vt review dok lõik 2.

### P2: Bulk-operatsioonide atomic write

`main.py` `bulk_collection`, `bulk_tags`, `bulk_genre` — TOCTOU risk: luku vabastamine arvutuse ajal. Lisa helper mis hoiab lukku terve read-compute-write tsükli vältel. Vt review dok lõik 4.

### P3: Legacy fallbackid sulgeda migratsioonidega

Kohtade labeli järgi lineaarne runtime-otsing (`places_ops.py`), `status`/`confession` legacy fallbackid (`prosopography/ops.py`). Siduda migratsiooniskriptidega või lisada diagnostiline hoiatus.

---

## `PageThumbnail` — jagatud komponent (praegu duplitseeritud)

**Failid:** `src/pages/search/SearchResults.tsx`, `src/pages/WorkManage.tsx`

**Probleem:**  
Viewer-token retry loogika (piiratud kollektsioonide pisipiltide laadimiseks) on duplikeeritud kahes kohas lokaalsete komponentidena (`PageThumbnail` SearchResults-is, `PageThumb` WorkManage-s). Mõlemad teevad sama asja: 403-viga → küsi viewer-token → lisa `exp`+`sig` parameetrid URLi.

`ThumbnailGrid.tsx` (töölaua pisipildivaade) samuti ei kasuta viewer-tokenit.

**Soovituslik parandus:**  
Luua `src/components/PageThumbnail.tsx` jagatud komponent ja asendada kõik kolm kasutuskohta sellega.

---

## TODO CLAUDE.md-st (üle toodud siia)

| Ülesanne | Prioriteet |
|----------|-----------|
| Automaatne backup-süsteem | Kõrge (ootab IT-d) |
| JSON cleanup (`page_number` eemaldamine) | Madal |
| `crossLangTypeMap` eemaldamine AdvancedFilters-ist | Madal (kui kõigil teostel on `type_ids` indekseeritud) |

=== MINU LISANDUSED ===
Arhiiviviidetel puudub inglise keel praegu.

main.py on hiigelsuureks kasvanud

Oleks vaja võimalust valida manage all mitu lehekülge ja need kustutada või mitu lehekülge ja need liigutada teise kohta. ✅ TEHTUD (feat/bulk-page-select-move-delete, 2026-06-21)

---

## Manage hulgivalik — ülevaatuse leiud (2026-06-21)

Featuur (hulgivalik + liigutamine + kustutamine) on töökindel ja testitud (util 13 testi,
server 14 testi, tsc puhas). Allesjäänud väiksed lahtised:

### Bug 1: 409 conflict jätab segase kinnitusriba rippuma
**Fail:** `src/pages/WorkManage.tsx`, `handleBulkDelete` (409-haru)
409-harus tühjendatakse valik (`setSelectedFiles(new Set())`), aga `bulkDeleteConfirm`
jääb `true`. Kinnituspaneel renderdub valikust sõltumatult → kuvab "Kustutada 0 lehekülge?"
töötava nupuga, mis siis no-op'ib. **Fix:** lisa `setBulkDeleteConfirm(false)` 409-harusse.

### Bug 2: lühike vale-välgatus lehtede laadimisel
**Fail:** `src/pages/WorkManage.tsx:209, 221` (`hasReorderChanges`, `changedCount`)
Esmarenderil on `draftPositions` tühi → `draftPositions[p.filename]` on `undefined !== page_num`
→ `hasReorderChanges` hetkeks `true` (kuni `useEffect` rida 203 jookseb). Tähendab "Salvesta
järjekord"-riba välgatust ja bulk-kustutuse hetkelist keelamist. Järjekord ise OK (`?? page_num`).
**Fix:** `useMemo` või init otse `useState`-s.

### Bug 3: üksik-kustutus pole draft'i ajal blokeeritud (bulk on)
**Fail:** `src/pages/WorkManage.tsx`, `handleDeletePage`
Bulk-kustutus on `disabled={hasReorderChanges}` (vihjega). Üksik prügikasti-nupp töötab ka
salvestamata draft'i ajal ja `handleDeletePage → loadPages → useEffect` nullib vaikselt
draft-järjekorra. Loogiliselt korrektne (kustutab serveri `page_num` järgi), aga kasutaja
kaotab salvestamata järjekorra ette hoiatamata. **Fix:** sama blokeering või hoiatus.

### ✅ Visuaalne: pildiredaktori modaali X kättesaamatu väiksel ekraanil (2026-06-21)
**Fail:** `src/components/PageImageEditorModal.tsx`
App-i `<Header>` on `sticky top-0 z-[1200]`, aga modaali ülekate oli vaid `z-50` → app-i päis
renderdus modaali peale. Vertikaalselt tsentreeritud `max-h-[92vh]` modaali ülemine serv (X-nupp)
libises väiksel ekraanil app-i päise taha ega olnud klikitav (Esc töötas). **Parandatud:**
modaali ülekate `z-50` → `z-[1300]` (app-i päisest kõrgemale).
