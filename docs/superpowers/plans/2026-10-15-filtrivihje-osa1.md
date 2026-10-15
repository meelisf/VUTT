# Filtrivihje otsingureal, osa 1: implementatsiooniplaan

> **Agentidele:** NÕUTAV ALAMOSKUS: kasuta superpowers:subagent-driven-development (soovitatud) või superpowers:executing-plans, et plaan ülesanne-ülesande haaval ellu viia. Sammud kasutavad märkeruutude (`- [ ]`) süntaksit.

**Eesmärk:** avalehe otsingurida tunneb päringus ära aasta, žanri, märksõna ja tüübi ning pakub kollase punktiiriga kiipi. Vastuvõtt annab sama tulemuse kui külgribal valimine.

**Ülesehitus:** puhas tuvastaja (`detectFilterHints`) + `searchWorks`-ist eraldatud ühine päringuehitaja (`buildDashboardSearch`), mida kasutavad nii otsing kui ka loendurid. Hook `useFilterHints` küsib Meilist sõnavara ja loendurid ning peidab vananenud vihjed. Rakendamine käib külgribaga sama `applyWorkFilter`-i kaudu. Serveripoolset muudatust ei ole.

**Tehnoloogia:** React 19, TypeScript, Tailwind, meilisearch-js, vitest (+ jsdom komponendi- ja hooktestides), react-i18next.

**Spec:** `docs/superpowers/2026-10-15-filtrivihje-otsingureal-design.md`. Täitja loeb nii spec'i kui ka plaani.

## Üldised piirangud

- Koodikommentaarid on **eesti keeles** (CLAUDE.md).
- Uus i18n-võti läheb **mõlemasse keelde korraga** (`src/locales/et/…` ja `src/locales/en/…`), muidu kukuvad `localeParity.test.ts` ja build.
- Komponendi- ja hooktestid algavad failipäisega `/** @vitest-environment jsdom */`. Loogikatestid jooksevad `node`-keskkonnas.
- Väravad enne iga commiti: `npm run typecheck` ja `npm test`. Lõpus lisaks `npm run lint:ci` (lävi `--max-warnings 42`, uusi hoiatusi ei tohi tulla).
- Hook ei tee **ühtki** Meili päringut, kui `scopeReady` on väär (ADR 0042: laadimata töökollektsioon tähendaks piiranguta korpust).
- `server/cache.py`-d ega moodulitasandi kasutajapõhist vahemälu ei kasutata; sõnavara vahemälu elab hooki sees.
- Tuvastusreeglid: aasta on eraldiseisev 4-kohaline arv **1400–1950**; sildisõna on vähemalt **4** tähte; korraga kuni **3** kiipi; loendurid **3** kaupa, lagi **4** partiid (12 päringut); viide **400 ms**.
- Vihjekiibi stiil: valge taust, `border-[1.5px] border-dashed border-amber-400`, tekst `text-amber-800`, liigi silt `text-amber-700 text-xs`, ees „+", loendur `text-gray-400 text-xs`.
- Enne igat commiti kontrolli `git branch --show-current`. Töö käib harul `feat/filtrivihje-605`, mitte `main`-il.

## Ülevaatuse fookus

1. **Kasutaja trükib, kuni loendurid veel jooksevad.** Vana kiip peab kaduma kohe ja vana kiibi klõps ei tohi uut teksti üle kirjutada. Kaetud: ülesanne 4 (vananemise test) ja ülesanne 6 (`acceptHint` kontrollib `isCurrent`).
2. **Jutumärkidega fraasiotsing (`"oratio panegyr"`).** Jutumärke sisaldavat sõna ei tõlgendata filtrina, muidu laguneks fraas. Kaetud: ülesanne 1, test „jutumärgiga sõna".
3. **Žanr on juba valitud ja kasutaja kirjutab teise žanri.** Kiip pakub uut žanri ja loendur arvestab asendust, mitte kahe žanri ühendit. Kaetud: ülesanne 4, test „žanri asendus loenduris".
4. **Valitud žanr on URL-is sildina, mitte Q-koodina** (vana link või keelevahetus). Sama väärtust ei pakuta uuesti. Kaetud: ülesanne 4, test „rakendatud sildi järgi".
5. **Sorteerimine `recent`** (`onlyFirstPage: false`). Loendur kasutab sama `onlyFirstPage` loogikat nagu otsing, sest mõlemad tulevad `buildDashboardSearch`-ist. Kaetud: ülesanne 2, test `onlyFirstPage: false`.

---

## Failide struktuur

| Fail | Vastutus |
|---|---|
| Uus `src/services/filterHints/detectFilterHints.ts` | Puhas tuvastaja: päring + sõnavara → kandidaadid |
| Uus `src/services/filterHints/candidateOptions.ts` | Puhas `withCandidate(options, kandidaat)`: kandidaat rakendatud otsinguvalikutena |
| Uus `src/services/filterHints/useFilterHints.ts` | Hook: sõnavara, järjestus, partiiloendurid, vananemine |
| Muuda `src/services/searchService.ts` | `buildDashboardSearch` + `DASHBOARD_SEARCH_ATTRIBUTES` + `getScopeFacetCodes`; `searchWorks` kasutab neid |
| Muuda `src/components/workFilters/useWorkFilterModel.ts` | `applyWorkFilter(kind, value)`; `toggleTag` lisamine läbi selle |
| Muuda `src/components/workFilters/WorkFilterSections.tsx` | Külgriba žanr ja tüüp kasutavad `applyWorkFilter`-it |
| Muuda `src/components/workFilters/WorkFilterChips.tsx` | `FilterHintChip`; `hints`, `hasApplied`, `highlight` prop'id; `FilterChip` saab `highlight` prop'i |
| Uus `src/services/analytics.ts` | `trackEvent`: ohutu Umami ümbris |
| Uus `src/pages/dashboardQuerySync.ts` | Puhas `sortAfterQueryChange` (eraldatud Dashboardi effectist) |
| Muuda `src/pages/Dashboard.tsx` | Ühine `searchOptions`, hook, `acceptHint`, kiibirida |
| Muuda `tailwind.config.js` | `hint-flash` keyframes + animatsioon |
| Muuda `src/locales/{et,en}/dashboard.json` | `filterHints.addFilter` |

---

### Ülesanne 1: `detectFilterHints`, puhas tuvastaja

**Failid:**
- Uus: `src/services/filterHints/detectFilterHints.ts`
- Test: `src/services/filterHints/__tests__/detectFilterHints.test.ts`

**Liidesed:**
- Kasutab: `normalizeForSearch(s: string): string` failist `src/utils/diacritics.ts`
- Annab:
  ```ts
  export type HintKind = 'year' | 'genre' | 'tag' | 'type';
  export interface VocabEntry { kind: 'genre' | 'tag' | 'type'; id: string; labels: { et?: string; en?: string }; terms?: string[]; facetCount?: number }
  export interface FilterHintCandidate { kind: HintKind; value: string; label: string; matched: [number, number]; matchedTokens: number; matchedChars: number; remainingQuery: string; facetCount: number }
  export interface DetectOptions { minYear?: number; maxYear?: number; minTokenLength?: number }
  export function detectFilterHints(query: string, vocab: VocabEntry[], lang: 'et' | 'en', opts?: DetectOptions): FilterHintCandidate[]
  ```
  Tagastus on eeljärjestuses: `matchedTokens` kahanevalt → `matchedChars` kahanevalt → `facetCount` kahanevalt. Aasta `facetCount` on `Number.MAX_SAFE_INTEGER`, et selgesõnaline aasta eelistuks sama pikkusega sildivastele.

- [ ] **Samm 1: kirjuta kukkuvad testid**

