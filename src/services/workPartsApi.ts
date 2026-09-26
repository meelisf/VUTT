// src/services/workPartsApi.ts
/** Teose osade API (#464, ADR 0057): /works/{id}/parts. */
import { ApiRequestOptions, apiDelete, apiGet, apiPost, apiPut } from './apiClient';
import type { WorkDating } from '../utils/workDating';

export type PartKind = 'letter' | 'poem' | 'speech' | 'session' | 'attachment';
export type PartRole = 'auctor' | 'addressee' | 'praeses' | 'participant' | 'subject';
export const PART_KINDS: PartKind[] = ['letter', 'poem', 'speech', 'session', 'attachment'];
export const PART_ROLES: PartRole[] = ['auctor', 'addressee', 'praeses', 'participant', 'subject'];

export interface PartCreator { id?: string | null; name?: string; role: PartRole; source?: string; }
export interface PartPlace { id: string | null; label: string; }
export interface WorkPart {
  id: string; kind: PartKind; pages: string[]; title?: string; incipit?: string;
  dating?: WorkDating; place?: PartPlace; place_to?: PartPlace; creators: PartCreator[];
  attached_to: string | null; languages?: string[]; notes?: string; needs_review: boolean;
}
export type PartInput = Omit<WorkPart, 'id' | 'needs_review'>;

const opts = (token: string | null): ApiRequestOptions => ({ token, timeout: 20000 });
const base = (workId: string) => `/works/${encodeURIComponent(workId)}/parts`;
const one = (workId: string, partId: string) => `${base(workId)}/${encodeURIComponent(partId)}`;

export async function listParts(workId: string, token: string | null): Promise<WorkPart[]> {
  const r = await apiGet<{ parts: WorkPart[] }>(base(workId), opts(token));
  return r.parts ?? [];
}
export const createPart = (workId: string, part: PartInput, token: string | null) =>
  apiPost<WorkPart>(base(workId), part, opts(token));
export const updatePart = (workId: string, partId: string, part: PartInput, token: string | null) =>
  apiPut<WorkPart>(one(workId, partId), part, opts(token));
export async function deletePart(workId: string, partId: string, token: string | null): Promise<void> {
  await apiDelete<unknown>(one(workId, partId), opts(token));
}
export const changePartPages = (workId: string, partId: string, add: string[], remove: string[], token: string | null) =>
  apiPost<WorkPart>(`${one(workId, partId)}/pages`, { add, remove }, opts(token));
