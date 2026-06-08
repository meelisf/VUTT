import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  IMAGE_BASE_URL: 'http://localhost:8001',
  FILE_API_URL: 'http://localhost:8002',
}));

vi.mock('../workImageService', () => ({
  getFullImageUrl: (path: string) => `http://localhost:8001/${path}`,
  getThumbUrl: (id: string) => `http://localhost:8001/thumbs/${id}.jpg`,
}));

// checkMixedContent kasutab window.location — ei tööta node keskkonnas.
// Mockime selle no-op'iks, aga jätame normalizePage/normalizeWork päriseks.
vi.mock('../meiliService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../meiliService')>();
  return { ...actual, checkMixedContent: vi.fn() };
});

import { normalizePage } from '../meiliService';

const basePageHit = {
  id: 'abc123-1',
  work_id: 'abc123',
  lehekylje_number: '3',
  lehekylje_tekst: 'Cleaned text',
  text_content: 'Raw text with <i>markup</i>',
  lehekylje_pilt: 'img001.jpg',
  status: 'Töös',
  comments: [],
  text_annotations: [],
  history: [],
  title: 'Test Work',
  year: 1680,
  collections: ['coll-1'],
};

describe('normalizePage', () => {
  describe('page_number', () => {
    it('parses string lehekylje_number', () => {
      expect(normalizePage({ ...basePageHit, lehekylje_number: '7' }).page_number).toBe(7);
    });
    it('returns 0 when lehekylje_number is null', () => {
      expect(normalizePage({ ...basePageHit, lehekylje_number: null }).page_number).toBe(0);
    });
    it('returns 0 when lehekylje_number is undefined', () => {
      const { lehekylje_number, ...hit } = basePageHit as any;
      expect(normalizePage(hit).page_number).toBe(0);
    });
  });

  describe('text_content', () => {
    it('prefers text_content over lehekylje_tekst', () => {
      expect(normalizePage(basePageHit).text_content).toBe('Raw text with <i>markup</i>');
    });
    it('falls back to lehekylje_tekst when text_content absent', () => {
      const { text_content, ...hit } = basePageHit as any;
      expect(normalizePage(hit).text_content).toBe('Cleaned text');
    });
    it('returns empty string when both absent', () => {
      const { text_content, lehekylje_tekst, ...hit } = basePageHit as any;
      expect(normalizePage(hit).text_content).toBe('');
    });
  });

  describe('page_tags', () => {
    it('uses page_tags_object when present', () => {
      const tags = [{ id: 'Q1', label: 'Test' }];
      expect(normalizePage({ ...basePageHit, page_tags_object: tags }).page_tags).toEqual(tags);
    });
    it('falls back to page_tags strings lowercased', () => {
      expect(normalizePage({ ...basePageHit, page_tags: ['Foo', 'BAR'] }).page_tags)
        .toEqual(['foo', 'bar']);
    });
    it('falls back to hit.tags when page_tags absent', () => {
      const { page_tags, ...hit } = basePageHit as any;
      expect(normalizePage({ ...hit, tags: ['Alpha'] }).page_tags).toEqual(['alpha']);
    });
    it('deduplicates string tags', () => {
      expect(normalizePage({ ...basePageHit, page_tags: ['foo', 'foo', 'bar'] }).page_tags)
        .toEqual(['foo', 'bar']);
    });
    it('returns empty array when no tags', () => {
      const { page_tags, ...hit } = basePageHit as any;
      expect(normalizePage(hit).page_tags).toEqual([]);
    });
  });

  describe('languages', () => {
    it('returns languages array as-is', () => {
      expect(normalizePage({ ...basePageHit, languages: ['lat', 'deu'] }).languages)
        .toEqual(['lat', 'deu']);
    });
    it('returns empty array when languages absent (no lat hardcode)', () => {
      const { languages, ...hit } = basePageHit as any;
      expect(normalizePage(hit).languages).toEqual([]);
    });
  });

  describe('collections_hierarchy', () => {
    it('falls back to empty array', () => {
      const { collections_hierarchy, ...hit } = basePageHit as any;
      expect(normalizePage(hit).collections_hierarchy).toEqual([]);
    });
  });

  describe('creators and authors_text', () => {
    it('defaults to empty arrays', () => {
      const page = normalizePage(basePageHit);
      expect(page.creators).toEqual([]);
      expect(page.authors_text).toEqual([]);
    });
  });

  describe('work_id derivation', () => {
    it('derives work_id from id when work_id absent', () => {
      const { work_id, ...hit } = basePageHit as any;
      expect(normalizePage(hit).work_id).toBe('abc123');
    });
  });
});

describe('getPage wires normalizePage', () => {
  it('returns page_number as integer from string hit', async () => {
    const { getPage } = await import('../pageService');
    const mockIndex = {
      search: vi.fn().mockResolvedValue({
        hits: [{ ...basePageHit, lehekylje_number: '5', work_id: 'abc123' }],
      }),
    } as any;
    const page = await getPage(mockIndex, 'abc123', 5);
    expect(page?.page_number).toBe(5);
  });

  it('returns empty languages array when hit has none (no lat hardcode)', async () => {
    const { getPage } = await import('../pageService');
    const { languages, ...hitWithoutLang } = basePageHit as any;
    const mockIndex = {
      search: vi.fn().mockResolvedValue({ hits: [hitWithoutLang] }),
    } as any;
    const page = await getPage(mockIndex, 'abc123', 3);
    expect(page?.languages).toEqual([]);
  });

  it('prefers page_tags_object over string page_tags', async () => {
    const { getPage } = await import('../pageService');
    const tags = [{ id: 'Q1', label: 'Test' }];
    const mockIndex = {
      search: vi.fn().mockResolvedValue({
        hits: [{ ...basePageHit, page_tags_object: tags, page_tags: ['foo'] }],
      }),
    } as any;
    const page = await getPage(mockIndex, 'abc123', 3);
    expect(page?.page_tags).toEqual(tags);
  });
});
