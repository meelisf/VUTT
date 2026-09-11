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

/** Impordi lagi. Import kestab O(lehtede arv): 524 lk ≈ 75 s (SFTP alla, git
 *  commit, Meili sünk). Vana 60 s lagi langes kokku nginx-i vaikimisi
 *  `proxy_read_timeout`-iga ja iga suurem teos andis 504 valmis teose kohta.
 *  Lagi on nüüd sama, mis nginx-is (`nginx.host.conf`, `/api/files/admin/`). */
const IMPORT_TIMEOUT_MS = 600_000;

/** Kui vastus siiski kaob, küsitakse tulemus staatusest — nii tihti ja nii
 *  kaua. Eelarve katab ka väga suure teose, mille import juba käib. */
const IMPORT_RECOVERY_POLL_MS = 3_000;
const IMPORT_RECOVERY_BUDGET_MS = 15 * 60 * 1000;

export function importUpload(uploadId: string, token: string | null): Promise<UploadImportResponse> {
  return apiPost<UploadImportResponse>(
    `/admin/upload/${uploadId}/import`, {}, { token, timeout: IMPORT_TIMEOUT_MS },
  );
}

export interface ImportRecoveryDeps {
  doImport?: typeof importUpload;
  checkStatus?: typeof getUploadStatus;
  pollMs?: number;
  budgetMs?: number;
}

const maga = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Impordib ja EI usu katkenud päringut tõendina.
 *
 *  Import jookseb serveris threadpoolis: kliendi lahtiühendamine (504, timeout,
 *  suletud sülearvuti) EI katkesta seda. Katkenud vastus tähendab „ma ei tea",
 *  mitte „ebaõnnestus" — tõene allikas on upload'i staatus:
 *    `imported` → import LÄKS läbi, tulemus on `work_id`,
 *    `importing` → käib veel, ootame,
 *    muu → server andis staatuse tagasi ehk import päriselt kukkus.
 */
export async function importUploadWithRecovery(
  uploadId: string,
  token: string | null,
  deps: ImportRecoveryDeps = {},
): Promise<UploadImportResponse & { recovered?: boolean }> {
  const {
    doImport = importUpload,
    checkStatus = getUploadStatus,
    pollMs = IMPORT_RECOVERY_POLL_MS,
    budgetMs = IMPORT_RECOVERY_BUDGET_MS,
  } = deps;

  try {
    return await doImport(uploadId, token);
  } catch (algne) {
    const tahtaeg = Date.now() + budgetMs;
    do {
      let olek;
      try {
        olek = await checkStatus(uploadId, token);
      } catch {
        // Ka staatus ei vasta — algne viga on parem teade kui „staatus ei vasta".
        throw algne;
      }
      if (olek.status === 'imported' && olek.work_id) {
        return { work_id: olek.work_id, recovered: true };
      }
      if (olek.status !== 'importing') throw algne;
      await maga(pollMs);
    } while (Date.now() < tahtaeg);
    throw algne;
  }
}

