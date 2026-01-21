# Kollektsioonide implementatsiooniplaan

> **Staatus:** Töös (Etapid 1-4, 6, 7, 9, 10 valmis)
> **Viimati uuendatud:** 2026-01-21
> **Alusdokument:** `docs/PLAAN_kollektsioonid.md`

## Hetkeolukord

### ✅ VALMIS: Isikute (creators) kuvamise ja otsingu parandused (2026-01-21)

**Probleemid:**
1. Admin metaandmete modaalis "autori" muutmisel ei näidatud seda Info vaates
2. Dashboardis klikkides autorile, otsiti ainult praeses väljalt
3. Nimede automaatne soovitus ei töötanud (luges ainult v1 formaati)

**Lahendused:**

1. **Server-side parandused:**
   - `server/file_server.py` `/get-metadata-suggestions` - loeb nüüd v2 `creators[]` massiivi
   - `server/meilisearch_ops.py` `sync_work_to_meilisearch()`:
     - Autor: prioriteet praeses > auctor > esimene muu-rolli isik
     - Lisab nüüd `creators[]` massiivi ka Meilisearchi dokumenti

2. **Frontend parandused:**
   - `src/components/TextEditor.tsx` Info tab:
     - Näitab kõiki `work.creators[]` isikuid koos rollisiltidega
     - Fallback v1 `author`/`respondens` väljadele
   - `src/components/WorkCard.tsx`:
     - Autori/respondendi klikkimisel navigeerib nüüd `/search?q="Nimi"` (mitte `/?author=...`)
     - Otsib isikut kõikidest teostest, mitte ainult konkreetselt väljalt
   - Isiku nimele vajutamine kasutab täistekstiotsingut, et leida teda kõikides rollides

---

### ✅ VALMIS: Etapp 1+2+3 - Vundament ja UI

**Tehtud 2026-01-19:**

1. **Konfiguratsioonifailid:**
   - `state/collections.json` - hierarhia (universitas-dorpatensis-1 → academia-gustaviana / academia-gustavo-carolina)
   - `state/vocabularies.json` - kontrollitud sõnavara (types, genres, roles, languages, relation_types)

2. **Backend:**
   - `server/config.py` - COLLECTIONS_FILE, VOCABULARIES_FILE
   - `server/file_server.py` - GET /collections, GET /vocabularies endpoint'id
   - `server/__init__.py` - eksporditavad muutujad

3. **Migratsioon:**
   - `scripts/migrate_metadata_v2.py` - teisendab _metadata.json failid v2 formaati
   - `scripts/1-1_consolidate_data.py` - uuendatud indekseerimise skript

4. **Frontend teenused:**
   - `src/services/collectionService.ts` - API klient + abifunktsioonid:
     - `getCollections()`, `getVocabularies()` - API päringud cache'iga
     - `getCollectionName()`, `getCollectionById()` - üksiku kollektsiooni info
     - `getCollectionHierarchy()` - tagastab parent chain massiivina
     - `getRootCollections()`, `getChildCollections()` - puunavigatsiooni abistajad
     - `buildCollectionTree()` - rekursiivne puu ehitaja
   - `src/types.ts` - Creator, Series, Relation tüübid; uuendatud Work, Page

5. **Meilisearch:**
   - `src/services/meiliService.ts`:
     - `collection` filterableAttributes hulgas
     - `collections_hierarchy` filterableAttributes hulgas (hierarhiline filter!)
     - Filter: `collections_hierarchy = "id"` (leiab ka alamkollektsioonide teosed)

6. **UI komponendid:**
   - `src/contexts/CollectionContext.tsx` - globaalne kollektsiooni state
     - `selectedCollection` - praegune valik
     - `setSelectedCollection()` - muudab ja salvestab localStorage'i
     - **localStorage persistence:** võti `vutt_collection`
   - `src/components/CollectionPicker.tsx` - modaalne puuvaade
     - Laiendatav puu chevron-nuppudega
     - "Kõik tööd" valik header-režiimis
     - "Määramata" valik bulk-režiimis
     - `onSelect` callback massimääramise jaoks
   - `src/components/Header.tsx` - kollektsiooni valija nupp
     - Library ikoon + valiku nimi
     - Amber värv kui filter aktiivne
   - `src/pages/Dashboard.tsx` - collection filter päringus
   - `src/App.tsx` - CollectionProvider
   - `src/locales/et/common.json`, `src/locales/en/common.json` - tõlked

