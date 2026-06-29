import { describe, it, expect } from 'vitest';
import { roleLevel, canManageUser, canAssignRole, assignableRoles, ROLE_LEVELS } from '../roleUtils';

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
});
