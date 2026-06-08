/**
 * =============================================================================
 * MEILISEARCH SERVICE - Core: client, index ja jagatud utiliidid
 * =============================================================================
 *
 * See fail sisaldab ainult:
 *   - Jagatud normaliseerijad (normalizeWork, normalizePage, normalizeContentSearchHit)
 *   - Jagatud utiliidid (calculateWorkStatus, checkMixedContent)
 *
 * NB: Meilisearch index ei ole enam siit eksportitud — see luuakse
 * MeilisearchContext-is (tokeni-põhine) ja antakse teenusefunktsioonidele
 * esimese argumendina (dependency injection).
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

import { Page, Work, PageStatus, WorkStatus, ContentSearchHit } from '../types';
import { MEILI_HOST } from '../config';
import { getFullImageUrl, getThumbUrl } from './workImageService';

// Check for Mixed Content (HTTPS vs HTTP)
export const checkMixedContent = () => {
  if (window.location.protocol === 'https:' && MEILI_HOST.startsWith('http:')) {
    throw new Error(
      `Turvaprobleem: Rakendus töötab HTTPS-is, aga andmebaas on HTTP-s (${MEILI_HOST}). Brauser blokeerib selle ühenduse (Mixed Content). Palun avage rakendus HTTP kaudu või seadistage andmebaas HTTPS-ile.`
    );
  }
};

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
    year_display: hit.year_display || null,
    location: hit.location_object ?? null,
    publisher: hit.publisher_object ?? null,
    publisher_id: hit.publisher_id,
    type: hit.type_object ?? null,
    genre: hit.genre_object ?? null,
    collections: hit.collections || [],
    collections_hierarchy: hit.collections_hierarchy,
    creators: hit.creators || [],
    authors_text: hit.authors_text || [],
    tags: hit.tags_object ?? [],
    languages: hit.languages || [],
    series: hit.series,
    series_title: hit.series_title,
    relations: hit.relations,
    ester_id: hit.ester_id,
    external_url: hit.external_url,
    archive_refs: hit.archive_refs || null,
    page_count: hit.page_count || hit.teose_lehekylgede_arv || 0,
    thumbnail_url: getThumbUrl(workId),
    work_status: hit.work_status || hit.teose_staatus,
    page_tags: hit.page_tags || [],
    shareable: hit.shareable ?? false,
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
    page_number: hit.lehekylje_number != null ? parseInt(hit.lehekylje_number) : 0,
    text_content: hit.text_content || hit.lehekylje_tekst || '',
    image_url: getFullImageUrl(hit.lehekylje_pilt || ''),
    status: (hit.status as PageStatus) || PageStatus.RAW,
    comments: hit.comments || [],
    text_annotations: hit.text_annotations || [],
    page_tags: hit.page_tags_object ||
      Array.from(new Set((hit.page_tags || hit.tags || []).map((t: any) =>
        typeof t === 'string' ? t.toLowerCase() : t
      ))),
    history: hit.history || [],
    // Denormaliseeritud teose andmed
    title: hit.title,
    year: hit.year ?? hit.aasta ?? null,
    year_display: hit.year_display || null,
    location: hit.location_object ?? null,
    publisher: hit.publisher_object ?? null,
    type: hit.type_object ?? null,
    genre: hit.genre_object ?? null,
    collections: hit.collections || [],
    collections_hierarchy: hit.collections_hierarchy || [],
    creators: hit.creators || [],
    authors_text: hit.authors_text || [],
    tags: hit.tags_object ?? [],
    languages: hit.languages || [],
    series: hit.series,
    series_title: hit.series_title,
    ester_id: hit.ester_id,
    external_url: hit.external_url,
    archive_refs: hit.archive_refs || null,
    // @deprecated väljad — töölaua tagasiühilduvus
    original_path: hit.originaal_kataloog,
    originaal_kataloog: hit.originaal_kataloog,
    autor: hit.autor,
    respondens: hit.respondens,
    aasta: hit.aasta ?? hit.year,
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
