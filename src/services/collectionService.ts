/**
 * Kollektsioonide ja sõnavara teenus.
 * Suhtleb backend'iga staatiliste konfiguratsioonifailide (collections.json, vocabularies.json) lugemiseks.
 */

import { FILE_API_URL } from '../config';
import { apiGet } from './apiClient';

// =========================================================
// TÜÜBID
// =========================================================

export interface CollectionName {
  et: string;
  en: string;
}

export interface Collection {
  name: CollectionName;
  type?: 'virtual_group';  // Virtuaalne grupp, millel endal teoseid ei ole
  parent?: string;         // Ülemkollektsiooni ID
  order?: number;          // Sorteerimise järjekord
  children?: string[];     // Alamkollektsioonide ID-d (virtual_group'il)
  description?: CollectionName;
  description_long?: CollectionName;
  color?: string;          // Tailwind värvi nimi (nt 'amber', 'teal', 'violet')
  visibility?: 'public' | 'restricted';
}

// Tailwind värviklassid kollektsioonide jaoks
// NB: Klassid peavad olema täielikult välja kirjutatud, et Tailwind neid kompileeriks
// `dot` = küllaslik toon värvitäpile (päise kogu valija, kogu-riba, #587)
export type CollectionColorClasses = { bg: string; text: string; border: string; hoverBg: string; dot: string };
export const COLLECTION_COLOR_CLASSES: Record<string, CollectionColorClasses> = {
  red:     { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200',     hoverBg: 'hover:bg-red-100', dot: 'bg-red-500' },
  orange:  { bg: 'bg-orange-50',  text: 'text-orange-700',  border: 'border-orange-200',  hoverBg: 'hover:bg-orange-100', dot: 'bg-orange-500' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200',   hoverBg: 'hover:bg-amber-100', dot: 'bg-amber-500' },
  yellow:  { bg: 'bg-yellow-50',  text: 'text-yellow-700',  border: 'border-yellow-200',  hoverBg: 'hover:bg-yellow-100', dot: 'bg-yellow-500' },
  lime:    { bg: 'bg-lime-50',    text: 'text-lime-700',    border: 'border-lime-200',    hoverBg: 'hover:bg-lime-100', dot: 'bg-lime-500' },
  green:   { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200',   hoverBg: 'hover:bg-green-100', dot: 'bg-green-500' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', hoverBg: 'hover:bg-emerald-100', dot: 'bg-emerald-500' },
  teal:    { bg: 'bg-teal-50',    text: 'text-teal-700',    border: 'border-teal-200',    hoverBg: 'hover:bg-teal-100', dot: 'bg-teal-500' },
  cyan:    { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200',    hoverBg: 'hover:bg-cyan-100', dot: 'bg-cyan-500' },
  sky:     { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200',     hoverBg: 'hover:bg-sky-100', dot: 'bg-sky-500' },
  blue:    { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200',    hoverBg: 'hover:bg-blue-100', dot: 'bg-blue-500' },
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200',  hoverBg: 'hover:bg-indigo-100', dot: 'bg-indigo-500' },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200',  hoverBg: 'hover:bg-violet-100', dot: 'bg-violet-500' },
  purple:  { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200',  hoverBg: 'hover:bg-purple-100', dot: 'bg-purple-500' },
  fuchsia: { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', border: 'border-fuchsia-200', hoverBg: 'hover:bg-fuchsia-100', dot: 'bg-fuchsia-500' },
  pink:    { bg: 'bg-pink-50',    text: 'text-pink-700',    border: 'border-pink-200',    hoverBg: 'hover:bg-pink-100', dot: 'bg-pink-500' },
  rose:    { bg: 'bg-rose-50',    text: 'text-rose-700',    border: 'border-rose-200',    hoverBg: 'hover:bg-rose-100', dot: 'bg-rose-500' },
};

// Vaikimisi värv kui kollektsioonil pole määratud
const DEFAULT_COLOR = 'indigo';

/**
 * Tagastab kollektsiooni värviklassid.
 */
export function getCollectionColorClasses(collection: Collection | null): CollectionColorClasses {
  const colorName = collection?.color || DEFAULT_COLOR;
  return COLLECTION_COLOR_CLASSES[colorName] || COLLECTION_COLOR_CLASSES[DEFAULT_COLOR];
}

export interface Collections {
  [id: string]: Collection;
}

export interface VocabularyItem {
  et: string;
  en: string;
}

export interface VocabularySeisusItem {
  id: string;
  label: { et: string; en: string };
}

export interface Vocabularies {
  types: { [id: string]: VocabularyItem };
  genres: { [id: string]: VocabularyItem };
  roles: { [id: string]: VocabularyItem };
  languages: { [id: string]: VocabularyItem };
  relation_types: { [id: string]: VocabularyItem };
  seisused?: VocabularySeisusItem[];
  konfessioonid?: VocabularySeisusItem[];
}

// =========================================================
// VAHEMÄLU
// =========================================================

let collectionsCache: Collections | null = null;
let vocabulariesCache: Vocabularies | null = null;

// =========================================================
// API PÄRINGUD
// =========================================================

/**
 * Laeb kollektsioonide puu backend'ist.
 * Kasutab vahemälu, et vältida korduvaid päringuid.
 */
export async function getCollections(forceRefresh = false): Promise<Collections> {
  if (collectionsCache && !forceRefresh) {
    return collectionsCache;
  }

  try {
    const data = await apiGet<any>(`${FILE_API_URL}/collections`);
    if (data.status === 'success') {
      collectionsCache = data.collections;
      return data.collections;
    }
    throw new Error(data.message || 'Unknown error');
  } catch (error) {
    console.error('Kollektsioonide laadimine ebaõnnestus:', error);
    return {};
  }
}

/**
 * Laeb kontrollitud sõnavara backend'ist.
 * Kasutab vahemälu, et vältida korduvaid päringuid.
 */
export async function getVocabularies(forceRefresh = false): Promise<Vocabularies> {
  if (vocabulariesCache && !forceRefresh) {
    return vocabulariesCache;
  }

  try {
    const data = await apiGet<any>(`${FILE_API_URL}/vocabularies`);
    if (data.status === 'success') {
      vocabulariesCache = data.vocabularies;
      return data.vocabularies;
    }
    throw new Error(data.message || 'Unknown error');
  } catch (error) {
    console.error('Sõnavara laadimine ebaõnnestus:', error);
    // Tagasta tühi struktuur vea korral
    return {
      types: {},
      genres: {},
      roles: {},
      languages: {},
      relation_types: {}
    };
  }
}

// =========================================================
// ABIFUNKTSIOONID
// =========================================================

/**
 * Tagastab kollektsiooni nime keele järgi.
 */
export function getCollectionName(collection: Collection, lang: 'et' | 'en' = 'et'): string {
  return collection.name[lang] || collection.name.et;
}

/**
 * Tagastab kollektsiooni ID järgi.
 */
export function getCollectionById(collections: Collections, id: string): Collection | null {
  return collections[id] || null;
}

/**
 * Tagastab kollektsiooni hierarhia (vanematest lapseni).
 * Näiteks: ["universitas-dorpatensis-1", "academia-gustaviana"]
 */
export function getCollectionHierarchy(collections: Collections, id: string): string[] {
  const hierarchy: string[] = [];
  let currentId: string | undefined = id;

  while (currentId) {
    hierarchy.unshift(currentId);
    const collection: Collection | undefined = collections[currentId];
    currentId = collection?.parent;
  }

  return hierarchy;
}

/**
 * Kogu ja tema esivanemad (alates kogust endast). Tsüklikindel — sama mis
 * serveri `collection_tree.collection_chain`.
 */
function collectionChain(collections: Collections, id: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let currentId: string | undefined = id;
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    chain.push(currentId);
    currentId = collections[currentId]?.parent;
  }
  return chain;
}

/**
 * Kehtiv nähtavus (#617): privaatse kogu alamkogu on privaatne. Kogu enda
 * `visibility` on salvestatud määrang; tundmatu kogu ei ole piiratud.
 * Peegeldab serveri `server/collection_tree.py` reeglit.
 */
export function isCollectionRestricted(collections: Collections, id: string): boolean {
  return collectionChain(collections, id).some(
    cid => collections[cid]?.visibility === 'restricted'
  );
}

/**
 * Kas lugemisõigus (`allowed_collections`) katab kogu — otse või esivanema
 * kaudu, nagu tenant-tokeni `collections_hierarchy IN [allowed]`.
 */
export function isCollectionAllowed(
  collections: Collections, id: string, allowed: Iterable<string>,
): boolean {
  const allowedSet = new Set(allowed);
  return collectionChain(collections, id).some(cid => allowedSet.has(cid));
}

/**
 * Tagastab kõik tippkollektsioonid (ilma vanemata).
 * Sorteeritud order välja järgi.
 */
export function getRootCollections(collections: Collections): Array<{ id: string; collection: Collection }> {
  return Object.entries(collections)
    .filter(([_, col]) => !col.parent)
    .map(([id, collection]) => ({ id, collection }))
    .sort((a, b) => (a.collection.order || 999) - (b.collection.order || 999));
}

/**
 * Tagastab kollektsiooni alamad.
 * Sorteeritud order välja järgi.
 */
export function getChildCollections(collections: Collections, parentId: string): Array<{ id: string; collection: Collection }> {
  return Object.entries(collections)
    .filter(([_, col]) => col.parent === parentId)
    .map(([id, collection]) => ({ id, collection }))
    .sort((a, b) => (a.collection.order || 999) - (b.collection.order || 999));
}

/**
 * Ehitab kollektsioonide puu struktuuri UI jaoks.
 */
export interface CollectionTreeNode {
  id: string;
  collection: Collection;
  children: CollectionTreeNode[];
}

export function buildCollectionTree(collections: Collections): CollectionTreeNode[] {
  const buildNode = (id: string): CollectionTreeNode => {
    const collection = collections[id];
    const children = getChildCollections(collections, id)
      .map(({ id }) => buildNode(id));
    return { id, collection, children };
  };

  return getRootCollections(collections)
    .map(({ id }) => buildNode(id));
}

/**
 * Tagastab kollektsioonid, millele saab teose määrata (id + kuvanimi, sorditud nime järgi).
 * Kasutatakse kirjutamisulatuse valijates (contributor'i edit_collections) — virtual_group
 * on välja jäetud, sest teosele ei saagi seda kunagi määrata (vt MetadataModal), mistõttu
 * see ei saa olla ka mõistlik kirjutamisulatuse liige.
 */
export function getWritableCollectionOptions(
  collections: Collections,
  lang: 'et' | 'en' = 'et'
): Array<{ id: string; name: string }> {
  return Object.entries(collections)
    .filter(([, c]) => c.type !== 'virtual_group')
    .map(([id, c]) => ({ id, name: c.name?.[lang] || c.name?.et || id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

/**
 * Tühjenda vahemälu (nt pärast admin muudatusi).
 */
export function clearCache(): void {
  collectionsCache = null;
  vocabulariesCache = null;
}
