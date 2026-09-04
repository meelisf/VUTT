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

interface WorkScope {
  collections?: string[];
}

interface UserScope {
  role?: string;
  edit_collections?: string[];
}

/**
 * Kas kasutaja tohib teost muuta. Peegeldab serveri can_write_work'i
 * ulatuse-osa (ADR 0031). Lugemisõiguse osa jääb serverile — frontend on
 * ergonoomika, mitte turve.
 *
 * Fail-closed: puuduv roll = contributor (piiratud).
 */
export function canEditWork(user: UserScope | null | undefined, work: WorkScope | null | undefined): boolean {
  if (!user) return false;
  // Fail-closed: puuduv roll tähendab contributor'it (piiratud), mitte admin'it
  const role = user.role ?? 'contributor';
  if (role !== 'contributor') return true;
  const scope = user.edit_collections ?? [];
  if (scope.length === 0) return false;
  const workCollections = work?.collections ?? [];
  return workCollections.some((c) => scope.includes(c));
}

/**
 * Kirjutamisulatus kuvamiseks (Seaded → „Minu õigused").
 * `all` = piiranguta (editor ja üle), `collections` = contributor'i ulatus,
 * `none` = contributor ilma ulatuseta (ei saa mitte kuskil salvestada).
 */
export type WriteScope =
  | { kind: 'all' }
  | { kind: 'collections'; ids: string[] }
  | { kind: 'none' };

/**
 * Sama fail-closed loogika mis `canEditWork`-il: ainult TUNTUD editor+ roll
 * annab piiranguta ulatuse, kõik muu (sh `undefined` ja tundmatu roll)
 * käitub contributor'ina.
 */
export function describeWriteScope(role: string | undefined | null, editCollections?: string[]): WriteScope {
  if (isAtLeast(role, 'editor')) return { kind: 'all' };
  const ids = editCollections ?? [];
  return ids.length > 0 ? { kind: 'collections', ids } : { kind: 'none' };
}
