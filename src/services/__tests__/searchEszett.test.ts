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

import { normalizeSearchQuery, searchWorks, searchContent, searchWorkHits } from '../searchService';

const mockIndex = { search: mockSearch } as any;

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, totalHits: 0, estimatedTotalHits: 0 });
});

// Meili voldib täpitähed ise (Königsberg == Konigsberg), aga ß-i mitte.
// Indeksipool normaliseerib server/meili_doc.py:normalize_eszett-is — päring PEAB
// käima sama teed, muidu ei leiaks „Schluß" otsimine enam midagi (#228).
describe('normalizeSearchQuery', () => {
  it('asendab ß ss-iga', () => {
    expect(normalizeSearchQuery('daß')).toBe('dass');
    expect(normalizeSearchQuery('nachließen')).toBe('nachliessen');
  });

  it('asendab suurtähe ẞ', () => {
    expect(normalizeSearchQuery('STRAẞE')).toBe('STRASSE');
  });

  it('töötab fraasiotsingu jutumärkide sees', () => {
    expect(normalizeSearchQuery('"Schluß der Sache"')).toBe('"Schluss der Sache"');
  });

  it('jätab muu puutumata', () => {
    expect(normalizeSearchQuery('Königsberg')).toBe('Königsberg');
    expect(normalizeSearchQuery('')).toBe('');
  });
});

describe('otsingu sisenemispunktid normaliseerivad päringu', () => {
  it('searchWorks', async () => {
    await searchWorks(mockIndex, 'daß');
    expect(mockSearch.mock.calls[0][0]).toBe('dass');
  });

  it('searchContent', async () => {
    await searchContent(mockIndex, 'daß');
    expect(mockSearch.mock.calls[0][0]).toBe('dass');
  });

  it('searchWorkHits', async () => {
    await searchWorkHits(mockIndex, 'daß', 'work1');
    expect(mockSearch.mock.calls[0][0]).toBe('dass');
  });
});
