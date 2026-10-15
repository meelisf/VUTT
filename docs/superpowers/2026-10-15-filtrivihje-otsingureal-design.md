# Filtrivihje otsingureal — osa 1: tuum + avaleht

**Kuupäev:** 2026-10-15
**Issue:** #605 (osa 1 kolmest; osa 2 = otsinguleht + isik/autor, osa 3 = isikute leht)
**Seotud:** ADR 0038 (filtri URL-i sünk), ADR 0042 (`scopeClauses`), ADR 0068 (sildiülekirjutus), PR #606 (avaleht otsib ka žanrist)

## Eesmärk

Inimesed kirjutavad otsingureale filtriväärtusi: `põhiki`, `1702 constitu`, `käsikiri`. Praegu lähevad need vabatekstiks. Neid saab küll leida, aga filtrit ei teki ja aastaarv ei piira aastat. Otsingurida peab sellise väärtuse ära tundma ja **pakkuma** filtrit. Pakkumise vastuvõtt annab **täpselt sama tulemuse kui sama väärtuse valimine külgribal**: käitumine on prognoositav.

Edu:
- `põhiki` (ja `pohiki`) → kiip „Žanr: Põhikiri (7)";
- `1702 constitu` → kiip „Aasta: 1702 (n)"; vastuvõtul on päringuks `constitu` ja URL-is `ys=1702&ye=1702`;
- vastuvõetud kiibi URL on identne sama väärtuse külgribalt valimisega (v.a päringust eemaldatud sõnad).

