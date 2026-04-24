import { FILE_API_URL } from '../../config';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import type { ProsopoIndexEntry, ProsopoMapResponse, ProsopoRecord, PlaceEntry } from '../types';

const BASE = `${FILE_API_URL}/prosopography`;

export async function listPersons(params?: {
  q?: string;
  gender?: string;
  occupation?: string;
  origin_group?: string;
  institution?: string;
  status_id?: string;
  source?: string;
  verification_level?: string;
  imm_year_from?: number;
  imm_year_to?: number;
  sort_by?: string;
  ids?: string[];
  limit?: number;
  offset?: number;
}, token?: string): Promise<{ results: ProsopoIndexEntry[]; total: number; offset: number; limit: number }> {
  if (params?.ids?.length) {
    const resp = await fetchWithTimeout(`${BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(params),
      timeout: 10000,
    });
    if (!resp.ok) throw new Error(`listPersons: ${resp.status}`);
    return resp.json();
  }

  const url = new URL(BASE, window.location.origin);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.gender) url.searchParams.set('gender', params.gender);
  if (params?.occupation) url.searchParams.set('occupation', params.occupation);
  if (params?.origin_group) url.searchParams.set('origin_group', params.origin_group);
  if (params?.institution) url.searchParams.set('institution', params.institution);
  if (params?.status_id) url.searchParams.set('status_id', params.status_id);
  if (params?.source) url.searchParams.set('source', params.source);
  if (params?.verification_level) url.searchParams.set('verification_level', params.verification_level);
  if (params?.imm_year_from != null) url.searchParams.set('imm_year_from', String(params.imm_year_from));
  if (params?.imm_year_to != null) url.searchParams.set('imm_year_to', String(params.imm_year_to));
  if (params?.sort_by) url.searchParams.set('sort_by', params.sort_by);
  if (params?.ids?.length) url.searchParams.set('ids', params.ids.join(','));
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit));
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset));

  const resp = await fetchWithTimeout(url.toString(), {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`listPersons: ${resp.status}`);
  return resp.json();
}

export async function fetchPersonMapMarkers(params?: {
  q?: string;
  gender?: string;
  occupation?: string;
  origin_group?: string;
  institution?: string;
  status_id?: string;
  source?: string;
  verification_level?: string;
  imm_year_from?: number;
  imm_year_to?: number;
  ids?: string[];
}, token?: string): Promise<ProsopoMapResponse> {
  const url = new URL(`${BASE}/map`, window.location.origin);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.gender) url.searchParams.set('gender', params.gender);
  if (params?.occupation) url.searchParams.set('occupation', params.occupation);
  if (params?.origin_group) url.searchParams.set('origin_group', params.origin_group);
  if (params?.institution) url.searchParams.set('institution', params.institution);
  if (params?.status_id) url.searchParams.set('status_id', params.status_id);
  if (params?.source) url.searchParams.set('source', params.source);
  if (params?.verification_level) url.searchParams.set('verification_level', params.verification_level);
  if (params?.imm_year_from != null) url.searchParams.set('imm_year_from', String(params.imm_year_from));
  if (params?.imm_year_to != null) url.searchParams.set('imm_year_to', String(params.imm_year_to));
  if (params?.ids?.length) url.searchParams.set('ids', params.ids.join(','));

  const resp = await fetchWithTimeout(url.toString(), {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`fetchPersonMapMarkers: ${resp.status}`);
  return resp.json();
}

export async function getPersonFacets(params?: {
  q?: string;
  gender?: string;
  ids?: string[];
}, token?: string): Promise<{
  origin_groups: { value: string; labels: Record<string, string>; label_et: string; label_en: string; count: number }[];
  institutions: { value: string; count: number }[];
  occupations: any[];
}> {
  if (params?.ids?.length) {
    const resp = await fetchWithTimeout(`${BASE}/facets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(params),
      timeout: 10000,
    });
    if (!resp.ok) throw new Error(`getPersonFacets: ${resp.status}`);
    return resp.json();
  }

  const url = new URL(`${BASE}/facets`, window.location.origin);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.gender) url.searchParams.set('gender', params.gender);

  const resp = await fetchWithTimeout(url.toString(), {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`getPersonFacets: ${resp.status}`);
  return resp.json();
}

