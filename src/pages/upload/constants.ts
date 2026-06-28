import type { UploadType } from './types';

export const POLL_SLOW_MS = 5000;
export const POLL_FAST_MS = 2000;
export const OCR_TIMEOUT_MS_FALLBACK = 2 * 60 * 60 * 1000; // 2 tundi (kui lehekülgede arv teadmata)
export const OCR_MS_PER_PAGE = 60 * 1000; // ~60 sek/lk (konservatiivne, timeout'i jaoks)
export const OCR_PAGES_PER_MIN = 2.5; // Reaalne OCR kiirus lehekülgi minutis (ajahinnangu kuvamiseks)

export const TYPE_PRINT: UploadType = {
  id: 'Q1261026',
  label: 'trükis',
  source: 'wikidata',
  labels: { et: 'trükis', en: 'printed matter' },
};

export const TYPE_HAND: UploadType = {
  id: 'Q87167',
  label: 'käsikiri',
  source: 'wikidata',
  labels: { et: 'käsikiri', en: 'manuscript' },
};
