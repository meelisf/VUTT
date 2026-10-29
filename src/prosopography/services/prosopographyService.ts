import { FILE_API_URL } from '../../config';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '../../services/apiClient';
import { appendPersonFilterParams, type PersonFilterParams } from './personFilterParams';
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
/** Serveri `detail` (string või objekt); puudub → `undefined`. */
function errorDetail(e: unknown): unknown {
  if (!(e instanceof ApiError) || !e.data || typeof e.data !== 'object') return undefined;
  return (e.data as { detail?: unknown }).detail;
}

/**
 * Objektikujuline `detail` sõnumiks: agendi ettepanekute paneel loeb sõnumist
 * `stale_proposal` ja `items[i]: …` (apiClient võtaks ainult stringi).
 */
async function withDetailMessage<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (e) {
    const detail = errorDetail(e);
    if (e instanceof ApiError && detail != null && typeof detail !== 'string') {
      throw new ApiError(JSON.stringify(detail), e.status, e.data);
    }
    throw e;
  }
}

export async function fetchInstitutions(): Promise<Record<string, InstitutionRegistryEntry>> {
  return withDetailMessage(apiGet(`${BASE}/registries/institution`, { timeout: 10000 }));
}
export interface OccupationRegistryEntry {
  id: string | null; labels: Record<string, string>; variants: string[]; notes?: string;
}
export async function fetchRegistry(kind: 'occupation' | 'institution'):
  Promise<Record<string, OccupationRegistryEntry | InstitutionRegistryEntry>> {
  return withDetailMessage(apiGet(`${BASE}/registries/${kind}`, { timeout: 10000 }));
}
export async function saveRegistryEntry(kind: 'occupation' | 'institution', key: string,
  entry: OccupationRegistryEntry | InstitutionRegistryEntry, token: string): Promise<OccupationRegistryEntry | InstitutionRegistryEntry> {
  return withDetailMessage(apiPut(`${BASE}/registries/${kind}/${encodeURIComponent(key)}`, entry, { token, timeout: 15000 }));
}
/** Sama Q-koodiga kirje on registris juba olemas — kutsuja pakub seda (`key`). */
export class RegistryDuplicateError extends Error {
  constructor(public key: string) { super('duplicate_id'); }
}
/** Uus registrikirje; võtme genereerib server. */
export async function createRegistryEntry(kind: 'occupation' | 'institution',
  entry: OccupationRegistryEntry | InstitutionRegistryEntry, token: string):
  Promise<{ key: string; entry: OccupationRegistryEntry | InstitutionRegistryEntry }> {
  try {
    return await withDetailMessage(apiPost(`${BASE}/registries/${kind}`, entry, { token, timeout: 15000 }));
  } catch (e) {
    const detail = errorDetail(e) as { code?: unknown; key?: unknown } | undefined;
    if (e instanceof ApiError && e.status === 409 && detail?.code === 'duplicate_id' && typeof detail.key === 'string') {
      throw new RegistryDuplicateError(detail.key);
    }
    throw e;
  }
}

export async function listEnrichmentProposals(personId: string, token: string): Promise<EnrichmentProposal[]> {
  return withDetailMessage(apiGet(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}`, { token, timeout: 10000 }));
}

/** Kinnitus kukkus pärast registrikirjete loomist: kirjed jäid alles, kaart muutmata. */
export class EnrichmentApplyError extends Error {
  created: string[];
  constructor(message: string, created: string[]) { super(message); this.created = created; }
}

export async function applyEnrichmentProposal(personId: string, proposalId: string,
  selected: number[], token: string, revision: string): Promise<ProsopoRecord> {
  try {
    // Kinnitus võib teha mitu git-commitit (registrikirjed + kaart) — pikem ajalõpp.
    return await withDetailMessage(apiPost(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}/apply`,
      { proposal_id: proposalId, selected, revision }, { token, timeout: 30000 }));
  } catch (e) {
    const detail = errorDetail(e) as { error?: unknown; created_registry_entries?: unknown } | undefined;
    if (detail && typeof detail === 'object' && Array.isArray(detail.created_registry_entries)) {
      throw new EnrichmentApplyError(String(detail.error), detail.created_registry_entries);
    }
    throw e;
  }
}

