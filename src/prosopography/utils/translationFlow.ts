import type { FormDraft } from '../components/personForm/types';
import type { TranslationAnchor } from '../types';

export type BioField = 'biography_et' | 'biography_en';

/** Keeleväli → teise keele väli. Tõlke LÄHE on alati teine keel. */
export const OTHER_FIELD: Record<BioField, BioField> = {
  biography_et: 'biography_en',
  biography_en: 'biography_et',
};

/** Keeleväli → tema kinnitusruudu võti draftis. */
export const CONFIRM_KEY: Record<BioField, 'confirm_et' | 'confirm_en'> = {
  biography_et: 'confirm_et',
  biography_en: 'confirm_en',
};

export interface BioSnapshot { biography_et: string; biography_en: string }

/** Täidetud sihtväli → küsi kinnitust ENNE päringu saatmist. */
export function needsOverwriteConfirm(targetText: string): boolean {
  return targetText.trim().length > 0;
}

/**
 * Kas mõni väli muutus tõlke ajal?
 *
 * Hetktõmmis võetakse MÕLEMAST väljast, mitte ainult lähtest: toimetaja võis
 * ootamise ajal hakata sihtvälja ise kirjutama ja automaatne kirjutus sööks
 * selle ära (spekk, otsus 8).
 */
export function isStaleResult(snapshot: BioSnapshot, current: BioSnapshot): boolean {
  return snapshot.biography_et !== current.biography_et
      || snapshot.biography_en !== current.biography_en;
}

/**
 * Lähteteksti muutmine kustutab TEISE keele kinnituse märke.
 *
 * Sihtteksti toimetamine EI kustuta — toimetaja parandab tõlget, see on
 * kinnituse sisu, mitte selle rikkumine (spekk, otsus 5).
 */
export function confirmClearPatch(
  editedField: BioField,
  confirms: { confirm_et: boolean; confirm_en: boolean },
): Partial<FormDraft> {
  const key = CONFIRM_KEY[OTHER_FIELD[editedField]];
  return confirms[key] ? ({ [key]: false } as Partial<FormDraft>) : {};
}

/**
 * Kas ankur on vananenud?
 *
 * `null`/`undefined` ankur EI ole vananenud: see tähendab „seost ei ole
 * salvestatud", mitte „originaal on muutunud" (ADR 0039). Hoiatus tühja
 * ankru peale oleks vale hoiatus.
 */
export function isAnchorStale(
  anchor: TranslationAnchor | null | undefined,
  currentSourceHash: string,
): boolean {
  return !!anchor?.hash && anchor.hash !== currentSourceHash;
}

/** Pakkuja veatüüp → i18n võti (ADR 0033: sõnum tuleb lugeja keeles). */
export function translateErrorKey(kind: 'blocked' | 'rate_limited' | 'other'): string {
  if (kind === 'blocked') return 'form.translateBlocked';
  if (kind === 'rate_limited') return 'form.translateRateLimited';
  return 'form.translateError';
}
