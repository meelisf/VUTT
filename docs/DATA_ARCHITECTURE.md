# VUTT Andmekihtide Arhitektuur

> **OLULINE:** Loe see dokument läbi enne kui hakkad Meilisearchi päringuid või andmete käsitlemist muutma.

## Ülevaade

VUTT süsteemis on **kolm andmekihti**:

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
│     Formaat: Ingliskeelsed väljad + filtrid/sortimine eesti keeles     │
│     - title, year, location, publisher (ingliskeelsed)                 │
│     - aasta, autor, respondens (filtrite/sortimise jaoks)              │
│     - EEMALDATUD: pealkiri, koht, trükkal                              │
└─────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ src/services/meiliService.ts
┌─────────────────────────────────────────────────────────────────────────┐
│  3. FRONTEND: src/types.ts Work / Page tüübid                          │
│     Formaat: Ingliskeelsed väljad (ilma fallback'ideta)                │
│     Kasuta: work.title, work.year, work.creators[]                     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Meilisearchi Väljad

### Põhiväljad

| _metadata.json | Meilisearch | Märkus |
|----------------|-------------|--------|
| `id` | `work_id` | Nanoid, püsiv ID |
| `slug` | `originaal_kataloog` | Kausta nimi |
| `title` | `title` | Teose pealkiri |
| `year` | `year`, `aasta` | `aasta` sortimise/filtrite jaoks |
| `location` | `location`, `location_object` | LinkedEntity või string |
| `publisher` | `publisher`, `publisher_object` | LinkedEntity või string |
| `creators[]` | `creators`, `author_names`, `respondens_names`, `autor`, `respondens` | Isikud |
| `tags[]` | `tags`, `tags_et`, `tags_en`, `tags_object` | Märksõnad |
| `genre` | `genre`, `genre_et`, `genre_en`, `genre_object` | Žanr |
| `type` | `type`, `type_et`, `type_en`, `type_object` | Tüüp |
| `collection` | `collection`, `collections_hierarchy` | Kollektsioon |

### EEMALDATUD väljad (ei kirjutata ega pärita)

- `pealkiri` - kasuta `title`
- `koht` - kasuta `location`
- `trükkal` - kasuta `publisher`

### Säilitatud eestikeelsed väljad (filtrite/sortimise jaoks)

| Väli | Kasutus |
|------|---------|
| `aasta` | Aasta filter ja sortimine |
| `autor` | Autori filter |
| `respondens` | Respondendi filter |
| `lehekylje_number` | Lehekülje sortimine |
| `originaal_kataloog` | Kausta nimi |

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
- `autor` - praeses/auctor nimi stringina (filtreerimiseks)
- `respondens` - respondens nimi stringina (filtreerimiseks)
- `author_names` - kõik mitte-respondens nimed listina (filtreerimiseks)
- `respondens_names` - respondens nimed listina (filtreerimiseks)
- `authors_text` - kõik nimed listina (otsinguks)

## Frontendi Juhised

### KASUTA (ingliskeelsed väljad):
```typescript
work.title
work.year
work.location
work.publisher
work.creators
work.tags
```

### Filtrid ja Sortimine

Meilisearchi filtrites/sortimises kasuta eestikeelseid välju (need on indekseeritud):
```typescript
// Filtrid
filter: [`aasta >= 1630`, `aasta <= 1710`]
filter: [`work_id = "cymbv7"`]
filter: [`autor = "Virginius, Georg"`]

// Sortimine
sort: ['aasta:asc']
sort: ['title:asc']
sort: ['lehekylje_number:asc']
```

### Otsing

Otsinguväljad (`attributesToSearchOn`):
```typescript
['title', 'authors_text', 'lehekylje_tekst']
```

## Migratsioon (Lõpetatud)

- ✅ `work_id` - nanoid kasutusel
- ✅ `creators[]` - kasutusel
- ✅ `title` - kasutusel (pealkiri eemaldatud)
- ✅ `year` - kasutusel (aasta säilitatud sortimiseks)
- ✅ `location` - kasutusel (koht eemaldatud)
- ✅ `publisher` - kasutusel (trükkal eemaldatud)

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