Väljaspool osa 1: isik/autor, otsinguleht, isikute leht, sünonüümid (`terms`, vt „Laiendus").

## Käitumine

### Tuvastatavad väärtused (avaleht)

| Liik | Sobitus | Vastuvõtt (sama mis külgriba) |
|---|---|---|
| aasta | eraldiseisev 4-kohaline arv 1400–1950 | `setYearStart(y)`, `setYearEnd(y)` |
| žanr | vt sildireegel | `filterModel.onGenreChange(qkood)`. Üksikvalik: asendab olemasoleva, nagu külgribal |
| märksõna | vt sildireegel | `filterModel.toggleTag(qkood)` |
| tüüp | vt sildireegel | `filterModel.onTypeChange(qkood)` |

**Sildireegel:** päringu sõna (≥ 4 tähte) on mõne sildi sõna algus. Sildid on registri `et` ja `en` sildid (A-variant; Wikidata aliased ei kuulu sisse). Võrdlus on tõstu- ja diakriitikutundetu (`NFD` + kombineerivate märkide eemaldus + `casefold`), seega `pohiki` ~ „põhikiri", `ſ` ei ole erijuht (Meili teeb sama). Mitmesõnaline silt („Christian hymn") sobitub järjestikuste päringusõnadega; viimane sõna tohib olla poolik. Ühest sõnast võib tulla mitu kandidaati (`disput` → žanr „disputatsioon" ja sama sõnaga märksõna); kõik lähevad loendurite ja järjestuse kaudu läbi. Reegel on **sildi sõna algus**: `kiri` ei sobi „põhikiri"-ga.

### Millal kiipi näidatakse

- Kiibil on loendur: mitu teost jääb alles, kui **praegustele** filtritele lisada see filter ja jätta päringuks ülejäänud sõnad. Loendur 0 → kiipi ei näidata.
- Juba rakendatud väärtust ei pakuta.
- Kõige rohkem 3 kiipi. Järjestus: pikem sobitus (sõnade arv, siis tähemärgid) → suurem loendur.
- Kiibil ei ole ×-i. Kiip kaob, kui päring muutub nii, et vihjet ei teki.
- Kiipe arvutatakse sama 400 ms viitega nagu otsingut.

### Vastuvõtt

1. Kutsutakse `applyWorkFilter(kind, value)`, sama funktsiooni, mida kasutab külgriba.
2. Päringust (`inputValue`) eemaldatakse sobitunud sõnad; tühikud normaliseeritakse.
3. Kiip jääb samale kohale ja muutub tavaliseks siniseks `FilterChip`-iks, kollane sähvatus ~600 ms (CSS `transition`, mitte JS-taimer).
4. Lehekülg läheb 1-le, sorteerimine ja kogu jäävad: seda teeb juba olemasolev URL-i debounce-effect, kiip midagi omaette ei kirjuta.
5. Umami sündmus `filter-hint-accept` (`{ kind }`).

## Kujundus (kinnitatud brauseri maketiga)

- **A2:** vihjekiibid on samas reas aktiivsete filtritega, nende **järel**, õhukese vertikaalse eraldajaga. „Tühjenda" liigub rea paremasse serva (`ml-auto`) ja puudutab ainult rakendatud filtreid.
- **Vihjekiip:** valge taust, `border-dashed border-amber-400` (1,5 px), tekst `text-amber-800`, liigi silt `text-amber-700 text-xs`, ees „+", loendur `text-gray-400 text-xs`. Kollane tähendab VUTT-is „muutus / tähelepanu".
- **Pärast vastuvõttu:** sinine `FilterChip` samas kohas, `ring` `amber-200` sähvatus.
- **Ilma rakendatud filtriteta:** rida ilmub, kui on vihje (variant a). Nihe ~38 px tuleb trükkimise ajal, kui tulemused niikuinii vahetuvad. Ruumi ei reserveerita.
- Mobiilis sama rida (wrap).

## Ülesehitus

Ainult kliendis (variant A). Serveri endpointi ei tule: sõnavara ja loendurid tulevad Meilist sama tenant-tokeni ja `scopeClauses`-i kaudu, mis kaitseb ka otsingut (ADR 0042). Serveri tee dubleeriks ligipääsufiltrit.

### 1. `detectFilterHints` — puhas funktsioon

`src/services/filterHints/detectFilterHints.ts`

```ts
type HintKind = 'year' | 'genre' | 'tag' | 'type';

interface VocabEntry {
  kind: Exclude<HintKind, 'year'>;
  id: string;                         // Q-kood
  labels: { et?: string; en?: string };
  terms?: string[];                   // laiendus (sünonüümid), osa 1-s tühi
}

interface FilterHintCandidate {
  kind: HintKind;
  value: string;                      // Q-kood või aasta
  label: string;                      // kuvatav silt UI keeles
  matched: [number, number];          // sõnaindeksite vahemik päringus
  remainingQuery: string;             // päring ilma sobitunud sõnadeta
}

function detectFilterHints(query: string, vocab: VocabEntry[], lang: 'et' | 'en',
                           opts?: { minYear?: number; maxYear?: number; minTokenLength?: number }): FilterHintCandidate[];
```

Kõrvalmõjudeta, Reactita, `node`-keskkonnas testitav. Loenduriteta: loendurid ja juba-rakendatud filtreerimine on hooki töö.

### 2. `buildDashboardFilter` — eraldatud filtriehitaja

`searchWorks` ehitab praegu filtrit oma kehas (`searchService.ts`). See osa eraldatakse eksporditud puhtaks funktsiooniks `buildDashboardFilter(options): string[]`, mida kasutavad **nii** `searchWorks` kui ka vihjete loendurid. Nii ei saa loendur ja päris otsing lahku minna. `searchWorks` käitumine ei muutu. Valvuriks on olemasolevad testid ja uus võrdlustest (sama `options` → sama filter).

### 3. `useFilterHints` — hook

`src/services/filterHints/useFilterHints.ts`

- **Sõnavara:** üks Meili päring `q: ''`, `limit: 0`, `facets: [genre_ids, tags_ids, type_ids]`, filter = `lehekylje_number = 1` + valik (`pushSelectionFilter`). Vahemälus valiku võtme järgi (moodulitasandil `Map`, **ainult** koodiloend, mitte kasutajapõhine vastus väljaspool sessiooni; kliendi mälu, mitte `server/cache.py`). Sildid tulevad `getEntityLabelsCache()`-st. Ilma registrisildita kood jäetakse välja. `vutt:` koodid jäetakse välja (nagu `tagItems`).
- **Loendurid:** paralleelsed `index.search` päringud (`Promise.all`; enne loendureid lõigatakse kandidaadid 6-ni, et päringuid oleks piiratud arv). `MeilisearchContext` annab ainult indeksi, mitte klienti, seega `multiSearch` nõuaks konteksti muutmist ja see ei tasu end ära. Iga kandidaadi kohta `q: remainingQuery`, `limit: 0`, `filter = buildDashboardFilter({...praegused valikud, + kandidaat})`. Tulemus on `estimatedTotalHits`. `lehekylje_number = 1` teeb sellest teosepõhise; täpsus pole siin kriitiline, sest loendur on vihje.
- **Juba rakendatud** väärtused filtreeritakse välja enne loendureid.
- `AbortController`: uus päring tühistab eelmise. Viga (v.a abort) → `[]`; viga ei lähe kliendivigade ringi, sest vihje on parim-pingutus.
- Tagastab `FilterHint[] = FilterHintCandidate & { count: number }`.

### 4. `applyWorkFilter` — üks rakendaja

`useWorkFilterModel` saab meetodi `applyWorkFilter(kind, value)`. Külgriba `onToggle`-id kutsuvad seda (lisamise suunal), vihjekiip samuti. Aasta käib avalehe `setYearStart`/`setYearEnd` kaudu ühes kohas `Dashboard.tsx`-is (`applyHint`), mis kutsub mudelit ülejäänud liikide jaoks.

### 5. `FilterHintChip` — komponent

`src/components/workFilters/WorkFilterChips.tsx`-is `FilterChip`-i kõrval. Props: `kind`, `label`, `count`, `onAccept`. Nupp (`<button>`), `aria-label` „Lisa filter: Žanr Põhikiri". `WorkFilterChips` saab valikulise `hints` slot'i, mis renderdab eraldaja + vihjekiibid **pärast** rakendatud kiipe. Rida renderdatakse, kui `hasActiveFilters || hints.length > 0`.

### 6. Umami

`src/services/analytics.ts`: `trackEvent(name, data?)` kutsub `window.umami?.track`, `try/catch`, ei viska kunagi. Esimene kasutaja on `filter-hint-accept`.

## i18n

Uued võtmed mõlemasse keelde korraga (`dashboard` nimeruum): `filterHints.addFilter` („Lisa filter" / „Add filter", aria), `filterHints.count` (loendur). Liigi sildid tulevad olemasolevatest `filters.genre`, `filters.tags`, `filters.type`, `common:labels.year`.

## Testid

- `detectFilterHints.test.ts` (node): `põhiki`, `pohiki`, `PÕHIKI`, `1702 constitu` (aasta + ülejäänud tekst), `1350` / `2026` (väljaspool vahemikku), `abc` (< 4), mitmesõnaline silt + poolik viimane sõna, mitu kandidaati ühest sõnast, `remainingQuery` tühikute normaliseerimine, `en`-keelne kuvamissilt.
- `buildDashboardFilter.test.ts`: sama `options` → sama filter, mis enne eraldamist (pinnitud ootused).
- **Valvur „sama mis külgriba"** (`useWorkFilterModel` test): vihje vastuvõtt ja külgriba `onToggle` sama väärtusega viivad sama `onGenreChange` / `onTagsChange` / `onTypeChange` kutseni samade argumentidega.
- `FilterHintChip.test.tsx` (jsdom): kollane punktiir, klikk kutsub `onAccept`, aria-silt.
- Käsitsi tootmisandmetega (tunnel + `npm run dev`): `põhiki`, `1702 constitu`, `käsikiri`, `disputa`, `loengukat`; valitud kogu ja ilma; mobiil 390 px.

## Laiendus (mitte osa 1)

- **Sünonüümid (C):** `label_overrides.json` saab `aliases` (või eraldi fail). Hook paneb need `VocabEntry.terms`-i ja tuvastaja sobitab neid nagu silte. Tuvastaja ise ei muutu.
- **Osa 2:** otsingulehel on oma URL-i sõnavara (`teoseTags`, `p`, žanr mitmikvalikuna) ja oma rakendaja; tuvastaja ja kiip on samad. Lisandub isik/autor.
- **Osa 3:** isikute leht, serveri registrid sõnavarana.
