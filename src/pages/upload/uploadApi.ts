import { FILE_API_URL } from '../../config';
import { apiDelete, apiGet, apiPost, ApiError } from '../../services/apiClient';
import { fetchWithTimeout, getAuthHeaders } from '../../utils/fetchWithTimeout';
import type {
  PollResult,
  UploadCreatePayload,
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

export function createUpload(payload: UploadCreatePayload | unknown, token: string | null): Promise<UploadCreateResponse> {
  return apiPost<UploadCreateResponse>('/admin/upload/create', payload, { token });
}

export function listUploads(token: string | null): Promise<UploadListResponse> {
  return apiGet<UploadListResponse>('/admin/uploads', { token });
}

export function getUploadStatus(uploadId: string, token: string | null): Promise<PollResult> {
  return apiGet<PollResult>(`/admin/upload/${uploadId}/status`, { token });
}

export async function uploadSingleFile(uploadId: string, file: File, token: string | null): Promise<unknown> {
  const response = await fetchWithTimeout(`${FILE_API_URL}/admin/upload/${uploadId}/files`, {
    method: 'POST',
    headers: { 'X-Filename': encodeURIComponent(file.name), ...getAuthHeaders(token) },
    body: file,
    timeout: 300_000,
  });
  return parseUploadResponse(response);
}

export async function uploadImagePage(
  uploadId: string,
  file: File,
  pageNumber: number,
  totalPages: number,
  token: string | null,
): Promise<unknown> {
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
  return parseUploadResponse(response);
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
