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

import { searchWorks, buildDashboardSearch, getScopeFacetCodes } from '../searchService';
import { withCandidate } from '../filterHints/candidateOptions';
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
  return { q: query, filter: params.filter, attributesToSearchOn: params.attributesToSearchOn, matchingStrategy: params.matchingStrategy,
    ...(params.distinct ? { distinct: params.distinct } : {}) };
}

describe('searchWorks päringu tuum (pinnitud enne eraldamist)', () => {
  it('rikas valik', async () => {
    expect(await sentParams('Schluß constitu', rich)).toMatchInlineSnapshot(`
      {
        "attributesToSearchOn": [
          "title",
          "title_en",
          "title_original",
          "authors_text",
          "part_persons_text",
          "tags_search",
          "genre_search",
        ],
        "filter": [
          "lehekylje_number = 1",
          "year_end >= 1690",
          "year_start <= 1700",
          "(author_names = "Ludenius" OR respondens_names = "Ludenius")",
          "teose_staatus = "Valmis"",
          "tags_ids = "Q2534157"",
          "collections_hierarchy = "universitas-dorpatensis-1"",
          "genre_ids = "Q3497659"",
          "type_ids = "Q87167"",
          "languages = "lat"",
        ],
        "matchingStrategy": "frequency",
        "q": "Schluss constitu",
      }
    `);
  });
  it('tühi päring, onlyFirstPage: false', async () => {
    expect(await sentParams('', { sort: 'recent', onlyFirstPage: false })).toMatchInlineSnapshot(`
      {
        "attributesToSearchOn": [
          "title",
          "title_en",
          "title_original",
          "authors_text",
          "part_persons_text",
          "tags_search",
          "genre_search",
        ],
        "distinct": "work_id",
        "filter": [],
        "matchingStrategy": "last",
        "q": "",
      }
    `);
  });
});

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
    expect(params.facets).toEqual(['genre_ids', 'tags_ids', 'type_ids', 'languages', 'teose_staatus']);
    expect(params.filter[0]).toBe('lehekylje_number = 1');
    expect(params.filter.length).toBeGreaterThan(1); // + valikuklausel
    expect(r).toEqual({ genre_ids: { Q1: 3 }, tags_ids: {}, type_ids: { Q2: 1 }, languages: {}, teose_staatus: {} });
  });
});

describe('buildDashboardSearch distinct (lõppülevaatus: recent loendur luges lehti)', () => {
  it('onlyFirstPage:false + mitte-relevance → distinct work_id, sama mis searchWorks', async () => {
    const o: DashboardSearchOptions = { sort: 'recent', onlyFirstPage: false };
    expect(buildDashboardSearch('', o).distinct).toBe('work_id');
    await searchWorks(mockIndex, '', o);
    expect(mockSearch.mock.calls.at(-1)![1].distinct).toBe('work_id');
  });
  it('tavavaates distinct puudub', () => {
    expect(buildDashboardSearch('x', { sort: 'year_asc', onlyFirstPage: true }).distinct).toBeUndefined();
    expect(buildDashboardSearch('x', { sort: 'relevance', onlyFirstPage: false }).distinct).toBeUndefined();
  });
});
