import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock on hoistitud — mockSearch peab olema vi.hoisted abil deklareeritud
const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('../meiliService', () => ({
  checkMixedContent: vi.fn(),
  normalizeWork: vi.fn(),
  normalizeContentSearchHit: vi.fn(),
}));

// config.ts kasutab window.location.origin — mockime
vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  MEILI_API_KEY: '',
  MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images',
  FILE_API_URL: '/api/files',
}));

import { getGenreLabelMap } from '../searchService';

// Mock index antakse otse funktsiooni argumendina (dependency injection)
const mockIndex = { search: mockSearch } as any;

// Abifunktsioon: tekitab mockSearch vastuse
const makeResponse = (hits: object[]) =>
  Promise.resolve({ hits, facetDistribution: {}, estimatedTotalHits: hits.length });

beforeEach(() => {
  mockSearch.mockReset();
});

describe('getGenreLabelMap', () => {
  it('tagastab tühja kaardi kui hits on tühi', async () => {
    mockSearch.mockReturnValue(makeResponse([]));
    expect(await getGenreLabelMap(mockIndex)).toEqual({});
  });

  it('loob Q-kood → label kaardi genre_object massiivi põhjal', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon', en: 'oration' } }] },
      { genre_object: [{ id: 'Q789', label: 'disputatsioon', labels: { et: 'disputatsioon', en: 'disputation' } }] },
    ]));
    const result = await getGenreLabelMap(mockIndex, undefined,'et');
    expect(result['Q861911']).toBe('Oratsioon');
    expect(result['Q789']).toBe('Disputatsioon');
  });

  it('üksik objekt (mitte massiiv) genre_object-ina töötab korrektselt', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: { id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon' } } },
    ]));
    const result = await getGenreLabelMap(mockIndex);
    expect(result['Q861911']).toBe('Oratsioon');
  });

  it('kasutab UI keele labeli kui olemas', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon', en: 'oration' } }] },
    ]));
    const resultEt = await getGenreLabelMap(mockIndex, undefined,'et');
    const resultEn = await getGenreLabelMap(mockIndex, undefined,'en');
    expect(resultEt['Q861911']).toBe('Oratsioon');
    expect(resultEn['Q861911']).toBe('Oration');
  });

  it('langeb et-le kui nõutud keel puudub', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon' } }] },
    ]));
    const result = await getGenreLabelMap(mockIndex, undefined,'en');
    expect(result['Q861911']).toBe('Oratsioon');
  });

  it('langeb item.label-ile kui labels puudub', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q861911', label: 'oratsioon' }] },
    ]));
    const result = await getGenreLabelMap(mockIndex);
    expect(result['Q861911']).toBe('Oratsioon');
  });

  it('teeb esimese tähe suureks (capitalize_first)', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q1', label: 'funeral sermon', labels: { en: 'funeral sermon' } }] },
    ]));
    const result = await getGenreLabelMap(mockIndex, undefined,'en');
    expect(result['Q1']).toBe('Funeral sermon');
  });

  it('jätab vahele genre_object puuduva hiti, teised Q-koodid leitavad', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: null },
      { title: 'teos ilma žanrita' },
      { genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon' } }] },
    ]));
    const result = await getGenreLabelMap(mockIndex);
    expect(result['Q861911']).toBe('Oratsioon');
  });

  it('jätab vahele item-id kellel puudub id', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ label: 'tundmatu', labels: { et: 'tundmatu' } }] },
    ]));
    const result = await getGenreLabelMap(mockIndex);
    expect(result).toEqual({});
  });

  it('mitu hitti sama Q-koodiga — Q-kood on kaardil üks kord', async () => {
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon' } }] },
      { genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon' } }] },
    ]));
    const result = await getGenreLabelMap(mockIndex);
    expect(result['Q861911']).toBe('Oratsioon');
  });

  it('tagastab tühja kaardi vea korral', async () => {
    mockSearch.mockRejectedValue(new Error('network error'));
    const result = await getGenreLabelMap(mockIndex);
    expect(result).toEqual({});
  });

  it('edastab collection filtri Meilisearch päringule', async () => {
    mockSearch.mockReturnValue(makeResponse([]));
    await getGenreLabelMap(mockIndex, 'academia-gustaviana', 'et');
    const [, options] = mockSearch.mock.calls[0];
    expect(options.filter).toContain('collections_hierarchy = "academia-gustaviana"');
  });

  it('alati sisaldab lehekylje_number = 1 filtrit', async () => {
    mockSearch.mockReturnValue(makeResponse([]));
    await getGenreLabelMap(mockIndex);
    const [, options] = mockSearch.mock.calls[0];
    expect(options.filter).toContain('lehekylje_number = 1');
  });

  it('kasutab limit 5000 et kõik teosed oleksid kaetud', async () => {
    mockSearch.mockReturnValue(makeResponse([]));
    await getGenreLabelMap(mockIndex);
    const [, options] = mockSearch.mock.calls[0];
    expect(options.limit).toBe(5000);
  });
});
