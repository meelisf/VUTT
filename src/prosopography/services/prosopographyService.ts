import { FILE_API_URL } from '../../config';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import { appendTagParams } from './tagParams';
import type { HistoricalRegionsResponse, ProsopoIndexEntry, ProsopoMapResponse, ProsopoRecord, PlaceEntry } from '../types';

const BASE = `${FILE_API_URL}/prosopography`;

export interface EnrichmentEvidence {
  source_kind: string; source_id?: string; locator?: string; work_id?: string;
  page?: number; printed_page?: string; part_id?: string; quote?: string; url?: string;
  /** Kirjanduse loetav viide; MCP täidab kirjanduskogust. */
  citation?: string;
}
/** Agendi pakutud uus registrikirje (`key` kirje sees). */
export interface EnrichmentRegistryEntry {
  key: string; id?: string | null; labels: Record<string, string>; variants?: string[];
  type?: string; place_key?: string | null;
}
export interface EnrichmentReviewState {
  state: 'applicable' | 'already_present' | 'blocked'; reason?: string;
}
export interface EnrichmentDate {
  date: string; precision?: string; bound?: string; calendar?: string; is_circa?: boolean;
}
export interface EnrichmentItem {
  kind: 'occupation' | 'education'; match_status: string; existing_index?: number;
  review_state: EnrichmentReviewState;
  registry_labels?: Record<string, string>;
  registry_ids?: Record<string, string>;
  occupation_entry?: EnrichmentRegistryEntry;
  institution_entry?: EnrichmentRegistryEntry;
  institution_place_key?: string | null;
  raw_occupation?: string; raw_institution?: string; occupation_key?: string;
  institution_key?: string; place_key?: string | null; edu_type?: string;
  occupation_variant?: string | null; institution_variant?: string | null;
  date_from?: EnrichmentDate | null;
  date_to?: EnrichmentDate | null;
  evidence: EnrichmentEvidence[];
}
export interface EnrichmentProposal {
  proposal_id: string; person_id: string; base_updated_at: string;
  /** Ridade versioon: otsus saadab selle kaasa, et vana vaade ei otsustaks nihkunud rida. */
  revision: string;
  created_at: number; expires_at: number; items: EnrichmentItem[];
}
export interface InstitutionRegistryEntry {
  id: string | null; labels: Record<string, string>; variants: string[];
  type: string; place_key: string | null; notes?: string;
  /** Koht ajas (nt AGC: Tartu kuni 1699, Pärnu alates 1699); `place_key` on vaikekoht. */
  place_periods?: PlacePeriod[];
  /** Tegutsemisaeg — eristab samanimelisi asutusi; ei ole koht ajas. */
  active_from?: number; active_to?: number;
}
export interface PlacePeriod { place_key: string; from?: number; to?: number; }
export async function fetchInstitutions(): Promise<Record<string, InstitutionRegistryEntry>> {
  const response = await fetchWithTimeout(`${BASE}/registries/institution`, { timeout: 10000 });
  return enrichmentResponse(response);
}
export interface OccupationRegistryEntry {
  id: string | null; labels: Record<string, string>; variants: string[]; notes?: string;
}
export async function fetchRegistry(kind: 'occupation' | 'institution'):
  Promise<Record<string, OccupationRegistryEntry | InstitutionRegistryEntry>> {
  const response = await fetchWithTimeout(`${BASE}/registries/${kind}`, { timeout: 10000 });
  return enrichmentResponse(response);
}
export async function saveRegistryEntry(kind: 'occupation' | 'institution', key: string,
  entry: OccupationRegistryEntry | InstitutionRegistryEntry, token: string): Promise<OccupationRegistryEntry | InstitutionRegistryEntry> {
  const response = await fetchWithTimeout(`${BASE}/registries/${kind}/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(entry), timeout: 15000,
  });
  return enrichmentResponse(response);
}
/** Sama Q-koodiga kirje on registris juba olemas — kutsuja pakub seda (`key`). */
export class RegistryDuplicateError extends Error {
  constructor(public key: string) { super('duplicate_id'); }
}
/** Uus registrikirje; võtme genereerib server. */
export async function createRegistryEntry(kind: 'occupation' | 'institution',
  entry: OccupationRegistryEntry | InstitutionRegistryEntry, token: string):
  Promise<{ key: string; entry: OccupationRegistryEntry | InstitutionRegistryEntry }> {
  const response = await fetchWithTimeout(`${BASE}/registries/${kind}`, {
    method: 'POST', headers: { ...getAuthHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify(entry), timeout: 15000,
  });
  if (response.status === 409) {
    const detail = await response.json().then(body => body?.detail, () => null);
    if (detail?.code === 'duplicate_id' && typeof detail.key === 'string') throw new RegistryDuplicateError(detail.key);
  }
  return enrichmentResponse(response);
}
async function enrichmentResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = String(response.status);
    try { detail = (await response.json()).detail ?? detail; } catch { /* HTTP error */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return response.json();
}

/** Esituskood agendile: ühele isikule või (`null`) kõigile isikutele (#492). */
export async function createEnrichmentHandoff(personId: string | null, token: string): Promise<{
  code: string; expires_at: number; base_updated_at?: string; scope?: 'person' | 'any'; max_uses?: number;
}> {
  const path = personId ? `/enrichment-handoff/${encodeURIComponent(personId)}` : '/enrichment-handoff';
  const response = await fetchWithTimeout(`${BASE}${path}`, {
    method: 'POST', headers: getAuthHeaders(token), timeout: 10000,
  });
  return enrichmentResponse(response);
}

export async function listEnrichmentProposals(personId: string, token: string): Promise<EnrichmentProposal[]> {
  const response = await fetchWithTimeout(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}`, {
    headers: getAuthHeaders(token), timeout: 10000,
  });
  return enrichmentResponse(response);
}

