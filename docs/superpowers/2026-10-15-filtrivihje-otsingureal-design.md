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

- Kiibil on loendur: mitu teost näitaks avaleht **pärast vastuvõttu**, st sama otsing, mis vastuvõtu järel tegelikult jookseb: praegused filtrid + see filter (žanril ja tüübil **asendab** olemasoleva, nagu vastuvõtt) ja päringuks ülejäänud sõnad, samade otsinguparameetritega (vt „Ühine otsingupäring"). Loendur 0 → kiipi ei näidata.
- Juba rakendatud väärtust ei pakuta.
- Kõige rohkem 3 kiipi. **Eeljärjestus** (enne loendureid): pikem sobitus (sõnade arv, siis tähemärgid) → suurem ulatuse fassetiloendur (sõnavarapäringust, vt hook). Loendurid arvutatakse eeljärjestuses partiidena (3 korraga), kuni 3 positiivset kiipi on leitud või kandidaadid otsas (lagi: 4 partiid = 12 päringut). Kuvamisjärjestus = eeljärjestus. Ükski kandidaat ei jää kärpe tõttu välja enne, kui 3 parema eeljärjestusega kiipi on juba olemas.
- Kiibil ei ole ×-i. Kiip kaob, kui päring muutub nii, et vihjet ei teki.
- Kiipe arvutatakse sama 400 ms viitega nagu otsingut.
- **Vananemine:** iga vihje kannab oma **lähteolekut**: `sourceQuery` (sisend, millest ta tuvastati) + `stateKey` (filtrite, aasta, valiku ja indeksi/tokeni võti). Kui sisend või `stateKey` erineb praegusest, vihjet **ei renderdata** kohe (mitte alles uue arvutuse lõpus). Vastuvõtt kontrollib sama tingimust uuesti ja on vananenud vihje korral no-op. Nii ei saa klikk kirjutada üle teksti, mille kasutaja vahepeal trükkis.

### Vastuvõtt

1. Kutsutakse `applyWorkFilter(kind, value)`, sama funktsiooni, mida kasutab külgriba.
2. Päringust (`inputValue`) eemaldatakse sobitunud sõnad; tühikud normaliseeritakse.
3. Kiip jääb samale kohale ja muutub tavaliseks siniseks `FilterChip`-iks, kollane sähvatus ~600 ms (CSS `transition`, mitte JS-taimer).
4. URL-i kirjutab olemasolev debounce-effect, kiip midagi omaette ei kirjuta. Seega kehtivad sama effecti reeglid: lehekülg läheb 1-le, kogu jääb. **Sorteerimine:** kui päringust jääb tekst alles, jääb sort samaks. Kui vastuvõtt tühjendab päringu (`põhiki` → ``) ja sort oli `relevance`, muudab effect selle `year_asc`-iks (`Dashboard.tsx` „Kui otsing tühjendatakse…"). See on **tahtlik ja jääb**: sama juhtub käsitsi tühjendamisel ja ilma päringuta pole relevantsusel tähendust. Valvur kontrollib seda.
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

### 2. `buildDashboardSearch` — ühine otsingupäring

`searchWorks` ehitab praegu päringu oma kehas (`searchService.ts`): `normalizeSearchQuery`, filter, `attributesToSearchOn`, `matchingStrategy` (`frequency` päringuga, `last` ilma). Sama filtri jagamisest ei piisa: teistsuguste otsinguväljade või strateegiaga loendur võiks leida vaste lehetekstist, mida avaleht pärast vastuvõttu ei näita. Seepärast eraldatakse eksporditud puhas funktsioon

```ts
buildDashboardSearch(rawQuery: string, options: DashboardSearchOptions):
  { q: string; filter: string[]; attributesToSearchOn: string[]; matchingStrategy: MatchingStrategies }
```

mida kasutavad **nii** `searchWorks` (+ oma `attributesToRetrieve`, fassetid, lehekülg) kui ka loendurid (+ `limit: 0`). `searchWorks` käitumine ei muutu. Valvurid: pinnitud ootused enne/pärast eraldamist ja test, mis võrdleb loenduri ning `searchWorks`-i Meilile saadetud parameetreid (mock-index) sama oleku korral.

### 3. `useFilterHints` — hook

`src/services/filterHints/useFilterHints.ts`

- **Ootab ulatust:** hook ei tee ühtki päringut enne, kui `useSelectionScope().ready` on tõene. Laadimata töökollektsiooni `scope` on `undefined` ja see üksi tähendaks piiranguta korpust (ADR 0042). Sama tingimus, mis avalehe otsingul (`!scopeReady → return`).
- **Sõnavara:** üks Meili päring `q: ''`, `limit: 0`, `facets: [genre_ids, tags_ids, type_ids]`, filter = `lehekylje_number = 1` + valik (`pushSelectionFilter`). Tulemus annab ka eeljärjestuse fassetiloendurid. **Vahemälu elab hooki sees** (`useRef`), mitte moodulitasandil. Võti = `index` objekt (vahetub tokeni ehk sisse/välja logimise ja õiguste muutusega) + valiku **sisu** võti (püsikogu id või töökollektsiooni `work_id` loend, mitte ainult kogu id, sest sama kogu liikmed võivad muutuda). Teistsugune võti → uus päring. Sildid tulevad `getEntityLabelsCache()`-st. Ilma registrisildita kood jäetakse välja. `vutt:` koodid jäetakse välja (nagu `tagItems`).
- **Loendurid:** `index.search` partiidena (3 paralleelset, eeljärjestuse kaupa, vt „Millal kiipi näidatakse"). `MeilisearchContext` annab ainult indeksi, mitte klienti, seega `multiSearch` nõuaks konteksti muutmist ja see ei tasu end ära. Iga kandidaadi kohta `buildDashboardSearch(remainingQuery, {...praegused valikud, kandidaat rakendatud})` + `limit: 0`. Kandidaat rakendatakse sama reegliga nagu vastuvõtt (žanr ja tüüp asendavad, märksõna lisandub, aasta seab `ys = ye`). Tulemus on `estimatedTotalHits`: ligikaudne, aga 0 vs > 0 on täpne, ja ainult see otsustab nähtavuse.
- **Juba rakendatud** väärtused filtreeritakse välja enne loendureid.
- `AbortController`: sisendi, `stateKey` või indeksi muutus tühistab käimasolevad päringud ja tühjendab vihjed kohe. Viga (v.a abort) → `[]`; viga ei lähe kliendivigade ringi, sest vihje on parim-pingutus.
- Tagastab `FilterHint[] = FilterHintCandidate & { count: number; sourceQuery: string; stateKey: string }`.

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
- `buildDashboardSearch.test.ts`: sama `(rawQuery, options)` → sama `q`, filter, `attributesToSearchOn`, `matchingStrategy`, mis `searchWorks` saatis enne eraldamist (pinnitud ootused).
- **Valvur „sama mis külgriba"** (`useWorkFilterModel` test): vihje vastuvõtt ja külgriba `onToggle` sama väärtusega viivad sama `onGenreChange` / `onTagsChange` / `onTypeChange` kutseni samade argumentidega.
- **Loendur = päris otsing:** mock-index salvestab parameetrid; sama oleku + kandidaadi korral on loenduri `q`, `filter`, `attributesToSearchOn`, `matchingStrategy` identsed `searchWorks`-i omadega pärast vastuvõttu. Žanri asendus kaetud.
- **Vananemine** (`useFilterHints`, jsdom + võltsajad): vihje on nähtaval → kasutaja trükib → vihje kaob kohe ja vana vihje vastuvõtt on no-op. Sama kogu, filtri ja indeksi (token) vahetusel.
- **Ulatus:** `ready = false` → null päringut; indeksi vahetus → sõnavara päritakse uuesti.
- **Partiid:** 7 kandidaati, esimesed 6 loenduriga 0 → seitsmes kuvatakse.
- **Päringu tühjenemine** vastuvõtul: `q` kaob URL-ist, `relevance` → `year_asc` (tahtlik).
- `FilterHintChip.test.tsx` (jsdom): kollane punktiir, klikk kutsub `onAccept`, aria-silt.
- Käsitsi tootmisandmetega (tunnel + `npm run dev`): `põhiki`, `1702 constitu`, `käsikiri`, `disputa`, `loengukat`; valitud kogu ja ilma; mobiil 390 px.

## Laiendus (mitte osa 1)

- **Sünonüümid (C):** `label_overrides.json` saab `aliases` (või eraldi fail). Hook paneb need `VocabEntry.terms`-i ja tuvastaja sobitab neid nagu silte. Tuvastaja ise ei muutu.
- **Osa 2:** otsingulehel on oma URL-i sõnavara (`teoseTags`, `p`, žanr mitmikvalikuna) ja oma rakendaja; tuvastaja ja kiip on samad. Lisandub isik/autor.
- **Osa 3:** isikute leht, serveri registrid sõnavarana.
