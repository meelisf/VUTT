# Sajandi-dateering ja aastavahemike kattuvusfilter — disain

**Kuupäev:** 2026-06-10
**Staatus:** kinnitatud

## Probleem

Teose dateering toetab praegu täpset aastat (`year`), ligikaudset aastat (`year_display: "ca. 1750"`) ja vahemikku (`"1670–1690"`). Sajandi-täpsusega dateeringut (nt "19. saj") ei ole võimalik esitada:

1. **Filtreerimine** võrdleb Meilisearchis ühte numbrit (`year >= ys AND year <= ye`). Sajandi-teosel pole ühte mõistlikku aastat. Sama puudus kehtib juba praegu "ca." ja vahemike puhul: "ca. 1750" teost EI leia filter 1741–1745, sest indeksis on ainult `year=1750`. Senine ±10 loogika töötab ainult kaardil aastale klikkides (`parseYearDisplayRange` eeltäidab filtri).
2. **Kuvamine** näitab `year_display` toorelt — "19. saj" oleks inglise UI-s eestikeelne.

## Lahendus (kokkuvõte)

- Indeksisse lisanduvad tuletatud väljad `year_start`/`year_end`; filtreerimine muutub vahemike **kattuvuseks**.
- `_metadata.json` formaat **ei muutu** — admin kirjutab `year_display` väljale vabalt "19. saj"; vahemik tuletatakse indekseerimisel.
- Kuvamisel tunneb frontend sajandimustri ära ja tõlgib (et "19. saj" / en "19th century"). Muud `year_display` väärtused (ca., vahemikud) on keele-neutraalsed ja jäävad tooreks.

## 1. Parsimine (jagatud loogika)

### Frontend: `src/utils/yearDisplayUtils.ts`

`parseYearDisplayRange` saab juurde sajandimustri (kontrollitakse ENNE 4-kohalise aasta otsimist, sest sajandi stringis 4-kohalist aastat pole):

| Sisend | Tulemus |
|--------|---------|
| `"19. saj"`, `"19. sajand"`, `"19 saj"` | `{ start: 1801, end: 1900 }` |
| `"ca. 1750"` | `{ start: 1740, end: 1760 }` (olemasolev) |
| `"1670–1690"` / `"1670-1690"` | `{ start: 1670, end: 1690 }` (olemasolev) |
| `"1750"` | `{ start: 1750, end: 1750 }` (olemasolev) |

Sajandimuster: `/^(\d{1,2})\.?\s*saj/i` (trimmitud stringi algusest). N. sajand = `(n-1)*100+1` kuni `n*100` (ajaloolaste konventsioon: 19. saj = 1801–1900).

### Backend: `server/utils.py` → `parse_year_range(year, year_display)`

Sama loogika Python-portimisena. Tagastab `(start, end)` või `None`. Mõlemad indekseerimisteed kasutavad SEDA funktsiooni:

- `server/meilisearch_ops.py` (live sync)
- `scripts/1-1_consolidate_data.py` (seed) — impordib `from server.utils import parse_year_range` (sys.path muster on skriptis juba olemas)

## 2. Meilisearch indeks

Iga `teosed` dokument saab:

- `year_start`, `year_end` — tuletatud `parse_year_range(year, year_display)`-st. Kui vahemikku ei tuvastata (aastat pole üldse), siis `year_start = year_end = 0` (sama käitumine kui praegune `year=0`).
- `aasta`/`year` jääb alles **sortimiseks**. Kui `year` on tühi, aga `year_display` annab vahemiku (nt sajand), tuletatakse sortimisväärtuseks vahemiku keskpaik (19. saj → 1850). Praegune regex-fallback (`\d{4}` year_display-st) asendub sellega.

`filterableAttributes` täiendused (`year_start`, `year_end`) kahes kohas:

- `scripts/2-1_upload_to_meili.py` — seed-tee settings
- `server/meilisearch_ops.py` `_ensure_filterable_attributes()` — live-tee `needed` hulk

Pärast deploy'd: täisreindeks serveris (`./scripts/server_seed_data.sh`).

## 3. Filtreerimine (frontend)

`src/services/searchService.ts` — kõik 8 kohta, kus praegu:

```ts
if (yearStart) filter.push(`year >= ${yearStart}`);
if (yearEnd) filter.push(`year <= ${yearEnd}`);
```

asendub kattuvusega:

```ts
if (yearStart) filter.push(`year_end >= ${yearStart}`);
if (yearEnd) filter.push(`year_start <= ${yearEnd}`);
```

Loogika: kaks vahemikku kattuvad ⇔ `A.end >= B.start AND A.start <= B.end`. Teosed ilma aastata (`year_start=year_end=0`) käituvad identselt praegusega (`year=0`).

Korduv muster ekstraheeritakse abifunktsiooni (nt `pushYearFilter(filter, yearStart, yearEnd)`), et 8 kohta ei läheks tulevikus lahku.

## 4. Kuvamine + i18n

Uus util `formatYearDisplay(yearDisplay, year, t)` (`src/utils/yearDisplayUtils.ts`):

- sajandimuster → `t('common:year.century', { n })` → et `"19. saj"`, en `"19th century"`
- muu mittetühi `year_display` → toorelt (nagu praegu)
- muidu → `year` number või tühi string

Tõlkevõtmed: `src/locales/{et,en}/common.json` → `year.century`.

Kasutuskohad (praegu `year_display || year`):

- `src/components/WorkCard.tsx`
- `src/pages/search/SearchResults.tsx`
- `src/components/TextEditor.tsx` (info paneel)
- `src/components/mobile/WorkspaceMobileView.tsx`
- `src/components/editor/AnnotationsTab.tsx`

Kaardil aastale klikkimine (WorkCard, SearchResults) töötab muutmata kujul — `parseYearDisplayRange` tunneb sajandi ära ja eeltäidab filtri 1801–1900.

## 5. Sisestus

`MetadataModal` / `UploadMetaForm` ei muutu. Admin kirjutab `year_display` väljale "19. saj". Placeholder/abitekst täieneb näitega ("nt ca. 1680, 1670–1690, 19. saj").

## 6. Testid

- `src/utils/__tests__/yearDisplayUtils.test.ts`: sajand (variandid "19. saj", "19. sajand", "19 saj", 1-kohaline "9. saj"), ca., vahemik, täpne aasta, tühi/null, `formatYearDisplay` tõlkega
- `tests/test_year_range.py` (pytest): `parse_year_range` samad juhud + keskpaiga tuletus

## Mitte skoobis

- `year_precision` struktuurväli metadatas (YAGNI — mustreid on kolm, kirjeid null)
- Eraldi sajandifacet UI-s
- Kümnendi-täpsus ("1850ndad") — lisatav hiljem sama mustriga