```ts
// src/services/filterHints/__tests__/detectFilterHints.test.ts
import { describe, it, expect } from 'vitest';
import { detectFilterHints, VocabEntry } from '../detectFilterHints';

const vocab: VocabEntry[] = [
  { kind: 'genre', id: 'Q3497659', labels: { et: 'põhikiri', en: 'statutes' }, facetCount: 7 },
  { kind: 'genre', id: 'Q1123131', labels: { et: 'disputatsioon', en: 'disputation' }, facetCount: 900 },
  { kind: 'genre', id: 'Q856713', labels: { et: 'kirikulaul', en: 'Christian hymn' }, facetCount: 5 },
  { kind: 'type', id: 'Q87167', labels: { et: 'käsikiri', en: 'manuscript' }, facetCount: 300 },
  { kind: 'tag', id: 'Q2534157', labels: { et: 'loengukataloog', en: 'course catalog' }, facetCount: 18 },
];

const ids = (q: string, lang: 'et' | 'en' = 'et') => detectFilterHints(q, vocab, lang).map(c => `${c.kind}:${c.value}`);

describe('detectFilterHints', () => {
  it('sildi sõna algus, tõstu- ja diakriitikutundetu', () => {
    expect(ids('põhiki')).toEqual(['genre:Q3497659']);
    expect(ids('pohiki')).toEqual(['genre:Q3497659']);
    expect(ids('PÕHIKI')).toEqual(['genre:Q3497659']);
  });

  it('ingliskeelne silt sobitub ja kuvasilt tuleb UI keeles', () => {
    const [c] = detectFilterHints('statut', vocab, 'et');
    expect(c.value).toBe('Q3497659');
    expect(c.label).toBe('Põhikiri');
    expect(detectFilterHints('statut', vocab, 'en')[0].label).toBe('Statutes');
  });

  it('aasta + ülejäänud tekst', () => {
    const r = detectFilterHints('1702 constitu', vocab, 'et');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'year', value: '1702', label: '1702', matched: [0, 0], remainingQuery: 'constitu' });
  });

  it('aasta väljaspool vahemikku ei ole vihje', () => {
    expect(ids('1350')).toEqual([]);
    expect(ids('2026')).toEqual([]);
    expect(ids('17020')).toEqual([]);
  });

  it('alla 4 tähe ei sobitu', () => {
    expect(ids('põh')).toEqual([]);
    expect(ids('kir')).toEqual([]);
  });

  it('sõna keskelt ei sobitu: kiri → kirikulaul (algus), mitte põhikiri (keskel)', () => {
    expect(ids('kiri')).toEqual(['genre:Q856713']);
  });

  it('mitmesõnaline silt: täissõnad + poolik viimane', () => {
    const r = detectFilterHints('christian hym', vocab, 'en');
    expect(r[0]).toMatchObject({ kind: 'genre', value: 'Q856713', matched: [0, 1], matchedTokens: 2, remainingQuery: '' });
  });

  it('üksik teine sõna mitmesõnalisest sildist sobitub', () => {
    expect(ids('hymn', 'en')).toEqual(['genre:Q856713']);
  });

  it('jutumärgiga sõna ei tõlgendata filtrina', () => {
    expect(ids('"põhikiri"')).toEqual([]);
    expect(ids('"oratio põhiki"')).toEqual([]);
  });

  it('remainingQuery normaliseerib tühikud', () => {
    const r = detectFilterHints('  Ludenius   loengukat  1690 ', vocab, 'et');
    const tag = r.find(c => c.kind === 'tag')!;
    expect(tag.remainingQuery).toBe('Ludenius 1690');
    const year = r.find(c => c.kind === 'year')!;
    expect(year.remainingQuery).toBe('Ludenius loengukat');
  });

  it('eeljärjestus: pikem sobitus, siis fassetiloendur', () => {
    const v: VocabEntry[] = [
      { kind: 'tag', id: 'Qa', labels: { et: 'disputatio' }, facetCount: 1 },
      { kind: 'genre', id: 'Qb', labels: { et: 'disputatsioon' }, facetCount: 900 },
    ];
    expect(detectFilterHints('disput', v, 'et').map(c => c.value)).toEqual(['Qb', 'Qa']);
  });

  it('sama kood mitme sildi kaudu tuleb üks kord (pikim sobitus)', () => {
    const v: VocabEntry[] = [{ kind: 'genre', id: 'Qx', labels: { et: 'loengu kataloog', en: 'loengu' } }];
    const r = detectFilterHints('loengu kata', v, 'et');
    expect(r).toHaveLength(1);
    expect(r[0].matchedTokens).toBe(2);
  });

  it('terms (sünonüümid) sobituvad nagu sildid', () => {
    const v: VocabEntry[] = [{ kind: 'genre', id: 'Q3497659', labels: { et: 'põhikiri' }, terms: ['constitutiones'] }];
    expect(detectFilterHints('constitu', v, 'et').map(c => c.value)).toEqual(['Q3497659']);
  });

  it('tühi päring → tühi tulemus', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});
```

- [ ] **Samm 2: käivita, et näha kukkumist**

Run: `npx vitest run src/services/filterHints/__tests__/detectFilterHints.test.ts`
Oodatud: FAIL („Failed to resolve import ../detectFilterHints")

- [ ] **Samm 3: kirjuta teostus**

```ts
// src/services/filterHints/detectFilterHints.ts
/**
 * Filtrivihje tuvastaja (#605, spec 2026-10-15): otsingupäring + sõnavara →
 * filtrikandidaadid. Puhas funktsioon — loendurid ja „juba rakendatud" on
 * hooki (`useFilterHints`) töö.
 *
 * Reegel: päringu sõna on SILDI SÕNA ALGUS (tõstu- ja diakriitikutundetu).
 * Mitmesõnaline silt sobitub järjestikuste päringusõnadega, kus kõik peale
 * viimase on täissõnad ja viimane võib olla poolik.
 */
import { normalizeForSearch } from '../../utils/diacritics';

export type HintKind = 'year' | 'genre' | 'tag' | 'type';

export interface VocabEntry {
  kind: 'genre' | 'tag' | 'type';
  id: string;
  labels: { et?: string; en?: string };
  /** Sünonüümid (spec „Laiendus"); osa 1-s tühi. */
  terms?: string[];
  /** Ulatuse fassetiloendur — eeljärjestuse teine kriteerium. */
  facetCount?: number;
}

export interface FilterHintCandidate {
  kind: HintKind;
  value: string;
  label: string;
  /** Sõnaindeksite vahemik päringus (kaasa arvatud). */
  matched: [number, number];
  matchedTokens: number;
  matchedChars: number;
  remainingQuery: string;
  facetCount: number;
}

export interface DetectOptions {
  minYear?: number;
  maxYear?: number;
  minTokenLength?: number;
}

const DEFAULTS = { minYear: 1400, maxYear: 1950, minTokenLength: 4 };

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Mitu päringusõna alates `start`-ist sobitub sildisõnadega alates `w`-st.
 * Kõik peale viimase peavad olema täpselt võrdsed, viimane on algus.
 * Tagastab pikima kehtiva arvu (0 = ei sobitu).
 */
function runLength(tokens: string[], start: number, words: string[], w: number, minLen: number): number {
  let best = 0;
  let chars = 0;
  for (let k = 1; start + k - 1 < tokens.length && w + k - 1 < words.length; k++) {
    const tok = tokens[start + k - 1];
    const word = words[w + k - 1];
    if (!word.startsWith(tok)) break;
    chars += tok.length;
    // Lühike poolik sõna üksi ei loe: kogu sobitus peab kandma ≥ minLen tähte
    if (chars >= minLen && (k === 1 ? tok.length >= minLen : true)) best = k;
    // Järgmine samm nõuab, et see sõna oleks TÄIS-sõna
    if (tok !== word) break;
  }
  return best;
}

export function detectFilterHints(
  query: string,
  vocab: VocabEntry[],
  lang: 'et' | 'en',
  opts: DetectOptions = {},
): FilterHintCandidate[] {
  const { minYear, maxYear, minTokenLength } = { ...DEFAULTS, ...opts };
  const raw = (query || '').trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0) return [];
  // Jutumärke sisaldav päring on fraasiotsing — ei lõhu seda filtriks
  if (raw.some(t => t.includes('"'))) return [];
  const tokens = raw.map(normalizeForSearch);

  const remaining = (from: number, to: number) =>
    raw.filter((_, i) => i < from || i > to).join(' ');

  const out: FilterHintCandidate[] = [];

  tokens.forEach((tok, i) => {
    if (/^\d{4}$/.test(tok)) {
      const y = Number(tok);
      if (y >= minYear && y <= maxYear) {
        out.push({
          kind: 'year', value: tok, label: tok, matched: [i, i], matchedTokens: 1,
          matchedChars: tok.length, remainingQuery: remaining(i, i), facetCount: Number.MAX_SAFE_INTEGER,
        });
      }
    }
  });

  for (const entry of vocab) {
    const phrases = [entry.labels.et, entry.labels.en, ...(entry.terms || [])].filter(Boolean) as string[];
    let best: { start: number; k: number; chars: number } | null = null;
    for (const phrase of phrases) {
      const words = normalizeForSearch(phrase).split(/\s+/).filter(Boolean);
      for (let start = 0; start < tokens.length; start++) {
        for (let w = 0; w < words.length; w++) {
          const k = runLength(tokens, start, words, w, minTokenLength);
          if (k === 0) continue;
          const chars = tokens.slice(start, start + k).join('').length;
          if (!best || k > best.k || (k === best.k && chars > best.chars)) best = { start, k, chars };
        }
      }
    }
    if (best) {
      out.push({
        kind: entry.kind,
        value: entry.id,
        label: capitalize(entry.labels[lang] || entry.labels.et || entry.labels.en || entry.id),
        matched: [best.start, best.start + best.k - 1],
        matchedTokens: best.k,
        matchedChars: best.chars,
        remainingQuery: remaining(best.start, best.start + best.k - 1),
        facetCount: entry.facetCount ?? 0,
      });
    }
  }

  return out.sort((a, b) =>
    b.matchedTokens - a.matchedTokens || b.matchedChars - a.matchedChars || b.facetCount - a.facetCount);
}
```

- [ ] **Samm 4: käivita testid, peavad läbi minema**

Run: `npx vitest run src/services/filterHints/__tests__/detectFilterHints.test.ts`
Oodatud: PASS (14 testi)

- [ ] **Samm 5: commit**

```bash
git branch --show-current   # feat/filtrivihje-605
git add src/services/filterHints/detectFilterHints.ts src/services/filterHints/__tests__/detectFilterHints.test.ts
git commit -m "feat(otsing): filtrivihje tuvastaja (#605)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Ülesanne 2: `buildDashboardSearch` ja `getScopeFacetCodes`

**Failid:**
- Muuda: `src/services/searchService.ts` (`searchWorks` keha, praegu ~read 382–445)
- Uus: `src/services/filterHints/candidateOptions.ts`
- Test: `src/services/__tests__/buildDashboardSearch.test.ts`

**Liidesed:**
- Annab:
  ```ts
  export const DASHBOARD_SEARCH_ATTRIBUTES: string[];
  export interface DashboardSearchCore { q: string; filter: string[]; attributesToSearchOn: string[]; matchingStrategy: MatchingStrategies }
  export function buildDashboardSearch(rawQuery: string, options?: DashboardSearchOptions): DashboardSearchCore;
  export async function getScopeFacetCodes(index: Index, scope: SelectionScope | undefined, signal?: AbortSignal): Promise<{ genre_ids: Record<string, number>; tags_ids: Record<string, number>; type_ids: Record<string, number> }>;
  // candidateOptions.ts
  export function withCandidate(base: DashboardSearchOptions, c: { kind: HintKind; value: string }): DashboardSearchOptions;
  ```

- [ ] **Samm 1: kirjuta pinnitud test ENNE eraldamist**

See test salvestab praeguse `searchWorks` käitumise. Inline-snapshot kirjutatakse esimesel käivitusel ja jääb refaktori valvuriks.

```ts
// src/services/__tests__/buildDashboardSearch.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('../meiliService', () => ({
  checkMixedContent: vi.fn(),
  normalizeWork: vi.fn((hit) => hit),
  normalizeContentSearchHit: vi.fn(),
}));
vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700', MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images', FILE_API_URL: '/api/files',
}));

