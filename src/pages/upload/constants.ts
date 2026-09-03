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

/** Staatused, mille korral fail on VUTT-i poolel ja poolitamise samm on avatud.
 *
 * `applying` EI KUULU siia: apply on ühekordne (kordus annab 409), plaani ei
 * saa enam muuta ja kasutaja kuulub juba ülevaatuse sammu, kus ta näeb
 * edenemist. Siia jäetuna viskaks polling ta poolitamise vaatesse tagasi. */
export const PREPRESS_STATUSES = ['awaiting_split', 'prepping'];

/** ADA allalaadimine käib → viisardi 2. samm (progressiriba failivalija
 * asemel). EI TOHI kuuluda `PREPRESS_STATUSES`-esse — muidu viskaks polling
 * admini poolitamise vaatesse keset ~320 MB allalaadimist (sama viga nagu
 * `applying`, ADR 0028). */
export const ADA_TRANSFER_STATUSES = ['ada_fetching', 'ada_error'];

/** Staatus → viisardi samm ADA-voos. */
export function adaSammuOlek(status: string): number {
  if (ADA_TRANSFER_STATUSES.includes(status)) return 2;
  if (PREPRESS_STATUSES.includes(status)) return 3;
  return 4;
}
