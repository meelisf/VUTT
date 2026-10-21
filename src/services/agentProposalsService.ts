/**
 * Ühtne agendikood ja ootel ettepanekute loend (ADR 0058 täiendus 2026-10-20).
 * Mõlemad otspunktid on ainult superadminile; `target_url` koostab server.
 */
import { FILE_API_URL } from '../config';
import { fetchWithTimeout, getAuthHeaders } from '../utils/fetchWithTimeout';

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

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetchWithTimeout(`${FILE_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    timeout: 15000,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`);
  }
  return body as T;
}

export const listAgentProposals = (token: string) =>
  call<AgentProposal[]>(token, '/agent-proposals');

export const createAgentHandoff = (token: string) =>
  call<AgentHandoff>(token, '/agent-handoff', { method: 'POST' });