### ✅ VALMIS: Etapp 4 - Massiline kollektsiooni määramine

**Tehtud 2026-01-20:**

1. **Dashboard multi-select režiim:**
   - `selectMode` state + floating action bar
   - "Vali" nupp tulemuste sektsioonis (ainult admin)
   - "Vali kõik nähtavad" / "Tühista valik" nupud
   - Valitud teoste arvu näitamine

2. **WorkCard komponendi uuendus:**
   - `selectMode`, `isSelected`, `onToggleSelect` propid
   - Checkbox pildi peal valikurežiimis
   - Visuaalne esiletõst valitud kaartidel (ring + border)

3. **Backend endpoint:**
   - `POST /works/bulk-collection` - uuendab mitu _metadata.json faili
   - Valideerib kollektsiooni ID `collections.json` vastu
   - Re-indekseerib Meilisearch'is (`sync_work_to_meilisearch()`)
   - Tagastab `{ updated: N, failed: [...] }`
   - Nõuab admin rolli

4. **CollectionPicker komponendi laiendus:**
   - `onSelect` callback variant (massiline määramine)
   - `showUnassigned` prop - näitab "Määramata" valikut
   - `title` prop - kohandatud pealkiri

5. **Tõlked:**
   - `bulkAssign.*` võtmed et/en dashboard.json failides
   - `collections.unassigned` common.json failides

### Praegune seis

- ✅ Kollektsiooni valija töötab Header'is
- ✅ "Kõik tööd" näitab kõiki teoseid
- ✅ Hierarhiline filter töötab (`collections_hierarchy`)
- ✅ Valik säilib localStorage's (`vutt_collection`)
- ✅ Admin saab valida teoseid ja määrata kollektsiooni
- ⚠️ Teosed vajavad veel kollektsiooni määramist (andmete töö)

---

## 🔜 JÄRGMINE: Etapp 5 - Admin kollektsioonide haldus

### Etapp 5: Admin - Kollektsioonide haldus (CRUD)

**Eesmärk:** Admin saab kollektsioone luua, muuta, kustutada.

**Tööd:**
1. Lisa `/admin` lehele uus tab "Kollektsioonid"
2. Kollektsioonide nimekiri puuvaatena
3. Lisa/muuda/kustuta modaalid
4. Backend endpoint'id: POST/PUT/DELETE /collections
5. Ohutu kustutamine (vt PLAAN): keela kui alamaid, küsi kuhu teosed liigutada

**Sõltuvused:** Etapp 1 (valmis)

**Prioriteet:** Madal kuni kollektsioonide arv on väike (praegu 3)

---

### ✅ VALMIS: Etapp 6 - Metadata modaali täielik v2 tugi

**Tehtud 2026-01-21:**

1. **Creators massiivi toimetamine:**
   - Dünaamiline loend isikutest (lisa/eemalda nupud)
   - Rolli valik dropdown'ist (praeses, respondens, auctor, gratulator, jne)
   - Rollid tulevad `vocabularies.json` failist
   - Automaatne soovitus (datalist) nime sisestamisel

2. **Type/genre dropdown'id:**
   - Type: impressum / manuscriptum valik
   - Genre: disputatio, oratio, carmen, jne valik
   - Mõlemad loetakse `vocabularies.json` failist
   - Keeletundlik (et/en)

3. **Keelte valik:**
   - Checkbox-põhine mitmevalik
   - Keeled: lat, deu, est, grc, heb, swe, fra, rus
   - Loetakse `vocabularies.json` failist

4. **Uuendatud väljad:**
   - `title` (mitte `pealkiri`)
   - `year` (mitte `aasta`)
   - `location` (mitte `koht`)
   - `publisher` (mitte `trükkal`)
   - `tags` (mitte `teose_tags`)

5. **UI parandused:**
   - Modaal keritav (max-h-[90vh])
   - Grupeeritud sektsioonid: Isikud, Bibliograafilised andmed, Klassifikatsioon, Välised lingid
   - Tõlked lisatud (et/en)

