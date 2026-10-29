import { describe, it, expect } from 'vitest';
import { restoreNotice, restoreErrorText } from '../useRestoreAction';

describe('restoreNotice', () => {
  const messages = { success: 'Taastatud', gitWarning: 'Commit puudub', error: 'Viga' };

  it('commit õnnestus → eduteade', () => {
    expect(restoreNotice({ gitCommitted: true }, messages)).toEqual({ text: 'Taastatud', kind: 'success' });
  });

  it('commit puudub → hoiatus, edu ei peida seda', () => {
    expect(restoreNotice({ gitCommitted: false }, messages))
      .toEqual({ text: 'Taastatud\n\nCommit puudub', kind: 'warning' });
  });

  it('eduteateta toiming: õnnestumisel vaikib, puuduval commitil hoiatab', () => {
    const m = { gitWarning: 'Commit puudub', error: 'Viga' };
    expect(restoreNotice({ gitCommitted: true }, m)).toBeNull();
    expect(restoreNotice({ gitCommitted: false }, m)).toEqual({ text: 'Commit puudub', kind: 'warning' });
  });

  it('hoiatus võib sõltuda tulemusest', () => {
    const m = { gitWarning: (o: { gitCommitted: boolean; gitError: string }) => `Commit puudub (${o.gitError})`, error: 'Viga' };
    expect(restoreNotice({ gitCommitted: false, gitError: 'lock' }, m)?.text).toBe('Commit puudub (lock)');
  });
});

describe('restoreErrorText', () => {
  it('lisab erindi sõnumi eesliitele', () => {
    expect(restoreErrorText('Taastamine ebaõnnestus', new Error('409'))).toBe('Taastamine ebaõnnestus: 409');
  });

  it('sõnumita erind → ainult eesliide', () => {
    expect(restoreErrorText('Taastamine ebaõnnestus', new Error(''))).toBe('Taastamine ebaõnnestus');
    expect(restoreErrorText('Taastamine ebaõnnestus', 'string')).toBe('Taastamine ebaõnnestus');
  });
});
