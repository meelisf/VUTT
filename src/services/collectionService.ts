/**
 * Kollektsioonide ja sõnavara teenus.
 * Suhtleb backend'iga staatiliste konfiguratsioonifailide (collections.json, vocabularies.json) lugemiseks.
 */

import { FILE_API_URL } from '../config';

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
}

export interface Collections {
  [id: string]: Collection;
}

export interface VocabularyItem {
  et: string;
  en: string;
}

export interface Vocabularies {
  types: { [id: string]: VocabularyItem };
  genres: { [id: string]: VocabularyItem };
  roles: { [id: string]: VocabularyItem };
  languages: { [id: string]: VocabularyItem };
  relation_types: { [id: string]: VocabularyItem };
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
    const response = await fetch(`${FILE_API_URL}/collections`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
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
    const response = await fetch(`${FILE_API_URL}/vocabularies`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
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
    const collection = collections[currentId];
    currentId = collection?.parent;
  }

  return hierarchy;
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
 * Tühjenda vahemälu (nt pärast admin muudatusi).
 */
export function clearCache(): void {
  collectionsCache = null;
  vocabulariesCache = null;
}
