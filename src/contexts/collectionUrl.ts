import { Collections } from '../services/collectionService';

/**
 * Aktiivne kogu URL-is (#323).
 *
 * Kogu elas ainult `localStorage`-is, seega jagatud link kandis küll filtreid,
 * aga rakendus need SAAJA kogus: „Klingeriana käsikirjad" avanes Tartu ülikooli
 * kogus ja andis null vastet. Kogu on filter nagu iga teine ja kuulub URL-i.
 */
export const COLLECTION_PARAM = 'collection';

/** Sõnaselge „kõik kogud" — eristub puuduvast parameetrist (= ei ütle midagi). */
export const ALL_COLLECTIONS = 'all';

/**
 * Algne kogu: URL > localStorage > vaikekogu.
 *
 * URL võidab, sest ta on saatja tahe ja saaja oma valik on tal juba olemas.
 * Tundmatu id URL-is jäetakse vahele (kogu võib olla kustutatud või
 * ligipääsmatu) — siis kehtib saaja senine valik, mitte tühi vaade.
 */
export function resolveInitialCollection(
  urlValue: string | null,
  stored: string | null,
  collections: Collections,
  defaultCollection: string,
): string | null {
  if (urlValue === ALL_COLLECTIONS) return null;
  if (urlValue && collections[urlValue]) return urlValue;
  if (stored && collections[stored]) return stored;
  if (!stored && collections[defaultCollection]) return defaultCollection;
  return null;
}
