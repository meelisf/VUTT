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

import { searchContent, searchWorks } from '../searchService';

const mockIndex = { search: mockSearch } as any;

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, totalHits: 0, estimatedTotalHits: 0 });
});

const appliedFilters = (): string[] => mockSearch.mock.calls[0][1].filter ?? [];

describe('keelefilter', () => {
  it('ei lisa klauslit, kui keeli ei ole valitud', async () => {
    await searchContent(mockIndex, 'anima');
    expect(appliedFilters().some(f => f.includes('languages'))).toBe(false);
  });

  it('ei lisa klauslit tühja massiivi korral', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: [] });
    expect(appliedFilters().some(f => f.includes('languages'))).toBe(false);
  });

  it('üks keel annab lihtsa võrdluse', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: ['grc'] });
    expect(appliedFilters()).toContain('languages = "grc"');
  });

  it('mitu keelt annab OR-klausli', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: ['grc', 'heb'] });
    expect(appliedFilters()).toContain('(languages = "grc" OR languages = "heb")');
  });

  it('keelefilter ei sega UI keele lang-välja', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: ['grc'], lang: 'en' });
    expect(appliedFilters()).toContain('languages = "grc"');
    expect(appliedFilters().some(f => f.includes('"en"'))).toBe(false);
  });
});

// --- Dashboard (teosetasand) ---
// Dashboard filtreerib `lehekylje_number = 1`, seega dokumente on üks teose
// kohta ja facet-loendurid näitavad TEOSEID (erinevalt SearchPage'ist, kus
// dokument on iga lehekülg).
describe('keelefilter teoseotsingus (Dashboard)', () => {
  it('ei lisa klauslit, kui keeli ei ole valitud', async () => {
    await searchWorks(mockIndex, '');
    expect(appliedFilters().some(f => f.includes('languages'))).toBe(false);
  });

  it('üks keel annab lihtsa võrdluse', async () => {
    await searchWorks(mockIndex, '', { languages: ['grc'] });
    expect(appliedFilters()).toContain('languages = "grc"');
  });

  it('mitu keelt annab OR-klausli', async () => {
    await searchWorks(mockIndex, '', { languages: ['grc', 'heb'] });
    expect(appliedFilters()).toContain('(languages = "grc" OR languages = "heb")');
  });

  it('küsib languages facetid, et loendurid saaks kuvada', async () => {
    await searchWorks(mockIndex, '');
    expect(mockSearch.mock.calls[0][1].facets).toContain('languages');
  });
});
