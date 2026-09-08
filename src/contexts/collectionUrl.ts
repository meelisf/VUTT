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
  // Salvestatud väärtus, mida kogude hulgas ei ole, EI ole valik — ta on
  // jäänuk kustutatud kogust. Varem langes selline kasutaja „kõigi kogude"
  // peale (terve korpus), samal ajal kui uus kasutaja sai vaikekogu.
  if (collections[defaultCollection]) return defaultCollection;
  return null;
}

/** Mida teha `localStorage`-i kirjega pärast valiku lahendamist. */
export type StoredCollectionUpdate =
  | { action: 'keep' }
  | { action: 'write'; value: string }
  | { action: 'clear' };

/**
 * `localStorage` peab kehtivat valikut PEEGELDAMA.
 *
 * Kaks juhtu nõuavad kirjutamist:
 * 1. **Jäänuk** — salvestatud kogu ei ole enam olemas. Ilma parandamiseta
 *    kordub vale vaade igal laadimisel, sest lahendus elab ainult mälus.
 * 2. **Link** — URL kandis valikut; see jääb kehtima nagu käsitsi valimine,
 *    muidu hüppaks järgmine leht tagasi.
 *
 * Vaikekogu salvestamata kasutajal jääb kirjutamata: vaikeväärtus ei ole
 * valik ja kinnistamine jätaks ta vaikekogu muutumisel vanasse kinni.
 */
export function decideStoredCollection(
  urlValue: string | null,
  stored: string | null,
  collections: Collections,
  resolved: string | null,
): StoredCollectionUpdate {
  const isStale = stored !== null && !collections[stored];
  if (!isStale && urlValue === null) return { action: 'keep' };
  if (resolved === stored) return { action: 'keep' };
  return resolved ? { action: 'write', value: resolved } : { action: 'clear' };
}
