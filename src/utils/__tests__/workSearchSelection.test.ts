import { describe, expect, it } from 'vitest';
import { collectionForWorkSearch } from '../workSearchSelection';

const HIER = ['academia-gustavo-carolina', 'universitas-dorpatensis'];

describe('collectionForWorkSearch', () => {
  it('töökollektsioon, mis teost sisaldab, jääb valituks (Fischeri konverents → 179o97)', () => {
    expect(collectionForWorkSearch({ kind: 'work_set', id: 's1' }, HIER, '179o97', ['179o97', 'x'])).toBeNull();
  });

  it('töökollektsioon, kus teost pole → teose kogu (muidu oleks otsing tühi)', () => {
    expect(collectionForWorkSearch({ kind: 'work_set', id: 's1' }, HIER, '179o97', ['x']))
      .toBe('academia-gustavo-carolina');
  });

  it('töökollektsiooni loend teadmata (päring kukkus) → valikut ei muudeta', () => {
    expect(collectionForWorkSearch({ kind: 'work_set', id: 's1' }, HIER, '179o97', null)).toBeNull();
  });

  it('püsikogu teose hierarhias jääb; väljaspool → teose kogu', () => {
    expect(collectionForWorkSearch({ kind: 'collection', id: 'universitas-dorpatensis' }, HIER, 'w', null)).toBeNull();
    expect(collectionForWorkSearch({ kind: 'collection', id: 'muu' }, HIER, 'w', null)).toBe('academia-gustavo-carolina');
  });

  it('„kõik" käitub nagu varem: teose esimene kogu', () => {
    expect(collectionForWorkSearch({ kind: 'all' }, HIER, 'w', null)).toBe('academia-gustavo-carolina');
  });

  it('kogudeta teos → valikut ei muudeta', () => {
    expect(collectionForWorkSearch({ kind: 'collection', id: 'muu' }, [], 'w', null)).toBeNull();
  });
});
