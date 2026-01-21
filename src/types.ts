
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

export interface Work {
  // V2 identifikaatorid
  id: string;               // Lehekülje ID (Meilisearch primary key)
  work_id?: string;         // Püsiv lühikood (nanoid)
  teose_id: string;         // Slug (URL-is, tagasiühilduvus)

  // V2 teose andmed
  title: string;
  year: number | null;
  location: string;
  publisher: string;

  // V2 taksonoomia
  type?: string;            // 'impressum' | 'manuscriptum'
  genre?: string | null;    // 'disputatio' | 'oratio' | ...
  collection?: string | null;
  collections_hierarchy?: string[];

  // V2 isikud
  creators?: Creator[];
  authors_text?: string[];  // Denormaliseeritud otsinguks

  // V2 märksõnad
  teose_tags?: string[];    // Sisuline klassifikatsioon
  languages?: string[];     // Keeled (ISO 639-3)

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
  tags?: string[];          // Esimese lehekülje tagid

  // Tagasiühilduvus (ajutine)
  catalog_name?: string;    // originaal_kataloog
  author?: string;          // Esimene praeses
  respondens?: string;      // Esimene respondens
  koht?: string;
  trükkal?: string;
  pealkiri?: string;
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
  tags: string[];
  history: HistoryEntry[];

  // V2 teose andmed (denormaliseeritud)
  title?: string;
  year?: number | null;
  location?: string;
  publisher?: string;
  type?: string;
  genre?: string | null;
  collection?: string | null;
  collections_hierarchy?: string[];
  creators?: Creator[];
  authors_text?: string[];
  teose_tags?: string[];
  languages?: string[];
  series?: Series;
  series_title?: string;
  ester_id?: string;
  external_url?: string;

  // Tagasiühilduvus (ajutine)
  pealkiri?: string;
  autor?: string;
  respondens?: string;
  aasta?: number;
  originaal_kataloog?: string;
  original_path?: string;
  koht?: string;
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
}

export interface ContentSearchHit {
  id: string;
  teose_id: string;
  work_id?: string;
  lehekylje_number: number | string;
  lehekylje_tekst: string;
  lehekylje_pilt: string;

  // V2 väljad
  title?: string;
  year?: number | string | null;
  location?: string;
  publisher?: string;
  genre?: string | null;
  collection?: string | null;
  creators?: Creator[];
  authors_text?: string[];

  // Tagasiühilduvus
  pealkiri?: string;
  autor?: string;
  aasta?: number | string;
  originaal_kataloog?: string;

  tags?: string[];
  comments?: Annotation[];

  _formatted?: {
    lehekylje_tekst: string;
    tags?: string[];
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