import { searchWorks } from '../searchService';
import type { DashboardSearchOptions } from '../searchService';

const mockIndex = { search: mockSearch } as any;
beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, totalHits: 0 });
});

const rich: DashboardSearchOptions = {
  yearStart: '1690', yearEnd: '1700', sort: 'relevance', author: 'Ludenius',
  workStatus: 'Valmis', teoseTags: ['Q2534157'], genre: ['Q3497659'], type: ['Q87167'],
  languages: ['lat'], collection: 'universitas-dorpatensis-1', lang: 'et', onlyFirstPage: true,
};

async function sentParams(q: string, o: DashboardSearchOptions) {
  await searchWorks(mockIndex, q, o);
  const [query, params] = mockSearch.mock.calls.at(-1)!;
  return { q: query, filter: params.filter, attributesToSearchOn: params.attributesToSearchOn, matchingStrategy: params.matchingStrategy };
}

describe('searchWorks päringu tuum (pinnitud enne eraldamist)', () => {
  it('rikas valik', async () => {
    expect(await sentParams('Schluß constitu', rich)).toMatchInlineSnapshot();
  });
  it('tühi päring, onlyFirstPage: false', async () => {
    expect(await sentParams('', { sort: 'recent', onlyFirstPage: false })).toMatchInlineSnapshot();
  });
});
```

- [ ] **Samm 2: käivita, et snapshot salvestuks; kontrolli selle sisu silmaga**

Run: `npx vitest run src/services/__tests__/buildDashboardSearch.test.ts -u`
Oodatud: PASS, failis on nüüd inline-snapshotid. Kontrolli, et esimeses on `q: "Schluss constitu"`, `matchingStrategy: "frequency"`, `attributesToSearchOn` sisaldab `genre_search`-i ja filter algab `lehekylje_number = 1`-ga. Teises on `matchingStrategy: "last"` ja filtris **ei ole** `lehekylje_number = 1`.

- [ ] **Samm 3: lisa kukkuvad testid uutele funktsioonidele**

Lisa samasse faili:

```ts
import { buildDashboardSearch, getScopeFacetCodes } from '../searchService';
import { withCandidate } from '../filterHints/candidateOptions';

describe('buildDashboardSearch', () => {
  it('annab täpselt selle, mida searchWorks Meilile saadab', async () => {
    for (const [q, o] of [['Schluß constitu', rich], ['', { sort: 'recent', onlyFirstPage: false }]] as const) {
      expect(buildDashboardSearch(q, o)).toEqual(await sentParams(q, o));
    }
  });
});

describe('withCandidate', () => {
  const base: DashboardSearchOptions = { genre: ['Qvana'], type: ['Qt'], teoseTags: ['Qa'], yearStart: '1600' };
  it('žanr ja tüüp asendavad (üksikvalik nagu külgribal)', () => {
    expect(withCandidate(base, { kind: 'genre', value: 'Qg' }).genre).toEqual(['Qg']);
    expect(withCandidate(base, { kind: 'type', value: 'Qn' }).type).toEqual(['Qn']);
  });
  it('märksõna lisandub', () => {
    expect(withCandidate(base, { kind: 'tag', value: 'Qb' }).teoseTags).toEqual(['Qa', 'Qb']);
  });
  it('aasta seab ys = ye', () => {
    const o = withCandidate(base, { kind: 'year', value: '1702' });
    expect([o.yearStart, o.yearEnd]).toEqual(['1702', '1702']);
  });
  it('ei muuda sisendit', () => {
    withCandidate(base, { kind: 'tag', value: 'Qb' });
    expect(base.teoseTags).toEqual(['Qa']);
  });
});

describe('getScopeFacetCodes', () => {
  it('küsib ulatuse fassetid ilma otsingusõnata', async () => {
    mockSearch.mockResolvedValueOnce({ hits: [], facetDistribution: { genre_ids: { Q1: 3 }, tags_ids: {}, type_ids: { Q2: 1 } } });
    const r = await getScopeFacetCodes(mockIndex, 'universitas-dorpatensis-1');
    const [q, params] = mockSearch.mock.calls.at(-1)!;
    expect(q).toBe('');
    expect(params.limit).toBe(0);
    expect(params.facets).toEqual(['genre_ids', 'tags_ids', 'type_ids']);
    expect(params.filter[0]).toBe('lehekylje_number = 1');
    expect(params.filter.length).toBeGreaterThan(1); // + valikuklausel
    expect(r).toEqual({ genre_ids: { Q1: 3 }, tags_ids: {}, type_ids: { Q2: 1 } });
  });
});
```

Run: `npx vitest run src/services/__tests__/buildDashboardSearch.test.ts`
Oodatud: FAIL (`buildDashboardSearch` ja `withCandidate` puuduvad)

- [ ] **Samm 4: eralda `buildDashboardSearch`**

`searchService.ts`-is, otse `searchWorks`-i ette:

```ts
// Avalehe otsinguväljad. ÜKS allikas otsingule ja filtrivihje loenduritele (#605):
// teistsuguste väljadega loendur leiaks vasteid, mida avaleht ei näita.
export const DASHBOARD_SEARCH_ATTRIBUTES = ['title', 'title_en', 'title_original', 'authors_text', 'tags_search', 'genre_search'];

export interface DashboardSearchCore {
  q: string;
  filter: string[];
  attributesToSearchOn: string[];
  matchingStrategy: MatchingStrategies;
}

/** Avalehe päringu tuum: normaliseeritud päring, filter, väljad, strateegia. */
export function buildDashboardSearch(rawQuery: string, options?: DashboardSearchOptions): DashboardSearchCore {
  const q = normalizeSearchQuery(rawQuery);
  const filter: string[] = [];
  // ⟵ SIIA tõsta muutmata kujul searchWorks-i plokk alates kommentaarist
  //   „// ALATI filtreeri esimese lehekülje järgi" kuni keelefiltri
  //   `filter.push(buildMultiFilter(options.languages, …))` sulgeva `}`-ni (k.a).
  return {
    q,
    filter,
    attributesToSearchOn: [...DASHBOARD_SEARCH_ATTRIBUTES],
    matchingStrategy: (q ? 'frequency' : 'last') as unknown as MatchingStrategies,
  };
}
```

Plokk tõstetakse sõna-sõnalt, nii et kommentaarid jäävad alles. `searchWorks`-is asenda `const query = normalizeSearchQuery(rawQuery);` ja kogu tõstetud filtriplokk järgmisega:

```ts
  const { q: query, filter, attributesToSearchOn, matchingStrategy } = buildDashboardSearch(rawQuery, options);
```

Asenda `searchParams` objektis read `attributesToSearchOn: [...]` (koos kommentaariga) ja `matchingStrategy: (...)`:

```ts
      attributesToSearchOn, // DASHBOARD_SEARCH_ATTRIBUTES (#605: üks allikas)
      matchingStrategy,
