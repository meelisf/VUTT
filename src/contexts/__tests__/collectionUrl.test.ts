import { describe, it, expect } from 'vitest';
import { ALL_COLLECTIONS, resolveInitialCollection } from '../collectionUrl';

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
    expect(resolveInitialCollection(null, 'kadunud', COLLECTIONS, DEFAULT)).toBeNull();
  });

  it('tundmatu vaikekogu ei tekita fantoomvalikut', () => {
    expect(resolveInitialCollection(null, null, COLLECTIONS, 'pole-olemas')).toBeNull();
  });
});
