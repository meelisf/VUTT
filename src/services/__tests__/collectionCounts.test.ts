import { describe, expect, it, vi } from 'vitest';

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

import { getCollectionCounts } from '../searchService';

// Kogude arvud (#587, #319 p2): facet loeb DOKUMENTE ehk lehekülgi, seega
// ilma `lehekylje_number = 1` filtrita oleks 30-leheline teos arvus 30 korda.
describe('getCollectionCounts', () => {
  it('loeb teoseid, mitte lehekülgi, ja annab kogusumma täpse totalHits-iga', async () => {
    const search = vi.fn().mockResolvedValue({
      hits: [],
      totalHits: 1385,
      estimatedTotalHits: 1000,
      facetDistribution: { collections_hierarchy: { 'academia-gustaviana': 1258 } },
    });
    const counts = await getCollectionCounts({ search } as any);

    const params = search.mock.calls[0][1];
    expect(params.filter).toEqual(['lehekylje_number = 1']);
    expect(params.facets).toEqual(['collections_hierarchy']);
    expect(params.hitsPerPage).toBe(0);
    expect(counts).toEqual({ byCollection: { 'academia-gustaviana': 1258 }, total: 1385 });
  });
});
