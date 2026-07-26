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
  it('kasutab lehe-joondatud offseti korral page/hitsPerPage režiimi', async () => {
    mockSearch.mockResolvedValue({
      hits: [{ id: 'a', work_id: 'w1', year: 1640, title: 'A' }],
      facetDistribution: {},
      totalHits: 1316,
    });

    const result = await searchWorks(mockIndex, '', {
      sort: 'year_asc',
      offset: 24,
      limit: 12,
      onlyFirstPage: true,
    });

    const params = mockSearch.mock.calls[0][1];
    expect(params.page).toBe(3);          // offset 24 / limit 12 + 1
    expect(params.hitsPerPage).toBe(12);
    expect(params.offset).toBeUndefined();
    expect(params.limit).toBeUndefined();
    expect(params.distinct).toBeUndefined();
    expect(result.totalHits).toBe(1316);  // TÄPNE totalHits, mitte estimatedTotalHits
    expect(result.works).toHaveLength(1);
  });

  it('joondamata offseti korral jääb offset/limit režiimi', async () => {
    mockSearch.mockResolvedValue({
      hits: [], facetDistribution: {}, estimatedTotalHits: 42,
    });

    const result = await searchWorks(mockIndex, '', {
      sort: 'year_asc', offset: 5, limit: 12, onlyFirstPage: true,
    });

    const params = mockSearch.mock.calls[0][1];
    expect(params.offset).toBe(5);
    expect(params.limit).toBe(12);
    expect(params.page).toBeUndefined();
    expect(result.totalHits).toBe(42);
  });

  it('kasutab kõigi lehekülgede viimaste muudatuste vaates distincti', async () => {
    mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, totalHits: 0 });

    await searchWorks(mockIndex, '', {
      sort: 'recent',
      offset: 0,
      limit: 12,
      onlyFirstPage: false,
    });

    expect(mockSearch.mock.calls[0][1].distinct).toBe('work_id');
  });

  it('EI sorteeri tulemusi kliendipoolselt ümber (#183 sõlmkoht B)', async () => {
    // Meilisearchi järjestus on globaalne (üle lehepiiride); lehe sees ümbersortimine
    // annaks kohalikult teistsuguse järjekorra kui lehtede vaheline järjestus.
    // Verifitseeritud tootmises: title:asc juures lähevad Meili kollatsioon ja
    // localeCompare('et') päriselt lahku (Börk vs Bröms, Örneklou vs Palmroot).
    mockSearch.mockResolvedValue({
      hits: [
        { id: '1', work_id: 'w1', year: 1700, title: 'Börk' },
        { id: '2', work_id: 'w2', year: 1650, title: 'Bröms' },
      ],
      facetDistribution: {},
      totalHits: 2,
    });

    const azimuth = await searchWorks(mockIndex, '', {
      sort: 'az', offset: 0, limit: 12, onlyFirstPage: true,
    });
    expect(azimuth.works.map(w => w.title)).toEqual(['Börk', 'Bröms']);

    const byYear = await searchWorks(mockIndex, '', {
      sort: 'year_asc', offset: 0, limit: 12, onlyFirstPage: true,
    });
    // Meili järjekord säilib ka siis, kui aastad ei ole lehe sees kasvavad
    expect(byYear.works.map(w => w.year)).toEqual([1700, 1650]);
  });

  it('langeb estimatedTotalHits-ile kui täpset totalHits ei tule', async () => {
    mockSearch.mockResolvedValue({
      hits: [], facetDistribution: {}, estimatedTotalHits: 7,
    });

    const result = await searchWorks(mockIndex, '', {
      sort: 'year_asc', offset: 0, limit: 12, onlyFirstPage: true,
    });

    expect(result.totalHits).toBe(7);
  });
});