**Sõltuvused:** Etapid 1-3 (valmis)

---

### ✅ VALMIS: Etapp 7 - SearchPage ja Statistics filtreerimine

**Tehtud 2026-01-20:**

1. **SearchPage:**
   - `useCollection` hook importitud ja kasutatud
   - `collection: selectedCollection` lisatud `ContentSearchOptions`'i
   - Sidebar näitab aktiivset kollektsiooni (amber info-kast)
   - Otsing filtreerib `collections_hierarchy` järgi

2. **Statistics:**
   - `useCollection` hook importitud ja kasutatud
   - Meilisearch päring filtreerib `collections_hierarchy` järgi
   - Leht näitab aktiivset kollektsiooni infokaardil
   - Statistika arvutatakse valitud kollektsiooni piires

3. **Tõlked:**
   - `collections.activeFilter` - "Aktiivne kollektsioon"
   - `collections.changeInHeader` - viide päise valijale

**Sõltuvused:** Etapp 3 (valmis)

---

### Etapp 8: Breadcrumbs ja navigatsioon

**Eesmärk:** Workspace näitab teose kollektsiooni hierarhiat.

**Tööd:**
1. `CollectionBreadcrumbs.tsx` komponent
2. Klikkimine navigeerib Dashboard'ile filtriga
3. URL routing `/collections/:slug` (valikuline, võib jätta)

**Sõltuvused:** Etapid 3-4 (valmis)

---

### ✅ VALMIS: Etapp 9 - V2 formaat ja puhastus

**Tehtud 2026-01-20:**

1. **_metadata.json failid on v2 formaadis:**
   - Kõik failid migreeritud `scripts/migrate_metadata_v2.py` abil
   - Väljad: `id`, `slug`, `title`, `year`, `creators[]`, `tags`, `location`, `publisher`, `collection`

2. **Workspace metadata modal saadab v2 formaadis:**
   - `src/pages/Workspace.tsx` uuendatud
   - Saadab: `title`, `year`, `creators[]`, `tags`, `location`, `publisher`

3. **Server normaliseerib v1→v2 salvestamisel:**
   - `server/file_server.py` `/update-work-metadata` endpoint
   - Kui v2 väli olemas, eemaldab vastava v1 välja (nt `title` olemas → `pealkiri` eemaldatakse)
   - Kui `creators[]` olemas → `autor` ja `respondens` eemaldatakse

4. **Lugemisloogika kasutab v2-esmalt:**
   - `server/meilisearch_ops.py` - v2 esmalt, v1 fallback turvavõrguna
   - `scripts/1-1_consolidate_data.py` - sama loogika

**Veel tegemata (madal prioriteet):**
- `scripts/validate_metadata.py` - validatsiooniskript (kontrolliks collection ID-d jne)

---

## Tehniline arhitektuur

### Hierarhiline filtreerimine

```
Kasutaja valib: "universitas-dorpatensis-1"
                      ↓
CollectionContext.setSelectedCollection("universitas-dorpatensis-1")
                      ↓
localStorage["vutt_collection"] = "universitas-dorpatensis-1"
                      ↓
Dashboard/Search päring: filter = `collections_hierarchy = "universitas-dorpatensis-1"`
                      ↓
Meilisearch tagastab: AG teosed + AGC teosed (mõlemal on hierarchy massiivis parent)
```

### Andmevoog salvestamisel

```
Admin valib Dashboard'il teosed → "Määra kollektsioon" → CollectionPicker
                      ↓
POST /works/bulk-collection { work_ids: [...], collection: "academia-gustaviana" }
                      ↓
file_server.py: iga teose kohta:
  1. Loe _metadata.json
  2. Uuenda collection väli
  3. Salvesta _metadata.json
  4. sync_work_to_meilisearch() - uuendab collections_hierarchy
```

---

## Serveris käivitamine (meeldetuletus)

```bash
# Pärast koodi uuendamist
npm run build                           # Kohalik
# Kopeeri serverisse: dist/, server/, state/, scripts/

# Serveris
python3 scripts/migrate_metadata_v2.py --apply  # Ainult esimene kord
python3 scripts/1-1_consolidate_data.py
python3 scripts/2-1_upload_to_meili.py
./start_services.sh
```