/** Kinnitus kukkus pärast registrikirjete loomist: kirjed jäid alles, kaart muutmata. */
export class EnrichmentApplyError extends Error {
  created: string[];
  constructor(message: string, created: string[]) { super(message); this.created = created; }
}

export async function applyEnrichmentProposal(personId: string, proposalId: string,
  selected: number[], token: string, revision: string): Promise<ProsopoRecord> {
  // Kinnitus võib teha mitu git-commitit (registrikirjed + kaart) — pikem ajalõpp.
  const response = await fetchWithTimeout(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ proposal_id: proposalId, selected, revision }), timeout: 30000,
  });
  if (!response.ok) {
    const detail = await response.clone().json().then(body => body?.detail).catch(() => null);
    if (detail && typeof detail === 'object' && Array.isArray(detail.created_registry_entries)) {
      throw new EnrichmentApplyError(String(detail.error), detail.created_registry_entries);
    }
  }
  return enrichmentResponse(response);
}

export async function rejectEnrichmentProposal(personId: string, proposalId: string,
  selected: number[], token: string, revision: string): Promise<{ proposal_id: string; remaining: number }> {
  const response = await fetchWithTimeout(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}/reject`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ proposal_id: proposalId, selected, revision }), timeout: 15000,
  });
  return enrichmentResponse(response);
}

export async function listPersons(params?: {
  q?: string;
  gender?: string;
  occupation?: string;
  origin_group?: string;
  origin_place?: string;
  institution?: string;
  status_id?: string;
  tag?: string | string[];
  source?: string;
  verification_level?: string;
  year_from?: number;
  year_to?: number;
  imm_year_from?: number;
  imm_year_to?: number;
  sort_by?: string;
  ids?: string[];
  collection?: string;
  /** Töökollektsiooni id (#354). Server kontrollib ligipääsu ja piirab isikud. */
  work_set?: string;
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
  if (params?.origin_place) url.searchParams.set('origin_place', params.origin_place);
  if (params?.institution) url.searchParams.set('institution', params.institution);
  if (params?.status_id) url.searchParams.set('status_id', params.status_id);
  appendTagParams(url.searchParams, params?.tag);
  if (params?.source) url.searchParams.set('source', params.source);
  if (params?.verification_level) url.searchParams.set('verification_level', params.verification_level);
  if (params?.year_from != null) url.searchParams.set('year_from', String(params.year_from));
  if (params?.year_to != null) url.searchParams.set('year_to', String(params.year_to));
  if (params?.imm_year_from != null) url.searchParams.set('imm_year_from', String(params.imm_year_from));
  if (params?.imm_year_to != null) url.searchParams.set('imm_year_to', String(params.imm_year_to));
  if (params?.sort_by) url.searchParams.set('sort_by', params.sort_by);
  if (params?.ids?.length) url.searchParams.set('ids', params.ids.join(','));
  if (params?.collection) url.searchParams.set('collection', params.collection);
  if (params?.work_set) url.searchParams.set('work_set', params.work_set);
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
  tag?: string | string[];
  source?: string;
  verification_level?: string;
  year_from?: number;
  year_to?: number;
  imm_year_from?: number;
  imm_year_to?: number;
  ids?: string[];
  related_to?: string;
  collection?: string;
  work_set?: string;
}, token?: string): Promise<ProsopoMapResponse> {
  const url = new URL(`${BASE}/map`, window.location.origin);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.gender) url.searchParams.set('gender', params.gender);
  if (params?.occupation) url.searchParams.set('occupation', params.occupation);
  if (params?.origin_group) url.searchParams.set('origin_group', params.origin_group);
  if (params?.institution) url.searchParams.set('institution', params.institution);
  if (params?.status_id) url.searchParams.set('status_id', params.status_id);
  appendTagParams(url.searchParams, params?.tag);
  if (params?.source) url.searchParams.set('source', params.source);
  if (params?.verification_level) url.searchParams.set('verification_level', params.verification_level);
  if (params?.year_from != null) url.searchParams.set('year_from', String(params.year_from));
  if (params?.year_to != null) url.searchParams.set('year_to', String(params.year_to));
  if (params?.imm_year_from != null) url.searchParams.set('imm_year_from', String(params.imm_year_from));
  if (params?.imm_year_to != null) url.searchParams.set('imm_year_to', String(params.imm_year_to));
  if (params?.ids?.length) url.searchParams.set('ids', params.ids.join(','));
  if (params?.related_to) url.searchParams.set('related_to', params.related_to);
  if (params?.collection) url.searchParams.set('collection', params.collection);
  if (params?.work_set) url.searchParams.set('work_set', params.work_set);

  const resp = await fetchWithTimeout(url.toString(), {
    headers: getAuthHeaders(token),
    timeout: 10000,
  });
  if (!resp.ok) throw new Error(`fetchPersonMapMarkers: ${resp.status}`);
  return resp.json();
}

export async function fetchHistoricalRegions(params: {
  year: number;
  south: number;
  west: number;
  north: number;
  east: number;
}, signal?: AbortSignal): Promise<HistoricalRegionsResponse> {
  const url = new URL(`${BASE}/map-regions`, window.location.origin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const resp = await fetchWithTimeout(url.toString(), { signal, timeout: 90000 });
  if (!resp.ok) throw new Error(`fetchHistoricalRegions: ${resp.status}`);
  return resp.json();
}

export async function getPersonFacets(params?: {
  q?: string;
  gender?: string;
  ids?: string[];
  collection?: string;
  work_set?: string;
}, token?: string): Promise<{
  origin_groups: { value: string; labels: Record<string, string>; label_et: string; label_en: string; count: number }[];
  institutions: { value: string; count: number }[];
  tags: { value: string; label: string; labels?: Record<string, string> | null; count: number }[];
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
  if (params?.collection) url.searchParams.set('collection', params.collection);
  if (params?.work_set) url.searchParams.set('work_set', params.work_set);

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

/**
 * Teoste pealkirjad ID järgi varuvariandina, kui Meilisearch neid ei tagasta
 * (kaitstud kollektsiooni teosed anonüümsele/õiguseta kasutajale).
 * `restricted: true` → frontend kuvab pealkirja, kuid keelab lingi.
 */
export async function getWorkTitles(
  workIds: string[],
  token?: string,
): Promise<Record<string, { title: string; year: number | null; restricted: boolean }>> {
  if (workIds.length === 0) return {};
  try {
    const resp = await fetchWithTimeout(`${BASE}/work-titles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify({ work_ids: workIds }),
      timeout: 10000,
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    return data.titles || {};
  } catch {
    return {};
  }
}