export function replaceWorkUpload(uploadId: string, workId: string, token: string | null): Promise<UploadImportResponse> {
  return apiPost<UploadImportResponse>(
    `/admin/upload/${uploadId}/replace-work/${workId}`,
    { metadata_updates: {} },
    { token, timeout: IMPORT_TIMEOUT_MS },
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

/** Poolitusplaani ja apply lagi. Kumbki ei oota tööd ennast: plaani salvestus
 *  kirjutab state.json-i, apply on CAS + taustalõime start. Aga mõlemad
 *  konkureerivad protsessis käiva 300 DPI eelvaate renderdusega (512 lk), ja
 *  `fetchWithTimeout` vaikimisi 10 s andis kasutajale „The operation was
 *  aborted." töö kohta, mis oli ainult ootel (#340). Vaikeväärtus ei ole
 *  leping — sama õppetund mis ADR 0036 / #327, seal nginx-i 60 s. */
const PREPRESS_TIMEOUT_MS = 120_000;

export function savePrepress(
  uploadId: string,
  plan: Pick<PrepressPlan, 'default_split_x' | 'pages'>,
  token: string | null,
): Promise<PrepressSaveResult> {
  return apiPost<PrepressSaveResult>(
    `/admin/upload/${uploadId}/prepress`, plan, { token, timeout: PREPRESS_TIMEOUT_MS },
  );
}

export function setOcrModel(
  uploadId: string,
  model: 'print' | 'hand',
  token: string | null,
): Promise<{ status: string; ocr_model: string }> {
  return apiPost(`/admin/upload/${uploadId}/ocr-model`, { model }, { token });
}

/** Kui vastus siiski kaob, küsitakse tulemus staatusest. Apply päring võib
 *  serverisse jõuda alles pärast kliendi abordi, seega eelarve on mõne
 *  sekundi, mitte ühe päringu pikkune. */
const APPLY_RECOVERY_POLL_MS = 2_000;
const APPLY_RECOVERY_BUDGET_MS = 30_000;

/** Staatused, mis tähendavad „apply LÄKS käima" — ka need, mis on juba
 *  kaugemal: kasutaja võis vahepeal edasi liikuda või poll jõudis ette. */
const APPLY_STARTED_STATUSES = ['applying', 'reviewing', 'done', 'importing', 'imported'];

export function applyPrepress(
  uploadId: string,
  token: string | null,
): Promise<{ status: string; path: string }> {
  return apiPost<{ status: string; path: string }>(
    `/admin/upload/${uploadId}/prepress/apply`, {}, { token, timeout: PREPRESS_TIMEOUT_MS },
  );
}

export interface ApplyRecoveryDeps {
  doApply?: typeof applyPrepress;
  checkStatus?: typeof getUploadStatus;
  pollMs?: number;
  budgetMs?: number;
}

/** Rakendab poolitusplaani ja EI usu katkenud päringut tõendina.
 *
 *  `start_apply` on ühekordne CAS + taustalõim: kliendi lahtiühendamine ei
 *  katkesta seda. Katkenud vastus tähendab „ma ei tea", mitte „ebaõnnestus".
 *  Kui staatus ütleb, et töö käib (või on juba kaugemal), on see õnnestumine;
 *  kui töö eelarve jooksul käima ei lähe, jääb algne viga veaks ja kordus on
 *  kasutaja otsustada — kordus ise on ohutu, teine apply annab 409.
 */
export async function applyPrepressWithRecovery(
  uploadId: string,
  token: string | null,
  deps: ApplyRecoveryDeps = {},
): Promise<{ status: string; path?: string; recovered?: boolean }> {
  const {
    doApply = applyPrepress,
    checkStatus = getUploadStatus,
    pollMs = APPLY_RECOVERY_POLL_MS,
    budgetMs = APPLY_RECOVERY_BUDGET_MS,
  } = deps;

  try {
    return await doApply(uploadId, token);
  } catch (algne) {
    const tahtaeg = Date.now() + budgetMs;
    do {
      let olek;
      try {
        olek = await checkStatus(uploadId, token);
      } catch {
        // Ka staatus ei vasta — algne viga on parem teade kui „staatus ei vasta".
        throw algne;
      }
      if (APPLY_STARTED_STATUSES.includes(olek.status)) {
        return { status: olek.status, recovered: true };
      }
      await maga(pollMs);
    } while (Date.now() < tahtaeg);
    throw algne;
  }
}

/**
 * Pildipäringud lähevad <img src>-ina, mis EI saada Authorization päist.
 * Token käib query-parameetrina — SAMA muster nagu olemasoleval pisipildil
 * (UploadStepReview.tsx: `/admin/upload/${uploadId}/thumb/${page}?token=…`).
 */
/** Eelvaate URL. `rotate` on RENDERDUSPARAMEETER — server annab juba pööratud
 *  pildi, seega joone- ja kuvasuhte-matemaatika ei tea pöördest midagi. Ühtlasi
 *  muutub `src` string pöörde muutumisel iseenesest (ei vaja cache-bust'i). */
export function prepressPreviewUrl(
  uploadId: string, n: number, token: string | null, rotate = 0,
): string {
  const rot = rotate ? `&rot=${rotate}` : '';
  return `${FILE_API_URL}/admin/upload/${uploadId}/preview/${n}?token=${token ?? ''}${rot}`;
}
