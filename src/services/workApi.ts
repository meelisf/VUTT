import { LinkedEntity } from '../types/LinkedEntity';
import type { ConvoluteBlock, Exemplar, ExemplarConvolute } from '../types';
import { ApiRequestOptions, apiDelete, apiGet, apiPost, apiPut } from './apiClient';
import { FILE_API_URL } from '../config';
import type { PageOpRequest } from '../pages/manage/pageOpsPlan';
import type { PageAdjust } from '../pages/upload/types';

// Teoste ja haldusvaate backend API abifunktsioonid. Komponendid peaksid siin
// kasutama domeenimeetodeid, mitte otse URL-e kokku panema.

export interface ApiStatusResponse {
  status?: string;
  message?: string;
  detail?: string;
  /** false = kettale kirjutatud, aga Git-commit ebaõnnestus (#418). */
  git_committed?: boolean;
  warning?: string;
}

export interface WorkPageInfo {
  page_num: number;
  sequence: number;
  base_name: string;
  filename: string;
  lehekylje_pilt: string;
  status: string;
  has_text: boolean;
}

export interface DeletedWorkPage {
  filename: string;
  base_name: string;
  deleted_at: string | null;
  deleted_by: string | null;
  commit_hash: string | null;
  /** 'deleted' | 'split' | 'unknown' — serveri liigitus commiti sõnumist. */
  reason: string;
  /** Serveri otsus. Klient EI tuleta seda liigist — reegel elab ühes kohas. */
  restorable: boolean;
  /** Lähtefaili mtime_ns pisipildi URL-i jaoks. */
  v: number;
}

export interface ModifiedImage {
  filename: string;
  page: number;
  /** Tühi loend = „muudetud" ilma täpsustuseta (logirida puudub). */
  action: string[];
  at: string | null;
  by: string | null;
  /** Originaali („enne") versioon. */
  v: number;
  /** Praeguse pildi („pärast") versioon — MUUTUB originaali taastamisel. */
  v_current: number;
}

export interface ModifiedImagesResponse extends ApiStatusResponse {
  images?: ModifiedImage[];
}

export interface WorkPagesResponse extends ApiStatusResponse {
  pages?: WorkPageInfo[];
}

export interface DeletedWorkPagesResponse extends ApiStatusResponse {
  pages?: DeletedWorkPage[];
}

export interface WorkMetadataResponse extends ApiStatusResponse {
  metadata?: {
    title?: string;
    type?: { id?: string } | null;
    [key: string]: unknown;
  };
}

export interface ViewerTokenResponse {
  token?: string;
  image_exp?: number;
  image_sig?: string;
}

export interface ReocrBatchRequest {
  page_filenames: string[];
  material_type: 'print' | 'hand';
  /** Puudumisel = "loss" (backendi vaikeväärtus). "gemini" nõuab superadmin-rolli. */
  provider?: 'loss' | 'gemini';
}

export interface AddPagesResponse extends ApiStatusResponse {
  meili_warning?: boolean;
}

export interface OcrProvidersResponse extends ApiStatusResponse {
  gemini?: { enabled: boolean; model: string };
}

const auth = (token: string | null, options: ApiRequestOptions = {}): ApiRequestOptions => ({
  ...options,
  token,
});

const authJson = (token: string | null, options: ApiRequestOptions = {}): ApiRequestOptions => ({
  ...auth(token, options),
  headers: { 'Content-Type': 'application/json', ...options.headers },
});

export function bulkAssignCollection(
  token: string | null,
  workIds: string[],
  collectionId: string | null,
): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>('/works/bulk-collection', {
    work_ids: workIds,
    // null = "Määramata" → set puhastab kõik; päris kollektsioon → add lisab olemasolevate kõrvale
    mode: collectionId === null ? 'set' : 'add',
    collection_id: collectionId,
  }, authJson(token, { timeout: 30000 }));
}

export function bulkAssignTags(
  token: string | null,
  workIds: string[],
  tags: LinkedEntity[],
  mode: 'add' | 'replace' | 'remove',
): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>('/works/bulk-tags', {
    work_ids: workIds,
    tags,
    mode,
  }, authJson(token, { timeout: 30000 }));
}

