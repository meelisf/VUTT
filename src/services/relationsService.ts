/**
 * Teoste seosed (#701, ADR 0075). Kirjutus ainult PUT /works/{id}/relations
 * kaudu — server kirjutab mõlemad pooled ühe commitiga.
 */
import { FILE_API_URL } from '../config';
import type { Relation, ResolvedRelation } from '../types';
import { apiGet, apiPut } from './apiClient';

/** Kuvatavad seosed: praegu ainult variant. Muud liigid ei lähe arvu ega kuvamisse. */
export function variantRelations(rels?: Relation[] | null): Relation[] {
  return (rels || []).filter(r => r?.rel_type === 'isVersionOf');
}

export function fetchRelations(workId: string, token?: string): Promise<ResolvedRelation[]> {
  return apiGet<ResolvedRelation[]>(`${FILE_API_URL}/works/${encodeURIComponent(workId)}/relations`, { token });
}

export async function changeRelations(
  workId: string,
  change: { add: Relation[]; remove: Relation[] },
  token: string,
): Promise<ResolvedRelation[]> {
  const res = await apiPut<{ relations: ResolvedRelation[] }>(
    `${FILE_API_URL}/works/${encodeURIComponent(workId)}/relations`, change, { token });
  return res.relations;
}
