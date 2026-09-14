import { describe, it, expect } from 'vitest';
import {
  affectedUsernames, canAddAllowed, canAddEdit, rightsControl, rightsDelta, rightsRows,
  rowVisible, RightsState, RightsUser,
} from '../collectionRightsDraft';

const USERS: RightsUser[] = [
  { username: 'mari', name: 'Mari Mets', email: 'mari@ut.ee', role: 'contributor' },
  { username: 'juri', name: 'Jüri Jõgi', email: 'juri@ut.ee', role: 'editor' },
  { username: 'aadu', name: 'Aadu Admin', email: 'aadu@ut.ee', role: 'admin' },
];
const ADMIN = { username: 'aadu', role: 'admin' };

const olek = (p: Partial<RightsState> = {}): RightsState => ({
  visibility: 'restricted', isVirtual: false,
  allowed: new Set<string>(), edit: new Set<string>(), ...p,
});

describe('rightsRows — alus', () => {
  it('piiratud kogul on määratud lugemisõigus „assigned"', () => {
    const [r] = rightsRows(olek({ allowed: new Set(['mari']) }), USERS, ADMIN);
    expect(r.username).toBe('mari');
    expect(r.allowed).toBe(true);
    expect(r.allowedBasis).toBe('assigned');
  });

  it('avalikul kogul on salvestatud lugemismäärang INERTNE, mitte kehtiv', () => {
    const [r] = rightsRows(
      olek({ visibility: 'public', allowed: new Set(['mari']) }), USERS, ADMIN);
    expect(r.allowed).toBe(true);
    expect(r.allowedBasis).toBe('inert');
  });

  it('editor+ salvestatud kirjutamisulatus on inertne — ulatus tuleb rollist', () => {
    const [r] = rightsRows(olek({ edit: new Set(['juri']) }), USERS, ADMIN);
    expect(r.username).toBe('juri');
    expect(r.edit).toBe(true);
    expect(r.editBasis).toBe('role_based');
  });

  it('contributori kirjutamisulatus on päris määrang', () => {
    const [r] = rightsRows(olek({ edit: new Set(['mari']) }), USERS, ADMIN);
    expect(r.editBasis).toBe('assigned');
  });

  it('admin+ kasutaja lugemisõigus tuleneb rollist', () => {
    const [r] = rightsRows(olek({ allowed: new Set(['aadu']) }), USERS, ADMIN);
    expect(r.allowedBasis).toBe('role_based');
  });

  it('sama kasutaja mõlemal teljel annab ÜHE rea', () => {
    const read = rightsRows(
      olek({ allowed: new Set(['mari']), edit: new Set(['mari']) }), USERS, ADMIN);
    expect(read).toHaveLength(1);
    expect(read[0].allowed && read[0].edit).toBe(true);
  });

  it('järjestab kasutajanime järgi', () => {
    const read = rightsRows(
      olek({ allowed: new Set(['mari', 'juri']) }), USERS, ADMIN);
    expect(read.map(r => r.username)).toEqual(['juri', 'mari']);
  });

  it('võrdse rolliga kasutaja rida ei ole hallatav', () => {
    const [r] = rightsRows(olek({ allowed: new Set(['aadu']) }), USERS, ADMIN);
    expect(r.canManage).toBe(false);
  });

  it('tundmatu kasutajaloend ei märgi kedagi rollipõhiseks', () => {
    // Loendi puudumine ei ole teadmine puudumisest (sama viga mis 1b-s).
    const [r] = rightsRows(olek({ allowed: new Set(['keegi']) }), [], ADMIN,
                           { usersKnown: false });
    expect(r.allowedBasis).toBe('assigned');
    expect(r.canManage).toBe(false);
  });
});

describe('canAddAllowed / canAddEdit', () => {
  it('avalikule kogule lugemisõigust ei lisata', () => {
    expect(canAddAllowed(olek({ visibility: 'public' }))).toBe(false);
    expect(canAddAllowed(olek())).toBe(true);
  });

  it('virtuaalsele rühmale kirjutamisulatust ei pakuta', () => {
    expect(canAddEdit(olek({ isVirtual: true }), 'contributor')).toBe(false);
  });

  it('kirjutamisulatust pakutakse ainult contributor-ile', () => {
    expect(canAddEdit(olek(), 'contributor')).toBe(true);
    expect(canAddEdit(olek(), 'editor')).toBe(false);
  });

  it('kirjutamisulatus AVALIKUL kogul on lubatud — teljed on eraldi', () => {
    expect(canAddEdit(olek({ visibility: 'public' }), 'contributor')).toBe(true);
  });
});

