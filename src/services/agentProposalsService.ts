/**
 * Ühtne agendikood ja ootel ettepanekute loend (ADR 0058 täiendus 2026-10-20).
 * Mõlemad otspunktid on ainult superadminile; `target_url` koostab server.
 */
import { FILE_API_URL } from '../config';
import { apiGet, apiPost } from './apiClient';

export type AgentProposalKind = 'text' | 'parts' | 'person';

export interface AgentProposal {
  kind: AgentProposalKind;
  proposal_id: string;
  target_id: string;
  target_label: string;
  target_url: string;
  pending: number;
  /** `null` = vananemist ei arvutata (isik); osadel = `pending`, kui lehed muutusid. */
  stale: number | null;
  created_at: number;
}

export interface AgentHandoff {
  code: string;
  expires_at: number;
  max_uses: { text: number; parts: number; persons: number };
}

function call<T>(token: string, path: string, init: { method?: 'POST' } = {}): Promise<T> {
  const options = { token, timeout: 15000 };
  return init.method === 'POST'
    ? apiPost<T>(`${FILE_API_URL}${path}`, undefined, options)
    : apiGet<T>(`${FILE_API_URL}${path}`, options);
}

export const listAgentProposals = (token: string) =>
  call<AgentProposal[]>(token, '/agent-proposals');

export const createAgentHandoff = (token: string) =>
  call<AgentHandoff>(token, '/agent-handoff', { method: 'POST' });
