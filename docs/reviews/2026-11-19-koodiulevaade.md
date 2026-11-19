# VUTT koodiülevaade: kiirus, hallatavus, optimeeritus ja turvalisus (2026-11-19)

**Kuupäev:** 2026-11-19  
**Aluseks olev seis:** `main` (`754c862c`, PR #837)  
**Varasemad ülevaated:** `2026-10-16-turva-ja-koodibaasi-ulevaade.md`, `2026-11-10-kiiruse-ja-turva-ulevaade.md`, `2026-11-16-ocr-kiirus-ja-rl.md`

**Raamistus ja meetod:** kogu koodibaasi staatiline ülevaatus (fookusega alates 2026-10-16 ja eriti 2026-11-10..2026-11-19 lisandunud koodile: püsisessioonid, pildivahemälu, isikuindeksi vahemälu, eksemplaride leht ja kogupäring, ühendatud pildiredaktor, töökollektsioonid, isikuettepaneku 1. ja 2. osa, MCP tööriistad) + automaatkontrollid (`npm audit --omit=dev` = 0 haavatavust, `npx tsc --noEmit` = 0 viga, `dist/assets/` bundle-analüüs). Serveris jooksvaid mõõtmisi ei tehtud.

---

## Järelkontroll ja otsused (2026-11-19, sama päev)

Ülevaate väited kontrolliti koodi vastu enne parandamist. **Kontrollitud leiud pidasid sisuliselt paika,
aga prioriteedid olid paisutatud:** P0 tähendab „tootmine katki või turvaauk" ja sellist ei olnud ühtegi.
Ainus funktsionaalne viga oli N19-05; ülejäänud on jõudlus või hügieen. Allpool olev koondtabel on
jäetud algsel kujul, kehtiv seis ja prioriteet on selles jaotises.

### Seis leiu kaupa

| ID | Algne → hinnang | Seis | Märkus |
|---|---|---|---|
| N19-01 | P0 → P1 | **#840** | Topeltlaadimine juhtub ainult teose ESIMESEL lehel: allkiri jääb `ImageTokenContext`-i vahemällu teose kaupa. |
| N19-02 | P0 → P1 | **#839** | „Autentimata DoS" jättis mainimata rate-limiti (30 / 300 s IP kohta, `config.py`). |
| N19-03 | P0 → P1 | **#839** | |
| N19-04 | P0 → P1 | **#838** | Tulemus oli õige, ainult aeglane — ainult ametifiltri korral. |
| N19-05 | P0 → P1 | **#838** | Päris viga. Parandus aitab ka jätkamisel (`handleResume` seatud ajatempli kirjutas poll üle). |
| N19-06 | P1 → P2 | **#838** | Sama oraakel oli ka **osaettepanekul** (`invalid_parts`), mitte ainult eksemplaridel. Risk on väike (nanoid-e ei saa ära arvata + rate-limit). |
| N19-07 | P1 | **#839** (osaliselt) | Vt otsused allpool; leidus kolmas koopia `git_ops.py`-s. |
| N19-08 | P1 | **#838** | Ülevaade mõõtis toorsuurust (97 KB, 51 %); CLAUDE.md nõuab gzip'i: ~14 KB 32,6 KB-st. Tulemus: peamine CSS gzip 32,6 → 16,2 KB. Kaardid brauseris üle vaadatud. |
| N19-09–12 | P1 | #841, #842, #843, #844 | Rea-täpsusega väiteid EI kontrollitud — issue'des on esimene samm kontroll/mõõtmine. |
| N19-13 | P2 | **#840** | Kontrollitud: `thumb.save` kirjutas otse sihtfaili. |
| N19-14 p2 | P2 | **#838** | Parooli lähtestus tühistab MCP agendikoodid. |
| N19-14 p5 nginx | P2 | **#840** | Kontrollitud: `add_header` lisab teise päise, ei asenda olemasolevat; `no-store` võidab. |
| N19-14 p1, p3, p5 `original_path` | P2 | **#840** | p4 (tulevane rollilangetus) ei vaja praegu muudatust. Docker `no-new-privileges` ja kommenteeritud `nginx.conf` jäid tegemata. |
| N19-15–17 | P2 | #845 | Hallatavus; liinid, mitte parandused. |
| N19-18 | P3 | **#838**, **#840** | `react-zoom-pan-pinch` eemaldatud; `Workspace.tsx:393` parandatud. |

### Otsused ja põhjused

**N19-06 — kood enne sisu.** Autentimata submit-otspunktis kontrollitakse agendikoodi ENNE igat
sisuvaliidsust (read, osad, versiooni tüüp, märkus), sest router jõuab `submit`-i ainult olemasoleva
teosega ja iga muu veateade reedaks teose olemasolu. Mall on `page_text_proposals.submit`, mis tegi
seda juba õigesti. Osaettepaneku `version`-tüübi viga sai seejuures nime `invalid_pages_version`
(oli `invalid_handoff`, mis kooditõrkega segi läks). Isikuettepanekut (`enrichment_proposals.submit`)
EI muudetud: isikukaardid on niikuinii avalikud (`GET /prosopography/{id}`), oraaklit ei ole.

**N19-04 — indeks on autoriteetne ka tühjana.** `_entry_occupations` tagastab indeksi loendi kohe, kui
väli on olemas, ka siis, kui see on tühi. Indeksikirje ehitatakse sama `_extract_occupation_entries`-iga,
seega kaardi lugemine ei saa anda muud tulemust. Varuvariant (kaardi lugemine) jääb ainult vanale
kirjele, millel väli puudub.

**N19-08 — CSS-i järjekord.** Kaardi-CSS imporditakse nüüd kaardikomponentides (`PersonsMap`,
`RelationsMap`, `PlacesDetail` → `leaflet.css`; `HistoricalMapLayer` → `maplibre-gl.css`). Laisk tükk
laeb PÄRAST `index.css`-i, seega sama spetsiifilisusega `index.css` reegel kaotaks Leafletile.
Ainus selline oli `.vutt-region-tooltip` → nüüd `.leaflet-tooltip.vutt-region-tooltip`. **Uus
`index.css` reegel, mis kirjutab üle `.leaflet-*` / `.maplibregl-*` klassi, vajab samuti topeltklassi.**

**N19-02 — mis läks threadpooli ja mis mitte.** Threadpooli läksid kutsed, mis cache-missil skannivad
kogu andmekausta või hoiavad lukku, mille all käib I/O: `find_directory_by_id`, `_load_work_metadata`,
`_resolve_work_set_ids`, `search_visible_work_ids`, `get_cached_suggestions`. `/collections` ja
`/config/archives` muudeti `def`-iks. Ühe väikese faili lugemised (`_load_or_404`, `_load_prepress`)
jäid `async def` sisse — need on mõõtmatult lühikesed. Valvur `tests/test_async_ei_blokeeri.py`
kontrollib AST-iga konkreetset nimekirja; uus raske abifunktsioon lisa sinna.
Soovituste vahemälu sai oma luku (`_suggestions_lock`): ehitus skannib kõik `_metadata.json`-id ja
küsib Meilit (kuni 5 s), ja ühise `_cache_lock`-i all ootas ka avalik `/collections`. `invalidate_cache`
EI võta soovituste lukku (ei oota ehitust ära); selle asemel tõstab ta põlvkonda ja keset ehitust
invalideeritud tulemust ei salvestata.
**Tegemata:** `find_directory_by_id` negatiivne vahemälu. Pärast threadpooli viimist ja rate-limitiga
ei ole see vajalik, aga äsja imporditud teos jääks invalideerimise unustamisel „olematuks".

**N19-03 — vahemälu võti.** Kasutati olemasolevat `network._cards_signature` (failide arv + mtime-d),
sama mis seoste pöördkaardil. Kaardi salvestus on atomaarne (uus fail + rename), seega mtime muutub alati.

**N19-07 — lehejärjekorra reegel.** Ülevaade soovitas ühtlustada, aga mitte, kumma reegli järgi.
Reegleid oli kolmes kohas: `meili_doc.enumerate_page_images` (`sequence`-ita leht → lõppu), ning
`admin_page_ops.get_sorted_images` ja `git_ops._build_images_list` (→ tähestikuline positsioon × 100).
**Valiti indekseerija reegel (lõppu)**, sest:
1. 2026-06-24 (`427d91f5`) ühtlustati seed ja live just selle reegli järgi ning
   `tests/test_meili_seed_live_parity.py` valvab seda — see on varasem teadlik otsus;
2. Meili lehenumbrid (otsing, `work_parts`, `work_exemplars`, URL-id) jäävad muutumatuks;
3. **tootmises ei ole ühtegi osalise `sequence`-iga teost** (kontrollitud serverist 2026-11-19: 0/1514;
   `"sequence": 0` samuti 0), seega muutus ei liiguta ühtki lehte.
Kui osaline `sequence` kunagi tekib, läheb nummerdamata leht kõigis vaadetes ühtemoodi lõppu.
Haldusvaate argument („tähestikuline positsioon hoiab lehe õiges kohas") kehtib, aga reegli
muutmine on eraldi otsus koos reindeksiga, mitte möödaminnes. `page_sequence` käsitleb nüüd
`sequence: 0` väärtusena (varem `or` → „puudub").
`scripts/sync_meilisearch.py` hoiab oma koopiat (sama reegel) — eraldiseisev skript, ei mõjuta tootmist.

**N19-07 — atomaarsed kirjutused.** `atomic_write_*` peale viidi ainult **olemasoleva** lehe JSON-i
ülekirjutus (järjestus, ümbernummerdus, poolitus, bulk-taaste): seal on kommentaarid ja ajalugu, ja
poolik kirjutus kaotaks need. Uue faili kirjutused impordis/upload'is jäid `open('w')`-ks — katkestuse
korral korratakse importi. Hind: `fsync` iga faili järel, nii et väga pika teose järjestamine võib minna
veidi aeglasemaks.
**Tegemata (soovitus oli vale):** `load_work_metadata_by_id` ei hakka katkist JSON-i alla neelama.
`work_relations.cleanup_for_deletion` püüab `OSError`/`ValueError` teadlikult ise kinni („katkine teos
peab jääma kustutatavaks"); `None` tagastamine muudaks seal semantikat.

**N19-01 — parandus serveris, mitte kliendis.** Ülevaade pakkus kahte asja: avalikule teosele allkirja
mitte anda ja piiratud teosel töölaual allkirja ära oodata. Tehti ainult esimene: `viewer-token`
tagastab avalikule ja jagatud teosele `image_exp/image_sig = null` (sama predikaat mis
`image_server._check_image_access`). Ootamist ei lisatud: piiratud teose esimene allkirjata päring
saab 403, mis on väike, mitte 2 MB skann. Teadlik piirang: pildiserver on eraldi protsess oma kogude
vahemäluga (TTL 5 min), nii et kogu muutumise järel avalikuks võib sisselogitud vaataja pilt kuni
5 min 403-ga tulla.

**N19-14 work_sets — oraakel.** Mitte-admin haldur saab olematu ja loetamatu teose kohta sama 403;
admin saab olematu kohta endiselt 400 (admin loeb kõike, oraaklit pole). Vana test
`test_tundmatu_teose_lisamine_annab_400` kinnitas just oraaklit ja asendati.

**N19-14 nginx.** `add_header Cache-Control $admin_cache_control` + `map $upstream_http_cache_control`:
no-store lisatakse ainult siis, kui backend oma päist ei saada. Hostis rakendatakse deploy'l
(`scp` + `nginx -t` + reload, CLAUDE.md „nginx").

### Järgmised sammud

Avatud töö on GitHub issue'des: #841 (N19-09), #842 (N19-10), #843 (N19-11), #844 (N19-12), #845 (N19-15/16/17). Väljaspool neid jäid
tegemata Docker `no-new-privileges` ja kommenteeritud `nginx.conf` viide (`backend:8001`).

---

## 0. Koondtabel

### Varasemate N10 leidude seis (2026-11-10 → 2026-11-19)

Peaaegu kõik 2026-11-10 koodipoolsed leiud on vahepeal lahendatud:
- **Lahendatud:** `N10-01` (PR #779: `private, no-cache`, aga vt uut frontendi koostoime leidu **N19-01**), `N10-03` (PR #780: `_cached_json`, aga vt jääke **N19-03/04/05**), `N10-05` (PR #765), `N10-06` (PR #782: püsisessioonid + libisev aegumine, ADR 0081), `N10-07` (PR #765), `N10-09` (PR #765: pildipiletid), `N10-10` (PR #781: Meili `v1.33.1`, Umami `3.0.3`), `N10-11` (PR #765).
- **Teadlikult ei tehta / avatud infra:** `N10-02` (vaatamiskuju, #758 — eraldi featuur), `N10-04` (Meili delta-sünk, #760 suletud mõõtmisega), `N10-08` (varukoopia teine asukoht ja taasteproov, #763).

### Uued ja aktuaalsed leiud (2026-11-19)

| ID | Teema | Valdkond | Prioriteet | Peamised failid |
|---|---|---|---|---|
| **N19-01** | Sisselogitud kasutajal laetakse töölaual pildid 2× ja `?exp=&sig=` lõhub 304 vahemälu | kiirus / optimeeritus | **P0** | `Workspace.tsx:135,368-386`, `public.py:63-89` |
| **N19-02** | `async def` otspunktid blokeerivad event loopi (sh autentimata `find_directory_by_id` täisskann) | kiirus / töökindlus | **P0** | `editing.py:400`, `collections.py:35`, `work_exemplars.py:177`, `work_parts.py:170`, `cache.py:19` |
| **N19-03** | Avalik rate-limitita `GET /prosopography/relation-type-suggestions` parsib kõik ~2350+ isikukaarti igal päringul | kiirus / DoS | **P0** | `prosopography/relations.py:104-120`, `router.py:969` |
| **N19-04** | `_entry_occupations()` N+1 bugi: tühi `occupations: []` langeb `get_person()` kettalugemisse | kiirus / optimeeritus | **P0** | `prosopography/person_search.py:187-218` |
| **N19-05** | `useUploadWizard.ts` aegunud sulund pollingus — OCR timeout ei käivitu kunagi | töökindlus (bug) | **P0** | `src/pages/upload/useUploadWizard.ts:262-286` |
| **N19-06** | Autentimata privaatsete teoste olemasolu oraakel `POST /works/exemplar-proposals/submit` | turvalisus | **P1** | `routers/work_exemplars.py:177-182`, `exemplar_proposals.py:194-201` |
| **N19-07** | Lehtede järjekorra SSOT-lahknevus (`get_sorted_images` vs `enumerate_page_images`) ja mitte-atomaarsed JSON-kirjutused | andmekorrektsus / hallatavus | **P1** | `meili_doc.py:243`, `admin_page_ops.py:182,232,277`, `import_work.py:404` |
| **N19-08** | Kaardi-CSS (`leaflet.css` + `maplibre-gl.css`, 97 KB = >51% peamisest CSS-ist) laetakse globaalselt igal lehel | optimeeritus | **P1** | `src/index.tsx:5-6` |
| **N19-09** | Pildiredaktori ja kõrvutusmodaali lohistus-jõudlus (rAF-ita `mousemove` re-renderdab 1721-realise `WorkManage`'i ja filmiriba) | kiirus | **P1** | `useCropBox.ts:176`, `SplitGuide.tsx:60`, `WorkManage.tsx:1620`, `PageFilmstrip.tsx:42` |
| **N19-10** | Backendi vahemälu lüngad, N+1 (`GET /exemplars/batch`, `work_relations_ops`, registrid) ja `_cached_json` stale-overwrite | kiirus / optimeeritus | **P1** | `indices.py:134`, `work_relations_ops.py:262`, `routers/work_exemplars.py:98`, `enrichment_proposals.py:408` |
| **N19-11** | Frontendi topelt-API päringud ja stale-response võidujooksud (`PersonEditPage`, `PersonDetailPage`, `ExemplarPage`, `AgentEnrichmentPanel`) | kiirus / töökindlus | **P1** | `PersonEditPage.tsx:185,195`, `PersonDetailPage.tsx:399-404,461`, `ExemplarPage.tsx:150` |
| **N19-12** | Mitmekordsed sünkroonsed git-commitid (`enrichment_proposals.apply_selected`) ja O(N²) `apply_page_ops` pakk-poolitus | kiirus | **P1** | `enrichment_proposals.py:732`, `reciprocal_ops.py:68`, `admin_page_ops.py:757` |
| **N19-13** | Pildiserveri `generate_thumbnail` mitte-atomaarne kirjutus ja piiramatu paralleelne Pillow CPU/RAM | töökindlus / optimeeritus | **P2** | `server/image_server.py:244-247,581` |
| **N19-14** | Väiksemad turva- ja andmevalideerimise puudused (`work_sets` 500/oraakel, paroolilähtestus ei tühista MCP koode, eneseseos, `original_path`, topelt `Cache-Control`) | turvalisus | **P2** | `work_sets.py:232`, `password_reset.py:229`, `enrichment_kinds.py:411`, `nginx.host.conf:161` |
| **N19-15** | Suured "jumalakomponendid" ja dubleerimine frontendis (`WorkManage` 1721 rida / 67 `useState`, kaks pildiredaktorit, 381× `any`) | hallatavus | **P2** | `WorkManage.tsx`, `PersonEditPage.tsx`, `Dashboard.tsx`, `PageImageEditorModal.tsx` vs `SplitPageDetail.tsx` |
| **N19-16** | Backendi suured moodulid, dubleerimine ja logimise/veakäsitluse lüngad (`upload_ops`, `reocr_ops`, `prosopography/router.py`, vaiksed `except: pass`) | hallatavus | **P2** | `upload_ops.py:560`, `reocr_ops.py`, `prosopography/router.py`, `enrichment.py:584` |
| **N19-17** | Mälukasutus piltide lisamisel (`admin_add_pages` loeb failid RAM-i enne mahukontrolli) ja täiskorpuse kettaskannid (`_propagate_name_to_works`, `collections`) | optimeeritus | **P2** | `routers/pages.py:185,259,359`, `person_crud.py:288`, `collections.py:331` |
| **N19-18** | Pisivead ja dokumentatsiooni/sõltuvuste hügieen (`ImageViewer.tsx:218`, `Workspace.tsx:393`, `react-zoom-pan-pinch`, `docs/tegemata_tood.md`) | hallatavus | **P3** | `ImageViewer.tsx:218`, `Workspace.tsx:393`, `package.json:36`, `docs/tegemata_tood.md` |

---

## 1. Kiirus ja optimeeritus

### N19-01 [P0] — Töölaual laetakse pildid sisselogitud kasutajal 2× ja `?exp=&sig=` lõhub 304 vahemälu
- **Asukoht:** `src/pages/Workspace.tsx:135, 368-386`, `src/contexts/ImageTokenContext.tsx:37-59`, `src/hooks/useAdjacentPagePrefetch.ts:45-92`, `server/routers/public.py:63-89`.
- **Probleem:**
  1. `Workspace.tsx:135` kutsub `useImageToken(workId, { enabled: !!authToken || !!viewerToken })`, ja `public.py:63-89` väljastab `image_exp`/`image_sig` **ka avalikele teostele**, kui kasutaja on sisse logitud.
  2. Meilisearchi `getPage` vastab kiiremini (~10 ms) kui `/work/{id}/viewer-token` (~30–80 ms). Esimesel renderil on `imageToken === null`, mistõttu `<ImageViewer>` alustab täissuuruses skanni (~2 MB) laadimist ilma tokenita. Kui `viewer-token` vastab, muutub `currentImageSrc` (`?exp=...&sig=...`) ja sama pilt laetakse **teist korda alla**; ka `useAdjacentPagePrefetch` jookseb uuesti (`warmedRef` URL-id ei ühti).
  3. Iga uus seanss/tab saab uue `image_exp` väärtuse → HTTP vahemälu võti muutub ja pildiserveri `304 Not Modified` revalideerimine ei taba üle seansside.
- **Parandus:** Ära lisa `?exp=&sig=` avalikele teostele (`useImageToken` aktiivne ainult piiratud teosel või `viewerToken`-iga). Piiratud teostel hoia `currentImageSrc` tühjana (`''`) ja eellaadimine keelatuna, kuni `imageToken` on käes.

### N19-02 [P0] — Blokeeriv sünkroonne I/O `async def` otspunktides (ühe-workeri event loopi külmutamine)
Ühe-workeri uvicornis blokeerib iga sünkroonne ketta- või võrgukutse `async def` sees kõik teised samaaegsed päringud:
- **Kriitiline:** `server/routers/editing.py:400-402` (`POST /get-metadata-suggestions`) kutsub `get_cached_suggestions()` otse event loopis. Cache-missil (`server/cache.py:152-234`) hoiab see globaalset `_cache_lock`-i, parsib kõik `_metadata.json`-id **ja teeb sünkroonse HTTP päringu Meilisearchi (`urllib.request.urlopen`, 5 s timeout)**.
- **Kõrge:** `server/routers/collections.py:35-39` (`GET /collections`, `GET /config/archives`) on `async def` ja võtavad **sama globaalse `_cache_lock`-i** — `get_cached_suggestions` rebuild külmutab ka avalikud kollektsioonide päringud.
- **Kõrge (DoS):** autentimata `async def` otspunktid `server/routers/work_exemplars.py:177` ja `server/routers/work_parts.py:170` kutsuvad `find_directory_by_id()` otse event loopis. Tundmatu `work_id` sunnib iga kord täieliku `os.scandir(BASE_DIR)` + kõigi `_metadata.json`-ide parsimise (`server/utils.py:264-270`).
- **Kõrge/Keskmine:** `server/prosopography/router.py:158-164, 248-252` (`_resolve_work_set_ids`), `server/routers/work_sets.py:143, 171, 217, 255` (`_load_or_404`, `search_visible_work_ids`), `server/routers/editing.py:355, 387`, `server/routers/pages.py:514`, `server/routers/public.py:38, 44`, `server/prosopography/router.py:619`, `server/routers/upload.py:257, 351`.
- **Parandus:** Muuda puhtalt sünkroonsed otspunktid tavaliseks `def`-iks või vii kutsed `await run_in_threadpool(...)` sisse; eralda `server/cache.py`-s `_suggestions_lock`; lisa `find_directory_by_id()`-le negatiivne vahemälu (`BASE_DIR` `mtime` põhjal) + lukk.

### N19-03 [P0] — Avalik `GET /prosopography/relation-type-suggestions` parsib kõik ~2350+ isikukaarti igal päringul
- **Asukoht:** `server/prosopography/relations.py:104-120`, `server/prosopography/router.py:969-972`.
- **Probleem:** Avalik, rate-limitita otspunkt, mis avab ja parsib igal päringul `glob(PROSOPOGRAPHY_DIR/*.json)` kõik isikukaardid ilma igasuguse vahemäluta. Tõsine GIL-i ja ketta-DoS vektor.
- **Parandus:** Lisa kausta allkirja/mtime põhine vahemälu (nagu `network.py:147-150`) või koonda seosetüübid indeksi uuendamisel.

### N19-04 [P0] — `_entry_occupations()` N+1 kettalugemise bugi `?occupation=...` filtris
- **Asukoht:** `server/prosopography/person_search.py:187-218`.
- **Probleem:** Kui indeksikirjel on `"occupations": []` (tühi loend), jääb `normalized` tühjaks, `if normalized:` (`:209`) on väär ja funktsioon langeb real `:215` `get_person(person_id)` kettalugemisse **iga ametita isiku kohta**.
- **Parandus:** Kui `occupations is not None`, tagasta `normalized` kohe (`return normalized`), ka siis kui see on tühi list.

### N19-08 [P1] — Kaardi-CSS (97 KB, >51% peamisest CSS-ist) laetakse globaalselt igal lehel
- **Asukoht:** `src/index.tsx:5-6`.
- **Probleem:** `leaflet/dist/leaflet.css` (15 KB) ja `maplibre-gl/dist/maplibre-gl.css` (82 KB) on imporditud rakenduse juures. Tulemusena on `dist/assets/index-*.css` 188 KB, millest üle poole on kaardistiilid, mida avalehel, otsingus ega töölaual ei kasutata (kaardi JS ise on ilusti lazy-loaded: `mapBase` 1010 KB + `maplibre-gl-worker` 498 KB).
- **Parandus:** Liiguta `leaflet.css` failidesse `src/prosopography/components/map/mapBase.tsx` ja `src/pages/admin/PlacesDetail.tsx` ning `maplibre-gl.css` faili `src/prosopography/components/HistoricalMapLayer.tsx`.

### N19-09 [P1] — Pildiredaktori ja kõrvutusmodaali lohistus-jõudlus
- **Asukoht:** `src/components/pagePrep/useCropBox.ts:176-219`, `src/components/pagePrep/SplitGuide.tsx:60-65`, `src/pages/WorkManage.tsx:358-365, 1620-1635`, `src/components/pagePrep/PageFilmstrip.tsx:42`, `src/pages/manage/PageCard.tsx:44`, `src/components/exemplars/ExemplarCompareModal.tsx:175-179, 238-258`.
- **Probleem:**
  - `useCropBox` ja `useSplitGuideDrag` uuendavad Reacti state'i igal `mousemove` sündmusel ilma `requestAnimationFrame`-ita.
  - Poolitusjoone lohistamine kirjutab otse `WorkManage`'i `pendingOps` state'i, re-renderdades kogu 1721-realise komponendi, kõik `PageCard`-id ja `PageFilmstrip`'i (kumbki pole `React.memo`). Lisaks loob `WorkManage.tsx:1622, 1625` iga renderiga uue `pages.map(...)` massiivi ja `onClose` funktsiooni.
  - `ExemplarCompareModal` (`zoomTogether`) re-renderdab igal `mousemove`/`wheel`-il mõlemad `ImageViewer`-id ja mõlemad `Strip` ribad.
- **Parandus:** Throttle'i lohistamine `requestAnimationFrame`-iga (hoia `liveSplitX` lohistuse ajal lokaalses state'is ja kirjuta parent'isse `mouseup`-il); mähi `PageFilmstrip`, `PageCard` ja `Strip` `React.memo`-sse; memoiseeri `editorPages` ja `onClose`; anna `imageTicket` `PageCard`-ile propina `WorkManage`-ist.

### N19-10 [P1] — Backendi vahemälu lüngad, N+1 ja `_cached_json` stale-overwrite
- **Asukoht:** `server/prosopography/indices.py:134-143`, `server/prosopography/work_relations_ops.py:262-281`, `server/routers/work_exemplars.py:98-105`, `server/work_exemplars.py:497-511, 786-826`, `server/prosopography/enrichment_proposals.py:408-520`, `server/prosopography/enrichment_kinds.py:67-70, 124-132, 255-263`, `server/prosopography/network.py:28-49`.
- **Probleem:**
  1. `_cached_json` (`indices.py:134-143`) arvutab faili allkirja `sig` ja parsib JSON-i väljaspool lukku ning kirjutab siis `_readonly_cache[path] = (sig, value)` — cache-missil võib tekkida paralleelne 3,4 MB parsimine (thundering herd) või hilisema lõime poolt vanema versiooni tagasikirjutamine.
  2. `work_relations_ops.py:262` parsib `prosopography_index.json` (~3,4 MB) otse kettalt `_load_index_readonly()` asemel. `network.py:28-49` peab sama indeksi teist koopiat mälus.
  3. `person_to_works.json`, `work_collections_index.json`, `works_creators_index.json` ja `convolute_index.json` on ilma `_cached_json` vahemäluta.
  4. `GET /exemplars/batch` (kuni 50 teost) teeb iga teose kohta topelt `find_directory_by_id`, skannib lehed `enumerate_page_images`-ga ning loeb `convolute_index.json` kettalt uuesti igal tsüklisammul. `_check_holder()` loeb `ARCHIVES_FILE` kettalt `get_cached_archives()` asemel.
  5. `enrichment_proposals.py` (`_registry_entry`) ja `enrichment_kinds.py` loevad `occupations.json`, `institutions.json`, `places.json` ja `vocabularies.json` kettalt igal ettepaneku real uuesti (20 rida = 60–80 faililugemist).
- **Parandus:** Laienda `_cached_json`-i (koos `sig == _file_sig(path)` või failipõhise laadimislukuga) kõigile lugemisindeksitele ja registritele; kasuta `work_relations_ops.py`-s `_load_index_readonly()`, `work_exemplars.py`-s `get_cached_archives()` ja `batch`-päringus per-request cache'i.

### N19-11 [P1] — Frontendi topelt-API päringud ja stale-response võidujooksud
- **Asukoht:** `src/prosopography/pages/PersonEditPage.tsx:162-206`, `src/prosopography/pages/PersonDetailPage.tsx:399-404, 461-511`, `src/pages/ExemplarPage.tsx:101-165`, `src/prosopography/components/personForm/AgentEnrichmentPanel.tsx:53-58`.
- **Probleem:**
  1. `PersonEditPage.tsx:185, 195` kutsub `fetchPlaces()` **kaks korda** igal avamisel (vahemäluta).
  2. `PersonDetailPage.tsx:399-404` kutsub `useWorkTitles` ja `useWorkInfo` kattuvate `sourceWorkIds`-idega → topelt võrgupäring. Samas failis (`:461-511`) puudub `cancelled` guard `getPerson` + `getWorkTitles` ahelal ning `index` sõltuvus põhjustab topeltlaadimise auth-initsialiseerimisel.
  3. `ExemplarPage.tsx:150-165` (`loadManifest`) ja `AgentEnrichmentPanel.tsx:53-58` (`refresh`) puudub requestId/`cancelled` guard — kiirel vahetusel võib vanem vastus uue oleku üle kirjutada.
- **Parandus:** Lisa moodulitasandi cache `fetchPlaces`-ile ja eemalda topeltkutse; kasuta `PersonDetailPage`-is ühte `useWorkInfo` kutset; lisa request-sequence/`cancelled` valvur `ExemplarPage`, `PersonDetailPage`, `PersonEditPage` ja `AgentEnrichmentPanel` efektidesse.

### N19-12 [P1] — Mitmekordsed sünkroonsed git-commitid ja O(N²) pakk-poolitus
- **Asukoht:** `server/prosopography/enrichment_proposals.py:50-82, 708-758`, `server/prosopography/reciprocal_ops.py:68-118`, `server/admin_page_ops.py:757-767`.
- **Probleem:**
  1. `apply_selected` teeb ühe kinnituse sees iga uue registrikirje kohta eraldi git-commiti (`registries.ensure`), 1 commiti isikukaardile (+ 3,4 MB indeksi ülekirjutus) ning iga vastastikuse seose B-isiku kohta eraldi sünkroonse git-commiti (`sync_reciprocals`). Lisaks hoiab `apply_selected` SQLite ühendust lahti kogu git-töö aja ja `_db()` käivitab `DROP TABLE`/`CREATE TABLE`/`PRAGMA` igal päringul.
  2. `apply_page_ops` (`admin_page_ops.py:757-763`) kutsub iga `split_x` sammul uuesti `get_sorted_images(path)`, lugedes uuesti läbi kõigi teose lehtede `.json` failid (O(N²)), ja teeb iga poolituse kohta eraldi git-commiti.
- **Parandus:** Lisa `registries.ensure_many()`, vii `sync_reciprocals` taustale või ühte batch-commiti, initsialiseeri SQLite skeem ühekordselt; `apply_page_ops`-is uuenda `images` loendit mälus.

### N19-17 [P2] — RAM-ikasutus failide lisamisel ja täiskorpuse kettaskannid
- **Asukoht:** `server/routers/pages.py:185, 259, 359`, `server/admin_page_ops.py:1033-1061`, `server/prosopography/person_crud.py:288-327`, `server/routers/collections.py:331-367`.
- **Probleem:** `admin_add_pages` loeb kõik üleslaetud failid RAM-i enne 200 MB mahukontrolli (`admin_replace_page_image` ja `admin_add_page` ei piira suurust üldse). `_propagate_name_to_works` ja `_find_works_with_collection` skannivad kogu `BASE_DIR`-i, kuigi pöördindeksid (`person_to_works.json`, `work_collections_index.json`) on olemas.
- **Parandus:** Kontrolli üleslaaditavate failide mahtu tükkide kaupa lugedes; kasuta pöördindekseid nime- ja kogumuudatustel.

---

## 2. Turvalisus ja ligipääsukontroll

Üldhinnang on tugev: **kriitilisi ega kõrge tõsidusega turvaauke ei leitud**, `npm audit --omit=dev` = 0 haavatavust, püsisessioonid (ADR 0081), pildipiletid, fail-closed pildiserver, töökollektsioonide autoriseerimine ja frontendi XSS-kaitse on korrektselt teostatud.

### N19-06 [P1 / Keskmine] — Autentimata privaatsete teoste olemasolu oraakel `POST /works/exemplar-proposals/submit`
- **Asukoht:** `server/routers/work_exemplars.py:177-182`, `server/exemplar_proposals.py:194-201`.
- **Probleem:** Router kutsub `find_directory_by_id(data["work_id"])` enne `epp.submit`-i (olematu teos → `invalid_or_expired_handoff`). Olemasoleva (ka privaatse) teose puhul jõuab päring `epp.submit`-i, kus `rows`/`note` valideerimine käib ENNE `agent_handoff.check(...)` kontrolli (`:196-201`). Päringuga `{"code":"x","work_id":"<kandidaat>","rows":[]}` saab olematu teose (`invalid_or_expired_handoff`) eristada olemasolevast (`invalid_rows`).
- **Parandus:** Kutsu `agent_handoff.check(...)` enne `find_directory_by_id`-d (ja vii `find_directory_by_id` `run_in_threadpool`-i, vt N19-02).

### N19-14 [P2 / Madal] — Väiksemad turva- ja valideerimispuudused
1. **`POST /work-sets/{set_id}/works` (`server/routers/work_sets.py:232-237`):** `work_ids` elementide kohta ei kontrollita `isinstance(work_id, str)` (`work_ids: [{}]` → `TypeError` HTTP 500); mitte-administ haldurile eristab vastus olematu teose (`400`) privaatsest (`403`).
2. **Parooli lähtestamine ei tühista MCP agendikoode (`server/password_reset.py:229-245`):** erinevalt `update_user_role` ja `delete_user` funktsioonidest (`auth.py:674, 847`) ei kutsuta `complete_password_reset`-is `_revoke_agent_handoffs(username)`.
3. **Isikuettepaneku valideerimise äärejuhud (`server/prosopography/enrichment_kinds.py:169-170, 411-433`):** `_apply_relation` lubab eneseseost (`target == person["id"]`), `name` liik ei kontrolli `from <= to`.
4. **Tulevase rollilangetamise valvur (`server/prosopography/enrichment_proposals.py:738`, `router.py:372-375`):** praegu on `apply` `superadmin`-only (turvaauku pole), kuid kui see kunagi `editor`-ile avada, saaks `editor` luua registrikirjeid (`registries.ensure`), mis muidu nõuavad `admin` rolli.
5. **Sügavuskaitse ja taristu pisidetailid:**
   - `server/exemplar_images.py:415-419` (`original_path`): lisa `os.path.commonpath` kontroll.
   - `nginx.host.conf:161`: `/api/files/admin/` lisab `Cache-Control: no-store...`, mis dubleerib ja tühistab `admin_page_preview` (`max-age=300`) ja `admin_history_thumb` (`immutable`) päised.
   - `nginx.conf:77` (kommenteeritud Docker-nginx): viitab veel `backend:8001` (`images:8001` asemel).
   - `docker-compose.yml:139-192`: `meilisearch`, `db-umami` ja `umami` teenustele tasub lisada `security_opt: [no-new-privileges:true]`.

---

## 3. Töökindlus ja andmekorrektsus

### N19-05 [P0] — `useUploadWizard.ts` aegunud sulund pollingus (OCR timeout ei käivitu kunagi)
- **Asukoht:** `src/pages/upload/useUploadWizard.ts:262-286`.
- **Probleem:** `fetchStatus` sõltub `processingStartedAt`-ist (`:277`), kuid `startPolling` (`:283`) salvestab `setInterval`-i algse `fetchStatus` sulundi, kus `processingStartedAt === null`. Igal poll-tiksul olekus `processing` on `processingStartedAt === null` endiselt tõene ja `setProcessingStartedAt(Date.now())` lähtestab taimeri uuesti, mistõttu `ocrTimedOut` ei käivitu kunagi. Lisaks puudub `replaceWorkId` efektil (`:121-167`) `cancelled`/ref-valve `authToken` uuenemisel.
- **Parandus:** Kasuta funktsionaalset uuendust `setProcessingStartedAt(prev => prev ?? Date.now())` ja eemalda `processingStartedAt` sõltuvusmassiivist.

### N19-07 [P1] — Lehtede järjekorra SSOT-lahknevus ja mitte-atomaarsed JSON-kirjutused
- **Asukoht:** `server/meili_doc.py:243` vs `server/admin_page_ops.py:166-186`; `server/admin_page_ops.py:232, 239, 277, 283`; `server/upload/import_work.py:404, 481`; `server/upload_ops.py:748`; `server/work_sets_access.py:17-26`.
- **Probleem:**
  1. `admin_page_ops.get_sorted_images` kasutab puuduva `sequence` korral fallbacki `(alpha_pos[f] + 1) * 100`, samas kui `meili_doc.enumerate_page_images` (mida kasutavad Meilisearch, `work_parts` ja `work_exemplars`) kasutab `float('inf')`. Osalise `sequence`-ga teosel lahknevad lehenumbrid halduse ja eksemplaride/otsingu vahel.
  2. Mitmes kohas kirjutatakse lehe- ja metaandmete `.json` otse `open(..., 'w')` + `json.dump(...)` (mitte `atomic_write_json`); `reocr_state.py` dubleerib käsitsi `tempfile`+`os.replace` 3×.
  3. `work_sets_access.load_work_metadata_by_id` puudub `try/except (OSError, ValueError)` — rikutud `_metadata.json` annab 500.
- **Parandus:** Ühtlusta `enumerate_page_images` ja `get_sorted_images` sorteerimisreegel; vii kõik JSON-kirjutused `atomic_write_json`-ile; lisa `try/except` `load_work_metadata_by_id`-le.

### N19-13 [P2] — Pildiserveri mitte-atomaarne thumbnail ja piiramatu paralleelne Pillow
- **Asukoht:** `server/image_server.py:244-247, 581`.
- **Probleem:** `generate_thumbnail()` kirjutab otse `thumb_path`-i (erinevalt `_generate_fitted_image`-ist real `:276-279`, mis kasutab `.tmp` + `os.replace`) — samaaegne päring mitmelõimelises `SafeThreadingHTTPServer`-is võib serveerida pooliku JPEG-i. Samuti puudub semafor paralleelse Pillow dekodeerimise piiramiseks.
- **Parandus:** Kasuta `generate_thumbnail`-is `.tmp` + `os.replace` mustrit ja piira paralleelset Pillow-tööd `BoundedSemaphore(4)`-ga.

---

## 4. Hallatavus ja arhitektuur

### N19-15 [P2] — Frontendi "jumalakomponendid", kahe pildiredaktori dubleerimine ja `any` kasutus
- **Suurimad komponendid:** `WorkManage.tsx` (1721 rida, **67 `useState`**), `PersonEditPage.tsx` (1198 rida, 27 `useState`), `Dashboard.tsx` (1179 rida, 33 `useState`), `PersonDetailPage.tsx` (1046 rida, 0 `useMemo`/`useCallback`), `searchService.ts` (1013 rida), `Review.tsx` (1001 rida).
- **Dubleerimine:** `PageImageEditorModal.tsx` (655 rida) ja `SplitPageDetail.tsx` (452 rida) dubleerivad modaalikarkassi, klaviatuurinavigatsiooni ja eelvaate loogikat (mõlema alguses on juba hoiatus `⚠ KAKS PILDIREDAKTORIT`).
- **Tüübikindlus:** `0` `@ts-ignore`/`@ts-expect-error` (väga hea), aga **381× `any`** (suurimad: `PersonDetailPage.tsx` 15, `personForm/helpers.ts` 12, `WorkInfoPanel.tsx` 12, `searchService.ts` 11) ja `package.json:12` lubab CI-s `--max-warnings 41`.
- **Soovitus:** Jaota esmalt `WorkManage.tsx` vahekaartide/hookide kaupa (`useWorkReocr`, `useWorkBulkAdd`, `useWorkTrash`) ja koonda kahe pildiredaktori ühine karkass `components/pagePrep/` alla; `Dashboard`-is võib admini hulgivaliku modaalid lazy-loadida.

### N19-16 [P2] — Backendi suured moodulid, dubleerimine ja logimise/veakäsitluse lüngad
- **Suurimad moodulid (pragmaatilised poolituskohad):**
  - `server/upload_ops.py:560-903`: 344-realine `_replace_work_content_locked` segab äriloogika ja `fastapi.HTTPException`-i — eralda `server/upload/replace_work.py`-ks nagu `import_work.py`.
  - `server/reocr_ops.py` (1574 rida): eralda partii-re-OCR (`reocr_batch.py`) üksiklehe voost (ja koonda topelt `_upload` sisefunktsioonid).
  - `server/prosopography/router.py` (1211 rida, 58 endpointi): eralda kohad/grupid ja ettepanekud alamrouteriteks.
- **Dubleerimine:**
  - Keha striimimine baitipiiranguga + JSON decode on kopeeritud **5 kohta** (`prosopography/router.py:436, 526`, `work_exemplars.py:165`, `work_parts.py:157`, `page_text_proposals.py:77`) → üks `read_json_body(request, max_bytes)` abifunktsioon `server/deps.py`-s.
  - Väliste ID-de skeemid (`wikidata`, `gnd`, `viaf`, `album_academicum`) on hajutatud 5 faili (`ext_ids.py:21` võiks olla SSOT); keelatud serveriväljad on dubleeritud `person_crud.py:370` vs `:646`.
  - `work_lock(work_id, work_dir)` (`admin_page_ops.py:36`) saab kõigilt 14 kutsujalt esimeseks argumendiks tegelikult `folder_name`-i — nimeta parameeter ümber, et vältida valet võtit.
- **Veakäsitlus ja jälgitavus:**
  - Vaiksed `except Exception: pass` plokid riskikohtades: `admin_page_ops.py:280, 340` (lehe `.json` viga neelatakse), `upload/import_work.py:41` (`normalize_txt_file`), `prosopography/enrichment.py:584-917` (16× väliste API-de parsimisel), `reocr_recovery.py` (7×).
  - Uued routerid/moodulid (`routers/work_exemplars.py`, `routers/work_sets.py`, `routers/page_text_proposals.py`, `routers/work_parts.py`, `enrichment_proposals.py`, `exemplar_proposals.py`) ei kasuta `logger`-it üldse.

### N19-18 [P3] — Pisivead, sõltuvused ja dokumentatsiooni triiv
- `src/components/ImageViewer.tsx:218-219`: allalaaditava faili laiendi parsimine ei eemalda `?exp=&sig=`/`?v=` query-stringi.
- `src/pages/Workspace.tsx:393`: kui `imageToken === null` (avalik teos), jäetakse ruudustiku pisipiltidelt `imageEpoch` (`?v=`) ära → vananenud pisipildid pärast halduses kärpimist.
- `package.json:36`: `"react-zoom-pan-pinch": "^3.7.0"` ei ole kogu `src/`-is kasutusel → eemaldada.
- `mcp/vutt_mcp/server.py:638-639`: `submit_exemplar_proposal` docstringi `fields` loetelust puudub `reproduction` (kuigi `work_exemplars.py:30` toetab seda).
- `docs/tegemata_tood.md`: mitmed reanumbrid (`utils.py`, `rate_limit.py`, `meili_doc.py`, `config.py`) ja moodulite mahud on nihkunud.

---

## 5. Kontrollitud ja korras

- **Püsisessioonid (`server/auth.py`, ADR 0081):** tokenite SHA-256 räsid, atomaarne kirjutus, libisev aegumine `SESSION_TOUCH_GRANULARITY = 60 s` (ei kirjuta igal päringul kettale!), lukud vabastatakse enne ketta-I/O-d, 14 p absoluutne ülempiir, `delete_user_sessions` rolli/õiguste/konto muutmisel.
- **Lukkude järjekord (deadlocki oht puudub):** prosopograafias `ext_id_claim_lock` → `merge_operation_lock` → `person_lock`; eksemplaridel `work_lock` → `metadata_lock`; `sync_reciprocals` lukustab B-isikuid ühekaupa.
- **Autoriseerimine uutel pindadel:** `GET /exemplars/batch` kontrollib `can_read_work` iga teose kohta (lagi 50); `enrichment-proposals` on rangelt `superadmin`-only + `base_hash` + optimistlik lukk; `work_sets` autoriseerib iga päringu ja ei kasuta globaalset vahemälu; `/mcp/work-sets` kasutab `hmac.compare_digest`.
- **Frontend XSS ja mälulekked:** ainult üks `dangerouslySetInnerHTML` (`SafeHtml.tsx` + CI valvurtest); `URL.createObjectURL` esineb ühes kohas (`ImageViewer.tsx:215`) ja on korrektselt vabastatud; `react-markdown` v10 ilma `rehype-raw`-ta.
- **Sõltuvused ja tüübid:** `npm audit --omit=dev` = 0 haavatavust; `npx tsc --noEmit` = 0 viga; `requirements.txt` ja `requirements.lock` täielikult kooskõlas; Dockeri pildid täpsete versioonidega ja pordid `127.0.0.1` peal.
