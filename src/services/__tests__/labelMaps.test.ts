import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock on hoistitud — mockid peavad olema vi.hoisted abil deklareeritud
const { mockSearch, mockRegistry } = vi.hoisted(() => ({
  mockSearch: vi.fn(),
  mockRegistry: vi.fn(),
}));

vi.mock('../meiliService', () => ({
  checkMixedContent: vi.fn(),
  normalizeWork: vi.fn(),
  normalizeContentSearchHit: vi.fn(),
}));

vi.mock('../entityLabelsService', () => ({
  getEntityLabelsCache: mockRegistry,
}));

// config.ts kasutab window.location.origin — mockime
vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images',
  FILE_API_URL: '/api/files',
}));

import { getGenreLabelMap, getTagsLabelMap } from '../searchService';

// Mock index antakse otse funktsiooni argumendina (dependency injection)
const mockIndex = { search: mockSearch } as any;

const makeResponse = (hits: object[]) =>
  Promise.resolve({ hits, facetDistribution: {}, estimatedTotalHits: hits.length });

beforeEach(() => {
  mockSearch.mockReset();
  mockRegistry.mockReset();
  mockRegistry.mockResolvedValue({});
});

describe('getGenreLabelMap — kanooniline register (#184)', () => {
  it('lahendab labelid registrist ILMA Meili päringuta', async () => {
    mockRegistry.mockResolvedValue({
      Q861911: { et: 'oratsioon', en: 'oration' },
      Q789: { et: 'disputatsioon', en: 'disputation' },
    });

    const result = await getGenreLabelMap(mockIndex, ['Q861911', 'Q789'], 'et');

    expect(result).toEqual({ Q861911: 'Oratsioon', Q789: 'Disputatsioon' });
    expect(mockSearch).not.toHaveBeenCalled();  // ← #184 põhieesmärk: limit:5000 kadus
  });

  it('kasutab UI keelt, siis kanoonilist et→en→la→de ahelat', async () => {
    mockRegistry.mockResolvedValue({
      Q1: { et: 'oratsioon', en: 'oration' },
      Q2: { la: 'oratio' },  // et ja en puuduvad
    });

    const en = await getGenreLabelMap(mockIndex, ['Q1', 'Q2'], 'en');
    expect(en['Q1']).toBe('Oration');
    expect(en['Q2']).toBe('Oratio');

    const et = await getGenreLabelMap(mockIndex, ['Q1'], 'et');
    expect(et['Q1']).toBe('Oratsioon');
  });

  it('tühi Q-koodide loend ei tee ühtegi päringut', async () => {
    expect(await getGenreLabelMap(mockIndex, [], 'et')).toEqual({});
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('registrist puuduvad Q-koodid: üks PIIRATUD päring ainult nende kohta', async () => {
    mockRegistry.mockResolvedValue({ Q1: { et: 'oratsioon' } });
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q2', label: 'kõne', labels: { et: 'kõne' } }] },
    ]));

    const result = await getGenreLabelMap(mockIndex, ['Q1', 'Q2'], 'et');

    expect(result['Q1']).toBe('Oratsioon');   // registrist
    expect(result['Q2']).toBe('Kõne');         // lünga-täitest
    expect(mockSearch).toHaveBeenCalledTimes(1);
    const [, options] = mockSearch.mock.calls[0];
    expect(options.filter).toContain('genre_ids IN ["Q2"]');  // AINULT puuduv
    expect(options.limit).toBeLessThanOrEqual(200);          // mitte 5000
    expect(options.attributesToRetrieve).toEqual(['genre_object']);
  });

  it('lünga-täite viga ei kaota registrist saadud labeleid', async () => {
    mockRegistry.mockResolvedValue({ Q1: { et: 'oratsioon' } });
    mockSearch.mockRejectedValue(new Error('network error'));

    const result = await getGenreLabelMap(mockIndex, ['Q1', 'Q2'], 'et');

    expect(result['Q1']).toBe('Oratsioon');
    expect(result['Q2']).toBeUndefined();  // UI kukub tagasi Q-koodile
  });

  it('registri viga: lünga-täide katab kõik Q-koodid', async () => {
    mockRegistry.mockResolvedValue({});
    mockSearch.mockReturnValue(makeResponse([
      { genre_object: [{ id: 'Q1', label: 'oratsioon', labels: { et: 'oratsioon' } }] },
    ]));

    const result = await getGenreLabelMap(mockIndex, ['Q1'], 'et');

    expect(result['Q1']).toBe('Oratsioon');
    const [, options] = mockSearch.mock.calls[0];
    expect(options.filter).toContain('genre_ids IN ["Q1"]');
  });

  it('lünga-täide on alati esilehtede peal (üks dokument teose kohta)', async () => {
    mockRegistry.mockResolvedValue({});
    mockSearch.mockReturnValue(makeResponse([]));

    await getGenreLabelMap(mockIndex, ['Q1'], 'et');

    const [, options] = mockSearch.mock.calls[0];
    expect(options.filter).toContain('lehekylje_number = 1');
  });

  it('ei kuku läbi, kui registris on Q-kood tühja labelite objektiga', async () => {
    mockRegistry.mockResolvedValue({ Q1: {} });
    mockSearch.mockReturnValue(makeResponse([]));

    const result = await getGenreLabelMap(mockIndex, ['Q1'], 'et');

    expect(result['Q1']).toBeUndefined();
    expect(mockSearch).toHaveBeenCalledTimes(1);  // tühi labels = puuduv
  });
});

describe('getTagsLabelMap — sama register, tags väljad (#179)', () => {
  it('lahendab märksõnad registrist ilma päringuta', async () => {
    mockRegistry.mockResolvedValue({ Q42: { et: 'teoloogia', en: 'theology' } });

    const result = await getTagsLabelMap(mockIndex, ['Q42'], 'en');

    expect(result).toEqual({ Q42: 'Theology' });
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('lünga-täide kasutab tags_ids/tags_object välju ja tsiteerib väärtused', async () => {
    // VUTT isiku-ID-d ei ole kunagi registris ja sisaldavad koolonit — tsiteerimine
    // on kohustuslik, muidu on filter vigane.
    mockRegistry.mockResolvedValue({});
    mockSearch.mockReturnValue(makeResponse([
      { tags_object: [{ id: 'vutt:P7', label: 'Luden', labels: { et: 'Luden' } }] },
    ]));

    const result = await getTagsLabelMap(mockIndex, ['vutt:P7'], 'et');

    const [, options] = mockSearch.mock.calls[0];
    expect(options.filter).toContain('tags_ids IN ["vutt:P7"]');
    expect(options.attributesToRetrieve).toEqual(['tags_object']);
    expect(result['vutt:P7']).toBe('Luden');
  });
});
