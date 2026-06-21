// Re-OCR koondstaatuse abifunktsioonid manage-lehele.
// Kolm SÕLTUMATUT mõistet: OCR töötab (active), .ocr ootel (ocr_ready, stem'id),
// viga (errors). has_text on eraldi (lehe päris .txt) — siin EI käsitleta.

export type ReocrState = 'processing' | 'ocr_ready' | 'error' | undefined;

export interface ReocrStatusResponse {
  active: Record<string, string>;
  ocr_ready: string[]; // stem'id (ilma laiendita)
  errors: Record<string, string>;
  progress: { total: number; ready: number; errors: number; active: boolean } | null;
}

const stripExt = (fn: string): string => fn.replace(/\.[^.]+$/, '');

/** Lehe re-OCR olek failinime järgi. ocr_ready võrreldakse stem'i järgi. */
export function mapReocrState(filename: string, status: ReocrStatusResponse | null): ReocrState {
  if (!status) return undefined;
  if (status.active[filename]) return 'processing';
  if (status.errors[filename]) return 'error';
  if (status.ocr_ready.includes(stripExt(filename))) return 'ocr_ready';
  return undefined;
}

/** "Vali tekstita": has_text===false JA mitte OCR-ootel JA mitte töötav. */
export function selectableNoTextFiles(
  pages: { filename: string; has_text: boolean }[],
  status: ReocrStatusResponse | null,
): string[] {
  return pages
    .filter((p) => !p.has_text)
    .filter((p) => {
      if (!status) return true;
      if (status.active[p.filename]) return false;
      if (status.ocr_ready.includes(stripExt(p.filename))) return false;
      return true;
    })
    .map((p) => p.filename);
}
