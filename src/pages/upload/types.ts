export interface FileEntry {
  page: number;
  filename: string;
  has_ocr: boolean;
  /**
   * Kas pisipilt on VUTT-i kettal. PILDI märk, eraldi `has_ocr`-ist (TEKSTI
   * märk) — pisipilt tuleb kaugserveri JPG-ga, tekst minuteid hiljem.
   * Puudub vanas state.json-is; siis langeme tagasi `has_ocr`-ile.
   */
  has_thumb?: boolean;
  deleted: boolean;
  /** OCR-serveri .err märgendi sisu — leht kukkus lõplikult läbi (#250). */
  ocr_error?: string;
  /**
   * Kas seda lehte SAAB teosesse importida (#294). Backend arvutab, frontend EI
   * tõlgenda `.err` kategooriaid ise — sõnavara elab ainult `server/ocr_err.py`-s.
   * Tekstiga leht on alati imporditav; veaga leht ainult `mudel`-kategoorias
   * (skaneering korras, inimene kirjutab teksti — ADR 0025).
   * Puudub vanas state.json-is; siis langeme tagasi `has_ocr`-ile.
   */
  importable?: boolean;
}

export interface PollResult {
  status: string;
  ready: number;
  /** Lehed, mille OCR lõplikult ebaõnnestus (#250). */
  failed?: number[];
  /** Mitu lehte OCR-i LÄHEB (poolitusplaani järgi) — kohatäidete arv viisardis. */
  planned_pages?: number | null;
  total: number;
  expected_pages: number | null;
  files: FileEntry[];
  /** Mitu LÄHTE-lehte on apply läbi töötanud. Ainult `applying` faasi teate jaoks. */
  applied_done?: number;
  progress?: {
    bytes_sent: number;
    bytes_total: number;
    error?: string | null;
    /** ADA allalaadimine: mitu allikfaili on tükeldatult valmis (vt server/ada/fetch.py). */
    files_done?: number;
    files_total?: number;
  };
  error?: string;
  stalled?: boolean;
}

export interface UploadType {
  id: string;
  label: string;
  source: string;
  labels?: Record<string, string>;
}

export interface SavedUpload {
  id: string;
  status: string;
  meta: { title: string; year: string | number; slug: string; type?: UploadType };
  created_at: string;
  expected_pages: number | null;
  files: FileEntry[];
  stalled?: boolean;
}

export interface WorkMetadataForReplace {
  title?: string;
  year?: string | number;
  slug?: string;
  collections?: string[];
  [key: string]: unknown;
}

export interface UploadCreatePayload {
  title: string;
  year: string;
  slug: string;
  collections: string[];
  replace_work_id: string | null;
  type: UploadType;
}

export interface UploadCreateResponse {
  upload: SavedUpload;
  conflict?: boolean;
  message?: string;
}

export interface UploadListResponse {
  uploads?: SavedUpload[];
}

export interface UploadImportResponse {
  work_id: string;
  message?: string;
  warning?: string;
  git_committed?: boolean;
}

export type PrepressMode = 'default' | 'custom' | 'nosplit';
export type PreviewStatus = 'idle' | 'rendering' | 'ready' | 'error' | 'cancelled';

export interface PrepressPage {
  n: number;
  mode: PrepressMode;
  split_x: number | null;
  excluded: boolean;
  /** Pööre päripäeva: 0 | 90 | 180 | 270. Puudub vanas plaanis → 0.
   *  Apply pöörab renderdatud lehe ENNE lõikamist. */
  rotate?: number;
}

export interface PrepressPlan {
  default_split_x: number;
  preview_status: PreviewStatus;
  preview_done: number;
  /** Ühe tsükli lipp: apply seab, prepress/start nullib (ADR 0026). */
  preview_cancel: boolean;
  pages: PrepressPage[];
  page_count: number;
  output_page_count: number;
  trivial: boolean;
  status: string;
  /** Töötlusotsus omas väljas — meta.type on bibliograafiline väide (§3). */
  ocr_model: 'print' | 'hand';
}

export interface PrepressSaveResult {
  status: string;
  output_page_count: number;
  trivial: boolean;
}

// ---------------------------------------------------------------------------
// ADA import (handle → metaandmed)
// ---------------------------------------------------------------------------

export type AdaVormiVali = 'title' | 'year' | 'year_display';

export interface AdaFile {
  name: string;
  bitstream_uuid: string;
  size_bytes: number;
  /** 0 = täiskuupäev, 1 = kuu+aasta, 2 = aasta, 3 = parsimatu. >0 → UI hoiatusmärk. */
  tapsus: number;
}

export interface AdaLookupResult {
  handle: string;
  item_uuid: string;
  meta: {
    title: string;
    year: string;
    year_display: string;
    creators: Array<{ label: string }>;
    languages: string[];
    ester_id: string | null;
    archive_refs: Array<{ archive_id: string; reference: string }>;
    external_url: string | null;
  };
  failid: AdaFile[];
  kogu_baite: number;
  vahele_jaetud: string[];
  /** Gemini pakutud „eesti / english" kuju. Puudub, kui tõlge ei õnnestunud. */
  title_suggestion?: string;
  /** Sama handle on juba imporditud (Task 12). HOIATUS, mitte blokeering. */
  olemasolev?: { work_id: string; title: string };
}

export interface AdaMergeTulemus {
  vaartused: Record<string, string>;
  ulekirjutatavad: Array<{ vali: AdaVormiVali; adaVaartus: string }>;
}
