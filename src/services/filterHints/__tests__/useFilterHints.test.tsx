/** @vitest-environment jsdom */
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
