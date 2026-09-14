import { describe, expect, it } from 'vitest';
import {
  addableAllowed, addableEdit, CollectionInfo, userRightsDelta, userRightsRows,
  UserRightsState,
} from '../userRightsDraft';

const KOGUD: Record<string, CollectionInfo> = {
  kinnine: { id: 'kinnine', name: 'Kinnine', visibility: 'restricted', isVirtual: false },
  avalik: { id: 'avalik', name: 'Avalik', visibility: 'public', isVirtual: false },
  ruhm: { id: 'ruhm', name: 'Rühm', visibility: 'public', isVirtual: true },
};

const olek = (allowed: string[], edit: string[]): UserRightsState =>
  ({ allowed: new Set(allowed), edit: new Set(edit) });

describe('userRightsRows', () => {
  it('contributori määrang on „assigned"', () => {
    const [rida] = userRightsRows(olek(['kinnine'], ['kinnine']), KOGUD, 'contributor');
    expect(rida.collectionId).toBe('kinnine');
    expect(rida.allowedBasis).toBe('assigned');
    expect(rida.editBasis).toBe('assigned');
    expect(rida.exists).toBe(true);
  });

  it('toimetaja kirjutamisulatus tuleb rollist, lugemisõigus mitte', () => {
    // ADR 0031: editor'i ulatus on üldine, aga piiratud kogu LUGEMISõigust
    // vajab ta endiselt — seepärast ei tohi mõlemad alused olla ühesugused.
    const [rida] = userRightsRows(olek(['kinnine'], ['kinnine']), KOGUD, 'editor');
    expect(rida.editBasis).toBe('role_based');
    expect(rida.allowedBasis).toBe('assigned');
  });

  it('adminil on mõlemad alused rollist', () => {
    const [rida] = userRightsRows(olek(['kinnine'], ['kinnine']), KOGUD, 'admin');
    expect(rida.allowedBasis).toBe('role_based');
    expect(rida.editBasis).toBe('role_based');
  });

  it('avaliku kogu lugemismäärang on inertne jäänuk', () => {
    const [rida] = userRightsRows(olek(['avalik'], []), KOGUD, 'contributor');
    expect(rida.allowedBasis).toBe('inert');
    expect(rida.allowed).toBe(true);  // määrang on ALLES ja taasjõustub piiramisel
  });

  it('kustutatud kogu jäänuk on nähtav, inertne ja lõpus', () => {
    const read = userRightsRows(olek(['kinnine', 'kadunud'], []), KOGUD, 'contributor');
    expect(read.map(r => r.collectionId)).toEqual(['kinnine', 'kadunud']);
    const kadunud = read[1];
    expect(kadunud.exists).toBe(false);
    expect(kadunud.allowedBasis).toBe('inert');
    expect(kadunud.name).toBe('kadunud');
  });
});

describe('addableAllowed / addableEdit', () => {
  it('lugemisõigust pakutakse ainult piiratud ja veel määramata kogule', () => {
    expect(addableAllowed(KOGUD, olek([], [])).map(c => c.id)).toEqual(['kinnine']);
    expect(addableAllowed(KOGUD, olek(['kinnine'], [])).map(c => c.id)).toEqual([]);
  });

  it('kirjutamisulatust ei pakuta toimetajale ega virtuaalsele rühmale', () => {
    expect(addableEdit(KOGUD, olek([], []), 'editor')).toEqual([]);
    expect(addableEdit(KOGUD, olek([], []), 'contributor').map(c => c.id))
      .toEqual(['avalik', 'kinnine']);
  });
});

describe('userRightsDelta', () => {
  it('puutumata olek ei tekita muudatust', () => {
    expect(userRightsDelta(olek(['kinnine'], []), olek(['kinnine'], []), 'mati')).toEqual([]);
  });

  it('kaks telge on eraldi kolmikud', () => {
    const delta = userRightsDelta(olek(['kinnine'], []), olek([], ['kinnine']), 'mati');
    expect(delta).toEqual([
      { username: 'mati', collection_id: 'kinnine', field: 'edit', action: 'add' },
      { username: 'mati', collection_id: 'kinnine', field: 'allowed', action: 'remove' },
    ]);
  });

  it('kustutatud kogu jäänukit tohib eemaldada', () => {
    const delta = userRightsDelta(olek(['kadunud'], []), olek([], []), 'mati');
    expect(delta).toEqual([
      { username: 'mati', collection_id: 'kadunud', field: 'allowed', action: 'remove' },
    ]);
  });
});
