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
export type CreatorRole = 'praeses' | 'respondens' | 'auctor' | 'gratulator' | 'dedicator' | 'editor';

// Isik teoses
export interface Creator {
  name: string;
  role: CreatorRole;
  id?: string | null;       // New: Wikidata ID
  source?: 'wikidata' | 'manual'; // New: Linking source
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
  id: string;               // Lehekülje ID (Meilisearch primary key)
  work_id?: string;         // Püsiv lühikood (nanoid)
  teose_id: string;         // Slug (URL-is)

  // Teose põhiandmed
  title: string;            // Pealkiri
  year: number | null;      // Ilmumisaasta
  location: string;         // Trükikoht (string facetiks)
  location_object?: LinkedEntity; // Trükikoht (objekt)
  publisher: string;        // Trükkal (string facetiks)
  publisher_object?: LinkedEntity; // Trükkal (objekt)

  // Taksonoomia
  type?: string;            // 'impressum' | 'manuscriptum'
  type_object?: LinkedEntity;
  genre?: string | null;    // 'disputatio' jne (string facetiks)
  genre_object?: LinkedEntity | LinkedEntity[] | null;
  collection?: string | null;
  collections_hierarchy?: string[];

  // Isikud - KASUTA SEDA, mitte author/respondens!
  creators?: Creator[];     // Kõik isikud koos rollidega
  authors_text?: string[];  // Denormaliseeritud otsinguks

  // Märksõnad ja keeled
  tags?: string[];          // Märksõnad (stringid facetiks)
  tags_object?: LinkedEntity[]; // Märksõnad (objektid)
  languages?: string[];     // Keeled (ISO 639-3: lat, deu, est, ...)

  // Seosed
  series?: Series;
  series_title?: string;
  relations?: Relation[];

  // Välised lingid
  ester_id?: string;
  external_url?: string;

  // Lehekülje info (esimese lehe andmed)
  page_count: number;
  thumbnail_url: string;
  work_status?: WorkStatus;
  page_tags?: string[];     // Esimese lehekülje tagid

  // =========================================================
  // ⛔ V1 VÄLJAD - ÄRA KASUTA UUES KOODIS!
  // Ainult tagasiühilduvuseks Meilisearchi skeemiga.
  // Eemaldatakse tulevikus.
  // =========================================================
  /** @deprecated Kasuta `catalog_name` asemel */
  catalog_name?: string;
  /** @deprecated Kasuta `creators.find(c => c.role === 'praeses')` */
  author?: string;
  /** @deprecated Kasuta `creators.find(c => c.role === 'respondens')` */
  respondens?: string;
  /** @deprecated Kasuta `location` */
  koht?: string;
  /** @deprecated Kasuta `publisher` */
  trükkal?: string;
  /** @deprecated Kasuta `title` */
  pealkiri?: string;
  /** @deprecated Kasuta `year` */
  aasta?: number;
}

// =========================================================
// PAGE - Lehekülje andmed (Workspace)
// =========================================================

export interface Annotation {
  id: string;
  text: string;
  author: string;
  created_at: string;
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
  id: string;               // Lehekülje ID (nt "1632-1-1")
  work_id?: string;         // Püsiv lühikood
  teose_id: string;         // Slug

  // Lehekülje andmed
  page_number: number;
  text_content: string;
  image_url: string;
  status: PageStatus;
  comments: Annotation[];
  page_tags: (string | LinkedEntity)[];      // Changed from tags
  history: HistoryEntry[];

  // =========================================================
  // V2 TEOSE ANDMED (denormaliseeritud) - KASUTA NEID
  // =========================================================
  title?: string;
  year?: number | null;
  location?: string;
  location_object?: LinkedEntity;
  publisher?: string;
  publisher_object?: LinkedEntity;
  type?: string;
  type_object?: LinkedEntity;
  genre?: string | null;
  genre_object?: LinkedEntity | LinkedEntity[] | null;
  collection?: string | null;
  collections_hierarchy?: string[];
  creators?: Creator[];     // Kõik isikud koos rollidega
  authors_text?: string[];
  tags?: string[];
  tags_object?: LinkedEntity[];
  languages?: string[];
  series?: Series;
  series_title?: string;
  ester_id?: string;
  external_url?: string;

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
  genre?: string;
  type?: string;          // V2: tüübi filter (impressum/manuscriptum)
  collection?: string;    // V2: kollektsiooni filter
  lang?: string;          // Keele filter (et, en) - kasutatakse genre/type/tags väljadega
}

/**
 * ContentSearchHit - Otsingutulemuse kirje
 *
 * ⚠️  OLULINE: Kasuta AINULT v2 välju uues koodis!
 */
export interface ContentSearchHit {
  id: string;
  teose_id: string;
  work_id?: string;
  lehekylje_number: number | string;
  lehekylje_tekst: string;
  lehekylje_pilt: string;

  // V2 VÄLJAD - KASUTA NEID
  title?: string;
  year?: number | string | null;
  location?: string;
  location_object?: LinkedEntity;
  publisher?: string;
  publisher_object?: LinkedEntity;
  genre?: string | null;
  genre_object?: LinkedEntity | LinkedEntity[] | null;
  type?: string | null;
  type_object?: LinkedEntity | null;
  collection?: string | null;
  creators?: Creator[];
  authors_text?: string[];
  tags?: string[]; // Added support for V3
  tags_object?: LinkedEntity[];
  page_tags?: (string | LinkedEntity)[]; // Per-page tags


  // =========================================================
  // ⛔ V1 VÄLJAD - ÄRA KASUTA UUES KOODIS!
  // =========================================================
  /** @deprecated Kasuta `title` */
  pealkiri?: string;
  /** @deprecated Kasuta `creators` */
  autor?: string;
  /** @deprecated Kasuta `year` */
  aasta?: number | string;
  /** @deprecated */
  originaal_kataloog?: string;

  comments?: Annotation[];

  _formatted?: {
    lehekylje_tekst: string;
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