```

`try {` jääb samale kohale. Destruktureerimine tuleb `try`-ploki sisse esimeseks reaks, et viga `buildDashboardSearch`-is liiguks sama `catch`-i.

- [ ] **Samm 5: lisa `getScopeFacetCodes`**

`searchService.ts`-is `getAuthorFacets`-i järele:

```ts
/**
 * Ulatuse žanri-, märksõna- ja tüübikoodid koos teoste arvuga (#605:
 * filtrivihje sõnavara). Ilma otsingusõnata ja muude filtriteta: sõnavara
 * on „mis siin kogus üldse olemas on".
 */
export const getScopeFacetCodes = async (
  index: Index,
  scope: SelectionScope | undefined,
  signal?: AbortSignal,
): Promise<{ genre_ids: Record<string, number>; tags_ids: Record<string, number>; type_ids: Record<string, number> }> => {
  const filter: string[] = ['lehekylje_number = 1'];
  pushSelectionFilter(filter, scope);
  const response = await index.search('', {
    filter, limit: 0, facets: ['genre_ids', 'tags_ids', 'type_ids'],
  }, signal ? { signal } : undefined);
  const fd = response.facetDistribution || {};
  return { genre_ids: fd['genre_ids'] || {}, tags_ids: fd['tags_ids'] || {}, type_ids: fd['type_ids'] || {} };
};
```

- [ ] **Samm 6: kirjuta `withCandidate`**

```ts
// src/services/filterHints/candidateOptions.ts
/**
 * Kandidaat rakendatud otsinguvalikutena — SAMA reegel, mis vastuvõtul
 * (applyWorkFilter / setYearStart+End): žanr ja tüüp asendavad (avalehel
 * üksikvalik), märksõna lisandub, aasta seab ys = ye. Loendur peab
 * arvutama just selle päringu, mis vastuvõtu järel jookseb.
 */
import type { DashboardSearchOptions } from '../searchService';
import type { HintKind } from './detectFilterHints';

export function withCandidate(base: DashboardSearchOptions, c: { kind: HintKind; value: string }): DashboardSearchOptions {
  switch (c.kind) {
    case 'year': return { ...base, yearStart: c.value, yearEnd: c.value };
    case 'genre': return { ...base, genre: [c.value] };
    case 'type': return { ...base, type: [c.value] };
    case 'tag': return { ...base, teoseTags: [...(base.teoseTags || []), c.value] };
  }
}
```

- [ ] **Samm 7: käivita kõik otsinguteenuse testid**

Run: `npx vitest run src/services` ja `npm run typecheck`
Oodatud: kõik PASS. Pinnitud snapshotid ei muutunud. Kui snapshot muutus, on refaktor käitumist muutnud: paranda refaktorit, mitte snapshot'i.

- [ ] **Samm 8: commit**

```bash
git branch --show-current
git add src/services/searchService.ts src/services/filterHints/candidateOptions.ts src/services/__tests__/buildDashboardSearch.test.ts
git commit -m "refactor(otsing): buildDashboardSearch ühine tuum otsingule ja loenduritele (#605)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Ülesanne 3: `applyWorkFilter`, ühine rakendaja külgribale ja kiibile

**Failid:**
- Muuda: `src/components/workFilters/useWorkFilterModel.ts` (`toggleTag` ja `return`, ~read 255–296)
- Muuda: `src/components/workFilters/WorkFilterSections.tsx:65` ja `:82`
- Test: `src/components/workFilters/__tests__/applyWorkFilter.test.tsx`

**Liidesed:**
- Annab: `model.applyWorkFilter(kind: 'genre' | 'tag' | 'type', value: string): void`

- [ ] **Samm 1: kirjuta kukkuv test**

```tsx
/** @vitest-environment jsdom */
// src/components/workFilters/__tests__/applyWorkFilter.test.tsx
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../services/collectionService', () => ({
  getVocabularies: vi.fn().mockResolvedValue({ languages: {} }),
}));

import { useWorkFilterModel, WorkFilterInput } from '../useWorkFilterModel';

function setup(over: Partial<WorkFilterInput> = {}) {
  const spies = {
    onGenreChange: vi.fn(), onTagsChange: vi.fn(), onTypeChange: vi.fn(),
    onStatusChange: vi.fn(), onLanguagesChange: vi.fn(),
  };
  const input: WorkFilterInput = {
    selectedGenre: null, selectedTags: [], selectedType: null, selectedStatus: null, selectedLanguages: [],
    lang: 'et', ...spies, ...over,
  };
  const r = renderHook(() => useWorkFilterModel(input));
  Object.values(spies).forEach(s => s.mockClear());
  return { model: () => r.result.current, spies };
}

describe('applyWorkFilter = sama, mis külgriba valik', () => {
  it('žanr', () => {
    const { model, spies } = setup();
    act(() => model().applyWorkFilter('genre', 'Q3497659'));
    expect(spies.onGenreChange).toHaveBeenCalledWith('Q3497659');
  });

  it('tüüp', () => {
    const { model, spies } = setup();
    act(() => model().applyWorkFilter('type', 'Q87167'));
    expect(spies.onTypeChange).toHaveBeenCalledWith('Q87167');
  });

  it('märksõna: kiip ja külgriba toggleTag annavad sama kutse', () => {
    const a = setup({ selectedTags: ['Qa'] });
    act(() => a.model().applyWorkFilter('tag', 'Qb'));
    const b = setup({ selectedTags: ['Qa'] });
    act(() => b.model().toggleTag('Qb'));
    expect(a.spies.onTagsChange.mock.calls).toEqual(b.spies.onTagsChange.mock.calls);
    expect(a.spies.onTagsChange).toHaveBeenCalledWith(['Qa', 'Qb']);
  });

  it('juba valitud märksõna: ei muuda midagi', () => {
    const { model, spies } = setup({ selectedTags: ['Qa'] });
    act(() => model().applyWorkFilter('tag', 'Qa'));
    expect(spies.onTagsChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Samm 2: käivita, et näha kukkumist**

Run: `npx vitest run src/components/workFilters/__tests__/applyWorkFilter.test.tsx`
Oodatud: FAIL („model(...).applyWorkFilter is not a function")

- [ ] **Samm 3: teostus mudelis**

`useWorkFilterModel.ts`-is asenda `toggleTag` järgmisega:

```ts
  // ÜKS rakendaja külgribale ja filtrivihjele (#605): vastuvõetud vihje peab
  // andma täpselt sama oleku kui külgribal valimine. Ainult LISAMISE suund;
  // eemaldamine käib endiselt kiibi × / külgriba uue klikiga.
  const applyWorkFilter = (kind: 'genre' | 'tag' | 'type', value: string) => {
    if (kind === 'genre') onGenreChange(value);
    else if (kind === 'type') onTypeChange(value);
    else if (!effectiveSelectedTags.includes(value)) onTagsChange([...effectiveSelectedTags, value]);
  };

  const toggleTag = (tag: string) => {
    if (effectiveSelectedTags.includes(tag)) {
      onTagsChange(effectiveSelectedTags.filter(t => t !== tag));
    } else {
      applyWorkFilter('tag', tag);
    }
  };
```

Lisa `return`-objekti `toggleTag`-i kõrvale `applyWorkFilter`:

```ts
    input, loading, activeCount, clearAll, toggleTag, applyWorkFilter,
```

- [ ] **Samm 4: külgriba kasutab sama rakendajat**

`WorkFilterSections.tsx`-is lisa rea 36 destruktureerimisse (`selectedGenreItemValue, selectedTypeItemValue, effectiveSelectedTags, toggleTag,`) `applyWorkFilter`, ja asenda:

rida 65:
```tsx
                onToggle={(val) => (selectedTypeItemValue === val ? onTypeChange(null) : applyWorkFilter('type', val))}
```
rida 82:
```tsx
                onToggle={(val) => (selectedGenreItemValue === val ? onGenreChange(null) : applyWorkFilter('genre', val))}
```

- [ ] **Samm 5: käivita testid**

Run: `npx vitest run src/components/workFilters` ja `npm run typecheck`
Oodatud: PASS

- [ ] **Samm 6: commit**

```bash
git branch --show-current
git add src/components/workFilters/
git commit -m "refactor(filtrid): applyWorkFilter ühine rakendaja külgribale ja vihjele (#605)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Ülesanne 4: `useFilterHints` hook

**Failid:**
- Uus: `src/services/filterHints/useFilterHints.ts`
- Test: `src/services/filterHints/__tests__/useFilterHints.test.tsx`

**Liidesed:**
- Kasutab: `detectFilterHints`, `VocabEntry`, `FilterHintCandidate` (ülesanne 1); `buildDashboardSearch`, `getScopeFacetCodes`, `DashboardSearchOptions` (ülesanne 2); `withCandidate` (ülesanne 2); `getEntityLabelsCache()` failist `src/services/entityLabelsService.ts`; `isAbortError` failist `src/utils/isAbortError.ts`; `isVuttId` failist `src/utils/qcodeUtils.ts`
- Annab:
  ```ts
  export interface FilterHint extends FilterHintCandidate { count: number; sourceQuery: string; stateKey: string }
  export interface UseFilterHintsArgs {
    index: Index | null;
    query: string;                          // otsingukasti jooksev väärtus (inputValue)
    searchOptions: DashboardSearchOptions;  // SAMA objekt, mille Dashboard annab searchWorks-ile (ilma offset/limit/signal)
    scopeReady: boolean;
    lang: 'et' | 'en';
    debounceMs?: number;                    // vaikimisi 400
  }
  export function useFilterHints(args: UseFilterHintsArgs): { hints: FilterHint[]; isCurrent: (h: FilterHint) => boolean };
  export function hintsStateKey(index: object | null, o: DashboardSearchOptions): string;
  ```

- [ ] **Samm 1: kirjuta kukkuvad testid**

```tsx
/** @vitest-environment jsdom */
// src/services/filterHints/__tests__/useFilterHints.test.tsx
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../meiliService', () => ({
  checkMixedContent: vi.fn(), normalizeWork: vi.fn((h) => h), normalizeContentSearchHit: vi.fn(),
}));
vi.mock('../../../config', () => ({
  MEILI_HOST: 'http://localhost:7700', MEILI_INDEX: 'teosed', IMAGE_BASE_URL: '/api/images', FILE_API_URL: '/api/files',
}));
const labels: Record<string, Record<string, string>> = {
  Q3497659: { et: 'põhikiri', en: 'statutes' },
  Q1123131: { et: 'disputatsioon', en: 'disputation' },
};
vi.mock('../../entityLabelsService', () => ({ getEntityLabelsCache: vi.fn(async () => labels) }));

import { useFilterHints, UseFilterHintsArgs } from '../useFilterHints';
import { buildDashboardSearch } from '../../searchService';
import { withCandidate } from '../candidateOptions';

type Facets = { genre_ids?: Record<string, number>; tags_ids?: Record<string, number>; type_ids?: Record<string, number> };

/** Võlts-indeks: fassetipäring vs loenduripäring; loendur = counts[filtri kood] ?? 0. */
function fakeIndex(facets: Facets, counts: Record<string, number>) {
  const search = vi.fn(async (_q: string, params: any) => {
    if (params.facets) return { hits: [], facetDistribution: facets };
    const f: string = params.filter.join(' ');
    const hit = Object.keys(counts).find(code => f.includes(code));
    return { hits: [], estimatedTotalHits: hit ? counts[hit] : 0 };
  });
  return { search } as any;
}

const base = (over: Partial<UseFilterHintsArgs> = {}): UseFilterHintsArgs => ({
  index: null, query: '', searchOptions: { collection: 'c1', lang: 'et', onlyFirstPage: true },
  scopeReady: true, lang: 'et', debounceMs: 400, ...over,
});

async function flush() {
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  await act(async () => { await vi.runAllTimersAsync(); });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useFilterHints', () => {
  it('ulatus pole valmis → ühtki päringut', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    renderHook(() => useFilterHints(base({ index, query: 'põhiki', scopeReady: false })));
    await flush();
    expect(index.search).not.toHaveBeenCalled();
  });

  it('põhiki → žanrikiip loenduriga', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    const { result } = renderHook(() => useFilterHints(base({ index, query: 'põhiki' })));
    await flush();
    expect(result.current.hints).toHaveLength(1);
    expect(result.current.hints[0]).toMatchObject({ kind: 'genre', value: 'Q3497659', label: 'Põhikiri', count: 7, sourceQuery: 'põhiki' });
  });

  it('loenduri parameetrid = searchWorks pärast vastuvõttu', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    const args = base({ index, query: 'põhiki constitu', searchOptions: { collection: 'c1', lang: 'et', onlyFirstPage: true, genre: ['Qvana'] } });
    renderHook(() => useFilterHints(args));
    await flush();
    const countCall = index.search.mock.calls.find((c: any[]) => !c[1].facets)!;
    const expected = buildDashboardSearch('constitu', withCandidate(args.searchOptions, { kind: 'genre', value: 'Q3497659' }));
    expect(countCall[0]).toBe(expected.q);
    expect(countCall[1]).toMatchObject({ filter: expected.filter, attributesToSearchOn: expected.attributesToSearchOn, matchingStrategy: expected.matchingStrategy, limit: 0 });
  });

  it('žanri asendus loenduris: vana žanrit filtris ei ole', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    renderHook(() => useFilterHints(base({ index, query: 'põhiki', searchOptions: { collection: 'c1', lang: 'et', onlyFirstPage: true, genre: ['Qvana'] } })));
    await flush();
    const countCall = index.search.mock.calls.find((c: any[]) => !c[1].facets)!;
    expect(countCall[1].filter.join(' ')).not.toContain('Qvana');
  });

  it('juba rakendatud väärtust ei pakuta (Q-kood või silt)', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    for (const applied of ['Q3497659', 'Põhikiri', 'statutes']) {
      const { result } = renderHook(() => useFilterHints(base({ index, query: 'põhiki', searchOptions: { collection: 'c1', lang: 'et', onlyFirstPage: true, genre: [applied] } })));
      await flush();
      expect(result.current.hints).toEqual([]);
    }
  });

  it('loendur 0 → kiipi pole', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, {});
    const { result } = renderHook(() => useFilterHints(base({ index, query: 'põhiki' })));
    await flush();
    expect(result.current.hints).toEqual([]);
  });

  it('vananemine: trükkimine peidab vihje kohe ja vana vihje ei ole enam „current"', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    const { result, rerender } = renderHook((a: UseFilterHintsArgs) => useFilterHints(a), { initialProps: base({ index, query: 'põhiki' }) });
    await flush();
    const old = result.current.hints[0];
    expect(old).toBeDefined();
    rerender(base({ index, query: 'põhiki x' }));
    expect(result.current.hints).toEqual([]);          // kohe, enne uut arvutust
    expect(result.current.isCurrent(old)).toBe(false);
  });

  it('vananemine: filtri, kogu või indeksi vahetus', async () => {
    const index = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    const a = base({ index, query: 'põhiki' });
    const { result, rerender } = renderHook((x: UseFilterHintsArgs) => useFilterHints(x), { initialProps: a });
    await flush();
    const old = result.current.hints[0];
    rerender({ ...a, searchOptions: { ...a.searchOptions, collection: 'c2' } });
    expect(result.current.isCurrent(old)).toBe(false);
    rerender({ ...a, index: fakeIndex({}, {}) });
    expect(result.current.isCurrent(old)).toBe(false);
  });

  it('indeksi (tokeni) vahetus → sõnavara päritakse uuesti', async () => {
    const i1 = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    const i2 = fakeIndex({ genre_ids: { Q3497659: 7 } }, { Q3497659: 7 });
    const { rerender } = renderHook((x: UseFilterHintsArgs) => useFilterHints(x), { initialProps: base({ index: i1, query: 'põhiki' }) });
    await flush();
    rerender(base({ index: i2, query: 'põhiki' }));
    await flush();
    expect(i2.search.mock.calls.some((c: any[]) => c[1].facets)).toBe(true);
  });

  it('partiid: 7 kandidaati, esimesed 6 tühjad → seitsmes kuvatakse', async () => {
    for (let n = 1; n <= 7; n++) labels[`Qk${n}`] = { et: `kirjad${n}` };
    const tags = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`Qk${i + 1}`, 100 - i]));
    const index = fakeIndex({ tags_ids: tags }, { Qk7: 4 });
    const { result } = renderHook(() => useFilterHints(base({ index, query: 'kirjad' })));
    await flush();
    expect(result.current.hints.map(h => h.value)).toEqual(['Qk7']);
  });

  it('aasta: 1702 constitu', async () => {
    const index = fakeIndex({}, {});
    index.search.mockImplementation(async (_q: string, p: any) =>
      p.facets ? { hits: [], facetDistribution: {} } : { hits: [], estimatedTotalHits: 3 });
    const { result } = renderHook(() => useFilterHints(base({ index, query: '1702 constitu' })));
    await flush();
    expect(result.current.hints[0]).toMatchObject({ kind: 'year', value: '1702', count: 3, remainingQuery: 'constitu' });
  });
});
```

- [ ] **Samm 2: käivita, et näha kukkumist**

Run: `npx vitest run src/services/filterHints/__tests__/useFilterHints.test.tsx`
Oodatud: FAIL (moodul puudub)

- [ ] **Samm 3: teostus**

```ts
// src/services/filterHints/useFilterHints.ts
/**
 * Filtrivihjed avalehe otsingureale (#605, spec 2026-10-15).
 *
 * - Ei tee päringut enne, kui ulatus on valmis (ADR 0042).
 * - Sõnavara = ulatuse fassetikoodid + registri sildid; vahemälu elab hooki
 *   SEES ja selle võti on indeks (vahetub tokeniga) + valiku sisu.
 * - Loendur = SAMA päring, mis vastuvõtu järel jookseb (buildDashboardSearch +
 *   withCandidate), partiidena eeljärjestuses, kuni 3 positiivset.
 * - Iga vihje kannab lähteolekut; vananenud vihjet ei renderdata ega rakendata.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Index } from 'meilisearch';
import { buildDashboardSearch, getScopeFacetCodes, DashboardSearchOptions } from '../searchService';
import { getEntityLabelsCache } from '../entityLabelsService';
import { isAbortError } from '../../utils/isAbortError';
import { isVuttId } from '../../utils/qcodeUtils';
import { normalizeForSearch } from '../../utils/diacritics';
import { detectFilterHints, FilterHintCandidate, VocabEntry } from './detectFilterHints';
import { withCandidate } from './candidateOptions';

export interface FilterHint extends FilterHintCandidate {
  count: number;
  sourceQuery: string;
  stateKey: string;
}

export interface UseFilterHintsArgs {
  index: Index | null;
  query: string;
  searchOptions: DashboardSearchOptions;
  scopeReady: boolean;
  lang: 'et' | 'en';
  debounceMs?: number;
}

const MAX_HINTS = 3;
const BATCH = 3;
const MAX_BATCHES = 4;

// Indeksi identiteet → number (WeakMap ei hoia kasutajaandmeid ega takista GC-d)
const indexIds = new WeakMap<object, number>();
let nextIndexId = 1;
const indexKey = (index: object | null) => {
  if (!index) return 0;
  if (!indexIds.has(index)) indexIds.set(index, nextIndexId++);
  return indexIds.get(index)!;
};

/** Kõik, mis muudab loendureid või rakendamist — v.a päring ise. */
export function hintsStateKey(index: object | null, o: DashboardSearchOptions): string {
  const { signal: _s, offset: _o, limit: _l, ...rest } = o;
  return `${indexKey(index)}|${JSON.stringify(rest)}`;
}

const scopeKey = (o: DashboardSearchOptions) => JSON.stringify(o.collection ?? null);

/** Kas kandidaat on juba rakendatud? Võrdleb Q-koodi JA sildiga (URL võib kanda silti). */
function isApplied(c: FilterHintCandidate, o: DashboardSearchOptions, vocab: VocabEntry[]): boolean {
  if (c.kind === 'year') return String(o.yearStart ?? '') === c.value && String(o.yearEnd ?? '') === c.value;
  const current = c.kind === 'genre' ? o.genre : c.kind === 'type' ? o.type : o.teoseTags;
  if (!current?.length) return false;
  const entry = vocab.find(v => v.kind === c.kind && v.id === c.value);
  const names = new Set([c.value, ...Object.values(entry?.labels || {})].filter(Boolean).map(s => normalizeForSearch(s!)));
  return current.some(v => names.has(normalizeForSearch(v)));
}

export function useFilterHints({ index, query, searchOptions, scopeReady, lang, debounceMs = 400 }: UseFilterHintsArgs) {
  const [hints, setHints] = useState<FilterHint[]>([]);
  const vocabCache = useRef<{ key: string; vocab: VocabEntry[] } | null>(null);
  const stateKey = hintsStateKey(index, searchOptions);
  const sKey = `${indexKey(index)}|${scopeKey(searchOptions)}`;

  useEffect(() => {
    // Tühja päringu korral pole midagi arvutada; vanad vihjed peidab isCurrent-filter
    if (!index || !scopeReady || !query.trim()) return;
    const controller = new AbortController();
    const { signal } = controller;
    const timer = setTimeout(async () => {
      try {
        // 1. Sõnavara (vahemälust, kui ulatus + indeks samad)
        let vocab = vocabCache.current?.key === sKey ? vocabCache.current.vocab : null;
        if (!vocab) {
          const [codes, registry] = await Promise.all([
            getScopeFacetCodes(index, searchOptions.collection, signal),
            getEntityLabelsCache(),
          ]);
          vocab = [];
          const add = (kind: VocabEntry['kind'], map: Record<string, number>) => {
            for (const [id, count] of Object.entries(map)) {
              if (isVuttId(id)) continue;
              const l = registry[id];
              if (!l?.et && !l?.en) continue; // ilma registrisildita koodi ei pakuta
              vocab!.push({ kind, id, labels: { et: l.et, en: l.en }, facetCount: count });
            }
          };
          add('genre', codes.genre_ids); add('tag', codes.tags_ids); add('type', codes.type_ids);
          vocabCache.current = { key: sKey, vocab };
        }

        // 2. Kandidaadid eeljärjestuses, juba rakendatud välja
        const ranked = detectFilterHints(query, vocab, lang).filter(c => !isApplied(c, searchOptions, vocab!));

        // 3. Loendurid partiidena, kuni MAX_HINTS positiivset
        const found: FilterHint[] = [];
        for (let b = 0; b < MAX_BATCHES && found.length < MAX_HINTS; b++) {
          const batch = ranked.slice(b * BATCH, (b + 1) * BATCH);
          if (batch.length === 0) break;
          const counts = await Promise.all(batch.map(async c => {
            const core = buildDashboardSearch(c.remainingQuery, withCandidate(searchOptions, c));
            const r = await index.search(core.q, {
              filter: core.filter, attributesToSearchOn: core.attributesToSearchOn,
              matchingStrategy: core.matchingStrategy, limit: 0,
            }, { signal });
            return (r as any).totalHits ?? r.estimatedTotalHits ?? 0;
          }));
          batch.forEach((c, i) => {
            if (counts[i] > 0 && found.length < MAX_HINTS) found.push({ ...c, count: counts[i], sourceQuery: query, stateKey });
          });
        }
        if (!signal.aborted) setHints(found);
      } catch (e) {
        // Vihje on parim-pingutus: viga ei sega otsingut ega lähe vearingi
        if (!signal.aborted && !isAbortError(e)) setHints([]);
      }
    }, debounceMs);
    return () => { clearTimeout(timer); controller.abort(); };
    // searchOptions on stateKey-s; objekti identiteet ei tohi effecti käivitada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, scopeReady, query, stateKey, sKey, lang, debounceMs]);

  const isCurrent = useCallback(
    (h: FilterHint) => h.sourceQuery === query && h.stateKey === stateKey,
    [query, stateKey],
  );

  // Vananenud vihjed peidetakse KOHE, mitte alles uue arvutuse lõpus
  return { hints: hints.filter(isCurrent), isCurrent };
}
```

Märkus `eslint-disable` kohta: `lint:ci` lävi on `--max-warnings 42`. Kommentaariga keelamine ei lisa hoiatust. Kontrolli, et `npm run lint:ci` hoiatuste arv ei kasva.

- [ ] **Samm 4: käivita testid**

Run: `npx vitest run src/services/filterHints` ja `npm run typecheck`
Oodatud: PASS (kõik 11 hooki testi + ülesande 1 testid)

- [ ] **Samm 5: commit**

```bash
git branch --show-current
git add src/services/filterHints/useFilterHints.ts src/services/filterHints/__tests__/useFilterHints.test.tsx
git commit -m "feat(otsing): useFilterHints — sõnavara, partiiloendurid, vananemine (#605)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Ülesanne 5: `FilterHintChip`, kiibirida ja i18n

**Failid:**
- Muuda: `src/components/workFilters/WorkFilterChips.tsx`
- Muuda: `tailwind.config.js` (`theme.extend`)
- Muuda: `src/locales/et/dashboard.json`, `src/locales/en/dashboard.json`
- Test: `src/components/workFilters/__tests__/FilterHintChip.test.tsx`

**Liidesed:**
- Annab:
  ```ts
  export const FilterHintChip: React.FC<{ kind: string; label: string; count: number; onAccept: () => void }>;
  // FilterChip saab valikulise prop'i: highlight?: boolean
  // WorkFilterChips props: + hints?: React.ReactNode; + hasApplied?: boolean (vaikimisi true); + highlight?: { kind: 'genre' | 'tag' | 'type'; value: string; label: string } | null
  ```

- [ ] **Samm 1: kirjuta kukkuv test**

```tsx
/** @vitest-environment jsdom */
// src/components/workFilters/__tests__/FilterHintChip.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FilterHintChip, FilterChip } from '../WorkFilterChips';

describe('FilterHintChip', () => {
  it('kollane punktiir, liik, silt ja loendur; klikk = onAccept', () => {
    const onAccept = vi.fn();
    render(<FilterHintChip kind="Žanr" label="Põhikiri" count={7} onAccept={onAccept} />);
    const btn = screen.getByRole('button', { name: 'dashboard:filterHints.addFilter: Žanr Põhikiri' });
    expect(btn.className).toContain('border-dashed');
    expect(btn.className).toContain('border-amber-400');
    expect(btn.textContent).toContain('(7)');
    fireEvent.click(btn);
    expect(onAccept).toHaveBeenCalledOnce();
  });
});

describe('FilterChip highlight', () => {
  it('highlight lisab sähvatuse animatsiooni', () => {
    const { container } = render(<FilterChip kind="Žanr" label="Põhikiri" onRemove={() => {}} highlight />);
    expect((container.firstChild as HTMLElement).className).toContain('animate-hint-flash');
  });
});
```

- [ ] **Samm 2: käivita, et näha kukkumist**

Run: `npx vitest run src/components/workFilters/__tests__/FilterHintChip.test.tsx`
Oodatud: FAIL (`FilterHintChip` puudub)

- [ ] **Samm 3: teostus**

`WorkFilterChips.tsx`: `FilterChip` saab `highlight` prop'i. Asenda komponendi signatuur ja välimine `<span>`:

```tsx
export const FilterChip: React.FC<{ kind: string; label: React.ReactNode; onRemove: () => void; highlight?: boolean }> = ({ kind, label, onRemove, highlight }) => {
  const { t } = useTranslation('common');
  return (
    <span className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 bg-primary-50 text-primary-800 border border-primary-100 rounded-full text-sm max-w-full${highlight ? ' animate-hint-flash' : ''}`}>
```

(ülejäänud `FilterChip` jääb samaks)

Lisa `FilterChip`-i järele:

```tsx
/**
 * Filtrivihje (#605): PAKUTUD, veel rakendamata filter. Kollane punktiir =
 * VUTT-is „muutus / tähelepanu"; vastuvõtu järel asendub tavalise sinise
 * FilterChip-iga samas kohas.
 */
export const FilterHintChip: React.FC<{ kind: string; label: string; count: number; onAccept: () => void }> = ({ kind, label, count, onAccept }) => {
  const { t } = useTranslation('dashboard');
  return (
    <button
      type="button"
      onClick={onAccept}
      aria-label={`${t('dashboard:filterHints.addFilter')}: ${kind} ${label}`}
      title={t('dashboard:filterHints.addFilter')}
      className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-white text-amber-800 border-[1.5px] border-dashed border-amber-400 rounded-full text-sm hover:bg-amber-50 max-w-full"
    >
      <span aria-hidden="true">+</span>
      <span className="text-amber-700 text-xs shrink-0">{kind}:</span>
      <span className="truncate">{label}</span>
      <span className="text-gray-400 text-xs shrink-0">({count})</span>
    </button>
  );
};
```

Asenda `WorkFilterChipsProps` ja komponent:

```tsx
interface WorkFilterChipsProps {
  model: WorkFilterModel;
  /** Lehe enda filtrid (aasta, autor, respondens, trükkal), mis ei ole mudelis. */
  children?: React.ReactNode;
  onClearAll: () => void;
  /** Filtrivihjed (#605) — renderdatakse PÄRAST rakendatud kiipe. */
  hints?: React.ReactNode;
  /** Kas on rakendatud filtreid (eraldaja + „Tühjenda"). Vaikimisi tõene. */
  hasApplied?: boolean;
  /** Äsja vastuvõetud vihje → selle kiip sähvatab korra. */
  highlight?: { kind: 'genre' | 'tag' | 'type'; value: string; label: string } | null;
}

const WorkFilterChips: React.FC<WorkFilterChipsProps> = ({ model, children, onClearAll, hints, hasApplied = true, highlight }) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { input, effectiveSelectedGenre, effectiveSelectedType, effectiveSelectedTags, selectedGenreItemValue, selectedTypeItemValue, languageLabel, tagLabel, toggleTag } = model;
  const { genreIdMap, typeIdMap, selectedStatus, selectedLanguages, onGenreChange, onTypeChange, onStatusChange, onLanguagesChange } = input;
  // Valitud väärtus võib olla Q-kood VÕI silt (keelevahetuse iseparandus) — võrdle mõlemat
  const isHi = (kind: 'genre' | 'tag' | 'type', ...vals: (string | null | undefined)[]) =>
    !!highlight && highlight.kind === kind && vals.some(v => v === highlight.value || v === highlight.label);

  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      {children}
      {effectiveSelectedType && (
        <FilterChip kind={t('dashboard:filters.type')} label={typeIdMap?.[effectiveSelectedType] || effectiveSelectedType}
          onRemove={() => onTypeChange(null)} highlight={isHi('type', effectiveSelectedType, selectedTypeItemValue, typeIdMap?.[effectiveSelectedType])} />
      )}
      {effectiveSelectedGenre && (
        <FilterChip kind={t('dashboard:filters.genre')} label={genreIdMap?.[effectiveSelectedGenre] || effectiveSelectedGenre}
          onRemove={() => onGenreChange(null)} highlight={isHi('genre', effectiveSelectedGenre, selectedGenreItemValue, genreIdMap?.[effectiveSelectedGenre])} />
      )}
      {effectiveSelectedTags.map(tag => (
        <FilterChip key={tag} kind={t('dashboard:filters.tags')} label={tagLabel(tag)} onRemove={() => toggleTag(tag)}
          highlight={isHi('tag', tag, tagLabel(tag))} />
      ))}
      {selectedLanguages.map(code => (
        <FilterChip key={code} kind={t('dashboard:filters.languages')} label={languageLabel(code)}
          onRemove={() => onLanguagesChange(selectedLanguages.filter(l => l !== code))} />
      ))}
      {selectedStatus && (
        <FilterChip kind={t('dashboard:filters.status')} label={t(`common:status.${selectedStatus}`)} onRemove={() => onStatusChange(null)} />
      )}
      {hasApplied && hints && <span className="w-px h-[18px] bg-gray-200" aria-hidden="true" />}
      {hints}
      {hasApplied && (
        <button type="button" onClick={onClearAll} className="text-sm text-gray-500 hover:text-red-600 ml-auto">
          {t('common:filterPanel.clearAll')}
        </button>
      )}
    </div>
  );
};
```

(„Tühjenda" klass muutub `ml-1` → `ml-auto`: nupp liigub rea paremasse serva, spec A2.)

`tailwind.config.js`, `theme.extend` sees:

```js
      keyframes: {
        'hint-flash': {
          '0%': { boxShadow: '0 0 0 3px #fde68a' },   // amber-200
          '100%': { boxShadow: '0 0 0 0 rgba(253,230,138,0)' },
        },
      },
      animation: {
        // Filtrivihje vastuvõtt (#605): kiip sähvatab korra mountimisel
        'hint-flash': 'hint-flash 600ms ease-out 1',
      },
```

(Kui `theme.extend`-is on juba `keyframes`/`animation`, lisa võtmed olemasolevatesse objektidesse.)

i18n, `src/locales/et/dashboard.json`, ülemisele tasemele `"filters"`-i järele:
```json
  "filterHints": {
    "addFilter": "Lisa filter"
  }
```
`src/locales/en/dashboard.json`:
```json
  "filterHints": {
    "addFilter": "Add filter"
  }
```

- [ ] **Samm 4: käivita testid**

Run: `npx vitest run src/components/workFilters src/locales` ja `npm test -- localeParity translationKeysResolve` ja `npm run typecheck`
Oodatud: PASS

- [ ] **Samm 5: commit**

```bash
git branch --show-current
git add src/components/workFilters/ tailwind.config.js src/locales/et/dashboard.json src/locales/en/dashboard.json
git commit -m "feat(filtrid): FilterHintChip, kiibirida vihjetega, sähvatus (#605)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Ülesanne 6: avalehe ühendus

**Failid:**
- Uus: `src/services/analytics.ts`
- Uus: `src/pages/dashboardQuerySync.ts`
- Muuda: `src/pages/Dashboard.tsx` (otsingu effect ~476–538, URL-i sünk ~365–473, kiibirida ~790–813)
- Test: `src/pages/__tests__/dashboardQuerySync.test.ts`, `src/services/__tests__/analytics.test.ts`

**Liidesed:**
- Kasutab: `useFilterHints`, `FilterHint` (ülesanne 4); `FilterHintChip`, `WorkFilterChips` uued prop'id (ülesanne 5); `filterModel.applyWorkFilter` (ülesanne 3)
- Annab:
  ```ts
  export function trackEvent(name: string, data?: Record<string, string | number>): void;      // analytics.ts
  export function sortAfterQueryChange(sort: string, newQuery: string): string;                // dashboardQuerySync.ts
  ```

- [ ] **Samm 1: kirjuta kukkuvad testid**

```ts
// src/pages/__tests__/dashboardQuerySync.test.ts
import { describe, it, expect } from 'vitest';
import { sortAfterQueryChange } from '../dashboardQuerySync';

describe('sortAfterQueryChange', () => {
  it('tühjenenud päring + relevance → year_asc (ka vihje vastuvõtul, tahtlik)', () => {
    expect(sortAfterQueryChange('relevance', '')).toBe('year_asc');
  });
  it('tekst jääb → sort ei muutu', () => {
    expect(sortAfterQueryChange('relevance', 'constitu')).toBe('relevance');
  });
  it('muu sort ei muutu ka tühjenemisel', () => {
    expect(sortAfterQueryChange('az', '')).toBe('az');
  });
});
```

```ts
// src/services/__tests__/analytics.test.ts
/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { trackEvent } from '../analytics';

afterEach(() => { delete (window as any).umami; });

describe('trackEvent', () => {
  it('kutsub umami.track-i', () => {
    const track = vi.fn();
    (window as any).umami = { track };
    trackEvent('filter-hint-accept', { kind: 'genre' });
    expect(track).toHaveBeenCalledWith('filter-hint-accept', { kind: 'genre' });
  });
  it('umami puudub → vaikne no-op', () => {
    expect(() => trackEvent('x')).not.toThrow();
  });
  it('umami viskab → neelatakse', () => {
    (window as any).umami = { track: () => { throw new Error('boom'); } };
    expect(() => trackEvent('x')).not.toThrow();
  });
});
```

Run: `npx vitest run src/pages/__tests__/dashboardQuerySync.test.ts src/services/__tests__/analytics.test.ts`
Oodatud: FAIL (moodulid puuduvad)

- [ ] **Samm 2: teostus abimoodulitele**

```ts
// src/pages/dashboardQuerySync.ts
/**
 * Avalehe päringu ↔ sort reegel, eraldatud URL-i sünkrooniva effecti seest,
 * et see oleks testitav (#605: vihje vastuvõtt võib päringu tühjendada).
 * Ilma päringuta pole relevantsusel tähendust → aasta järgi.
 */
export function sortAfterQueryChange(sort: string, newQuery: string): string {
  return !newQuery && sort === 'relevance' ? 'year_asc' : sort;
}
```

```ts
// src/services/analytics.ts
/**
 * Umami sündmus (skript laeb index.html-is). Analüütika ei tohi KUNAGI
 * rakendust murda: puuduv skript (adblock, dev) või viga neelatakse.
 */
export function trackEvent(name: string, data?: Record<string, string | number>): void {
  try {
    (window as any).umami?.track?.(name, data);
  } catch {
    // tahtlikult vaikne
  }
}
```

Run: sama käsk nagu sammus 1. Oodatud: PASS.

- [ ] **Samm 3: Dashboard, URL-i sünk kasutab `sortAfterQueryChange`-i**

`Dashboard.tsx` URL-i sünkrooniva effecti `else`-harus (praegu „Kui otsing tühjendatakse ja sort on relevantsus, muuda aasta järgi"):

```tsx
        else {
          newParams.delete('q');
          // Kui otsing tühjendatakse ja sort on relevantsus, muuda aasta järgi
          const nextSort = sortAfterQueryChange(sort, '');
          if (nextSort !== sort) {
            setSort(nextSort);
            newParams.set('sort', nextSort);
          }
        }
```

Lisa import: `import { sortAfterQueryChange } from './dashboardQuerySync';`

- [ ] **Samm 4: Dashboard, ühine `searchOptions`**

Otsingu effecti ette (enne `useEffect(() => { if (!index || collectionsLoading || !scopeReady) return;`):

```tsx
  // Otsinguvalikud ÜHES kohas: sama objekt läheb searchWorks-ile JA filtrivihje
  // loenduritele (#605) — kaks koopiat lahkneksid. Lehekülg/signaal lisab effect.
  const searchOptions = useMemo<DashboardSearchOptions>(() => ({
    yearStart: yearStart || undefined,
    yearEnd: yearEnd || undefined,
    sort,
    author: authorParam || undefined,
    respondens: respondensParam || undefined,
    printer: printerParam || undefined,
    workStatus: statusParam || undefined,
    teoseTags: selectedTags.length > 0 ? selectedTags : undefined,
    genre: selectedGenre ? [selectedGenre] : undefined,
    type: selectedType ? [selectedType] : undefined,
    languages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
    collection: scope,
    onlyFirstPage: sort !== 'recent',
    lang: getLangCode(i18n.language),
  }), [yearStart, yearEnd, sort, authorParam, respondensParam, printerParam, statusParam, selectedTags, selectedGenre, selectedType, selectedLanguages, scope, i18n.language]);
```

Effectis asenda `searchWorks(index, queryParam, { … })` objekt:

```tsx
        const result = await searchWorks(index, queryParam, {
          ...searchOptions,
          offset: (currentPage - 1) * ITEMS_PER_PAGE,
          limit: ITEMS_PER_PAGE,
          signal: controller.signal
        });
```

Kustuta effectis read `const start = yearStart || undefined;` ja `const end = yearEnd || undefined;`. Effecti deps: asenda `scope, queryParam, yearStart, yearEnd, sort, authorParam, respondensParam, printerParam, statusParam, selectedTags, selectedGenre, selectedType, selectedLanguages, currentPage, refreshCounter, i18n.language` loendiga `searchOptions, queryParam, currentPage, refreshCounter`. Ülejäänud (`index, collectionsLoading, scopeReady`) jäävad. Impordi `DashboardSearchOptions` `searchService`-ist ja `useMemo`, kui seda veel pole.

- [ ] **Samm 5: Dashboard, hook ja vastuvõtt**

`searchOptions`-i järele:

```tsx
  // Filtrivihjed otsingureal (#605)
  const { hints: filterHints, isCurrent: isHintCurrent } = useFilterHints({
    index, query: inputValue, searchOptions, scopeReady, lang: getLangCode(i18n.language) as 'et' | 'en',
    debounceMs: SEARCH_DEBOUNCE_MS,
  });
  const [acceptedHint, setAcceptedHint] = useState<FilterHint | null>(null);

  // Vastuvõtt = SAMA rakendaja, mis külgribal (applyWorkFilter / aastaväljad).
  // Vananenud vihje (kasutaja trükkis vahepeal) on no-op: ei tohi uut teksti üle kirjutada.
  const acceptHint = (h: FilterHint) => {
    if (!isHintCurrent(h)) return;
    if (h.kind === 'year') { setYearStart(h.value); setYearEnd(h.value); }
    else filterModel.applyWorkFilter(h.kind, h.value);
    setInputValue(h.remainingQuery);
    setAcceptedHint(h);
    trackEvent('filter-hint-accept', { kind: h.kind });
  };
```

`filterModel`-i on vaja enne `acceptHint`-i. Paiguta plokk `filterModel = useWorkFilterModel(...)` järele (praegu ~rida 343). `searchOptions` peab samuti olema seal: tõsta sammu 4 `useMemo` samuti `filterModel`-i järele, sest ta sõltub ainult olekust, mitte effectidest.

Sähvatus kehtib ainult seni, kuni päring on vastuvõtu järgne. See on tuletatud väärtus, mitte effect, mis olekut nullib (`setState` effectis lisaks lint-hoiatuse):

```tsx
  // Sähvatus ainult vastuvõtu hetkel: järgmine päringumuutus lõpetab selle
  const flashHint = acceptedHint && inputValue === acceptedHint.remainingQuery ? acceptedHint : null;
```

Impordid: `useFilterHints, FilterHint` failist `../services/filterHints/useFilterHints`, `trackEvent` failist `../services/analytics`, `FilterHintChip` failist `../components/workFilters/WorkFilterChips`.

- [ ] **Samm 6: Dashboard, kiibirida**

Asenda `{hasActiveFilters && ( <WorkFilterChips …> … </WorkFilterChips> )}` järgmisega:

```tsx
              {/* Aktiivsed filtrid + filtrivihjed (#605) samas reas; vihjed rakendatute JÄREL */}
              {(hasActiveFilters || filterHints.length > 0) && (
                <WorkFilterChips
                  model={filterModel}
                  onClearAll={clearAllFilters}
                  hasApplied={hasActiveFilters}
                  highlight={flashHint && flashHint.kind !== 'year' ? { kind: flashHint.kind, value: flashHint.value, label: flashHint.label } : null}
                  hints={filterHints.length > 0 ? filterHints.map(h => (
                    <FilterHintChip
                      key={`${h.kind}:${h.value}`}
                      kind={h.kind === 'year' ? t('common:labels.year')
                        : t(`dashboard:filters.${h.kind === 'tag' ? 'tags' : h.kind}`)}
                      label={h.label}
                      count={h.count}
                      onAccept={() => acceptHint(h)}
                    />
                  )) : undefined}
                >
                  {(yearStart || yearEnd) && (
                    <FilterChip
                      kind={t('common:labels.year')}
                      label={`${yearStart || '…'} – ${yearEnd || '…'}`}
                      onRemove={() => { setYearStart(''); setYearEnd(''); }}
                      highlight={flashHint?.kind === 'year'}
                    />
                  )}
                  {/* author / respondens / printer kiibid jäävad muutmata */}
                </WorkFilterChips>
              )}
```

Kommentaari `{/* author / respondens / printer … */}` kohale jäta olemasolevad kolm `FilterChip`-plokki (`authorParam`, `respondensParam`, `printerParam`) muutmata kujul.

- [ ] **Samm 7: väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Oodatud: kõik PASS, lint-hoiatuste arv ei ole kasvanud.

- [ ] **Samm 8: commit**

```bash
git branch --show-current
git add src/pages/Dashboard.tsx src/pages/dashboardQuerySync.ts src/pages/__tests__/dashboardQuerySync.test.ts src/services/analytics.ts src/services/__tests__/analytics.test.ts
git commit -m "feat(avaleht): filtrivihjed otsingureal (#605)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Ülesanne 7: käsitsi kontroll tootmisandmetega

**Failid:** puuduvad (kontroll). Leiud lähevad parandusena õigesse ülesandesse.

- [ ] **Samm 1: tunnel + dev-server**

Eraldi aknas: `ssh -N -L 7700:localhost:7700 -L 8001:localhost:8001 -L 8002:localhost:8002 vutt`, seejärel `npm run dev` (localhost:3000). **Ära logi sisse**: salvestus läheks tootmisse. Vihjed on lugemistoiming.

- [ ] **Samm 2: stsenaariumid**

Kogu „Universitas Dorpatensis" valitud ja ka „kõik":
1. `põhiki` → kiip „+ Žanr: Põhikiri (7)". Klõps: kiip jääb kohale, muutub siniseks ja sähvatab, päring tühjeneb, sort läheb `year_asc`-iks, URL-is `genre=Q3497659`. Võrdle sama valikuga külgribal: URL peab olema identne.
2. `1702 constitu` → aastakiip (kui 1702 teoseid on) ja klõpsu järel päring `constitu`, URL-is `ys=1702&ye=1702`.
3. `käsikiri` → tüübikiip. `disputa` → žanrikiip. `loengukat` → žanrikiip „Loengukataloog".
4. Žanr „Disputatsioon" on valitud ja kasutaja trükib `põhiki`: kiip pakub „Põhikiri" ja loendur on 7, mitte 0.
5. Trüki `põhiki`, oota kiipi, trüki kohe edasi `põhikiri x`: kiip kaob kohe.
6. `"oratio panegyr"` → kiipi ei ole.
7. Mobiil 390 px (iframe, vt mälu `feedback_mobiilivaate_testimine`): rida murdub, „Tühjenda" on näha.
8. Töökollektsioon (`s:<id>`): enne loendi laadimist päringut ei tehta (Network-vaade) ja pakutakse ainult kogu teoseid.

- [ ] **Samm 3: kirjuta tulemused PR-i kirjeldusse** (iga stsenaarium OK või leid koos parandusega).
