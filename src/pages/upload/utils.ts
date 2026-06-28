import { OCR_PAGES_PER_MIN, OCR_MS_PER_PAGE, OCR_TIMEOUT_MS_FALLBACK } from './constants';
import type { FileEntry, PollResult } from './types';

const SLUG_MAX_LEN = 80;

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];

/** Arvutab OCR ajahinnangu lehekülgede arvu põhjal. */
export function ocrEstimate(pages: number | null | undefined): string {
  if (!pages) return '~10 min';
  const mins = Math.ceil(pages / OCR_PAGES_PER_MIN);
  return `~${mins} min`;
}

/** Slug utiliit (peegeldab serveri sanitize_slug). */
export function sanitizeSlug(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, SLUG_MAX_LEN)
      .replace(/-+$/g, '') || 'teos'
  );
}

/** Kas failinimi on toetatud pildiformaat (mitme faili \u00fcleslaadimisel). */
export function isImageFile(name: string): boolean {
  const n = name.toLowerCase();
  return IMAGE_EXTS.some((ext) => n.endsWith(ext));
}

/**
 * Valmistab mitme pildi \u00fcleslaadimise nimekirja ette: tagastab pildid nime
 * j\u00e4rgi sorteerituna, v\u00f5i `null` kui kasv\u00f5i \u00fcks fail pole pilt (nt PDF segus).
 */
export function prepareMultiImages(files: File[]): File[] | null {
  const images = files.filter((f) => isImageFile(f.name));
  if (images.length !== files.length) return null;
  return [...images].sort((a, b) => a.name.localeCompare(b.name));
}

export interface ReviewDerived {
  filesWithLocalDeleted: FileEntry[];
  readyCount: number;
  progress: PollResult['progress'];
  progressPct: number;
  status: string;
  ocrTimeoutMs: number;
  ocrTimedOut: boolean;
  canImport: boolean;
}

/**
 * Tuletab samm 3 (\u00fclevaatus) kuvaolekud poll-tulemusest. Puhas funktsioon \u2014
 * `now` on parameetritud testitavuse jaoks. \u00dchendab serveri `deleted` lipu
 * lokaalselt kustutatutega ja arvutab OCR timeout'i + impordi lubatavuse.
 */
export function computeReviewDerived(
  pollResult: PollResult | null,
  localDeleted: Set<number>,
  ocrStartedAt: number | null,
  importLoading: boolean,
  now: number = Date.now(),
): ReviewDerived {
  const files = pollResult?.files ?? [];
  const filesWithLocalDeleted = files.map((f) => ({
    ...f,
    deleted: f.deleted || localDeleted.has(f.page),
  }));
  const readyCount = filesWithLocalDeleted.filter((f) => f.has_ocr && !f.deleted).length;
  const progress = pollResult?.progress;
  const progressPct =
    progress && progress.bytes_total > 0
      ? Math.round((progress.bytes_sent / progress.bytes_total) * 100)
      : 0;
  const status = pollResult?.status ?? '';
  const ocrTimeoutMs = pollResult?.expected_pages
    ? Math.max(5 * 60 * 1000, pollResult.expected_pages * OCR_MS_PER_PAGE)
    : OCR_TIMEOUT_MS_FALLBACK;
  const ocrTimedOut =
    ocrStartedAt !== null && now - ocrStartedAt > ocrTimeoutMs && status !== 'done';
  const canImport = (status === 'done' || ocrTimedOut) && readyCount > 0 && !importLoading;

  return { filesWithLocalDeleted, readyCount, progress, progressPct, status, ocrTimeoutMs, ocrTimedOut, canImport };
}
