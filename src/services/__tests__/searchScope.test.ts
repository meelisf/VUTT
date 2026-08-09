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

import { searchContent, searchWorkHits } from '../searchService';

const mockIndex = { search: mockSearch } as any;

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, totalHits: 0, estimatedTotalHits: 0 });
});

const searchedFields = (): string[] => mockSearch.mock.calls[0][1].attributesToSearchOn;

// „Terve dokument" PEAB katma kõik tekstiväljad — sh tekstiannotatsioonid.
// Varem puudus text_annotations_text vaikeloendist, mistõttu vaikeulatus oli
// kitsam kui tema enda alamvalik „Ainult annotatsioonid" ja annotatsiooni-vasted
// olid vaikevaates nähtamatud.
describe('otsinguulatus „Terve dokument" (vaikimisi)', () => {
  it('searchContent otsib ka tekstiannotatsioonidest', async () => {
    await searchContent(mockIndex, 'käsu');
    expect(searchedFields()).toEqual(
      expect.arrayContaining(['lehekylje_tekst', 'marginaalia_tekst', 'page_tags_et', 'comments.text', 'text_annotations_text'])
    );
  });

  it('searchWorkHits otsib ka tekstiannotatsioonidest', async () => {
    await searchWorkHits(mockIndex, 'käsu', 'work1');
    expect(searchedFields()).toEqual(
      expect.arrayContaining(['lehekylje_tekst', 'marginaalia_tekst', 'page_tags_et', 'comments.text', 'text_annotations_text'])
    );
  });

  it('on vähemalt sama lai kui „Ainult annotatsioonid"', async () => {
    await searchContent(mockIndex, 'käsu', 1, { scope: 'annotation' });
    const annotationFields = searchedFields();
    mockSearch.mockClear();
    await searchContent(mockIndex, 'käsu', 1, { scope: 'all' });
    expect(searchedFields()).toEqual(expect.arrayContaining(annotationFields));
  });
});

describe('kitsamad ulatused jäävad kitsaks', () => {
  it('„Ainult originaaltekst" ei otsi annotatsioonidest ega kommentaaridest', async () => {
    await searchContent(mockIndex, 'käsu', 1, { scope: 'original' });
    expect(searchedFields()).toEqual(['lehekylje_tekst', 'marginaalia_tekst']);
  });

  it('„Ainult annotatsioonid" ei otsi lehekülje põhitekstist', async () => {
    await searchContent(mockIndex, 'käsu', 1, { scope: 'annotation' });
    expect(searchedFields()).not.toContain('lehekylje_tekst');
    expect(searchedFields()).toContain('text_annotations_text');
  });
});
