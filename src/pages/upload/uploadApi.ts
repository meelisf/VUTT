import { FILE_API_URL } from '../../config';
import { apiDelete, apiGet, apiPost, ApiError } from '../../services/apiClient';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import type {
  PollResult,
  PrepressPlan,
  PrepressSaveResult,
  UploadCreateResponse,
  UploadImportResponse,
  UploadListResponse,
  WorkMetadataForReplace,
} from './types';

export { ApiError };

async function parseUploadResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.detail || data?.message || `Upload failed: ${response.status}`;
    throw new ApiError(message, response.status, data);
  }
  return data as T;
}

export function getReplaceWorkMetadata(workId: string, token: string | null): Promise<WorkMetadataForReplace> {
  return apiGet<WorkMetadataForReplace>(`/admin/work/${workId}/metadata`, { token });
}

export function createUpload<T = unknown>(payload: T, token: string | null): Promise<UploadCreateResponse> {
  return apiPost<UploadCreateResponse>('/admin/upload/create', payload, { token });
}

export function listUploads(token: string | null): Promise<UploadListResponse> {
  return apiGet<UploadListResponse>('/admin/uploads', { token });
}

export function getUploadStatus(uploadId: string, token: string | null): Promise<PollResult> {
  return apiGet<PollResult>(`/admin/upload/${uploadId}/status`, { token });
}

export async function uploadSingleFile(uploadId: string, file: File, token: string | null): Promise<void> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/admin/upload/${uploadId}/files`, {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(file.name), ...getAuthHeaders(token) },
    body: file,
    timeout: 300_000,
  });
  await parseUploadResponse(response);
}

export async function uploadImagePage(
  uploadId: string,
  file: File,
  pageNumber: number,
  totalPages: number,
  token: string | null,
): Promise<void> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/admin/upload/${uploadId}/files`, {
    method: 'POST',
    headers: {
      'X-Filename': encodeURIComponent(file.name),
      'X-Page-Number': String(pageNumber),
      'X-Total-Pages': String(totalPages),
      ...getAuthHeaders(token),
    },
    body: file,
    timeout: 300_000,
  });
  await parseUploadResponse(response);
}

export function importUpload(uploadId: string, token: string | null): Promise<UploadImportResponse> {
  return apiPost<UploadImportResponse>(`/admin/upload/${uploadId}/import`, {}, { token, timeout: 60_000 });
}

export function replaceWorkUpload(uploadId: string, workId: string, token: string | null): Promise<UploadImportResponse> {
  return apiPost<UploadImportResponse>(
    `/admin/upload/${uploadId}/replace-work/${workId}`,
    { metadata_updates: {} },
    { token, timeout: 30_000 },
  );
}

export function deleteUpload(uploadId: string, token: string | null): Promise<unknown> {
  return apiDelete<unknown>(`/admin/upload/${uploadId}`, { token });
}

// ---------------------------------------------------------------------------
// Prepress — topeltlehtede poolitamine enne OCR-i
// ---------------------------------------------------------------------------

export function getPrepress(uploadId: string, token: string | null): Promise<PrepressPlan> {
  return apiGet<PrepressPlan>(`/admin/upload/${uploadId}/prepress`, { token });
}

export function startPrepress(uploadId: string, token: string | null): Promise<{ status: string }> {
  return apiPost<{ status: string }>(`/admin/upload/${uploadId}/prepress/start`, {}, { token });
}

export function savePrepress(
  uploadId: string,
  plan: Pick<PrepressPlan, 'enabled' | 'default_split_x' | 'pages'>,
  token: string | null,
): Promise<PrepressSaveResult> {
  return apiPost<PrepressSaveResult>(`/admin/upload/${uploadId}/prepress`, plan, { token });
}

export function applyPrepress(
  uploadId: string,
  token: string | null,
): Promise<{ status: string; path: string }> {
  return apiPost<{ status: string; path: string }>(
    `/admin/upload/${uploadId}/prepress/apply`, {}, { token },
  );
}

/**
 * Pildipäringud lähevad <img src>-ina, mis EI saada Authorization päist.
 * Token käib query-parameetrina — SAMA muster nagu olemasoleval pisipildil
 * (UploadStepReview.tsx: `/admin/upload/${uploadId}/thumb/${page}?token=…`).
 */
export function prepressPreviewUrl(uploadId: string, n: number, token: string | null): string {
  return `${FILE_API_URL}/admin/upload/${uploadId}/preview/${n}?token=${token ?? ''}`;
}

export function prepressStripUrl(
  uploadId: string, n: number, x: number, token: string | null,
): string {
  return `${FILE_API_URL}/admin/upload/${uploadId}/strip/${n}`
    + `?x=${x.toFixed(5)}&token=${token ?? ''}`;
}
