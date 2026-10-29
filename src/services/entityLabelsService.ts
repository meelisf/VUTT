/**
 * Entity labels cache teenus.
 * Laeb state/labels.json sisu serverist üks kord sessiooni jooksul (module-level cache).
 * { "Q1499591": { "et": "Juhuluule", "en": "occasional poetry", ... }, ... }
 */
import { FILE_API_URL } from '../config';
import { apiGet } from './apiClient';

let cache: Record<string, Record<string, string>> | null = null;
let fetchPromise: Promise<Record<string, Record<string, string>>> | null = null;

export async function getEntityLabelsCache(): Promise<Record<string, Record<string, string>>> {
  if (cache) return cache;
  if (!fetchPromise) {
    fetchPromise = apiGet<Record<string, Record<string, string>>>(`${FILE_API_URL}/entity-labels`)
      .then(data => {
        cache = data ?? {};
        return cache;
      })
      .catch(() => ({}));
  }
  return fetchPromise;
}