export async function rejectEnrichmentProposal(personId: string, proposalId: string,
  selected: number[], token: string, revision: string): Promise<{ proposal_id: string; remaining: number }> {
  return withDetailMessage(apiPost(`${BASE}/enrichment-proposals/${encodeURIComponent(personId)}/reject`,
    { proposal_id: proposalId, selected, revision }, { token, timeout: 15000 }));
}

export async function listPersons(params?: PersonFilterParams & {
  sort_by?: string;
  ids?: string[];
  collection?: string;
  /** Töökollektsiooni id (#354). Server kontrollib ligipääsu ja piirab isikud. */
  work_set?: string;
  limit?: number;
  offset?: number;
}, token?: string): Promise<{ results: ProsopoIndexEntry[]; total: number; offset: number; limit: number }> {
  if (params?.ids?.length) {
    return apiPost(`${BASE}/query`, params, { token, timeout: 10000 });
  }

  const url = new URL(BASE, window.location.origin);
  appendPersonFilterParams(url.searchParams, params);
  if (params?.sort_by) url.searchParams.set('sort_by', params.sort_by);
  if (params?.ids?.length) url.searchParams.set('ids', params.ids.join(','));
  if (params?.collection) url.searchParams.set('collection', params.collection);
  if (params?.work_set) url.searchParams.set('work_set', params.work_set);
  if (params?.limit != null) url.searchParams.set('limit', String(params.limit));
  if (params?.offset != null) url.searchParams.set('offset', String(params.offset));

  return apiGet(url.toString(), { token, timeout: 10000 });
}

export async function fetchPersonMapMarkers(params?: PersonFilterParams & {
  ids?: string[];
  related_to?: string;
  collection?: string;
  work_set?: string;
}, token?: string): Promise<ProsopoMapResponse> {
  const url = new URL(`${BASE}/map`, window.location.origin);
  appendPersonFilterParams(url.searchParams, params);
  if (params?.ids?.length) url.searchParams.set('ids', params.ids.join(','));
  if (params?.related_to) url.searchParams.set('related_to', params.related_to);
  if (params?.collection) url.searchParams.set('collection', params.collection);
  if (params?.work_set) url.searchParams.set('work_set', params.work_set);

  return apiGet(url.toString(), { token, timeout: 10000 });
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
  return apiGet(url.toString(), { signal, timeout: 90000 });
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
    return apiPost(`${BASE}/facets`, params, { token, timeout: 10000 });
  }

  const url = new URL(`${BASE}/facets`, window.location.origin);
  if (params?.q) url.searchParams.set('q', params.q);
  if (params?.gender) url.searchParams.set('gender', params.gender);
  if (params?.collection) url.searchParams.set('collection', params.collection);
  if (params?.work_set) url.searchParams.set('work_set', params.work_set);

  return apiGet(url.toString(), { token, timeout: 10000 });
}

export async function getPerson(personId: string, token?: string): Promise<ProsopoRecord> {
  return apiGet(`${BASE}/${encodeURIComponent(personId)}`, { token, timeout: 10000 });
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
    const data = await apiPost<{ titles?: Record<string, { title: string; year: number | null; restricted: boolean }> }>(
      `${BASE}/work-titles`, { work_ids: workIds }, { token, timeout: 10000 });
    return data?.titles || {};
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

/** 409 `identifier_conflict` → `PersonConflictError`; muu 409 jääb `null`-iks. */
function personConflict(e: unknown): PersonConflictError | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = (errorDetail(e) ?? {}) as { error?: unknown; conflict?: 'exists' | 'split'; existing_person_ids?: string[] };
  return d.error === 'identifier_conflict' ? new PersonConflictError(d.conflict!, d.existing_person_ids ?? []) : null;
}

/** Isiku loomine ühe sammuga — ainus loomistee (server paneb ülevaatusmärke). */
export async function createPersonChecked(body: CreatePersonBody, token: string): Promise<ProsopoRecord> {
  try {
    return await apiPost(`${BASE}/persons/create`, body, { token, timeout: 15000 });
  } catch (e) {
    throw personConflict(e) ?? e;
  }
}

