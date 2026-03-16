import { FILE_API_URL } from '../../config';
import { fetchWithTimeout } from '../../utils/fetchWithTimeout';
import type { ProsopoIndexEntry, ProsopoRecord } from '../types';

const BASE = `${FILE_API_URL}/prosopography`;

function authHeader(token: string) {
  return { 'Content-Type': 'application/json' };
}

export async function listPersons(params?: {
  q?: string;
  gender?: string;
  status_id?: string;
  source?: string;
  verification_level?: string;
}, token?: string): Promise<{ results: ProsopoIndexEntry[]; total: number }> {
  const url = new URL(BASE, window.location.origin);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.gender) url.searchParams.set('gender', params.gender);
  if (params?.status_id) url.searchParams.set('status_id', params.status_id);
  if (params?.source) url.searchParams.set('source', params.source);
  if (params?.verification_level) url.searchParams.set('verification_level', params.verification_level);
  if (token) url.searchParams.set('token', token);

  const resp = await fetchWithTimeout(url.toString(), { timeout: 10000 });
  if (!resp.ok) throw new Error(`listPersons: ${resp.status}`);
  return resp.json();
}

export async function getPerson(personId: string, token: string): Promise<ProsopoRecord> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}?token=${token}`, { timeout: 10000 });
  if (!resp.ok) throw new Error(`getPerson: ${resp.status}`);
  return resp.json();
}

export async function createPerson(data: {
  name: string;
  birth_year?: number | null;
  death_year?: number | null;
  notes?: string;
  identifiers?: { scheme: string; id: string }[];
}, token: string): Promise<ProsopoRecord> {
  const resp = await fetchWithTimeout(BASE, {
    method: 'POST',
    headers: authHeader(token),
    body: JSON.stringify({ ...data, auth_token: token }),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`createPerson: ${resp.status}`);
  return resp.json();
}

export async function updatePerson(personId: string, data: Partial<ProsopoRecord>, token: string): Promise<ProsopoRecord> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}`, {
    method: 'PUT',
    headers: authHeader(token),
    body: JSON.stringify({ ...data, auth_token: token }),
    timeout: 10000,
  });
  if (resp.status === 409) {
    const err = await resp.json();
    throw Object.assign(new Error('conflict'), { conflict: true, current_updated_at: err.detail?.current_updated_at });
  }
  if (!resp.ok) throw new Error(`updatePerson: ${resp.status}`);
  return resp.json();
}

export async function uploadPersonImage(personId: string, file: File, token: string): Promise<{ image_url: string }> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/image?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
    timeout: 30000,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail ?? `uploadPersonImage: ${resp.status}`);
  }
  return resp.json();
}

export async function fetchEnrichmentPreview(scheme: string, id: string, token: string): Promise<{
  auto_filled: Record<string, any>;
  conflicts: { field: string; local: any; remote: any }[];
  error?: string;
}> {
  const url = new URL(`${BASE}/enrich/preview`, window.location.origin);
  url.searchParams.set('scheme', scheme);
  url.searchParams.set('id', id);
  url.searchParams.set('token', token);
  const resp = await fetchWithTimeout(url.toString(), { timeout: 15000 });
  if (!resp.ok) throw new Error(`fetchEnrichmentPreview: ${resp.status}`);
  return resp.json();
}

export async function deletePersonImage(personId: string, token: string): Promise<void> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/image?token=${token}`, {
    method: 'DELETE',
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`deletePersonImage: ${resp.status}`);
}
