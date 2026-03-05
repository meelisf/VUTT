/**
 * Entity labels cache teenus.
 * Laeb state/labels.json sisu serverist üks kord sessiooni jooksul (module-level cache).
 * { "Q1499591": { "et": "Juhuluule", "en": "occasional poetry", ... }, ... }
 */
import { FILE_API_URL } from '../config';

let cache: Record<string, Record<string, string>> | null = null;
let fetchPromise: Promise<Record<string, Record<string, string>>> | null = null;

export async function getEntityLabelsCache(): Promise<Record<string, Record<string, string>>> {
  if (cache) return cache;
  if (!fetchPromise) {
    fetchPromise = fetch(`${FILE_API_URL}/entity-labels`)
      .then(r => r.ok ? r.json() : {})
      .then((data: Record<string, Record<string, string>>) => {
        cache = data;
        return data;
      })
      .catch(() => ({}));
  }
  return fetchPromise;
}
