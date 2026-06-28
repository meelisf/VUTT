export interface FileEntry {
  page: number;
  filename: string;
  has_ocr: boolean;
  deleted: boolean;
}

export interface PollResult {
  status: string;
  ready: number;
  total: number;
  expected_pages: number | null;
  files: FileEntry[];
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
}
