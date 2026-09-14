import { describe, it, expect } from 'vitest';
import { searchUsers, SearchableUser } from '../userSearch';

const USERS: SearchableUser[] = [
  { username: 'mari', name: 'Mari Mets', email: 'mari@ut.ee' },
  { username: 'juri', name: 'Jüri Jõgi', email: 'juri@ut.ee' },
  { username: 'aadu', name: 'Aadu Admin', email: 'aadu@ut.ee' },
];

describe('searchUsers', () => {
  it('otsib nime, kasutajanime ja e-posti järgi', () => {
    expect(searchUsers(USERS, 'mets').map(u => u.username)).toEqual(['mari']);
    expect(searchUsers(USERS, 'juri').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'aadu@ut').map(u => u.username)).toEqual(['aadu']);
  });

  it('on diakriitikatundetu MÕLEMAS suunas', () => {
    expect(searchUsers(USERS, 'jogi').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'JÕGI').map(u => u.username)).toEqual(['juri']);
    expect(searchUsers(USERS, 'jyri').map(u => u.username)).toEqual([]);
  });

  it('tühi päring annab kõik', () => {
    expect(searchUsers(USERS, '   ')).toHaveLength(3);
  });

  it('säilitab kutsuja tüübi lisaväljadega', () => {
    const laiendatud = [{ ...USERS[0], role: 'contributor' }];
    expect(searchUsers(laiendatud, 'mari')[0].role).toBe('contributor');
  });
});
