import { describe, it, expect } from 'vitest';
import {
  ALL_COLLECTIONS,
  decideStoredCollection,
  parseSelection,
  readSelectionToken,
  resolveInitialCollection,
  serializeSelection,
  writeSelectionToken,
} from '../collectionUrl';

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

/**
 * Töökollektsiooni valik URL-is (#354).
 *
 * Token PEAB URL-i täpselt peegelduma: `agreed` võrdleb URL-ist loetud tokenit
 * sellega, mille me ise kirjutasime. Kui serialiseerimine ja lugemine annaksid
 * eri kuju (nt kirjutame `c:x`, loeme `x`), ei jõuaks sünkroniseerimine kunagi
 * püsipunkti — täpselt see #333 viga, ainult teises kohas.
 */
describe('valiku token', () => {
  it('serialiseerib ja parsib mõlemat liiki valiku', () => {
    expect(serializeSelection({ kind: 'work_set', id: 'ws_1' })).toBe('s:ws_1');
    expect(serializeSelection({ kind: 'all' })).toBe('all');
    expect(parseSelection('c:academia-gustaviana'))
      .toEqual({ kind: 'collection', id: 'academia-gustaviana' });
    expect(parseSelection('all')).toEqual({ kind: 'all' });
    expect(parseSelection(null)).toEqual({ kind: 'all' });
  });

  it('püsikogu token on PALJAS id — just nii, nagu ta URL-is seisab', () => {
    expect(serializeSelection({ kind: 'collection', id: 'klingeriana' })).toBe('klingeriana');
    expect(parseSelection('klingeriana')).toEqual({ kind: 'collection', id: 'klingeriana' });
  });

  it('token käib täisringi URL-i ja tagasi muutumatuna', () => {
    for (const s of [
      { kind: 'all' } as const,
      { kind: 'collection', id: 'klingeriana' } as const,
      { kind: 'work_set', id: 'ws_1' } as const,
    ]) {
      const params = new URLSearchParams();
      writeSelectionToken(params, serializeSelection(s));
      expect(readSelectionToken(params)).toBe(serializeSelection(s));
      expect(parseSelection(readSelectionToken(params))).toEqual(s);
    }
  });

  it('kirjutamine eemaldab teise parameetri', () => {
    const params = new URLSearchParams('collection=klingeriana&page=3');
    writeSelectionToken(params, 's:ws_1');
    expect(params.get('collection')).toBeNull();
    expect(params.get('set')).toBe('ws_1');
    expect(params.get('page')).toBe('3');

    writeSelectionToken(params, 'klingeriana');
    expect(params.get('set')).toBeNull();
    expect(params.get('collection')).toBe('klingeriana');
  });

  it('kui välises URL-is on mõlemad, võidab set', () => {
    const params = new URLSearchParams('collection=klingeriana&set=ws_1');
    expect(readSelectionToken(params)).toBe('s:ws_1');
  });
});
