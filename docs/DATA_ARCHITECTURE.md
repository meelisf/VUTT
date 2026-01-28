# VUTT Andmekihtide Arhitektuur

> **OLULINE:** Loe see dokument läbi enne kui hakkad Meilisearchi päringuid või andmete käsitlemist muutma.

## Ülevaade

VUTT süsteemis on **kolm andmekihti** erinevate väljanimedega. See on ajalooliselt kujunenud ja dokumenteeritud siin selguse huvides.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  1. FAILISÜSTEEM: data/{kaust}/_metadata.json                          │
│     Formaat: V2/V3 (ingliskeelsed väljad)                              │
│     Näide: title, year, location, publisher, creators[], tags          │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ server/meilisearch_ops.py sync_work_to_meilisearch()
┌─────────────────────────────────────────────────────────────────────────┐
│  2. MEILISEARCH INDEKS: teosed                                         │
│     Formaat: MÕLEMAD väljad (ingliskeelsed + eestikeelsed)             │
│     - title JA pealkiri                                                │
│     - year JA aasta                                                    │
│     - location JA koht                                                 │
│     - publisher JA trükkal                                             │
│     - creators[] JA autor/respondens                                   │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ src/services/meiliService.ts
┌─────────────────────────────────────────────────────────────────────────┐
│  3. FRONTEND: src/types.ts Work / Page tüübid                          │
│     Formaat: Mõlemad (ingliskeelsed EELISTATUD)                        │
│     Kasuta: work.title, work.year, work.creators[]                     │
│     Fallback: hit.pealkiri, hit.aasta (kui ingliskeelne puudub)        │
└─────────────────────────────────────────────────────────────────────────┘
```

## Meilisearchi Väljad (Täielik Nimekiri)

Backend (`server/meilisearch_ops.py`) kirjutab Meilisearchi **mõlemad versioonid**:

### Põhiväljad

| _metadata.json | Meilisearch (ingliskeelne) | Meilisearch (eestikeelne) | Märkus |
|----------------|---------------------------|---------------------------|--------|
| `id` | `work_id` | - | Nanoid, püsiv ID |
| `slug` | - | `originaal_kataloog` | Kausta nimi |
| `title` | `title` | `pealkiri` | Teose pealkiri |
| `year` | `year` | `aasta` | Ilmumisaasta |
| `location` | `location`, `location_object` | `koht` | LinkedEntity või string |
| `publisher` | `publisher`, `publisher_object` | `trükkal` | LinkedEntity või string |
| `creators[]` | `creators`, `author_names`, `respondens_names` | `autor`, `respondens` | Isikud |
| `tags[]` | `tags`, `tags_et`, `tags_en`, `tags_object` | - | Märksõnad |
| `genre` | `genre`, `genre_et`, `genre_en`, `genre_object` | - | Žanr |
| `type` | `type`, `type_et`, `type_en`, `type_object` | - | Tüüp |
| `collection` | `collection`, `collections_hierarchy` | - | Kollektsioon |

### Lehekülje väljad

| Väli | Kirjeldus |
|------|-----------|
| `id` | `{work_id}-{page_num}` (nt "cymbv7-1") |
| `lehekylje_number` | Lehekülje number (1, 2, 3...) |
| `lehekylje_tekst` | Transkribeeritud tekst |
| `lehekylje_pilt` | Pildi suhteline tee |
| `status` | Lehekülje staatus (Toores/Töös/Parandatud/Valmis) |
| `teose_staatus` | Teose koondstaatus |
| `page_tags` | Lehekülje märksõnad |
| `comments` | Kommentaarid |

### Isikute väljad (creators)

```json
// _metadata.json
"creators": [
  {"name": "Virginius, Georg", "role": "praeses"},
  {"name": "Schomerus, Johannes", "role": "respondens"}
]
```

Meilisearchis:
- `creators` - terve massiiv (filtreerimiseks ja kuvamiseks)
- `autor` - praeses/auctor nimi stringina (tagasiühilduvus)
- `respondens` - respondens nimi stringina (tagasiühilduvus)
- `author_names` - kõik mitte-respondens nimed listina (filtreerimiseks)
- `respondens_names` - respondens nimed listina (filtreerimiseks)
- `authors_text` - kõik nimed listina (otsinguks)

## Frontendi Juhised

### KASUTA (ingliskeelsed väljad):
```typescript
// Eelistatud - ingliskeelsed väljad
work.title
work.year
work.location
work.publisher
work.creators
work.tags
hit.title
hit.year
```

### VÄLDI (eestikeelsed väljad):
```typescript
// Tagasiühilduvus - kasuta ainult fallback'ina
hit.pealkiri    // kasuta: hit.title ?? hit.pealkiri
hit.aasta       // kasuta: hit.year ?? hit.aasta
hit.autor       // kasuta: hit.creators või hit.author_names
hit.trükkal     // kasuta: hit.publisher ?? hit.trükkal
hit.koht        // kasuta: hit.location ?? hit.koht
```

### Filtrid ja Sortimine

Meilisearchi filtrites/sortimises kasuta **eestikeelseid välju** (need on indekseeritud):
```typescript
// Filtrid
filter: [`aasta >= 1630`, `aasta <= 1710`]
filter: [`work_id = "cymbv7"`]

// Sortimine
sort: ['aasta:asc']
sort: ['lehekylje_number:asc']
```

### Otsing

Otsinguväljad (`attributesToSearchOn`):
```typescript
['title', 'pealkiri', 'authors_text', 'lehekylje_tekst']
```

## Migratsiooniplaan

Frontend liigub järk-järgult eestikeelsetelt väljadelt ingliskeelsetele:

1. ✅ `work_id` - juba kasutusel (nanoid)
2. ✅ `creators[]` - juba kasutusel
3. ⏳ `title` asemel `pealkiri` - töös
4. ⏳ `year` asemel `aasta` - töös
5. ⏳ `location` asemel `koht` - töös
6. ⏳ `publisher` asemel `trükkal` - töös

**NB:** Filtrid ja sortimine jäävad eestikeelsetele väljadele (`aasta`, `lehekylje_number`), sest need on Meilisearchis indekseeritud.

## Failid

| Fail | Vastutus |
|------|----------|
| `server/meilisearch_ops.py` | _metadata.json → Meilisearch mapping |
| `src/services/meiliService.ts` | Meilisearch → Frontend mapping |
| `src/types.ts` | TypeScript tüübid |
| `scripts/1-1_consolidate_data.py` | JSONL genereerimine (bulk import) |
| `scripts/2-1_upload_to_meili.py` | JSONL → Meilisearch upload |

## Viited

- `CLAUDE.md` - projekti üldine dokumentatsioon
- `docs/PLAN_metadata_v3_linked_data.md` - LinkedEntity formaat
