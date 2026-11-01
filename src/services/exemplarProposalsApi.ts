// src/services/exemplarProposalsApi.ts
/**
 * Agendi eksemplari-ettepanekud (#703, ADR 0076 §7). Ainult superadmin.
 * Ülevaatuse olek (`review_state`) arvutab server elava seisu vastu — klient ainult kuvab.
 */
import { FILE_API_URL } from '../config';
import type { Exemplar } from '../types';
import { apiGet, apiPost } from './apiClient';

export type ExemplarReviewState =
  'pending' | 'stale' | 'blocked_holder' | 'duplicate' | 'expired' | 'accepted' | 'rejected';

export interface ExemplarProposalRow {
  index: number;
  op: 'create' | 'update';
  exemplar_id?: string;
  fields: Partial<Exemplar>;
  base?: Partial<Exemplar>;
  source: { kind: 'ester'; ref: string; quote: string };
  status: 'pending' | 'accepted' | 'rejected';
  review_state: ExemplarReviewState;
  /** Muudatusreal elav eksemplar (kõrvutamiseks); uuel real `null`. */
  current: Exemplar | null;
  created_exemplar_id?: string;
}

export interface ExemplarProposal {
  proposal_id: string;
  created_at: number;
  expires_at: number;
  note?: string | null;
  rows: ExemplarProposalRow[];
}

const base = (workId: string) => `${FILE_API_URL}/works/${encodeURIComponent(workId)}/exemplar-proposals`;

export const listExemplarProposals = (workId: string, token: string) =>
  apiGet<ExemplarProposal[]>(base(workId), { token, timeout: 15000 });

export const decideExemplarProposals = (
  workId: string, items: { proposal_id: string; index: number }[], action: 'accept' | 'reject', token: string,
) => apiPost<{ accepted: string[]; rejected: number }>(`${base(workId)}/decide`, { items, action },
  { token, timeout: 30000 });

/** ESTERi kirje link: klient koostab selle numbrist, agent URL-i ei anna (ADR 0058 täiendus). */
export const esterRecordUrl = (ref: string) => `https://www.ester.ee/record=${encodeURIComponent(ref)}*est`;
