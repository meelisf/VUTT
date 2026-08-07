// Re-OCR koondstaatuse abifunktsioonid manage-lehele.
// Kolm SÕLTUMATUT mõistet: OCR töötab (active), .ocr ootel (ocr_ready, stem'id),
// viga (errors). has_text on eraldi (lehe päris .txt) — siin EI käsitleta.

export type ReocrState = 'processing' | 'ocr_ready' | 'error' | undefined;

export interface ReocrStatusResponse {
  active: Record<string, string>;
  ocr_ready: string[]; // stem'id (ilma laiendita)
  errors: Record<string, string>;
  progress: { total: number; ready: number; errors: number; active: boolean } | null;
  /** Viimase batch-töö lehed, mille .ocr on kettal (stem'id). Puudub vanas backendis. */
  batch_ready?: string[];
  /** Kas batch-kirje leiti. False = server taaskäivitati → varuvariant. */
  batch_known?: boolean;
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

export interface ApplicableReocr {
  /** Täisfailinimed API-le (mitte stem'id). */
  filenames: string[];
  /** Mitmel rakendataval lehel on juba tekst → ülekirjutuse hoiatus dialoogis. */
  withTextCount: number;
  /** Batch-infot ei ole (serveri restart) → ulatus on KÕIK ootel tulemused. */
  isFallback: boolean;
}

/**
 * Millised lehed lähevad hulgi-rakendusse.
 *
 * Vaikimisi AINULT selle teose viimase batch-töö lehed, et kellegi teise üksik
 * ootel tulemus samas teoses jääks puutumata. Kui batch-kirjet ei ole (server
 * taaskäivitati), langeme tagasi kõigile ootel tulemustele ja UI ütleb selle välja.
 * Leht, millel käib parasjagu uus OCR, jäetakse välja — vana tulemuse rakendamine
 * poolelioleva töö ajal oleks segadust tekitav.
 */
export function applicableReocrPages(
  pages: { filename: string; has_text: boolean }[],
  status: ReocrStatusResponse | null,
): ApplicableReocr {
  if (!status) return { filenames: [], withTextCount: 0, isFallback: false };
  const isFallback = status.batch_known !== true;
  const stems = new Set(isFallback ? status.ocr_ready : (status.batch_ready ?? []));
  const applicable = pages.filter(
    (p) => stems.has(stripExt(p.filename)) && !status.active[p.filename],
  );
  return {
    filenames: applicable.map((p) => p.filename),
    withTextCount: applicable.filter((p) => p.has_text).length,
    isFallback,
  };
}
