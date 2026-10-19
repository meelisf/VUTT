/**
 * Agendi lehe teksti ettepanekud (#641, ADR 0058 täiendus 2026-10-19).
 * Kõik otspunktid on ainult superadminile; kood antakse agendile kopeerimiseks.
 */
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';
import type { PageFields } from '../components/editor/pageConflict';

export type ProposalPageState = 'pending' | 'accepted' | 'rejected' | 'stale' | 'superseded';

export interface TextProposalPack {
  proposal_id: string;
  work_id: string;
  note: string;
  username: string;
  created_at: number;
  counts: Record<'pending' | 'stale' | 'accepted' | 'rejected', number>;
  pages: { stem: string; page_no: number; state: ProposalPageState }[];
}

export interface ProposalPageReview {
  proposal_id: string;
  stem: string;
  page_no: number;
  state: ProposalPageState;
  /** Lehe vaade, mille vastu `proposed_now` liideti (sama hetktõmmis). Puudub = leht kadunud. */
  page: PageFields | null;
  proposed_now: string | null;
  base_text: string;
  proposed_text: string;
  note: string;
  pack_note: string;
  work_id: string;
}

export interface ProposalJob {
  state: 'idle' | 'running' | 'done' | 'error';
  done?: number;
  total?: number;
  proposal_id?: string;
  result?: { accepted: string[]; stale: string[]; skipped: string[] };
  error?: string;
}

export interface ProposalHandoff {
  code: string;
  expires_at: number;
  max_uses: number;
  work_id: string | null;
}

const enc = encodeURIComponent;

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(`${FILE_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    timeout: 15000,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Serveri masinloetav kood (nt `job_running`, `unknown_proposal`) jõuab kutsujani.
    throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  }
  return body as T;
}

export const listPacks = (token: string, workId?: string) =>
  call<TextProposalPack[]>(token, workId ? `/works/${enc(workId)}/text-proposals` : '/text-proposals');

export const getReviewPage = (token: string, workId: string, proposalId: string, stem: string) =>
  call<ProposalPageReview>(token, `/works/${enc(workId)}/text-proposals/${enc(proposalId)}/pages/${enc(stem)}`);

export const rejectPage = (token: string, workId: string, proposalId: string, stem: string) =>
  call<{ rejected: number }>(token, `/works/${enc(workId)}/text-proposals/${enc(proposalId)}/pages/${enc(stem)}/reject`,
    { method: 'POST' });

export const rejectPack = (token: string, workId: string, proposalId: string) =>
  call<{ rejected: number }>(token, `/works/${enc(workId)}/text-proposals/${enc(proposalId)}/reject`, { method: 'POST' });

export const acceptPack = async (token: string, workId: string, proposalId: string): Promise<void> => {
  await call(token, `/works/${enc(workId)}/text-proposals/${enc(proposalId)}/accept`, { method: 'POST' });
};

export const getJobStatus = (token: string, workId: string) =>
  call<ProposalJob>(token, `/works/${enc(workId)}/text-proposals/job`);

export const issueHandoff = (token: string, workId?: string) =>
  call<ProposalHandoff>(token, '/text-proposals/handoff',
    { method: 'POST', body: JSON.stringify(workId ? { work_id: workId } : {}) });
