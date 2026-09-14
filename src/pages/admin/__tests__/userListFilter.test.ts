import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, filterUsers, filtersFromParams, ListUser, paramsFromFilters,
} from '../userListFilter';

const KASUTAJAD: ListUser[] = [
  { username: 'mati', name: 'Mati Jõgi', email: 'mati@ut.ee', role: 'contributor',
    allowed_collections: ['kinnine'], edit_collections: [] },
  { username: 'kati', name: 'Kati Kask', email: 'kati@ut.ee', role: 'editor',
    allowed_collections: [], edit_collections: ['kinnine'] },
  { username: 'juhan', name: 'Juhan Tamm', email: 'juhan@ut.ee', role: 'admin',
    allowed_collections: [], edit_collections: [] },
];

const KOGUD = { set1: { mati: 'viewer' } };

describe('filterUsers', () => {
  it('tühjad filtrid annavad kõik', () => {
    expect(filterUsers(KASUTAJAD, EMPTY_FILTERS, KOGUD)).toHaveLength(3);
  });

  it('rollifilter', () => {
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, role: 'editor' }, KOGUD)
      .map(u => u.username)).toEqual(['kati']);
  });

  it('kogu filter katab MÕLEMAD teljed', () => {
    // „Kellel on selle koguga seotud salvestatud määrang" — lugemisõigus VÕI
    // kirjutamisulatus. Ainult ühe telje vaatamine peidaks poole vastusest.
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, rightsCollection: 'kinnine' }, KOGUD)
      .map(u => u.username).sort()).toEqual(['kati', 'mati']);
  });

  it('töökollektsiooni filter', () => {
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, rightsWorkSet: 'set1' }, KOGUD)
      .map(u => u.username)).toEqual(['mati']);
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, rightsWorkSet: 'tundmatu' }, KOGUD))
      .toEqual([]);
  });

  it('otsing on diakriitikatundetu ja käib ka kasutajanime ning e-posti järgi', () => {
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, q: 'jogi' }, KOGUD)
      .map(u => u.username)).toEqual(['mati']);
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, q: 'kati@ut' }, KOGUD)
      .map(u => u.username)).toEqual(['kati']);
  });

  it('filtrid liituvad JA-ga', () => {
    expect(filterUsers(KASUTAJAD,
      { q: 'a', role: 'contributor', rightsCollection: 'kinnine', rightsWorkSet: 'set1' }, KOGUD)
      .map(u => u.username)).toEqual(['mati']);
  });
});

describe('URL-i teisendus', () => {
  it('tühi väärtus ei lähe URL-i', () => {
    expect(paramsFromFilters({ ...EMPTY_FILTERS, q: 'mati' })).toEqual({ q: 'mati' });
  });

  it('URL → filtrid → URL on stabiilne', () => {
    const p = new URLSearchParams({ q: 'mati', role: 'editor', rights_collection: 'kinnine' });
    const f = filtersFromParams(p);
    expect(f).toEqual({ q: 'mati', role: 'editor', rightsCollection: 'kinnine', rightsWorkSet: '' });
    expect(paramsFromFilters(f)).toEqual(
      { q: 'mati', role: 'editor', rights_collection: 'kinnine' });
  });

  it('tundmatu parameeter ei tühjenda loendit', () => {
    const f = filtersFromParams(new URLSearchParams({ collection: 'kinnine' }));
    expect(f).toEqual(EMPTY_FILTERS);
  });
});
