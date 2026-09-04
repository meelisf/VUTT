import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({ FILE_API_URL: '/api/files' }));

import {
  getCollectionColorClasses,
  getCollectionName,
  getCollectionById,
  getCollectionHierarchy,
  getRootCollections,
  getChildCollections,
  buildCollectionTree,
  getCollections,
  getVocabularies,
  getWritableCollectionOptions,
  clearCache,
  Collection,
  Collections,
} from '../collectionService';

// =========================================================
// PUHTAD ABIFUNKTSIOONID (ilma fetch-ita)
// =========================================================

describe('getCollectionColorClasses', () => {
  it('teadaoleva värviga kollektsioon', () => {
    const c = { name: { et: 'X', en: 'X' }, color: 'amber' } as Collection;
    expect(getCollectionColorClasses(c)).toEqual({
      bg: 'bg-amber-50', text: 'text-amber-700',
      border: 'border-amber-200', hoverBg: 'hover:bg-amber-100',
    });
  });

  it('null kollektsioon → vaikimisi indigo', () => {
    expect(getCollectionColorClasses(null).text).toBe('text-indigo-700');
  });

  it('värvita kollektsioon → indigo', () => {
    expect(getCollectionColorClasses({ name: { et: 'X', en: 'X' } }).text).toBe('text-indigo-700');
  });

  it('tundmatu värv → indigo fallback', () => {
    const c = { name: { et: 'X', en: 'X' }, color: 'nonexistent' } as Collection;
    expect(getCollectionColorClasses(c).text).toBe('text-indigo-700');
  });
});

describe('getCollectionName', () => {
  it('tagastab nime keele järgi', () => {
    const c = { name: { et: 'Akadeemia', en: 'Academy' } } as Collection;
    expect(getCollectionName(c, 'et')).toBe('Akadeemia');
    expect(getCollectionName(c, 'en')).toBe('Academy');
  });

  it('langeb et-le kui nõutud keel puudub', () => {
    const c = { name: { et: 'Akadeemia' } } as Collection;
    expect(getCollectionName(c, 'en')).toBe('Akadeemia');
  });
});

describe('getCollectionById', () => {
  const cols = { a: { name: { et: 'A', en: 'A' } } } as Collections;
  it('leiab olemasoleva', () => {
    expect(getCollectionById(cols, 'a')?.name.et).toBe('A');
  });
  it('tagastab null kui puudub', () => {
    expect(getCollectionById(cols, 'zzz')).toBeNull();
  });
});

describe('getCollectionHierarchy', () => {
  it('ehitab ahela juurest lapseni', () => {
    const cols = {
      root: { name: { et: 'R', en: 'R' }, parent: undefined },
      mid: { name: { et: 'M', en: 'M' }, parent: 'root' },
      leaf: { name: { et: 'L', en: 'L' }, parent: 'mid' },
    } as Collections;
    expect(getCollectionHierarchy(cols, 'leaf')).toEqual(['root', 'mid', 'leaf']);
  });

  it('üksildase juurkogu korral tagastab [id]', () => {
    const cols = { only: { name: { et: 'O', en: 'O' } } } as Collections;
    expect(getCollectionHierarchy(cols, 'only')).toEqual(['only']);
  });
});

describe('getRootCollections / getChildCollections sorteeritakse order järgi', () => {
  const cols = {
    a: { name: { et: 'A', en: 'A' }, parent: undefined, order: 2 },
    b: { name: { et: 'B', en: 'B' }, parent: undefined, order: 1 },
    c: { name: { et: 'C', en: 'C' }, parent: 'a', order: 1 },
    d: { name: { et: 'D', en: 'D' }, parent: 'a', order: undefined },
  } as Collections;

  it('juurkogud sorteeritakse order järgi (puuduv order = 999)', () => {
    const roots = getRootCollections(cols).map(r => r.id);
    expect(roots).toEqual(['b', 'a']);
  });

  it('alamed sorteeritakse order järgi', () => {
    const children = getChildCollections(cols, 'a').map(c => c.id);
    expect(children).toEqual(['c', 'd']);
  });
});

describe('buildCollectionTree', () => {
  it('ehitab pesastatud puu struktuuri', () => {
    const cols = {
      root: { name: { et: 'R', en: 'R' }, parent: undefined, order: 1 },
      child: { name: { et: 'C', en: 'C' }, parent: 'root', order: 1 },
    } as Collections;
    const tree = buildCollectionTree(cols);
    expect(tree.length).toBe(1);
    expect(tree[0].id).toBe('root');
    expect(tree[0].children.length).toBe(1);
    expect(tree[0].children[0].id).toBe('child');
  });
});

describe('getWritableCollectionOptions', () => {
  it('jätab virtual_group tüüpi kollektsioonid välja', () => {
    const cols = {
      grupp: { name: { et: 'Grupp', en: 'Group' }, type: 'virtual_group' },
      a: { name: { et: 'Aakadeemia', en: 'Academy' } },
      b: { name: { et: 'Bibliotheca', en: 'Library' } },
    } as unknown as Collections;
    const options = getWritableCollectionOptions(cols);
    expect(options.map(o => o.id)).toEqual(['a', 'b']);
    expect(options.find(o => o.id === 'grupp')).toBeUndefined();
  });

  it('sorditakse kuvanime järgi', () => {
    const cols = {
      z: { name: { et: 'Ülikool', en: 'University' } },
      a: { name: { et: 'Akadeemia', en: 'Academy' } },
    } as unknown as Collections;
    expect(getWritableCollectionOptions(cols).map(o => o.id)).toEqual(['a', 'z']);
  });

  it('kasutab en nime, kui lang=en, fallback et-le', () => {
    const cols = {
      a: { name: { et: 'Eesti', en: 'English' } },
      b: { name: { et: 'Ainult eesti', en: '' } },
    } as unknown as Collections;
    const options = getWritableCollectionOptions(cols, 'en');
    expect(options.find(o => o.id === 'a')?.name).toBe('English');
    expect(options.find(o => o.id === 'b')?.name).toBe('Ainult eesti');
  });
});

// =========================================================
// FETCH-PÕHISED (cache + viga)
// =========================================================

describe('getCollections', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearCache();
  });

  it('cache-b edu korral', async () => {
    const cols = { a: { name: { et: 'A', en: 'A' } } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'success', collections: cols }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getCollections()).toEqual(cols);
    expect(await getCollections()).toEqual(cols); // cache
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('viga → tühi objekt {}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    expect(await getCollections()).toEqual({});
  });

  it('HTTP vea → tühi objekt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    expect(await getCollections()).toEqual({});
  });

  it('forceRefresh ületab cache', async () => {
    const cols = { a: { name: { et: 'A', en: 'A' } } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'success', collections: cols }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await getCollections();
    await getCollections(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('getVocabularies', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    clearCache();
  });

  const emptyVocab = {
    types: {}, genres: {}, roles: {}, languages: {}, relation_types: {},
  };

  it('cache-b edu korral', async () => {
    const vocab = { types: { Q1: { et: 'T', en: 'T' } } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'success', vocabularies: vocab }),
    });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getVocabularies()).toEqual(vocab);
    expect(await getVocabularies()).toEqual(vocab);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('viga → tühi struktuur', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')));
    expect(await getVocabularies()).toEqual(emptyVocab);
  });
});