export async function getPerson(personId: string, token?: string): Promise<ProsopoRecord> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}`, {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
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
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify(data),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`createPerson: ${resp.status}`);
  return resp.json();
}

export async function updatePerson(personId: string, data: Partial<ProsopoRecord>, token: string): Promise<ProsopoRecord> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify(data),
    timeout: 10000,
  });
  if (resp.status === 409) {
    const err = await resp.json();
    throw Object.assign(new Error('conflict'), { conflict: true, current_updated_at: err.detail?.current_updated_at });
  }
  if (!resp.ok) throw new Error(`updatePerson: ${resp.status}`);
  return resp.json();
}

export async function uploadPersonImage(personId: string, file: File, token: string): Promise<{ image_url: string; updated_at?: string }> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/image`, {
    method: 'POST',
    headers: { 'Content-Type': file.type, ...getAuthHeaders(token) },
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
  const resp = await fetchWithTimeout(url.toString(), {
    headers: getAuthHeaders(token),
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`fetchEnrichmentPreview: ${resp.status}`);
  return resp.json();
}

export async function fetchPersonEnrichmentPreview(
  personId: string,
  scheme: string,
  token: string,
  extId?: string,
): Promise<{
  auto_filled: Record<string, any>;
  conflicts: { field: string; local: any; remote: any }[];
  error?: string;
}> {
  const encoded = encodeURIComponent(personId);
  const url = new URL(`${BASE}/${encoded}/enrich/preview`, window.location.origin);
  url.searchParams.set('scheme', scheme);
  if (extId) url.searchParams.set('id', extId);
  const resp = await fetchWithTimeout(url.toString(), {
    headers: getAuthHeaders(token),
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`fetchPersonEnrichmentPreview: ${resp.status}`);
  return resp.json();
}

export async function deletePersonImage(personId: string, token: string): Promise<{ updated_at: string }> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/image`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`deletePersonImage: ${resp.status}`);
  return resp.json();
}

export async function bulkUpdateOccupation(
  occupation: { id: string | null; label: string; labels?: Record<string, string> | null; source?: string },
  mode: 'add' | 'replace',
  personIds: string[],
  token: string,
): Promise<{ updated: number; skipped: number; total: number }> {
  const resp = await fetchWithTimeout(`${BASE}/bulk-occupation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ occupation, mode, person_ids: personIds }),
    timeout: 30000,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `bulkUpdateOccupation: ${resp.status}`);
  }
  return resp.json();
}

export async function deletePerson(personId: string, token: string): Promise<{ deleted: string }> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/delete`, {
    method: 'DELETE',
    headers: getAuthHeaders(token),
    timeout: 15000,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `deletePerson: ${resp.status}`);
  }
  return resp.json();
}

export async function mergePersons(
  sourceId: string,
  targetId: string,
  token: string,
): Promise<{ id: string }> {
  const encoded = encodeURIComponent(sourceId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ target_id: targetId }),
    timeout: 30000,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || `mergePersons: ${resp.status}`);
  }
  return resp.json();
}

export interface WorkRelationWork {
  work_id: string;
  work_title: string;
  work_year: number | null;
  a_roles: string[];
  b_roles: string[];
}

export interface WorkRelation {
  person_id: string;
  person_name: string;
  shared_works_count: number;
  shared_works: WorkRelationWork[];
}

export async function fetchWorkRelations(
  personId: string,
  params?: { limit?: number; offset?: number },
): Promise<WorkRelation[]> {
  const url = new URL(`${BASE}/work-relations/${personId}`, window.location.origin);
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit));
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset));
  const resp = await fetchWithTimeout(url.toString(), { timeout: 10000 });
  if (!resp.ok) throw new Error(`fetchWorkRelations: ${resp.status}`);
  return resp.json();
}

export async function fetchPlaces(): Promise<Record<string, PlaceEntry>> {
  const resp = await fetchWithTimeout(`${BASE}/places`, { timeout: 10000 });
  if (!resp.ok) throw new Error(`fetchPlaces: ${resp.status}`);
  return resp.json();
}

export async function fetchPlacesMeta(): Promise<{
  groups: Record<string, { labels: Record<string, string>; sort_order: number }>;
  allowed_types: string[];
}> {
  const resp = await fetchWithTimeout(`${BASE}/places/meta`, { timeout: 10000 });
  if (!resp.ok) throw new Error(`fetchPlacesMeta: ${resp.status}`);
  return resp.json();
}

export async function searchPlacesWikidata(q: string, lang = 'en'): Promise<{ q: string; label: string; description: string; aliases: string[] }[]> {
  const resp = await fetchWithTimeout(`${BASE}/places/wikidata-search?q=${encodeURIComponent(q)}&lang=${lang}`, { timeout: 10000 });
  if (!resp.ok) return [];
  return resp.json();
}

export async function fetchPlaceWikidata(qid: string): Promise<{
  labels: Record<string, string>;
  type: string | null;
  coordinates: { lat: number; lon: number; source?: string; wikidata_property?: string; geonames_id?: string } | null;
  parents: { q: string; label_en: string; label_sv: string }[];
}> {
  const resp = await fetchWithTimeout(`${BASE}/places/wikidata/${encodeURIComponent(qid)}`, { timeout: 15000 });
  if (!resp.ok) throw new Error(`fetchPlaceWikidata: ${resp.status}`);
  return resp.json();
}

export async function addPlace(key: string, data: Partial<PlaceEntry>, token: string): Promise<{ key: string; entry: PlaceEntry }> {
  const resp = await fetchWithTimeout(`${BASE}/admin/places/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify(data),
    timeout: 10000,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `addPlace: ${resp.status}`);
  }
  return resp.json();
}
