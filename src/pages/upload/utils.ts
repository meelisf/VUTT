import { OCR_PAGES_PER_MIN } from './constants';

const SLUG_MAX_LEN = 80;

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