---

## Muudetud failid (täielik nimekiri)

```
# Uued failid
state/collections.json
state/vocabularies.json
scripts/migrate_metadata_v2.py
src/services/collectionService.ts
src/contexts/CollectionContext.tsx
src/components/CollectionPicker.tsx

# Muudetud failid (Etapid 1-4)
server/config.py
server/__init__.py
server/file_server.py
scripts/1-1_consolidate_data.py
src/types.ts
src/services/meiliService.ts
src/components/Header.tsx
src/components/WorkCard.tsx
src/pages/Dashboard.tsx
src/App.tsx
src/locales/et/common.json
src/locales/en/common.json
src/locales/et/dashboard.json
src/locales/en/dashboard.json

# Muudetud failid (Etapp 7)
src/pages/SearchPage.tsx
src/pages/Statistics.tsx

# Muudetud failid (Etapp 9)
src/pages/Workspace.tsx
server/file_server.py
server/meilisearch_ops.py

# Muudetud failid (Etapp 6)
src/components/MetadataModal.tsx  # UUS: eraldatud komponent
src/pages/Workspace.tsx           # 1092→555 rida
src/locales/et/workspace.json
src/locales/en/workspace.json
```

---

## Avatud otsused

1. **URL routing `/collections/:slug`** - Praegu pole vaja, global state töötab.
2. **Collection landing page** - Kirjeldus Dashboard'il kui kollektsioon valitud. Madal prioriteet.
3. **WorkCard badge** - Kas näidata kollektsiooni kaardil? Mõtleme hiljem.

---

## ✅ VALMIS: Dashboard filtrite tõlked (2026-01-21)

**Lahendatud:**
1. `AdvancedFilters` komponent nüüd laeb `vocabularies.json` ja kasutab tõlkeid
2. Žanr ja tüüp väljad näitavad nüüd lokaliseeritud nimesid (et/en)
3. Ühtlustatud SearchPage ja Dashboard filtrite käitumine

**Muudetud failid:**
- `src/components/AdvancedFilters.tsx` - lisatud vocabularies import ja tõlkeloogika

---

### ✅ VALMIS: Etapp 10 - SearchPage sidebar refaktoreerimine

**Tehtud 2026-01-21:**

1. **CollapsibleSection komponent:**
   - `src/components/CollapsibleSection.tsx` - taaskasutatav klapitav sektsioon
   - Propid: `title`, `icon`, `defaultOpen`, `badge`, `children`
   - Animeeritud avamine/sulgemine

2. **SearchPage sidebar klapitavaks:**
   - Ulatus (scope) - vaikimisi AVATUD
   - Aasta vahemik - vaikimisi AVATUD
   - Žanr (genre väli) - vaikimisi KINNI
   - Märksõnad (teose_tags) - vaikimisi KINNI
   - Tüüp (type väli) - vaikimisi KINNI
   - Teose filter - vaikimisi KINNI

3. **Type ja genre filtrid:**
   - Žanr: disputatio, oratio, carmen jne (vocabularies.json)
   - Tüüp: impressum, manuscriptum (vocabularies.json)
   - URL parameetrid: `?genre=...&type=...`
   - Facetid: `getGenreFacets()`, `getTypeFacets()`

4. **Backend parandus (metadata modaali bug):**
   - `server/meilisearch_ops.py` `sync_work_to_meilisearch()` lisatud `type`, `genre`, `languages` väljad
   - Nüüd admin modaalist muudetud tüüp/žanr indekseeritakse kohe

5. **Tõlked:**
   - `filters.tags` - "Märksõnad" / "Tags"
   - `filters.type` - "Tüüp" / "Type"
   - `filters.allGenres` - "Kõik žanrid" / "All genres"
   - `filters.allTypes` - "Kõik tüübid" / "All types"

**Muudetud failid:**
- `src/components/CollapsibleSection.tsx` (UUS)
- `src/pages/SearchPage.tsx`
- `src/types.ts` (ContentSearchOptions)
- `src/services/meiliService.ts` (type filter)
- `src/locales/et/search.json`
- `src/locales/en/search.json`
- `server/meilisearch_ops.py`
