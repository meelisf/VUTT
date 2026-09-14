/**
 * Kollektsiooniõiguste päringud (#318, ADR 0043 p2).
 *
 * Kaks telge: `allowed` = lugemisõigus piiratud kogule, `edit` =
 * contributori kirjutamisulatus (kehtib KÕIGILE kogudele, ADR 0031).
 * Üks ei anna teist.
 *
 * Delta saadab AINULT muudetud määrangud — mitte tervet loendit. Vana
 * täisasendus võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt
 * maha võtta; delta puudutab ainult nimetatud kolmikuid.
 */
import { apiGet, apiPost } from './apiClient';

const AUTH = { useLocalStorageToken: true } as const;

export interface CollectionRights {
  collection: { name?: Record<string, string>; [k: string]: unknown };
  allowed_users: string[];
  edit_users: string[];
  visibility: 'public' | 'restricted';
  is_virtual: boolean;
}

export type RightsField = 'allowed' | 'edit';

export interface RightsChange {
  username: string;
  collection_id: string;
  field: RightsField;
  action: 'add' | 'remove';
}

export interface RightsResult {
  users: Record<string, { allowed_collections: string[]; edit_collections: string[] }>;
}

export async function getCollectionRights(id: string): Promise<CollectionRights> {
  const d = await apiGet<CollectionRights & { status?: string; message?: string }>(
    `/admin/collections/${id}/users`, AUTH);
  if (d.status === 'error') throw new Error(d.message || 'Laadimine ebaõnnestus');
  return d;
}

export async function applyCollectionRights(changes: RightsChange[]): Promise<RightsResult> {
  return apiPost<RightsResult>('/admin/users/collection-rights', { changes }, AUTH);
}
