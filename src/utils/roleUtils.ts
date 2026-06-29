// Rolli-hierarhia frontend-pool. Peegeldab backendi ROLE_HIERARCHY-t.
// MUGAVUS, MITTE TURVE: kõik piirangud dubleeritakse backendis (can_manage_user jne).
export const ROLE_LEVELS: Record<string, number> = {
  contributor: 0,
  editor: 1,
  admin: 2,
  superadmin: 3,
};

export type Role = 'contributor' | 'editor' | 'admin' | 'superadmin';

const ORDER: Role[] = ['contributor', 'editor', 'admin', 'superadmin'];

/** Tundmatu roll = -1 (ei anna õigusi). EI vaikselt 0 — peegeldab backendi rangust. */
export function roleLevel(role: string): number {
  const lvl = ROLE_LEVELS[role];
  return lvl === undefined ? -1 : lvl;
}

export function canManageUser(actorRole: string, targetRole: string): boolean {
  return roleLevel(targetRole) < roleLevel(actorRole);
}

export function canAssignRole(actorRole: string, newRole: string): boolean {
  return roleLevel(newRole) < roleLevel(actorRole);
}

/** Rollid, mida actor tohib määrata (rangelt madalamad), hierarhia järjekorras. */
export function assignableRoles(actorRole: string): Role[] {
  return ORDER.filter((r) => canAssignRole(actorRole, r));
}
