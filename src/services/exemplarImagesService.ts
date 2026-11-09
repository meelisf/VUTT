/**
 * Eksemplari pildid (ADR 0079): manifest `images.json` serveri otspunktide kaudu.
 * Kirjutus kannab `revision`-it; 409 → `ManifestConflictError` praeguse manifestiga.
 */
import { ApiError, apiDelete, apiGet, apiPatch, apiPost } from './apiClient';

export type ExemplarImageSourceKind = 'ada' | 'url' | 'photo' | 'paber_ut' | 'other';

export interface ExemplarImageSource {
  kind: ExemplarImageSourceKind;
  ref?: string;
  bitstream?: string;
  page?: number;
  import_id?: string;
  license?: string;
  added_by?: string;
  at?: string;
}

export interface ExemplarImage {
  id: string;
  original?: string;
  label?: string;
  page?: string;
  source: ExemplarImageSource;
}

export interface ExemplarManifest {
  revision: number;
  images: ExemplarImage[];
  imports: Record<string, unknown>;
  /** Ainult kirjutuse vastuses: `false` = salvestatud, aga commit ebaõnnestus. */
  git_committed?: boolean;
}

export interface AdaImportStatus {
  state: 'fetching' | 'rendering' | 'publishing' | 'published' | 'aborted' | 'error';
  pages_total?: number | null;
  pages_done?: number | null;
  error?: string | null;
}

/** Üleslaadimise allikas (impordi liik `ada` tuleb ainult serveri impordist). */
export interface UploadSource {
  kind: 'url' | 'photo' | 'other';
  ref?: string;
  license?: string;
}

export class ManifestConflictError extends Error {
  current: ExemplarManifest;
  constructor(message: string, current: ExemplarManifest) {
    super(message);
    this.name = 'ManifestConflictError';
    this.current = current;
  }
}

const auth = (token: string | null) => (token ? { token } : {});
const base = (workId: string, eid: string) =>
  `/works/${encodeURIComponent(workId)}/exemplars/${encodeURIComponent(eid)}/images`;

/** 409 koos praeguse manifestiga → `ManifestConflictError`, muu läbib muutmata. */
async function withConflict<T>(p: Promise<T>): Promise<T> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const detail = (e.data as { detail?: { message?: string; current?: ExemplarManifest } } | null)?.detail;
      if (detail?.current) throw new ManifestConflictError(detail.message || e.message, detail.current);
    }
    throw e;
  }
}

export function fetchExemplarImages(workId: string, eid: string, token: string | null): Promise<ExemplarManifest> {
  return apiGet<ExemplarManifest>(base(workId, eid), auth(token));
}

export function patchExemplarImages(
  workId: string, eid: string, revision: number, images: ExemplarImage[], token: string | null,
): Promise<ExemplarManifest> {
  return withConflict(apiPatch<ExemplarManifest>(base(workId, eid), { revision, images }, auth(token)));
}

export function deleteExemplarImage(
  workId: string, eid: string, imageId: string, revision: number, token: string | null,
): Promise<ExemplarManifest> {
  return withConflict(apiDelete<ExemplarManifest>(
    `${base(workId, eid)}/${encodeURIComponent(imageId)}?revision=${revision}`, auth(token)));
}

export function uploadExemplarImages(
  workId: string, eid: string, files: File[], source: UploadSource, token: string | null,
): Promise<ExemplarManifest> {
  const form = new FormData();
  files.forEach(f => form.append('files', f));
  form.append('source', JSON.stringify(source));
  // Suured TIFF-id: üleslaadimine võib kesta kaua.
  return apiPost<ExemplarManifest>(base(workId, eid), form, { ...auth(token), timeout: 600_000 });
}

export function startAdaImport(
  workId: string, eid: string, handle: string, from: number | undefined, to: number | undefined,
  token: string | null,
): Promise<{ import_id: string }> {
  return apiPost<{ import_id: string }>(`${base(workId, eid)}/import-ada`, { handle, from, to }, auth(token));
}

export function fetchAdaImportStatus(
  workId: string, eid: string, importId: string, token: string | null,
): Promise<AdaImportStatus> {
  return apiGet<AdaImportStatus>(`${base(workId, eid)}/import-ada/${encodeURIComponent(importId)}`, auth(token));
}

export function originalUrl(workId: string, eid: string, imageId: string): string {
  return `${base(workId, eid)}/${encodeURIComponent(imageId)}/original`;
}

type T = (key: string, opts?: Record<string, unknown>) => string;

const isHttp = (s?: string) => !!s && /^https?:\/\//i.test(s);

/** Allikarida pildi all: tekst + valikuline link originaalile. */
export function sourceLabel(src: ExemplarImageSource, t: T): { text: string; href?: string } {
  const ref = src.ref || '';
  if (src.kind === 'ada') {
    const text = src.page
      ? t('exemplarImages.source.adaPage', { ref, page: src.page })
      : t('exemplarImages.source.ada', { ref });
    return ref ? { text, href: `https://hdl.handle.net/${ref}` } : { text };
  }
  const text = t(`exemplarImages.source.${src.kind}`, { ref });
  return isHttp(ref) ? { text, href: ref } : { text };
}
