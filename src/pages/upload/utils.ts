import { OCR_PAGES_PER_MIN, OCR_MS_PER_PAGE, OCR_TIMEOUT_MS_FALLBACK } from './constants';
import type { FileEntry, PollResult } from './types';

const SLUG_MAX_LEN = 80;

const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff'];

/** Arvutab OCR ajahinnangu lehekülgede arvu põhjal. */
/** OCR-i ajahinnang lehekülgede arvust, või null kui arv on veel teadmata.
 *  Teadmata korral EI pakuta numbrit — vale hinnang on halvem kui hinnangu
 *  puudumine (kutsuja kuvab siis numbrita sõnastuse). */
export function ocrEstimate(pages: number | null | undefined): string | null {
  if (!pages) return null;
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

/** Jäänud aeg sekundites mõõdetud keskmise kiiruse põhjal, või null kui mõõta
 *  pole veel millegi pealt. Keskmine (mitte hetkkiirus) on tunni pikkusel
 *  üleslaadimisel stabiilsem — hetkkiirus hüppab ja number vilguks. */
export function estimateRemainingSeconds(
  bytesSent: number,
  bytesTotal: number,
  elapsedMs: number,
): number | null {
  if (bytesSent >= bytesTotal) return 0;
  if (bytesSent <= 0 || elapsedMs < 3000) return null;
  const bytesPerSecond = bytesSent / (elapsedMs / 1000);
  if (bytesPerSecond <= 0) return null;
  return (bytesTotal - bytesSent) / bytesPerSecond;
}

/** Inimloetav kestus. Ühikud on eesti ja inglise keeles samad ("min", "h"),
 *  seega tõlkevõtit siia ei ole vaja — lause ümber tuleb i18n-ist. */
export function formatEta(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 1) return '< 1 min';
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
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
  sendProgress: { bytes_sent: number; bytes_total: number } | null = null,
): ReviewDerived {
  const files = pollResult?.files ?? [];
  const filesWithLocalDeleted = files.map((f) => ({
    ...f,
    deleted: f.deleted || localDeleted.has(f.page),
  }));
  const readyCount = filesWithLocalDeleted.filter((f) => f.has_ocr && !f.deleted).length;
  // Kaks järjestikust faasi: brauser → VUTT (sendProgress, kliendi mõõdetud) ja
  // VUTT → OCR-server (pollResult.progress, backendi raporteeritud). Kui esimene
  // veel käib, näitame seda — polling ei tea sel hetkel failist veel midagi.
  const progress = sendProgress ?? pollResult?.progress;
  const progressPct =
    progress && progress.bytes_total > 0
      ? Math.round((progress.bytes_sent / progress.bytes_total) * 100)
      : 0;
  // Saatmise ajal vastab polling "pending" — backend ei tea failist veel midagi,
  // sest nginx puhverdab keha ja annab päringu edasi alles pärast viimast baiti.
  // Kuvame kasutajale seda, mis TEMA jaoks toimub, mitte serveri teadmatust.
  const status = sendProgress ? 'uploading' : pollResult?.status ?? '';
  const ocrTimeoutMs = pollResult?.expected_pages
    ? Math.max(5 * 60 * 1000, pollResult.expected_pages * OCR_MS_PER_PAGE)
    : OCR_TIMEOUT_MS_FALLBACK;
  const ocrTimedOut =
    ocrStartedAt !== null && now - ocrStartedAt > ocrTimeoutMs && status !== 'done';
  const canImport = (status === 'done' || ocrTimedOut) && readyCount > 0 && !importLoading;

  return { filesWithLocalDeleted, readyCount, progress, progressPct, status, ocrTimeoutMs, ocrTimedOut, canImport };
}
