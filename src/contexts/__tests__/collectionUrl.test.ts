import { describe, it, expect } from 'vitest';
import { ALL_COLLECTIONS, decideStoredCollection, resolveInitialCollection } from '../collectionUrl';

const COLLECTIONS = {
  klingeriana: { name: { et: 'Klingeriana', en: 'Klingeriana' } },
  'universitas-dorpatensis-1': { name: { et: 'Rootsi aja ülikool', en: 'Swedish era' } },
} as never;

const DEFAULT = 'universitas-dorpatensis-1';

describe('resolveInitialCollection', () => {
  it('URL võidab saaja senise valiku', () => {
    // Jagatud link: saatja on Klingerianas, saaja seni mujal.
    expect(resolveInitialCollection('klingeriana', DEFAULT, COLLECTIONS, DEFAULT)).toBe('klingeriana');
  });

  it('URL-i "all" tähendab kõiki kogusid', () => {
    expect(resolveInitialCollection(ALL_COLLECTIONS, 'klingeriana', COLLECTIONS, DEFAULT)).toBeNull();
  });

  it('tundmatu kogu URL-is ei tühjenda vaadet', () => {
    // Kustutatud või ligipääsmatu kogu: jääb kehtima saaja senine valik.
    expect(resolveInitialCollection('kadunud', 'klingeriana', COLLECTIONS, DEFAULT)).toBe('klingeriana');
  });

  it('ilma URL-ita kehtib senine käitumine', () => {
    expect(resolveInitialCollection(null, 'klingeriana', COLLECTIONS, DEFAULT)).toBe('klingeriana');
    expect(resolveInitialCollection(null, null, COLLECTIONS, DEFAULT)).toBe(DEFAULT);
  });

  it('tundmatu salvestatud kogu käitub nagu salvestamata', () => {
    // Kustutatud kogu localStorage'is andis varem `null` ehk „kõik kogud" —
    // uus kasutaja sai vaikekogu, vana kasutaja terve korpuse. Salvestatud
    // väärtus, mida ei ole, EI ole valik.
    expect(resolveInitialCollection(null, 'kadunud', COLLECTIONS, DEFAULT)).toBe(DEFAULT);
  });

  it('tundmatu vaikekogu ei tekita fantoomvalikut', () => {
    expect(resolveInitialCollection(null, null, COLLECTIONS, 'pole-olemas')).toBeNull();
  });
});

/**
 * localStorage peab kehtivat valikut PEEGELDAMA. Kui ta kannab kogu, mida enam
 * ei ole, kordub vale vaade igal laadimisel — lahendus ei tohi elada ainult
 * mälus.
 */
describe('decideStoredCollection', () => {
  it('kehtiv salvestatud valik jääb puutumata', () => {
    expect(decideStoredCollection(null, 'klingeriana', COLLECTIONS, 'klingeriana'))
      .toEqual({ action: 'keep' });
  });

  it('kadunud salvestatud kogu asendatakse lahendatuga', () => {
    expect(decideStoredCollection(null, 'kadunud', COLLECTIONS, DEFAULT))
      .toEqual({ action: 'write', value: DEFAULT });
  });

  it('kadunud salvestatud kogu kustutatakse, kui lahendus on „kõik kogud"', () => {
    expect(decideStoredCollection(null, 'kadunud', COLLECTIONS, null))
      .toEqual({ action: 'clear' });
  });

  it('lingiga tulnud valik jääb kehtima', () => {
    expect(decideStoredCollection('klingeriana', DEFAULT, COLLECTIONS, 'klingeriana'))
      .toEqual({ action: 'write', value: 'klingeriana' });
  });

  it('lingi „all" kustutab salvestatud valiku', () => {
    expect(decideStoredCollection(ALL_COLLECTIONS, DEFAULT, COLLECTIONS, null))
      .toEqual({ action: 'clear' });
  });

  it('vaikekogu EI kinnistata salvestamata kasutajal', () => {
    // Muidu jääks ta vaikekogu muutumisel vanasse kinni.
    expect(decideStoredCollection(null, null, COLLECTIONS, DEFAULT))
      .toEqual({ action: 'keep' });
  });
});