export interface CreatePersonBody {
  created_via: 'picker' | 'form';
  name?: string;
  identifiers?: { scheme: string; id: string }[];
  aliases?: string[];
  note?: string;
  card?: Partial<ProsopoRecord>;
  context?: { work_id: string; role?: string };
}

/** Välise ID konflikt loomisel (spekk §4.2): `exists` = üks kaart, `split` = ID-d eri kaartidel. */
export class PersonConflictError extends Error {
  constructor(public conflict: 'exists' | 'split', public existingPersonIds: string[]) {
    super(`person_conflict:${conflict}`);
  }
}

/** Isiku loomine ühe sammuga — ainus loomistee (server paneb ülevaatusmärke). */
export async function createPersonChecked(body: CreatePersonBody, token: string): Promise<ProsopoRecord> {
  const resp = await fetchWithTimeout(`${BASE}/persons/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify(body),
    timeout: 15000,
  });
  if (resp.status === 409) {
    const err = await resp.json().catch(() => ({}));
    const d = err?.detail ?? {};
    if (d.error === 'identifier_conflict') {
      throw new PersonConflictError(d.conflict, d.existing_person_ids ?? []);
    }
  }
  if (!resp.ok) throw new Error(`createPersonChecked: ${resp.status}`);
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
    const err = await resp.json().catch(() => ({}));
    const d = err?.detail ?? {};
    if (d.error === 'identifier_conflict') {
      throw new PersonConflictError(d.conflict, d.existing_person_ids ?? []);
    }
    throw Object.assign(new Error('conflict'), { conflict: true, current_updated_at: d.current_updated_at });
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

export async function updatePlace(
  key: string,
  data: Partial<PlaceEntry> & { historical_names?: string[]; notes?: string },
  token: string,
): Promise<{ key: string; entry: PlaceEntry }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/places/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(data),
      timeout: 10000,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `updatePlace: ${resp.status}`);
  }
  return resp.json();
}

export async function deletePlace(key: string, token: string): Promise<void> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/places/${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: getAuthHeaders(token), timeout: 10000 },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `deletePlace: ${resp.status}`);
  }
}

export async function putGroup(
  key: string,
  data: { labels?: Record<string, string>; sort_order?: number; parent?: string | null },
  token: string,
): Promise<{ key: string; entry: Record<string, any> }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/groups/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify(data),
      timeout: 10000,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `putGroup: ${resp.status}`);
  }
  return resp.json();
}

export async function deleteGroup(key: string, token: string): Promise<void> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/groups/${encodeURIComponent(key)}`,
    { method: 'DELETE', headers: getAuthHeaders(token), timeout: 10000 },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `deleteGroup: ${resp.status}`);
  }
}