describe('rightsDelta', () => {
  const laetud = olek({ allowed: new Set(['mari']), edit: new Set(['juri']) });

  it('muutusteta mustand annab tühja delta', () => {
    expect(rightsDelta(laetud, olek({ allowed: new Set(['mari']), edit: new Set(['juri']) }), 'k'))
      .toEqual([]);
  });

  it('lisamine ja eemaldamine mõlemal teljel', () => {
    const d = rightsDelta(laetud, olek({ allowed: new Set(['juri']), edit: new Set() }), 'k');
    expect(d).toEqual([
      { username: 'juri', collection_id: 'k', field: 'allowed', action: 'add' },
      { username: 'mari', collection_id: 'k', field: 'allowed', action: 'remove' },
      { username: 'juri', collection_id: 'k', field: 'edit', action: 'remove' },
    ]);
  });

  it('puutumata telg ei tekita ühtki muudatust', () => {
    const d = rightsDelta(laetud, olek({ allowed: new Set(['mari']), edit: new Set() }), 'k');
    expect(d.every(c => c.field === 'edit')).toBe(true);
  });
});

describe('affectedUsernames', () => {
  it('üks nimi inimese kohta, ka kahe muudatuse korral', () => {
    expect(affectedUsernames([
      { username: 'mari', collection_id: 'k', field: 'allowed', action: 'add' },
      { username: 'mari', collection_id: 'k', field: 'edit', action: 'add' },
      { username: 'juri', collection_id: 'k', field: 'allowed', action: 'remove' },
    ])).toEqual(['juri', 'mari']);
  });
});

describe('rightsControl — lüliti ainult seal, kus lülitamine midagi muudab', () => {
  const k = (p: Partial<Parameters<typeof rightsControl>[0]> = {}) =>
    rightsControl({ basis: 'assigned', checked: false, canManage: true, canAdd: true, ...p });

  it('määratud õigus on lüliti: selle saab maha võtta', () => {
    expect(k({ basis: 'assigned', checked: true })).toBe('toggle');
  });

  it('märkimata määrang on lüliti ainult siis, kui lisada üldse saab', () => {
    expect(k({ checked: false, canAdd: true })).toBe('toggle');
    // Avalik kogu, virtuaalne rühm, toimetaja ulatus: server lükkaks lisamise
    // tagasi. Hall kastike, mida ei saa märkida, on ainult müra.
    expect(k({ checked: false, canAdd: false })).toBe('hidden');
  });

  it('rollist tulenev õigus ILMA salvestatud kirjeta ei kuvata', () => {
    // See oli segaduse allikas: kastike, mille olek ei ütle midagi ja mille
    // lülitamine ei muuda midagi.
    expect(k({ basis: 'role_based', checked: false })).toBe('hidden');
  });

  it('salvestatud kirje, mis ei mõju, on koristatav väide', () => {
    expect(k({ basis: 'role_based', checked: true })).toBe('remnant');
    expect(k({ basis: 'inert', checked: true })).toBe('remnant');
  });

  it('ilma haldusõiguseta pole lülitit: olemasolev õigus on väide, puuduv kaob', () => {
    expect(k({ basis: 'assigned', checked: true, canManage: false })).toBe('fact');
    expect(k({ basis: 'assigned', checked: false, canManage: false })).toBe('hidden');
    // Ka jäänukit ei saa koristada see, kes kasutajat hallata ei tohi.
    expect(k({ basis: 'inert', checked: true, canManage: false })).toBe('fact');
  });
});

describe('rowVisible', () => {
  it('rida, millel ei ole ühtki nähtavat telge, jääb renderdamata', () => {
    expect(rowVisible('hidden', 'hidden')).toBe(false);
    expect(rowVisible('hidden', 'remnant')).toBe(true);
    expect(rowVisible('toggle', 'hidden')).toBe(true);
  });
});
