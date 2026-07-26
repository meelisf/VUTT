import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('../meiliService', () => ({
  checkMixedContent: vi.fn(),
  normalizeWork: vi.fn((hit) => hit),
  normalizeContentSearchHit: vi.fn((hit) => hit),
}));

vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images',
  FILE_API_URL: '/api/files',
}));

import { searchContent } from '../searchService';

const mockIndex = { search: mockSearch } as any;

/** Teosetasandi facet-päring: tühi query + lehekylje_number = 1 filter. */
function isWorkLevelQuery(params: any) {
  return Array.isArray(params?.filter)
    && params.filter.some((f: string) => String(f).includes('lehekylje_number = 1'));
}

function isPageCountQuery(params: any) {
  return params?.limit === 0 && params?.facets?.includes('work_id') && !isWorkLevelQuery(params);
}

interface MockOpts {
  workCounts: Record<string, number>;          // work_id facet: teos → lehti
  workFacets?: Record<string, Record<string, number>>;  // teosetasandi facetid
  workFacetsByBatch?: Record<string, Record<string, number>>[]; // partiide kaupa
}

function mockQueries(opts: MockOpts) {
  let batch = 0;
  mockSearch.mockImplementation((_q: string, params: any = {}) => {
    if (isWorkLevelQuery(params)) {
      const dist = opts.workFacetsByBatch
        ? (opts.workFacetsByBatch[batch++] || {})
        : (opts.workFacets || {});
      return Promise.resolve({ hits: [], estimatedTotalHits: 0, facetDistribution: dist });
    }
    if (isPageCountQuery(params)) {
      return Promise.resolve({
        hits: [],
        estimatedTotalHits: Object.values(opts.workCounts).reduce((a, b) => a + b, 0),
        facetDistribution: { work_id: opts.workCounts },
      });
    }
    // Kuvatavad tulemused (distinct)
    return Promise.resolve({
      hits: [{ id: 'p1', work_id: Object.keys(opts.workCounts)[0] || 'w1' }],
      estimatedTotalHits: 10,
    });
  });
}

const searchCalls = () => mockSearch.mock.calls.map(([, params]) => params ?? {});

beforeEach(() => mockSearch.mockReset());

describe('searchContent teosepõhised facetid', () => {
  it('võtab facetid teosetasandi päringust, mitte esimesest 5000 hitist', async () => {
    mockQueries({
      workCounts: { w1: 9, w2: 3 },
      workFacets: { genre_ids: { Q1: 2 }, type_ids: { Q9: 1 }, tags_ids: { Q5: 2 } },
    });

    const res = await searchContent(mockIndex, 'tartu', 1, {});

    expect(res.facetDistribution?.['genre_ids']).toEqual({ Q1: 2 });
    expect(res.facetDistribution?.['type_ids']).toEqual({ Q9: 1 });
    expect(res.facetDistribution?.['tags_ids']).toEqual({ Q5: 2 });
  });

  it('küsib teosetasandi facetid ühelt dokumendilt teose kohta', async () => {
    mockQueries({ workCounts: { w1: 9, w2: 3 }, workFacets: {} });

    await searchContent(mockIndex, 'tartu', 1, {});

    const workQuery = searchCalls().find(isWorkLevelQuery);
    expect(workQuery).toBeDefined();
    expect(workQuery.limit).toBe(0);
    const filter = (workQuery.filter as string[]).join(' AND ');
    expect(filter).toContain('work_id IN ["w1", "w2"]');
    expect(filter).toContain('lehekylje_number = 1');
  });

  it('ei tee enam 5000-hiti statistikapäringut', async () => {
    mockQueries({ workCounts: { w1: 1 }, workFacets: {} });

    await searchContent(mockIndex, 'tartu', 1, {});

    expect(searchCalls().every((p) => (p.limit ?? 0) < 1000)).toBe(true);
    expect(mockSearch).toHaveBeenCalledTimes(3);
  });

  it('liidab respondens_names autorite facetiga, nagu varem', async () => {
    mockQueries({
      workCounts: { w1: 1, w2: 1 },
      workFacets: { author_names: { Luden: 2 }, respondens_names: { Luden: 1, Virginius: 3 } },
    });

    const res = await searchContent(mockIndex, 'tartu', 1, {});

    expect(res.facetDistribution?.['author_names']).toEqual({ Luden: 3, Virginius: 3 });
  });

  it('säilitab work_id faceti, mida tulemuste vaade kasutab lehekülgede arvuks', async () => {
    mockQueries({ workCounts: { w1: 9, w2: 3 }, workFacets: {} });

    const res = await searchContent(mockIndex, 'tartu', 1, {});

    expect(res.facetDistribution?.['work_id']).toEqual({ w1: 9, w2: 3 });
  });

  it('jagab suure teoste hulga partiideks ja liidab loendurid', async () => {
    const workCounts: Record<string, number> = {};
    for (let i = 0; i < 1500; i++) workCounts[`w${i}`] = 1;
    mockQueries({
      workCounts,
      workFacetsByBatch: [
        { genre_ids: { Q1: 800, Q2: 200 } },
        { genre_ids: { Q1: 400, Q3: 100 } },
      ],
    });

    const res = await searchContent(mockIndex, 'de', 1, {});

    expect(searchCalls().filter(isWorkLevelQuery)).toHaveLength(2);
    expect(res.facetDistribution?.['genre_ids']).toEqual({ Q1: 1200, Q2: 200, Q3: 100 });
  });

  it('facet-päringu tõrge ei võta tulemusi maha', async () => {
    mockSearch.mockImplementation((_q: string, params: any = {}) => {
      if (isWorkLevelQuery(params)) return Promise.reject(new Error('filter too long'));
      if (isPageCountQuery(params)) {
        return Promise.resolve({ hits: [], estimatedTotalHits: 12, facetDistribution: { work_id: { w1: 9, w2: 3 } } });
      }
      return Promise.resolve({ hits: [{ id: 'p1', work_id: 'w1' }], estimatedTotalHits: 12 });
    });

    const res = await searchContent(mockIndex, 'tartu', 1, {});

    expect(res.totalWorks).toBe(2);
    expect(res.hits).toHaveLength(1);
    expect(res.facetDistribution?.['work_id']).toEqual({ w1: 9, w2: 3 });
  });

  it('laseb katkestuse veal läbi, et vana otsing ei kirjutaks uut üle', async () => {
    mockSearch.mockImplementation((_q: string, params: any = {}) => {
      if (isWorkLevelQuery(params)) {
        return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      }
      if (isPageCountQuery(params)) {
        return Promise.resolve({ hits: [], estimatedTotalHits: 1, facetDistribution: { work_id: { w1: 1 } } });
      }
      return Promise.resolve({ hits: [], estimatedTotalHits: 1 });
    });

    await expect(searchContent(mockIndex, 'tartu', 1, {})).rejects.toThrow();
  });

  it('ei tee teosetasandi päringut, kui ükski teos ei vastanud', async () => {
    mockQueries({ workCounts: {}, workFacets: {} });

    const res = await searchContent(mockIndex, 'xyzzy', 1, {});

    expect(searchCalls().some(isWorkLevelQuery)).toBe(false);
    expect(res.totalWorks).toBe(0);
  });
});
