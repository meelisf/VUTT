import { describe, it, expect } from 'vitest';
import {
  addableUsers, classifyEntries, draftChanged, searchUsers, KnownUser,
} from '../workSetAccessDraft';
import { SetRole } from '../workSetAccess';

const USERS: KnownUser[] = [
  { username: 'mari', name: 'Mari Mets', email: 'mari@ut.ee', role: 'contributor' },
  { username: 'juri', name: 'Jüri Jõgi', email: 'juri@ut.ee', role: 'editor' },
  { username: 'aadu', name: 'Aadu Admin', email: 'aadu@ut.ee', role: 'admin' },
  { username: 'siim', name: 'Siim Super', email: 'siim@ut.ee', role: 'superadmin' },
];
const ADMIN = { username: 'aadu', role: 'admin' };
const SUPER = { username: 'siim', role: 'superadmin' };

describe('classifyEntries', () => {
  it('tavaline madalama rolliga kirje on muudetav ja eemaldatav', () => {
    const [rida] = classifyEntries({ mari: 'viewer' }, USERS, ADMIN);
    expect(rida).toEqual({ username: 'mari', role: 'viewer', kind: 'normal',
                           canChange: true, canRemove: true });
  });

  it('admin+ kirje on rollist tulenev ja mitte muudetav', () => {
    const [rida] = classifyEntries({ siim: 'manager' }, USERS, ADMIN);
    expect(rida.kind).toBe('role_based');
    expect(rida.canChange).toBe(false);
    // admin ei tohi superadmini kirjet ka eemaldada
    expect(rida.canRemove).toBe(false);
  });

  it('enda dekoratiivse kirje tohib eemaldada, aga mitte muuta', () => {
    const [rida] = classifyEntries({ aadu: 'manager' }, USERS, ADMIN);
    expect(rida.kind).toBe('role_based');
    expect(rida.canChange).toBe(false);
    expect(rida.canRemove).toBe(true);
  });

  it('superadmin tohib admini vana kirje eemaldada', () => {
    const [rida] = classifyEntries({ aadu: 'manager' }, USERS, SUPER);
    expect(rida.canRemove).toBe(true);
    expect(rida.canChange).toBe(false);
  });

  it('tundmatu kasutajanimi on kustutatud kasutaja: eemaldatav, mitte muudetav', () => {
    const [rida] = classifyEntries({ kadunud: 'viewer' }, USERS, ADMIN);
    expect(rida.kind).toBe('deleted_user');
    expect(rida.canChange).toBe(false);
    expect(rida.canRemove).toBe(true);
  });

  it('järjestab kasutajanime järgi, et diff oleks stabiilne', () => {
    const read = classifyEntries({ mari: 'viewer', juri: 'manager' }, USERS, ADMIN);
    expect(read.map(r => r.username)).toEqual(['juri', 'mari']);
  });
});

describe('addableUsers', () => {
  it('jätab välja admin+ kasutajad — nende haldusõigus tuleneb rollist', () => {
    expect(addableUsers(USERS, {}, ADMIN).map(u => u.username)).toEqual(['mari', 'juri']);
  });

  it('jätab välja juba lisatud inimesed', () => {
    expect(addableUsers(USERS, { mari: 'viewer' }, ADMIN).map(u => u.username)).toEqual(['juri']);
  });

  it('superadminile kehtib sama admin+ piirang', () => {
    expect(addableUsers(USERS, {}, SUPER).map(u => u.username)).toEqual(['mari', 'juri']);
  });
});

describe('searchUsers', () => {
  it('otsib nime, kasutajanime ja e-posti järgi', () => {
    expect(searchUsers(USERS, 'mets').map(u => u.username)).toEqual(['mari']);
    expect(searchUsers(USERS, 'juri').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'aadu@ut').map(u => u.username)).toEqual(['aadu']);
  });

  it('on diakriitikatundetu mõlemas suunas', () => {
    expect(searchUsers(USERS, 'jogi').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'JÕGI').map(u => u.username)).toEqual(['juri']);
  });

  it('tühi päring annab kõik', () => {
    expect(searchUsers(USERS, '   ')).toHaveLength(4);
  });
});

describe('draftChanged', () => {
  const laetud: Record<string, SetRole> = { mari: 'viewer', juri: 'manager' };

  it('sama kaart on muutusteta', () => {
    expect(draftChanged(laetud, { juri: 'manager', mari: 'viewer' })).toBe(false);
  });

  it('rolli vahetus on muutus', () => {
    expect(draftChanged(laetud, { mari: 'manager', juri: 'manager' })).toBe(true);
  });

  it('eemaldamine on muutus', () => {
    expect(draftChanged(laetud, { mari: 'viewer' })).toBe(true);
  });

  it('lisamine on muutus', () => {
    expect(draftChanged(laetud, { ...laetud, uus: 'viewer' })).toBe(true);
  });
});
