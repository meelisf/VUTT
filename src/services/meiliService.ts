/**
 * =============================================================================
 * MEILISEARCH SERVICE - Core: client, index ja jagatud utiliidid
 * =============================================================================
 *
 * See fail sisaldab ainult:
 *   - Meilisearch client init (index eksportitud teiste teenuste jaoks)
 *   - Jagatud normaliseerijad (normalizeWork, normalizePage, normalizeContentSearchHit)
 *   - Jagatud utiliidid (isQCode, calculateWorkStatus, checkMixedContent)
 *
 * Teosed ja leheküljed:
 *   searchService.ts  — otsing, facetid, sirvimispäringud
 *   pageService.ts    — lehekülje lugemine ja salvestamine
 *   workService.ts    — teose metaandmed ja staatused
 *   workImageService.ts — piltide URL-abifunktsioonid
 *
 * INGLISKEELSED väljad (kasuta neid):
 *   title, year, location, publisher, creators[], work_id
 *
 * EESTIKEELSED väljad (ainult filtrite/sortimise jaoks):
 *   aasta, lehekylje_number, originaal_kataloog, autor, respondens
 *
 * EEMALDATUD väljad (ära kasuta):
 *   pealkiri, koht, trükkal
 *
 * Vt docs/DATA_ARCHITECTURE.md täieliku ülevaate jaoks.
 * =============================================================================
 */

import { MeiliSearch } from 'meilisearch';
import { Page, Work, PageStatus, WorkStatus, ContentSearchHit } from '../types';
import { MEILI_HOST, MEILI_API_KEY, MEILI_INDEX } from '../config';
import { getFullImageUrl, getThumbUrl } from './workImageService';

// Initialize Meilisearch client
const client = new MeiliSearch({
  host: MEILI_HOST,
  apiKey: MEILI_API_KEY,
});

export const index = client.index(MEILI_INDEX);

// Check for Mixed Content (HTTPS vs HTTP)
export const checkMixedContent = () => {
  if (window.location.protocol === 'https:' && MEILI_HOST.startsWith('http:')) {
    throw new Error(
      `Turvaprobleem: Rakendus töötab HTTPS-is, aga andmebaas on HTTP-s (${MEILI_HOST}). Brauser blokeerib selle ühenduse (Mixed Content). Palun avage rakendus HTTP kaudu või seadistage andmebaas HTTPS-ile.`
    );
  }
};

// Wikidata Q-koodi tuvastamine (nt "Q12345")
export const isQCode = (val: string) => /^Q\d+$/.test(val);

// Arvutab teose koondstaatuse lehekülgede staatuste põhjal
// Loogika: Kõik Valmis → Valmis, Kõik Toores → Toores, muidu → Töös
export const calculateWorkStatus = (statuses: string[]): WorkStatus => {
  if (statuses.length === 0) return 'Toores';

  const allDone = statuses.every(s => s === PageStatus.DONE);
  if (allDone) return 'Valmis';

  const allRaw = statuses.every(s => s === PageStatus.RAW || !s);
  if (allRaw) return 'Toores';

  return 'Töös';
};

/**
 * Normaliseerib Meilisearchist tulnud teose (Work) andmed.
 * Tagab, et kasutatakse ainult V2 välju ja puuduvad andmed on asendatud vaikeväärtustega.
 */
export const normalizeWork = (hit: any): Work => {
  // Garanterime work_id olemasolu: kui puudub, tuletame primaarvõtmest (id)
  // id on tavaliselt kujul "nanoid-lk" (nt "ms2ufe-1")
  let workId = hit.work_id;
  if (!workId && hit.id) {
    const lastDashIndex = hit.id.lastIndexOf('-');
    workId = lastDashIndex !== -1 ? hit.id.substring(0, lastDashIndex) : hit.id;
  }

  return {
    id: hit.id,
    work_id: workId,
    title: hit.title || 'Pealkiri puudub',
    year: hit.year ?? 0,
    location: hit.location || '',
    location_object: hit.location_object,
    // Toeta nii vana (publisher = LinkedEntity objekt) kui uut (publisher = string) Meili formaati
    publisher: typeof hit.publisher === 'string' ? hit.publisher : (hit.publisher?.label || ''),
    publisher_object: typeof hit.publisher === 'object' && hit.publisher !== null ? hit.publisher : hit.publisher_object,
    type: hit.type,
    type_object: hit.type_object,
    genre: hit.genre,
    genre_object: hit.genre_object,
    collection: hit.collection,
    collections_hierarchy: hit.collections_hierarchy,
    creators: hit.creators || [],
    authors_text: hit.authors_text || [],
    tags: hit.tags || [],
    tags_object: hit.tags_object,
    languages: hit.languages || [],
    series: hit.series,
    series_title: hit.series_title,
    relations: hit.relations,
    ester_id: hit.ester_id,
    external_url: hit.external_url,
    page_count: hit.page_count || hit.teose_lehekylgede_arv || 0,
    thumbnail_url: getThumbUrl(workId),
    work_status: hit.work_status || hit.teose_staatus,
    page_tags: hit.page_tags || []
  };
};

/**
 * Normaliseerib Meilisearchist tulnud lehekülje (Page) andmed.
 */
export const normalizePage = (hit: any): Page => {
  let workId = hit.work_id;
  if (!workId && hit.id) {
    const lastDashIndex = hit.id.lastIndexOf('-');
    workId = lastDashIndex !== -1 ? hit.id.substring(0, lastDashIndex) : hit.id;
  }

  return {
    id: hit.id,
    work_id: workId,
    page_number: hit.lehekylje_number || 0,
    text_content: hit.lehekylje_tekst || hit.text_content || '',
    image_url: getFullImageUrl(hit.lehekylje_pilt || ''),
    status: (hit.status as PageStatus) || PageStatus.RAW,
    comments: hit.comments || [],
    page_tags: hit.page_tags || hit.tags || [],
    history: hit.history || [],
    // Denormaliseeritud teose andmed
    title: hit.title,
    year: hit.year,
    location: hit.location,
    location_object: hit.location_object,
    publisher: hit.publisher,
    publisher_object: hit.publisher_object,
    type: hit.type,
    type_object: hit.type_object,
    genre: hit.genre,
    genre_object: hit.genre_object,
    collection: hit.collection,
    collections_hierarchy: hit.collections_hierarchy,
    creators: hit.creators,
    languages: hit.languages,
    ester_id: hit.ester_id,
    external_url: hit.external_url
  };
};

/**
 * Normaliseerib sisulise otsingu tulemused.
 */
export const normalizeContentSearchHit = (hit: any): ContentSearchHit => {
  let workId = hit.work_id;
  if (!workId && hit.id) {
    const lastDashIndex = hit.id.lastIndexOf('-');
    workId = lastDashIndex !== -1 ? hit.id.substring(0, lastDashIndex) : hit.id;
  }

  return {
    ...hit,
    work_id: workId,
    title: hit.title,
    year: hit.year,
    location: hit.location,
    publisher: hit.publisher,
    lehekylje_number: hit.lehekylje_number,
    lehekylje_tekst: hit.lehekylje_tekst || hit.text_content || ''
  };
};
