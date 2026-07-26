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

/**
 * searchContent teeb kolm paralleelset päringut: statistika (limit 5000),
 * kuvatavad tulemused (distinct) ja lehekülgede loendur (limit 0 + work_id facet).
 * Router valib mocki vastuse päringu kuju järgi.
 */
function mockQueries(opts: {
  statsHits: string[];            // stats-päringu hittide work_id-d
  statsEstimated: number;
  distinctEstimated: number;
  facet?: Record<string, number>; // work_id facet: teos → lehekülgede arv
  pageEstimated: number;
}) {
  mockSearch.mockImplementation((_q: string, params: any = {}) => {
    if (params.limit === 0 && params.facets?.includes('work_id')) {
      return Promise.resolve({
        hits: [],
        estimatedTotalHits: opts.pageEstimated,
        facetDistribution: opts.facet === undefined ? undefined : { work_id: opts.facet },
      });
    }
    if (params.distinct === 'work_id') {
      return Promise.resolve({
        hits: [{ id: 'p1', work_id: opts.statsHits[0] ?? 'w1' }],
        estimatedTotalHits: opts.distinctEstimated,
      });
    }
    return Promise.resolve({
      hits: opts.statsHits.map((work_id, i) => ({ id: `p${i}`, work_id })),
      estimatedTotalHits: opts.statsEstimated,
    });
  });
}

beforeEach(() => mockSearch.mockReset());

describe('searchContent teoste ja vastete koguarv', () => {
  it('loeb teosed work_id facetist ka siis, kui statistikapäring lõi 5000 piiri lõhki', async () => {
    // Päris mõõtmine: "est" → 10 000 lehte, tegelikult 1074 teost, kuid
    // esimesed 5000 hitti katavad vaid murdosa teostest.
    const facet: Record<string, number> = {};
    for (let i = 0; i < 1074; i++) facet[`w${i}`] = 9;
    mockQueries({
      statsHits: ['w0', 'w1', 'w2'],
      statsEstimated: 10000,
      distinctEstimated: 10000,
      facet,
      pageEstimated: 10000,
    });

    const res = await searchContent(mockIndex, 'est', 1, {});

    expect(res.totalWorks).toBe(1074);
  });

  it('annab sama täpse arvu ka kitsa päringu korral', async () => {
    mockQueries({
      statsHits: ['w1', 'w1', 'w2', 'w3'],
      statsEstimated: 4,
      distinctEstimated: 3,
      facet: { w1: 2, w2: 1, w3: 1 },
      pageEstimated: 4,
    });

    const res = await searchContent(mockIndex, 'Ludenius', 1, {});

    expect(res.totalWorks).toBe(3);
    expect(res.totalHits).toBe(4);
  });

  it('kasutab vastete koguarvuna facet-summat, mis ei ole maxTotalHits piiriga kärbitud', async () => {
    mockQueries({
      statsHits: ['w1'],
      statsEstimated: 10000,
      distinctEstimated: 10000,
      facet: { w1: 8000, w2: 5456 },
      pageEstimated: 10000, // Meilisearch kärbib maxTotalHits=10000 juures
    });

    const res = await searchContent(mockIndex, 'de', 1, {});

    expect(res.totalHits).toBe(13456);
  });

  it('kukub tagasi vanale loogikale, kui facet puudub', async () => {
    mockQueries({
      statsHits: ['w1', 'w2'],
      statsEstimated: 2,
      distinctEstimated: 2,
      facet: undefined,
      pageEstimated: 2,
    });

    const res = await searchContent(mockIndex, 'Ludenius', 1, {});

    expect(res.totalWorks).toBe(2);
    expect(res.totalHits).toBe(2);
  });
});
