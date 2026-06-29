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

/**
 * Kas roll on vähemalt minRole tasemel? KASUTA seda täpse `role === 'admin'`
 * võrdluse asemel — superadmin loeb adminiks (ja administ kõrgemaks), muidu
 * kukub superadmin admin-funktsioonidest välja. `undefined`/tundmatu → false.
 */
export function isAtLeast(role: string | undefined | null, minRole: Role): boolean {
  if (!role) return false;
  return roleLevel(role) >= ROLE_LEVELS[minRole];
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