export async function autoAssignGroupParents(token: string): Promise<{ assigned: number; skipped: string[] }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/groups/auto-assign`,
    { method: 'POST', headers: getAuthHeaders(token), timeout: 10000 },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `autoAssignGroupParents: ${resp.status}`);
  }
  return resp.json();
}

export async function mergePlaces(
  sourceKey: string,
  targetKey: string,
  token: string,
): Promise<{ redirected: number; target_key: string }> {
  const resp = await fetchWithTimeout(
    `${BASE}/admin/places/${encodeURIComponent(sourceKey)}/merge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
      body: JSON.stringify({ target_key: targetKey }),
      timeout: 15000,
    },
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as any).detail ?? `mergePlaces: ${resp.status}`);
  }
  return resp.json();
}

export async function fetchPersonHistory(
  personId: string,
  token: string | null
): Promise<{ hash: string; full_hash: string; author: string; formatted_date: string; message: string; is_original: boolean }[]> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/history`, {
    headers: getAuthHeaders(token),
  });
  if (!resp.ok) throw new Error(`fetchPersonHistory: ${resp.status}`);
  const data = await resp.json();
  return data.history ?? [];
}

export async function fetchPersonDiff(
  personId: string,
  commitHash: string,
  token: string | null
): Promise<{ field: string; old: unknown; new: unknown }[]> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/diff?commit=${commitHash}`, {
    headers: getAuthHeaders(token),
  });
  if (!resp.ok) throw new Error(`fetchPersonDiff: ${resp.status}`);
  const data = await resp.json();
  return data.changes ?? [];
}