export function bulkAssignGenre(
  token: string | null,
  workIds: string[],
  genre: LinkedEntity | null,
): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>('/works/bulk-genre', {
    work_ids: workIds,
    genre,
    mode: genre ? 'add' : 'set',
  }, authJson(token, { timeout: 30000 }));
}

export function getWorkPages(workId: string, token: string): Promise<WorkPagesResponse> {
  return apiGet<WorkPagesResponse>(`/admin/work/${workId}/pages`, auth(token));
}

export function getDeletedWorkPages(workId: string, token: string): Promise<DeletedWorkPagesResponse> {
  return apiGet<DeletedWorkPagesResponse>(`/admin/work/${workId}/trash-pages`, auth(token));
}

export function getModifiedImages(workId: string, token: string | null): Promise<ModifiedImagesResponse> {
  return apiGet<ModifiedImagesResponse>(`/admin/work/${workId}/modified-images`, auth(token));
}

export function getWorkMetadata(workId: string, token: string): Promise<WorkMetadataResponse> {
  return apiPost<WorkMetadataResponse>('/get-work-metadata', { work_id: workId }, authJson(token));
}

export function getViewerToken(workId: string, token: string | null): Promise<ViewerTokenResponse> {
  return apiGet<ViewerTokenResponse>(`/work/${workId}/viewer-token`, auth(token, { timeout: 10000 }));
}

export interface DownloadTicketResponse {
  exp: number;
  sig: string;
}

/** Lühiajaline allalaadimisallkiri: <a href> ei kanna Authorization-päist. */
export function getDownloadTicket(workId: string, token: string | null): Promise<DownloadTicketResponse> {
  return apiGet<DownloadTicketResponse>(`/download/${workId}/ticket`, auth(token, { timeout: 10000 }));
}

export function getReocrStatus<T>(workId: string, token: string): Promise<T> {
  return apiGet<T>(`/admin/work/${workId}/reocr-status`, auth(token, { timeout: 8000 }));
}

/** Millised OCR-pakkujad on seadistatud. Ainult superadmin; võtit vastus ei sisalda. */
export function getOcrProviders(token: string | null): Promise<OcrProvidersResponse> {
  return apiGet<OcrProvidersResponse>('/admin/ocr/providers', auth(token, { timeout: 8000 }));
}

export function startReocrBatch(
  workId: string,
  token: string,
  body: ReocrBatchRequest,
): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>(`/admin/work/${workId}/reocr-batch`, body, authJson(token, { timeout: 30000 }));
}

export interface ReocrCancelResponse {
  status: string;
  /** "failed" = LOSSi koristus ei õnnestunud; VUTT-i pool on siiski katkestatud (#217). */
  remote_cleanup: 'ok' | 'failed';
  deleted_ocr: number;
  restored_ocr: number;
}

/** Katkestab re-OCR töö (üksik või batch). Koristus teeb SFTP-d → pikem timeout. */
export function cancelReocrJob(jobId: string, token: string): Promise<ReocrCancelResponse> {
  return apiDelete<ReocrCancelResponse>(`/admin/reocr/${jobId}`, auth(token, { timeout: 30000 }));
}

export interface ReocrFailure {
  filename: string;
  error: string;
}

export interface ReocrApplyResponse extends ApiStatusResponse {
  applied?: string[];
  failed?: ReocrFailure[];
  commit_hash?: string;
  git_committed?: boolean;
  /** false = Meili sünk ei jõudnud ajalimiidiks valmis (jätkub taustal); null = midagi ei rakendatud */
  meili_synced?: boolean | null;
}

export interface ReocrDiscardResponse extends ApiStatusResponse {
  discarded?: string[];
  failed?: ReocrFailure[];
}

