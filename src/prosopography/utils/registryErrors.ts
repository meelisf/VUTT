import type { TFunction } from 'i18next';
import { ApiError } from '../../services/apiClient';
import { RegistryDuplicateError } from '../services/prosopographyService';

// Peavad kattuma serveriga: `server/prosopography/registries.py` (`_text` vaikepiir, `NOTES_MAX_LEN`).
export const REGISTRY_TEXT_MAX = 300;
export const REGISTRY_NOTES_MAX = 2000;

export const REGISTRY_ERROR_CODES = new Set([
  'invalid_notes', 'invalid_label', 'invalid_variant', 'invalid_variants', 'invalid_labels',
  'invalid_type', 'invalid_id', 'invalid_active_years', 'invalid_place_periods',
  'unknown_place_key', 'duplicate_id', 'registry_full', 'unknown_fields', 'invalid_key',
]);

/**
 * Registrikirje salvestuse vea kood (`invalid_notes` jne) inimloetavaks lauseks.
 * `t` peab nägema `prosopography` nimeruumi. Võrguviga jm mitte-koodiga sõnum jääb muutmata.
 */
export function registryErrorMessage(e: unknown, t: TFunction, notes?: string): string {
  const code = e instanceof RegistryDuplicateError ? 'duplicate_id'
    : e instanceof Error ? e.message : String(e);
  if (REGISTRY_ERROR_CODES.has(code)) {
    const max = code === 'invalid_notes' ? REGISTRY_NOTES_MAX : REGISTRY_TEXT_MAX;
    return t(`prosopography:registryErrors.${code}`, { max, length: notes?.length ?? 0 });
  }
  // Serveri tundmatu kood (snake_case) — näita koodi koos üldlausega, mitte paljalt.
  if (e instanceof ApiError && /^[a-z_]+$/.test(code)) {
    return t('prosopography:registryErrors.generic', { code });
  }
  return code;
}
