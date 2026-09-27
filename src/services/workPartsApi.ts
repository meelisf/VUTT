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
/** Töölaua sisukord: osad + nende lehtede numbrid (/work/{id}/{nr}). */
export async function getPartsToc(workId: string, token: string | null): Promise<{ parts: WorkPart[]; pageNumbers: Record<string, number> }> {
  const r = await apiGet<{ parts: WorkPart[]; page_numbers?: Record<string, number> }>(base(workId), opts(token));
  return { parts: r.parts ?? [], pageNumbers: r.page_numbers ?? {} };
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

// ── Agendi ettepanekud (#492 samm 2) ─────────────────────────────────────────

export interface PartProposalItem {
  part: PartInput;
  attached_to: number | string | null;
  evidence: { page: number; quote?: string }[];
  status: 'pending' | 'accepted' | 'rejected';
  created_part_id?: string;
  page_numbers: number[];
  missing_pages: string[];
  /** Olemasolev osa, mida ettepanek parandab (agendi `part_id` või samad lehed). */
  target_part_id?: string | null;
  /** Olemasolev osa + parandus (sama liitmine, mida vastuvõtt teeb). */
  merged?: PartInput;
}
/** Agendi pakutud uus isik (#492): ootel, kuni toimetaja loob, seob või jätab nimeks. */
export interface ProposedPerson {
  ref: string; name: string; aliases?: string[]; birth_year?: number; death_year?: number;
  identifiers?: { scheme: 'gnd' | 'wikidata' | 'viaf'; id: string }[]; note?: string;
  evidence?: { page: number; quote?: string }[];
  status: 'pending' | 'created' | 'linked' | 'name'; person_id: string | null;
}
export interface PartProposal {
  proposal_id: string; created_at: number; expires_at: number;
  pages_changed: boolean; items: PartProposalItem[]; persons?: ProposedPerson[];
}
export interface PartsHandoff { code: string; expires_at: number; max_uses: number; work_id: string; pages_version: string; }

export const createPartsHandoff = (workId: string, token: string | null) =>
  apiPost<PartsHandoff>(`${base(workId)}/handoff`, {}, opts(token));
export async function listPartProposals(workId: string, token: string | null): Promise<PartProposal[]> {
  return apiGet<PartProposal[]>(`${base(workId)}/proposals`, opts(token));
}
/** Toimetaja otsus ühe pakutud osa kohta; `part` = parandatud kuju vastuvõtul. */
export const decidePartProposal = (workId: string, proposalId: string, index: number,
  action: 'accept' | 'reject', token: string | null, part?: PartInput, mode?: 'create') =>
  apiPost<{ status: string; part: WorkPart | null }>(
    `${base(workId)}/proposals/${encodeURIComponent(proposalId)}/items/${index}/${action}`,
    { ...(part ? { part } : {}), ...(mode ? { mode } : {}) }, opts(token));
/** Pakutud isik: loo kaart, seo olemasolevaga (`personId`) või jäta nimeks. 409 `person_exists:<id>`. */
export const resolveProposedPerson = (workId: string, proposalId: string, ref: string,
  action: 'create' | 'link' | 'name', token: string | null, personId?: string) =>
  apiPost<{ ref: string; status: string; person_id: string | null }>(
    `${base(workId)}/proposals/${encodeURIComponent(proposalId)}/persons/${encodeURIComponent(ref)}/${action}`,
    personId ? { person_id: personId } : {}, opts(token));