export function applyReocrResults(
  workId: string,
  token: string,
  pageFilenames: string[],
): Promise<ReocrApplyResponse> {
  // Pikk timeout: suure teose puhul kirjutatakse sadu faile + üks git-commit,
  // seejärel ootab server Meili sünki (kuni 90 s).
  return apiPost<ReocrApplyResponse>(
    `/admin/work/${workId}/reocr-apply`,
    { page_filenames: pageFilenames },
    authJson(token, { timeout: 240000 }),
  );
}

export function discardReocrResults(
  workId: string,
  token: string,
  pageFilenames: string[],
): Promise<ReocrDiscardResponse> {
  return apiPost<ReocrDiscardResponse>(
    `/admin/work/${workId}/reocr-discard`,
    { page_filenames: pageFilenames },
    authJson(token, { timeout: 30000 }),
  );
}

export function reorderWorkPages(workId: string, token: string, order: string[]): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>(`/admin/work/${workId}/reorder-pages`, { order }, authJson(token, { timeout: 30000 }));
}

export interface PageOpsResult {
  /** `add_pdf` töö: lisatud lehed sisestusjärjekorras. */
  inserted?: { filename: string; sequence: number }[];
  rotated?: number;
  adjusted?: number;
  split?: number;
  new_page_count?: number;
}

/** Teose taustatöö liik (ADR 0074): teose kohta käib korraga üks, liigist sõltumata. */
export type WorkJobKind = 'page_ops' | 'add_pdf';

/** Taustatöö olek (#431). `idle` = tööd ei ole (või server taaskäivitus). */
export interface PageOpsStatus {
  state: 'idle' | 'running' | 'done' | 'error';
  kind?: WorkJobKind;
  /** Vea kood, nt `anchor_missing` (PDF-i sisestuskoha leht kadus vahepeal). */
  code?: string;
  done?: number;
  total?: number;
  result?: PageOpsResult;
  error?: string;
  /** Vea korral: täielikult tehtud lehed. Puudub = teadmata (plaan tühjaks). */
  applied?: string[];
  /** Vea korral: lehed, mille pööre/kärbe tehti, aga poolitus mitte. */
  transformed?: string[];
}

/** Käivitab ootel pöörded, kärped ja poolitused taustatööna; edenemine `getWorkPageOpsStatus`-ist. */
export function startWorkPageOps(
  workId: string,
  token: string,
  ops: PageOpRequest[],
): Promise<{ status: string; total: number }> {
  return apiPost(`/admin/work/${workId}/page-ops`, { ops }, authJson(token, { timeout: 30000 }));
}

/**
 * Ootel pöörde + kärpe eelvaade `<img src>`-ile (ADR 0061). Teisendus käib
 * URL-is: pilt on deterministlik ja vale pilti brauseri vahemällu ei jää.
 * `thumb` = ruudustiku pisipilt, `view` = pildiredaktori lava.
 */
export function workPagePreviewUrl(
  workId: string, filename: string, token: string | null,
  rotate: number, adjust: PageAdjust | null, size: 'thumb' | 'view', cacheBust = 0,
): string {
  const params = new URLSearchParams({ token: token ?? '', size });
  if (rotate) params.set('rot', String(rotate));
  if (adjust) params.set('adj', JSON.stringify(adjust));
  if (cacheBust) params.set('v', String(cacheBust));
  return `${FILE_API_URL}/admin/work/${workId}/page-image/${encodeURIComponent(filename)}/preview?${params}`;
}

export function getWorkPageOpsStatus(workId: string, token: string): Promise<PageOpsStatus> {
  return apiGet<PageOpsStatus>(`/admin/work/${workId}/page-ops/status`, auth(token, { timeout: 15000 }));
}

export function deleteWorkPages(workId: string, token: string, baseNames: string[]): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>(`/admin/work/${workId}/delete-pages`, { base_names: baseNames }, authJson(token, { timeout: 30000 }));
}

/** Uue pildi päritolu eksemplaridega teosel (ADR 0076 p 4): 'same' | 'unknown' | eksemplari id. */
function appendOrigin(formData: FormData, origin?: string | null) {
  if (origin) formData.append('exemplar_origin', origin);
}

