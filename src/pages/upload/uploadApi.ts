import { FILE_API_URL } from '../../config';
import { apiDelete, apiGet, apiPost, ApiError } from '../../services/apiClient';
import { getAuthHeaders } from '../../utils/fetchWithTimeout';
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

/** Üleslaadimine katkes seisaku tõttu — ühendus elus, aga baite ei liigu.
 *  Eristub tavalisest võrguveast, et kasutajale saaks öelda midagi kasulikku. */
export class UploadStalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadStalledError';
  }
}

export interface UploadTransferOptions {
  onProgress?: (p: { loaded: number; total: number }) => void;
  /** Lubatud paus KAHE edenemissündmuse vahel keha saatmise ajal (vaikimisi 120 s). */
  stallTimeout?: number;
  /** Lubatud ooteaeg pärast keha saatmist enne serveri vastust (vaikimisi 300 s). */
  responseTimeout?: number;
}

const STALL_TIMEOUT_MS = 120_000;
const RESPONSE_TIMEOUT_MS = 300_000;

/** Saadab faili XHR-iga, et saada edenemissündmusi.
 *
 *  Siin EI TOHI olla kogupäringu-timeout'i: 160 MB fail 43 kB/s ühenduses
 *  kestab tund aega ja iga kogulagi katkestaks selle keset saatmist (nginx
 *  logis 499, backend ei näe ühtki baiti). Piirame ainult SEISAKUT —
 *  saatmise ajal edenemissündmuste vahet, pärast saatmist vastuse ootamist. */
function sendFileWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  options: UploadTransferOptions = {},
): Promise<Response> {
  const stallMs = options.stallTimeout ?? STALL_TIMEOUT_MS;
  const responseMs = options.responseTimeout ?? RESPONSE_TIMEOUT_MS;

  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stalledError: UploadStalledError | null = null;

    const clearTimer = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };

    const armTimer = (ms: number, message: string) => {
      clearTimer();
      timer = setTimeout(() => {
        stalledError = new UploadStalledError(message);
        xhr.abort();
      }, ms);
    };

    xhr.open('POST', url);
    for (const [key, value] of Object.entries(headers)) {
      xhr.setRequestHeader(key, value);
    }

    xhr.upload.onprogress = (e: ProgressEvent) => {
      const total = e.lengthComputable ? e.total : file.size;
      options.onProgress?.({ loaded: e.loaded, total });
      // Keha täis saadetud → edasi ootame ainult vastust, edenemist ei tule enam
      if (total > 0 && e.loaded >= total) {
        armTimer(responseMs, 'Server ei vastanud pärast faili saatmist');
      } else {
        armTimer(stallMs, 'Üleslaadimine seiskus');
      }
    };

    xhr.onload = () => {
      clearTimer();
      // 204/205/304 ei tohi keha kanda; upload-teed neid ei kasuta, aga oleme ettevaatlikud
      const body = xhr.status === 204 || xhr.status === 205 || xhr.status === 304
        ? null
        : xhr.responseText;
      resolve(new Response(body, { status: xhr.status }));
    };

    xhr.onerror = () => {
      clearTimer();
      reject(new ApiError('Võrguviga üleslaadimisel', 0));
    };

    xhr.onabort = () => {
      clearTimer();
      reject(stalledError ?? new ApiError('Üleslaadimine katkestati', 0));
    };

    armTimer(stallMs, 'Üleslaadimine seiskus');
    xhr.send(file);
  });
}

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

export async function uploadSingleFile(
  uploadId: string,
  file: File,
  token: string | null,
  options?: UploadTransferOptions,
): Promise<void> {
  const response = await sendFileWithProgress(
    `${FILE_API_URL}/admin/upload/${uploadId}/files`,
    file,
    { 'X-Filename': encodeURIComponent(file.name), ...getAuthHeaders(token) },
    options,
  );
  await parseUploadResponse(response);
}

export async function uploadImagePage(
  uploadId: string,
  file: File,
  pageNumber: number,
  totalPages: number,
  token: string | null,
  options?: UploadTransferOptions,
): Promise<void> {
  const response = await sendFileWithProgress(
    `${FILE_API_URL}/admin/upload/${uploadId}/files`,
    file,
    {
      'X-Filename': encodeURIComponent(file.name),
      'X-Page-Number': String(pageNumber),
      'X-Total-Pages': String(totalPages),
      ...getAuthHeaders(token),
    },
    options,
  );
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
  plan: Pick<PrepressPlan, 'default_split_x' | 'pages'>,
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
