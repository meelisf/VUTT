import { Collections } from '../services/collectionService';
import { CollectionSelection } from '../services/selectionFilter';

export type { CollectionSelection };

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

// =========================================================
// VALIKU TOKEN (#354)
// =========================================================

/** Töökollektsiooni parameeter. Eraldi `?collection=`-ist, sest liikmesus ei ole hierarhia. */
export const WORK_SET_PARAM = 'set';

/**
 * Valik ühe tokenina, mille otsustaja (`decideCollectionSync`) saab võrrelda.
 *
 * Token PEAB olema täpselt see, mis URL-is seisab: `agreed` võrdleb loetud ja
 * kirjutatud tokenit. Kui serialiseerimine annaks `c:klingeriana`, aga lugemine
 * `klingeriana`, ei jõuaks sünkroniseerimine kunagi kokkuleppele ja tekiks
 * lõputu URL-i vahetus (#333 uues kohas). Seepärast on püsikogu token PALJAS id.
 */
export function serializeSelection(s: CollectionSelection): string {
  if (s.kind === 'all') return ALL_COLLECTIONS;
  return s.kind === 'collection' ? s.id : `${WORK_SET_PREFIX}${s.id}`;
}

export const WORK_SET_PREFIX = 's:';
const COLLECTION_PREFIX = 'c:';

/** Parsib tokeni. `c:` on lugemisel lubatud (käsitsi kirjutatud link), aga ei teki. */
export function parseSelection(token: string | null): CollectionSelection {
  if (!token || token === ALL_COLLECTIONS) return { kind: 'all' };
  if (token.startsWith(WORK_SET_PREFIX)) {
    return { kind: 'work_set', id: token.slice(WORK_SET_PREFIX.length) };
  }
  if (token.startsWith(COLLECTION_PREFIX)) {
    return { kind: 'collection', id: token.slice(COLLECTION_PREFIX.length) };
  }
  return { kind: 'collection', id: token };
}

/** Loeb tokeni URL-ist. Mõlema parameetri korral võidab `set` — kitsam valik. */
export function readSelectionToken(params: URLSearchParams): string | null {
  const set = params.get(WORK_SET_PARAM);
  if (set) return `${WORK_SET_PREFIX}${set}`;
  return params.get(COLLECTION_PARAM);
}

/** Kirjutab tokeni õigesse parameetrisse ja eemaldab teise. */
export function writeSelectionToken(params: URLSearchParams, token: string): void {
  if (token.startsWith(WORK_SET_PREFIX)) {
    params.set(WORK_SET_PARAM, token.slice(WORK_SET_PREFIX.length));
    params.delete(COLLECTION_PARAM);
  } else {
    params.set(COLLECTION_PARAM, token);
    params.delete(WORK_SET_PARAM);
  }
}
