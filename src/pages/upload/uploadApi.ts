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
  file: Blob,
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

// ---------------------------------------------------------------------------
// Jätkatav üleslaadimine (#235, ADR 0047)
// ---------------------------------------------------------------------------

/** Tüki suurus. 4 MiB mõõdetud 27–47 kB/s liinil ≈ 1,5–2,5 min tüki kohta:
 *  katkemine maksab ühe tüki, mitte tunni. Serveri lagi on 16 MiB. */
export const CHUNK_SIZE = 4 * 1024 * 1024;
/** Järjestikuseid ebaõnnestunud katseid enne loobumist (ühe tüki kohta). */
export const CHUNK_MAX_RETRIES = 6;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000, 30_000, 30_000];
const FINGERPRINT_SAMPLE = 1024 * 1024;

export interface ChunkStatus {
  received: number;
  total: number | null;
  fingerprint: string | null;
  name: string | null;
  status: string;
}

export interface ChunkResult {
  received: number;
  total: number;
  complete: boolean;
  expected_pages?: number;
}

/** Faili sõrmejälg jätkamiseks: suurus + SHA-256 esimesest ja viimasest MiB-st.
 *  Brauser ei säilita File-objekti üle lehe värskendamise — kasutaja valib faili
 *  uuesti, ja sõrmejälg ütleb, kas see on sama fail. Tervet 160 MB faili ei
 *  räsita: see nõuaks kogu faili mällu lugemist. */
export async function fileFingerprint(file: Blob & { name?: string; lastModified?: number }): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    // Ebaturvaline kontekst (http, mitte localhost) — nõrgem, aga deterministlik.
    return `v0:${file.size}:${file.lastModified ?? 0}:${encodeURIComponent(file.name ?? '')}`.slice(0, 128);
  }
  const algus = await file.slice(0, FINGERPRINT_SAMPLE).arrayBuffer();
  const lopp = await file.slice(Math.max(0, file.size - FINGERPRINT_SAMPLE)).arrayBuffer();
  const suurus = new TextEncoder().encode(`${file.size}:`);
  const koos = new Uint8Array(suurus.length + algus.byteLength + lopp.byteLength);
  koos.set(suurus, 0);
  koos.set(new Uint8Array(algus), suurus.length);
  koos.set(new Uint8Array(lopp), suurus.length + algus.byteLength);
  const digest = await subtle.digest('SHA-256', koos);
  return 'v1:' + Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function getChunkStatus(uploadId: string, token: string | null): Promise<ChunkStatus> {
  return apiGet<ChunkStatus>(`/admin/upload/${uploadId}/chunk`, { token });
}

interface SendChunkArgs {
  uploadId: string;
  blob: Blob;
  offset: number;
  total: number;
  fingerprint: string;
  name: string;
  token: string | null;
  onProgress?: (loaded: number) => void;
}

/** Üks tükk. 409 EI OLE viga: server ütleb oma tegeliku seisu. */
async function sendChunk(a: SendChunkArgs): Promise<
  { kind: 'ok'; result: ChunkResult } | { kind: 'conflict'; reason: string; received: number }
> {
  const response = await sendFileWithProgress(
    `${FILE_API_URL}/admin/upload/${a.uploadId}/chunk`,
    a.blob,
    {
      'X-Upload-Offset': String(a.offset),
      'X-Upload-Total': String(a.total),
      'X-Upload-Fingerprint': a.fingerprint,
      'X-Filename': encodeURIComponent(a.name),
      ...getAuthHeaders(a.token),
    },
    { onProgress: ({ loaded }) => a.onProgress?.(loaded) },
  );
  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));
    return { kind: 'conflict', reason: String(body.reason ?? ''), received: Number(body.received ?? 0) };
  }
  return { kind: 'ok', result: await parseUploadResponse<ChunkResult>(response) };
}

/** Kliendipoolsed vead, mida kordamine ei paranda. */
function isFatal(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500;
}

export interface ChunkedUploadDeps {
  fingerprint?: typeof fileFingerprint;
  getStatus?: typeof getChunkStatus;
  send?: typeof sendChunk;
  sleep?: (ms: number) => Promise<void>;
}

export interface ChunkedUploadOptions {
  onProgress?: (p: { loaded: number; total: number }) => void;
  /** Kutsutakse, kui jätkatakse serveris juba olevast baidist (> 0). */
  onResume?: (received: number) => void;
}

/** Laeb faili tükkidena. Jätkab serveri teadaolevast baidist, kui sama fail
 *  (sõrmejälg + suurus) on seal pooleli; võrgu- ja serveriviga tüki peal →
 *  ootus + serverilt tegeliku seisu küsimine + jätk (kuni `CHUNK_MAX_RETRIES`).
 *
 *  Tagastab `null`, kui server ütles, et fail on juba vastu võetud (nt kadunud
 *  viimase vastuse järel) — edasist edenemist näitab polling. */
export async function uploadFileChunked(
  uploadId: string,
  file: File,
  token: string | null,
  options: ChunkedUploadOptions = {},
  deps: ChunkedUploadDeps = {},
): Promise<ChunkResult | null> {
  const fingerprint = await (deps.fingerprint ?? fileFingerprint)(file);
  const getStatus = deps.getStatus ?? getChunkStatus;
  const send = deps.send ?? sendChunk;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const total = file.size;

  /** Serveri seis sama faili kohta; teine fail või puuduv poolik → 0. */
  const serverOffset = async (): Promise<number> => {
    const st = await getStatus(uploadId, token);
    return st.fingerprint === fingerprint && st.total === total ? st.received : 0;
  };

  let offset = await serverOffset();
  if (offset > 0) options.onResume?.(offset);
  let failures = 0;
  let conflicts = 0;

  for (;;) {
    const end = Math.min(offset + CHUNK_SIZE, total);
    try {
      const res = await send({
        uploadId, blob: file.slice(offset, end), offset, total, fingerprint,
        name: file.name, token,
        onProgress: (loaded) => options.onProgress?.({ loaded: offset + loaded, total }),
      });
      if (res.kind === 'conflict') {
        // Fail on juba vastu võetud / töötlemisel — polling näitab edasist.
        if (res.reason === 'status') return null;
        // Nihke parandus peab järgmisel katsel klappima; korduv konflikt
        // tähendab, et keegi teine kirjutab samasse upload'i.
        conflicts += 1;
        if (conflicts > 3) throw new ApiError('Üleslaadimine on teises aknas pooleli', 409);
        // Nihe ei klapi (nt kadunud vastus): jätka serveri tegelikust seisust.
        // Teine fail serveris → alustame otsast (nihe 0 kirjutab ta üle).
        offset = res.reason === 'mismatch' ? 0 : res.received;
        continue;
      }
      failures = 0;
      conflicts = 0;
      offset = res.result.received;
      options.onProgress?.({ loaded: offset, total });
      if (res.result.complete) return res.result;
    } catch (e) {
      if (isFatal(e) || failures >= CHUNK_MAX_RETRIES) throw e;
      await sleep(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]);
      failures += 1;
      // Tükk võis kohale jõuda ka siis, kui vastus kadus.
      try { offset = await serverOffset(); } catch { /* järgmine katse küsib uuesti */ }
    }
  }
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