export async function updatePerson(personId: string, data: Partial<ProsopoRecord>, token: string): Promise<ProsopoRecord> {
  try {
    return await apiPut(`${BASE}/${encodeURIComponent(personId)}`, data, { token, timeout: 10000 });
  } catch (e) {
    const conflict = personConflict(e);
    if (conflict) throw conflict;
    if (e instanceof ApiError && e.status === 409) {
      const d = (errorDetail(e) ?? {}) as { current_updated_at?: string };
      throw Object.assign(new Error('conflict'), { conflict: true, current_updated_at: d.current_updated_at });
    }
    throw e;
  }
}

export async function uploadPersonImage(personId: string, file: File, token: string): Promise<{ image_url: string; updated_at?: string }> {
  return apiPost(`${BASE}/${encodeURIComponent(personId)}/image`, file,
    { token, timeout: 30000, headers: { 'Content-Type': file.type } });
}

export async function fetchEnrichmentPreview(scheme: string, id: string, token: string): Promise<{
  auto_filled: Record<string, any>;
  conflicts: { field: string; local: any; remote: any }[];
  error?: string;
}> {
  const url = new URL(`${BASE}/enrich/preview`, window.location.origin);
  url.searchParams.set('scheme', scheme);
  url.searchParams.set('id', id);
  return apiGet(url.toString(), { token, timeout: 15000 });
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
  const url = new URL(`${BASE}/${encodeURIComponent(personId)}/enrich/preview`, window.location.origin);
  url.searchParams.set('scheme', scheme);
  if (extId) url.searchParams.set('id', extId);
  return apiGet(url.toString(), { token, timeout: 15000 });
}

export async function deletePersonImage(personId: string, token: string): Promise<{ updated_at: string }> {
  return apiDelete(`${BASE}/${encodeURIComponent(personId)}/image`, { token, timeout: 10000 });
}

export async function bulkUpdateOccupation(
  occupation: { id: string | null; label: string; labels?: Record<string, string> | null; source?: string },
  mode: 'add' | 'replace',
  personIds: string[],
  token: string,
): Promise<{ updated: number; skipped: number; total: number }> {
  return apiPost(`${BASE}/bulk-occupation`, { occupation, mode, person_ids: personIds }, { token, timeout: 30000 });
}

export async function deletePerson(personId: string, token: string): Promise<{ deleted: string }> {
  return apiDelete(`${BASE}/${encodeURIComponent(personId)}/delete`, { token, timeout: 15000 });
}

export async function mergePersons(
  sourceId: string,
  targetId: string,
  token: string,
): Promise<{ id: string }> {
  return apiPost(`${BASE}/${encodeURIComponent(sourceId)}/merge`, { target_id: targetId }, { token, timeout: 30000 });
}

export async function fetchPlaces(): Promise<Record<string, PlaceEntry>> {
  return apiGet(`${BASE}/places`, { timeout: 10000 });
}

export async function fetchPlacesMeta(): Promise<{
  groups: Record<string, { labels: Record<string, string>; sort_order: number }>;
  allowed_types: string[];
}> {
  return apiGet(`${BASE}/places/meta`, { timeout: 10000 });
}

export async function searchPlacesWikidata(q: string, lang = 'en'): Promise<{ q: string; label: string; description: string; aliases: string[] }[]> {
  try {
    return await apiGet(`${BASE}/places/wikidata-search?q=${encodeURIComponent(q)}&lang=${lang}`, { timeout: 10000 });
  } catch (e) {
    if (e instanceof ApiError) return [];
    throw e;
  }
}

export async function fetchPlaceWikidata(qid: string): Promise<{
  labels: Record<string, string>;
  type: string | null;
  coordinates: { lat: number; lon: number; source?: string; wikidata_property?: string; geonames_id?: string } | null;
  parents: { q: string; label_en: string; label_sv: string }[];
}> {
  return apiGet(`${BASE}/places/wikidata/${encodeURIComponent(qid)}`, { timeout: 15000 });
}

