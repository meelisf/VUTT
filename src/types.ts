/**
 * =============================================================================
 * TÜÜBID - Work, Page, Creator jne
 * =============================================================================
 *
 * ANDMEKIHTIDE MÄRKUS:
 *
 * KASUTA (ingliskeelsed):
 *   work.title, work.year, work.location, work.publisher, work.creators[]
 *
 * EEMALDATUD (Meilisearchist):
 *   pealkiri, koht, trükkal - neid välju enam ei kirjutata ega pärita
 *
 * SÄILITATUD (filtrite/sortimise jaoks):
 *   aasta, autor, respondens, originaal_kataloog, lehekylje_number
 *
 * Vt docs/DATA_ARCHITECTURE.md täieliku ülevaate jaoks.
 * =============================================================================
 */

import { LinkedEntity } from './types/LinkedEntity';

export enum PageStatus {
  RAW = 'Toores',
  IN_PROGRESS = 'Töös',
  CORRECTED = 'Parandatud',
  ANNOTATED = 'Annoteeritud',
  DONE = 'Valmis'
}

// Teose koondstaatus dashboardi jaoks
export type WorkStatus = 'Toores' | 'Töös' | 'Valmis';

// =========================================================
// V2 TÜÜBID - Kollektsioonide süsteem
// =========================================================

// Isiku roll teoses
export type CreatorRole = 'praeses' | 'respondens' | 'auctor' | 'gratulator' | 'dedicator' | 'editor' | 'aui';

// Isik teoses
export interface Creator {
  name: string;
  role: CreatorRole;
  id?: string | null;       // Wikidata ID, VIAF ID, GND ID, Album Academicum ID vms
  source?: 'wikidata' | 'viaf' | 'gnd' | 'album_academicum' | 'manual'; // Linkimise allikas
  identifiers?: {
    gnd?: string;   // GND ID (Saksa rahvusbibliograafia)
    viaf?: string;  // VIAF ID
  };
}

// Seeria info
export interface Series {
  title: string;
  number?: string;
}

// Arhiiviviide
export interface ArchiveRef {
  archive_id: string;
  reference: string;
  url?: string;
}

// Seos teiste teostega
export interface Relation {
  id: string;
  rel_type: 'isPartOf' | 'hasPart' | 'isVersionOf' | 'isReferencedBy' | 'references';
  label?: string;
}

// =========================================================
// WORK - Teose andmed (Dashboard, WorkCard)
// =========================================================

/**
 * Work - Teose andmed (Dashboard, WorkCard)
 *
 * ⚠️  OLULINE: Kasuta AINULT v2 välju uues koodis!
 *
 * V2 väljad (KASUTA NEID):
 *   - title, year, location, publisher
 *   - creators[] (isikud koos rollidega)
 *   - type, genre, collection, tags, languages
 *
 * V1 väljad (ÄRA KASUTA, ainult tagasiühilduvuseks):
 *   - pealkiri, aasta, koht, trükkal
 *   - author, respondens (kasuta creators[] asemel)
 *
 * Meilisearch kasutab sisemiselt eestikeelseid välju (koht, trükkal),
 * aga meiliService.ts kaardistab need v2 väljadele (location, publisher).
 */
export interface Work {
  // =========================================================
  // V2/V3 VÄLJAD - KASUTA NEID UUES KOODIS
  // =========================================================

  // Identifikaatorid
  id: string;               // Lehekülje ID (Meilisearch primary key, nt "cymbv7-1")
  work_id: string;          // Nanoid (püsiv lühikood, nt "cymbv7")

  // Teose põhiandmed
  title: string;            // Pealkiri
  year: number | null;      // Ilmumisaasta (number filtri/sortimise jaoks)
  year_display?: string | null; // Kuvatav aasta (nt "ca. 1680", "1670–1690")
  location?: LinkedEntity | null; // Trükikoht (LinkedEntity objekt)
  publisher?: LinkedEntity | null; // Trükkal (LinkedEntity objekt)
  publisher_id?: string;    // Trükkal (Wikidata Q-kood)

  // Taksonoomia
  type?: LinkedEntity | null;  // Teose tüüp (LinkedEntity)
  genre?: LinkedEntity | LinkedEntity[] | null; // Žanr(id)
  collections?: string[];
  collections_hierarchy?: string[];

  // Isikud - KASUTA SEDA, mitte author/respondens!
  creators?: Creator[];     // Kõik isikud koos rollidega
  authors_text?: string[];  // Denormaliseeritud otsinguks

  // Märksõnad ja keeled
  tags?: LinkedEntity[];    // Märksõnad (LinkedEntity objektid)
  languages?: string[];     // Keeled (ISO 639-3: lat, deu, est, ...)

  // Seosed
  series?: Series;
  series_title?: string;
  relations?: Relation[];

  // Välised lingid ja arhiiviviited
  ester_id?: string;
  external_url?: string;
  archive_refs?: ArchiveRef[] | null;

  // Jagamine
  shareable?: boolean;

  // Lehekülje info (esimese lehe andmed)
  page_count: number;
  thumbnail_url: string;
  work_status?: WorkStatus;
  page_tags?: string[];     // Esimese lehekülje tagid
}

// =========================================================
// PAGE - Lehekülje andmed (Workspace)
// =========================================================

export interface Annotation {
  id: string;
  text: string;
  author: string;
  author_username?: string;
  created_at: string;
  replies?: AnnotationReply[];
}

export interface AnnotationReply {
  id: string;
  text: string;
  author: string;
  author_username: string;
  created_at: string;
}