export async function restorePerson(
  personId: string,
  commitHash: string,
  token: string | null
): Promise<unknown> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(`${BASE}/${encoded}/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ commit_hash: commitHash }),
  });
  if (!resp.ok) throw new Error(`restorePerson: ${resp.status}`);
  return resp.json();
}

/** Tõlke veaklass. `kind` tuleb SERVERI koodist, mitte sõnumi sisust. */
export class TranslateFailed extends Error {
  readonly kind: 'blocked' | 'rate_limited' | 'other';
  constructor(kind: 'blocked' | 'rate_limited' | 'other', message: string) {
    super(message);
    this.name = 'TranslateFailed';
    this.kind = kind;
  }
}

// Masinloetav prefiks, mille backend paneb sisufiltri keeldumise ette (#292).
// Sama string on `server/ocr_providers/gemini.py` CONTENT_BLOCKED — kaks keelt,
// üks reegel.
const CONTENT_BLOCKED_PREFIX = 'content_blocked';

/**
 * Tõlgib teksti. OLEKUTA — kaarti ei puudutata, salvestamine käib eraldi.
 *
 * Timeout on 120 s: Gemini päring ise võib võtta kuni `GEMINI_REQUEST_TIMEOUT`
 * (120 s) ja lühem klienditimeout annaks „server 200 + klient viga" mustri.
 */
export async function translateText(
  text: string,
  sourceLang: 'et' | 'en',
  targetLang: 'et' | 'en',
  token: string,
): Promise<string> {
  const resp = await fetchWithTimeout(`${BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ source_lang: sourceLang, target_lang: targetLang, text }),
    timeout: 120000,
  });

  if (resp.status === 429) {
    throw new TranslateFailed('rate_limited', 'rate limited');
  }
  if (!resp.ok) {
    const detail = await resp.json().then(b => String(b?.detail ?? '')).catch(() => '');
    throw new TranslateFailed(
      detail.startsWith(CONTENT_BLOCKED_PREFIX) ? 'blocked' : 'other', detail);
  }
  const body = await resp.json();
  return body.text as string;
}

export interface SourceDiff {
  found: boolean;
  commit: string | null;
  date: string | null;
  text: string | null;
}

/** Ankru-aegne lähtetekst („vaata, mis muutus"). `found: false` EI ole viga. */
export async function fetchSourceDiff(
  personId: string,
  field: 'biography_et' | 'biography_en',
  token: string,
): Promise<SourceDiff> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(
    `${BASE}/${encoded}/source-diff?field=${field}`,
    { headers: getAuthHeaders(token), timeout: 15000 },
  );
  if (!resp.ok) throw new Error(`fetchSourceDiff: ${resp.status}`);
  return resp.json();
}

export interface SimilarPerson { id: string; label: string; birth_year: number | null; death_year: number | null; work_count: number }

/** Isikupaneeli kandidaatide kokkuvõtted (spekk §6) + sarnased olemasolevad kaardid. */
export async function fetchCandidates(
  name: string, refs: { scheme: string; id: string }[], token: string,
): Promise<{ results: import('../panel/types').CandidateResult[]; similar_persons: SimilarPerson[] }> {
  const resp = await fetchWithTimeout(`${BASE}/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ name, refs }),
    timeout: 15000,
  });
  if (!resp.ok) throw new Error(`fetchCandidates: ${resp.status}`);
  return resp.json();
}