export async function addPlace(key: string, data: Partial<PlaceEntry>, token: string): Promise<{ key: string; entry: PlaceEntry }> {
  return apiPut(`${BASE}/admin/places/${encodeURIComponent(key)}`, data, { token, timeout: 10000 });
}

export async function updatePlace(
  key: string,
  data: Partial<PlaceEntry> & { historical_names?: string[]; notes?: string },
  token: string,
): Promise<{ key: string; entry: PlaceEntry }> {
  return apiPut(`${BASE}/admin/places/${encodeURIComponent(key)}`, data, { token, timeout: 10000 });
}

export async function deletePlace(key: string, token: string): Promise<void> {
  await apiDelete(`${BASE}/admin/places/${encodeURIComponent(key)}`, { token, timeout: 10000 });
}

export async function putGroup(
  key: string,
  data: { labels?: Record<string, string>; sort_order?: number; parent?: string | null },
  token: string,
): Promise<{ key: string; entry: Record<string, any> }> {
  return apiPut(`${BASE}/admin/groups/${encodeURIComponent(key)}`, data, { token, timeout: 10000 });
}

export async function deleteGroup(key: string, token: string): Promise<void> {
  await apiDelete(`${BASE}/admin/groups/${encodeURIComponent(key)}`, { token, timeout: 10000 });
}

export async function autoAssignGroupParents(token: string): Promise<{ assigned: number; skipped: string[] }> {
  return apiPost(`${BASE}/admin/groups/auto-assign`, undefined, { token, timeout: 10000 });
}

export async function mergePlaces(
  sourceKey: string,
  targetKey: string,
  token: string,
): Promise<{ redirected: number; target_key: string }> {
  return apiPost(`${BASE}/admin/places/${encodeURIComponent(sourceKey)}/merge`, { target_key: targetKey }, { token, timeout: 15000 });
}

export async function fetchPersonHistory(
  personId: string,
  token: string | null
): Promise<{ hash: string; full_hash: string; author: string; date: string; formatted_date: string; message: string; is_original: boolean }[]> {
  const data = await apiGet<{ history?: any[] }>(`${BASE}/${encodeURIComponent(personId)}/history`, { token });
  return data?.history ?? [];
}

export async function fetchPersonDiff(
  personId: string,
  commitHash: string,
  token: string | null
): Promise<{ field: string; old: unknown; new: unknown }[]> {
  const data = await apiGet<{ changes?: { field: string; old: unknown; new: unknown }[] }>(
    `${BASE}/${encodeURIComponent(personId)}/diff?commit=${commitHash}`, { token });
  return data?.changes ?? [];
}

export async function restorePerson(
  personId: string,
  commitHash: string,
  token: string | null
): Promise<unknown> {
  return apiPost(`${BASE}/${encodeURIComponent(personId)}/restore`, { commit_hash: commitHash }, { token });
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
  try {
    const body = await apiPost<{ text: string }>(`${BASE}/translate`,
      { source_lang: sourceLang, target_lang: targetLang, text }, { token, timeout: 120000 });
    return body.text;
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    if (e.status === 429) throw new TranslateFailed('rate_limited', 'rate limited');
    const detail = String(errorDetail(e) ?? '');
    throw new TranslateFailed(detail.startsWith(CONTENT_BLOCKED_PREFIX) ? 'blocked' : 'other', detail);
  }
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
  return apiGet(`${BASE}/${encodeURIComponent(personId)}/source-diff?field=${field}`, { token, timeout: 15000 });
}

export interface SimilarPerson { id: string; label: string; birth_year: number | null; death_year: number | null; work_count: number }

/** Isikupaneeli kandidaatide kokkuvõtted (spekk §6) + sarnased olemasolevad kaardid. */
export async function fetchCandidates(
  name: string, refs: { scheme: string; id: string }[], token: string,
): Promise<{ results: import('../panel/types').CandidateResult[]; similar_persons: SimilarPerson[] }> {
  return apiPost(`${BASE}/candidates`, { name, refs }, { token, timeout: 15000 });
}