export interface UserNotification {
  id: string;
  type: 'comment_reply' | 'review_request' | 'system' | 'sent_notification' | string;
  recipient_username: string;
  actor_username?: string;
  actor_name?: string;
  title?: string;
  body?: string;
  link?: string;
  metadata?: Record<string, unknown>;
  work_id?: string;
  page_number?: number;
  comment_id?: string;
  reply_id?: string;
  text_preview?: string;
  created_at: string;
  read_at?: string | null;
}

// Tekst-annotatsioon (highlight + kommentaar)
// MVP: <annN> inline-ankur, text_annotations on kommentaari source of truth.
// Annotatsioonid ei tohi kattuda ega pesastuda — insert-loogika kontrollib seda.
export interface TextAnnotation {
  id: number;           // <ann{id}> tägi numbriline sufiks, kasvav integer
  comment: string;      // Toimetaja kommentaar
  author: string;       // Kasutajanimi
  created_at: string;   // ISO 8601 timestamp
}

export interface HistoryEntry {
  id: string;
  user: string;
  action: 'text_edit' | 'status_change' | 'comment_added';
  timestamp: string;
  description: string;
}

/**
 * Page - Lehekülje andmed (Workspace)
 *
 * ⚠️  OLULINE: Kasuta AINULT v2 välju uues koodis!
 * Vt Work interface'i kommentaare detailsema selgituse jaoks.
 */
export interface Page {
  // Identifikaatorid
  id: string;               // Lehekülje ID (nt "cymbv7-1")
  work_id: string;          // Nanoid (püsiv lühikood, nt "cymbv7")

  // Lehekülje andmed
  page_number: number;
  text_content: string;
  image_url: string;
  status: PageStatus;
  comments: Annotation[];
  text_annotations: TextAnnotation[];
  page_tags: (string | LinkedEntity)[];      // Changed from tags
  history: HistoryEntry[];

  // =========================================================
  // V2 TEOSE ANDMED (denormaliseeritud) - KASUTA NEID
  // =========================================================
  title?: string;
  year?: number | null;
  year_display?: string | null; // Kuvatav aasta (nt "ca. 1680", "1670–1690")
  location?: LinkedEntity | null;
  publisher?: LinkedEntity | null;
  type?: LinkedEntity | null;
  genre?: LinkedEntity | LinkedEntity[] | null;
  collections?: string[];
  collections_hierarchy?: string[];
  creators?: Creator[];     // Kõik isikud koos rollidega
  authors_text?: string[];
  tags?: LinkedEntity[];
  languages?: string[];
  series?: Series;
  series_title?: string;
  ester_id?: string;
  external_url?: string;
  archive_refs?: ArchiveRef[] | null;

  // =========================================================
  // ⛔ V1 VÄLJAD - ÄRA KASUTA UUES KOODIS!
  // =========================================================
  /** @deprecated Kasuta `title` */
  pealkiri?: string;
  /** @deprecated Kasuta `creators.find(c => c.role === 'praeses')` */
  autor?: string;
  /** @deprecated Kasuta `creators.find(c => c.role === 'respondens')` */
  respondens?: string;
  /** @deprecated Kasuta `year` */
  aasta?: number;
  /** @deprecated */
  originaal_kataloog?: string;
  /** @deprecated */
  original_path?: string;
  /** @deprecated Kasuta `location` */
  koht?: string;
  /** @deprecated Kasuta `publisher` */
  trükkal?: string;
}

// =========================================================
// OTSINGU TÜÜBID
// =========================================================

export interface SearchFilters {
  query: string;
  scope: 'all' | 'annotation' | 'original';
  yearRange: [number, number];
  status: PageStatus | 'All';
}

export interface ContentSearchOptions {
  yearStart?: number;
  yearEnd?: number;
  catalog?: string;
  workId?: string;
  scope?: 'all' | 'annotation' | 'original';
  teoseTags?: string[];
  genre?: string[];       // V2: žanri filter (mitu valikut OR loogikaga)
  type?: string[];        // V2: tüübi filter (mitu valikut OR loogikaga)
  collection?: string;    // V2: kollektsiooni filter (collections_hierarchy kaudu)
  lang?: string;          // Keele filter (et, en) - kasutatakse genre/type/tags väljadega
  author?: string;        // V2: autori filter (creators massiivist)
  subjectPerson?: string; // VUTT isiku ID (vutt:Pxxxxxx) teema-filtrina (tags_ids kaudu)
  pageTags?: string[];    // Lehekülje märksõnad (AND loogika, page_tags_ids)
}

/**
 * ContentSearchHit - Otsingutulemuse kirje
 *
 * ⚠️  OLULINE: Kasuta AINULT v2 välju uues koodis!
 */
export interface ContentSearchHit {
  id: string;
  work_id: string;
  lehekylje_number: number | string;
  lehekylje_tekst: string;
  marginaalia_tekst?: string;
  lehekylje_pilt: string;

  // V2 VÄLJAD - KASUTA NEID
  title?: string;
  year?: number | string | null;
  location?: LinkedEntity | null;
  publisher?: LinkedEntity | null;
  genre?: LinkedEntity | LinkedEntity[] | null;
  type?: LinkedEntity | null;
  collections?: string[];
  creators?: Creator[];
  authors_text?: string[];
  tags?: LinkedEntity[];
  page_tags?: (string | LinkedEntity)[]; // Per-page tags

  comments?: Annotation[];
  text_annotations?: TextAnnotation[];

  _formatted?: {
    lehekylje_tekst: string;
    marginaalia_tekst?: string;
    tags?: string[];
    page_tags?: string[];
    comments?: Annotation[];
  };

  hitCount?: number;
}

export interface ContentSearchResponse {
  hits: ContentSearchHit[];
  totalHits: number;
  totalWorks?: number;
  totalPages: number;
  page: number;
  processingTimeMs: number;
  facetDistribution?: Record<string, Record<string, number>>;
}
