
export enum PageStatus {
  RAW = 'Toores',
  IN_PROGRESS = 'Töös',
  CORRECTED = 'Parandatud',
  ANNOTATED = 'Annoteeritud',
  DONE = 'Valmis'
}

// Teose koondstaatus dashboardi jaoks
export type WorkStatus = 'Toores' | 'Töös' | 'Valmis';

// See vastab struktuurile, mis tuleb Meilisearchist (lehekylje_number=1 päringuga)
export interface Work {
  id: string; // See on teose_id (nt "1632-1")
  catalog_name: string; // originaal_kataloog
  title: string; // pealkiri
  author: string; // autor
  respondens?: string; // respondens (disputatsioonide puhul)
  year: number; // aasta
  publisher: string; // Hetkel puudub Meilisearchist, võib jätta tühjaks
  page_count: number; // Seda peame eraldi lugema või hinnanguliselt panema
  thumbnail_url: string; // lehekylje_pilt esimeselt lehelt
  work_status?: WorkStatus; // Teose koondstaatus (arvutatakse lehekülgede staatustest)
  tags?: string[]; // Esimese lehekülje tagid (dashboardil kuvamiseks)
  teose_tags?: string[]; // Teose-tasemel märksõnad/kollektsioonid (admin saab muuta)
  ester_id?: string; // ESTER kataloogi ID (nt "b1510692")
  external_url?: string; // Väline kataloogilink (kui pole ESTERis)
}

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

// Vastab Meilisearchi dokumendi struktuurile
export interface Page {
  id: string; // nt "1632-1-1"
  work_id: string; // teose_id
  page_number: number; // lehekylje_number
  text_content: string; // lehekylje_tekst
  image_url: string; // lehekylje_pilt (täispikk URL)
  status: PageStatus; // Hetkel pole Meilisearchis, simuleerime või lisame hiljem
  comments: Annotation[];
  tags: string[];
  history: HistoryEntry[];

  // Meilisearchi spetsiifilised väljad (metadata, mis on lehekülje dokumendi küljes)
  pealkiri?: string;
  autor?: string;
  respondens?: string;
  aasta?: number;
  teose_tags?: string[];
  originaal_kataloog?: string;
  ester_id?: string;
  external_url?: string;
  original_path?: string;
}

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
  workId?: string;  // Filter ühe teose piires
  scope?: 'all' | 'annotation' | 'original';
  teoseTags?: string[];  // Teose märksõnade filter (AND loogika)
}

// Full Text Search specific types
export interface ContentSearchHit {
  id: string;
  teose_id: string;
  lehekylje_number: number | string;
  pealkiri?: string;
  autor?: string;
  aasta?: number | string;
  originaal_kataloog?: string;
  lehekylje_tekst: string;
  lehekylje_pilt: string;
  tags?: string[];
  comments?: Annotation[];
  _formatted?: {
    lehekylje_tekst: string;
    tags?: string[];
    comments?: Annotation[];
  };
  // Vastete arv selles teoses (distinct päringu puhul)
  hitCount?: number;
}

export interface ContentSearchResponse {
  hits: ContentSearchHit[];
  totalHits: number;        // Kokku lehekülgi/vasteid
  totalWorks?: number;      // Kokku teoseid (distinct päringu puhul)
  totalPages: number;
  page: number;
  processingTimeMs: number;
  facetDistribution?: Record<string, Record<string, number>>;
}