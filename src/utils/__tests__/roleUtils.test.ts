import { describe, it, expect } from 'vitest';
import { roleLevel, canManageUser, canAssignRole, assignableRoles, isAtLeast, canEditWork, ROLE_LEVELS } from '../roleUtils';

describe('roleUtils', () => {
  it('hierarhia neli taset', () => {
    expect(ROLE_LEVELS).toEqual({ contributor: 0, editor: 1, admin: 2, superadmin: 3 });
  });
  it('tundmatu roll = -1 (ei anna õigusi)', () => {
    expect(roleLevel('user')).toBe(-1);
    expect(roleLevel('admin')).toBe(2);
  });
  it('canManageUser ainult rangelt madalam', () => {
    expect(canManageUser('admin', 'editor')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('superadmin', 'admin')).toBe(true);
    expect(canManageUser('superadmin', 'superadmin')).toBe(false);
  });
  it('canAssignRole lagi', () => {
    expect(canAssignRole('admin', 'editor')).toBe(true);
    expect(canAssignRole('admin', 'admin')).toBe(false);
    expect(canAssignRole('superadmin', 'admin')).toBe(true);
    expect(canAssignRole('superadmin', 'superadmin')).toBe(false);
  });
  it('assignableRoles filter', () => {
    expect(assignableRoles('admin')).toEqual(['contributor', 'editor']);
    expect(assignableRoles('superadmin')).toEqual(['contributor', 'editor', 'admin']);
  });
  it('isAtLeast: superadmin loeb adminiks', () => {
    expect(isAtLeast('superadmin', 'admin')).toBe(true);
    expect(isAtLeast('admin', 'admin')).toBe(true);
    expect(isAtLeast('editor', 'admin')).toBe(false);
    expect(isAtLeast('superadmin', 'editor')).toBe(true);
    expect(isAtLeast(undefined, 'admin')).toBe(false);
    expect(isAtLeast(null, 'admin')).toBe(false);
  });
});

describe('canEditWork', () => {
  const work = { collections: ['oma'] };

  it('lubab editoril kõike', () => {
    expect(canEditWork({ role: 'editor' }, work)).toBe(true);
  });

  it('lubab contributoril oma kollektsiooni', () => {
    expect(canEditWork({ role: 'contributor', edit_collections: ['oma'] }, work)).toBe(true);
  });

  it('keelab contributoril võõra kollektsiooni', () => {
    expect(canEditWork({ role: 'contributor', edit_collections: ['muu'] }, work)).toBe(false);
  });

  it('keelab contributoril kollektsioonita teose', () => {
    expect(canEditWork({ role: 'contributor', edit_collections: ['oma'] }, { collections: [] })).toBe(false);
  });

  it('keelab välja logitud kasutajal', () => {
    expect(canEditWork(null, work)).toBe(false);
  });
});
