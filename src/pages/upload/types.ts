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
  progress?: { bytes_sent: number; bytes_total: number; error?: string | null };
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
