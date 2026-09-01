import { LinkedEntity } from '../types/LinkedEntity';
import { ApiRequestOptions, apiDelete, apiGet, apiPost } from './apiClient';

// Teoste ja haldusvaate backend API abifunktsioonid. Komponendid peaksid siin
// kasutama domeenimeetodeid, mitte otse URL-e kokku panema.

export interface ApiStatusResponse {
  status?: string;
  message?: string;
  detail?: string;
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
  image_exp?: number;
  image_sig?: string;
}

export interface ReocrBatchRequest {
  page_filenames: string[];
  material_type: 'print' | 'hand';
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
    auth_token: token,
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
    auth_token: token,
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
    auth_token: token,
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

export function getWorkMetadata(workId: string, token: string): Promise<WorkMetadataResponse> {
  return apiPost<WorkMetadataResponse>('/get-work-metadata', { work_id: workId }, authJson(token));
}

export function getViewerToken(workId: string, token: string): Promise<ViewerTokenResponse> {
  return apiGet<ViewerTokenResponse>(`/work/${workId}/viewer-token`, auth(token, { timeout: 10000 }));
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
  // Pikk timeout: suure teose puhul kirjutatakse sadu faile + üks git-commit.
  return apiPost<ReocrApplyResponse>(
    `/admin/work/${workId}/reocr-apply`,
    { page_filenames: pageFilenames },
    authJson(token, { timeout: 120000 }),
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

export function deleteWorkPages(workId: string, token: string, baseNames: string[]): Promise<ApiStatusResponse> {
  return apiPost<ApiStatusResponse>(`/admin/work/${workId}/delete-pages`, { base_names: baseNames }, authJson(token, { timeout: 30000 }));
}

export function replaceWorkPageImage(
  workId: string,
  token: string,
  pageNum: number,
  file: File,
): Promise<ApiStatusResponse> {
  const formData = new FormData();
  formData.append('file', file);
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
): Promise<AddPagesResponse> {
  const formData = new FormData();
  files.forEach((file) => formData.append('file', file));
  formData.append('after_page_num', String(afterPageNum));
  return apiPost<AddPagesResponse>(`/admin/work/${workId}/add-pages`, formData, auth(token, { timeout: 120000 }));
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