export interface WorkExemplarsResponse {
  exemplars: Exemplar[];
  unknown_pages: string[];
  page_numbers: Record<string, number>;
  page_count: number;
  convolutes: ConvoluteBlock[];
}

export function getWorkExemplars(workId: string, token?: string | null): Promise<WorkExemplarsResponse> {
  return apiGet<WorkExemplarsResponse>(`/works/${workId}/exemplars`, auth(token ?? null));
}

/** Eksemplari muudetavad väljad (ADR 0076 p 2). Tühi string = välja eemaldamine. */
export interface ExemplarInput {
  holder?: string;
  shelfmark?: string;
  url?: string;
  condition?: string;
  binding?: string;
  provenance?: string;
  notes?: string;
  /** null = konvoluudi märge eemaldatakse. */
  convolute?: ExemplarConvolute | null;
  /** true = see on tunnistaja (server võtab märke eelmiselt), false = märge maha. */
  text_witness?: boolean;
  /** Ainult `false` on toimetaja toiming: lipu mahavõtmine. */
  needs_review?: boolean;
}

const exemplarsPath = (workId: string) => `/works/${encodeURIComponent(workId)}/exemplars`;

export function createWorkExemplar(workId: string, data: ExemplarInput, token: string | null): Promise<Exemplar> {
  return apiPost<Exemplar>(exemplarsPath(workId), data, auth(token));
}

export function updateWorkExemplar(
  workId: string, exemplarId: string, data: ExemplarInput, token: string | null,
): Promise<Exemplar> {
  return apiPut<Exemplar>(`${exemplarsPath(workId)}/${encodeURIComponent(exemplarId)}`, data, auth(token));
}

export function deleteWorkExemplar(workId: string, exemplarId: string, token: string | null): Promise<void> {
  return apiDelete<void>(`${exemplarsPath(workId)}/${encodeURIComponent(exemplarId)}`, auth(token));
}

export function reorderWorkExemplars(workId: string, ids: string[], token: string | null): Promise<{ exemplars: Exemplar[] }> {
  return apiPost<{ exemplars: Exemplar[] }>(`${exemplarsPath(workId)}/order`, { ids }, auth(token));
}

export function replaceWorkPageImage(
  workId: string,
  token: string,
  pageNum: number,
  file: File,
  origin?: string | null,
): Promise<ApiStatusResponse> {
  const formData = new FormData();
  formData.append('file', file);
  appendOrigin(formData, origin);
  return apiPost<ApiStatusResponse>(
    `/admin/work/${workId}/page/${pageNum}/replace-image`,
    formData,
    auth(token, { timeout: 30000 }),
  );
}

export function addWorkPages(
  workId: string,
  token: string,
  files: File[],
  afterPageNum: number,
  origin?: string | null,
): Promise<AddPagesResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append('file', file));
  formData.append('after_page_num', String(afterPageNum));
  appendOrigin(formData, origin);
  return apiPost<AddPagesResponse>(`/admin/work/${workId}/add-pages`, formData, auth(token, { timeout: 120000 }));
}

/**
 * Lisab PDF-i lehed taustatööna (ADR 0074); edenemine `getWorkPageOpsStatus`-ist
 * (`kind: 'add_pdf'`). `after` = "start" | "end" | pildifaili nimi, mille järele.
 */
export function addWorkPdf(
  workId: string,
  token: string,
  file: File,
  after: string,
  origin?: string | null,
): Promise<{ status: string; total: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('after', after);
  appendOrigin(formData, origin);
  return apiPost(`/admin/work/${workId}/add-pdf`, formData, auth(token, { timeout: 600000 }));
}

export function restoreDeletedWorkPage(
  workId: string,
  token: string,
  filename: string,
): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>(
    `/admin/work/${workId}/trash-pages/${encodeURIComponent(filename)}/restore`,
    undefined,
    auth(token, { timeout: 30000 }),
  );
}

export function deleteWork(workId: string, token: string): Promise<ApiStatusResponse | null> {
  return apiDelete<ApiStatusResponse | null>(`/admin/work/${workId}`, auth(token, { timeout: 15000 }));
}
