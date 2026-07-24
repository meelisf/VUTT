import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('../meiliService', () => ({
  checkMixedContent: vi.fn(),
  normalizeWork: vi.fn((hit) => hit),
  normalizeContentSearchHit: vi.fn(),
}));

vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images',
  FILE_API_URL: '/api/files',
}));

import { searchWorks } from '../searchService';

const mockIndex = { search: mockSearch } as any;

beforeEach(() => mockSearch.mockReset());

describe('searchWorks serveripoolne lehekülgjaotus', () => {
  it('saadab Meilisearchile offseti ja väikese limiidi ilma üleliigse distinctita', async () => {
    mockSearch.mockResolvedValue({
      hits: [{ id: 'a', work_id: 'w1', year: 1640, title: 'A' }],
      facetDistribution: {},
      estimatedTotalHits: 1316,
    });

    const result = await searchWorks(mockIndex, '', {
      sort: 'year_asc',
      offset: 24,
      limit: 12,
      onlyFirstPage: true,
    });

    const params = mockSearch.mock.calls[0][1];
    expect(params.offset).toBe(24);
    expect(params.limit).toBe(12);
    expect(params.distinct).toBeUndefined();
    expect(result.totalHits).toBe(1316);
    expect(result.works).toHaveLength(1);
  });

  it('kasutab kõigi lehekülgede viimaste muudatuste vaates distincti', async () => {
    mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, estimatedTotalHits: 0 });

    await searchWorks(mockIndex, '', {
      sort: 'recent',
      offset: 0,
      limit: 12,
      onlyFirstPage: false,
    });

    expect(mockSearch.mock.calls[0][1].distinct).toBe('work_id');
  });
});
