/** Lehtede lisamise vormi failivalik (ADR 0074): pildid VÕI täpselt üks PDF. */

export type AddFilesKind =
  | { kind: 'images' }
  | { kind: 'pdf'; file: File }
  | { kind: 'invalid'; reason: 'mixed' | 'multiplePdf' };

// Laiend on varuvariant: mõni süsteem annab PDF-ile tühja MIME-tüübi.
const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

export function classifyAddFiles(files: File[]): AddFilesKind {
  const pdfs = files.filter(isPdf);
  if (pdfs.length === 0) return { kind: 'images' };
  if (pdfs.length < files.length) return { kind: 'invalid', reason: 'mixed' };
  if (pdfs.length > 1) return { kind: 'invalid', reason: 'multiplePdf' };
  return { kind: 'pdf', file: pdfs[0] };
}

/**
 * Vormi valik (0 = algusesse, -1 = lõppu, N = lehe N järele) → serveri ankur.
 * Ankur on pildifaili nimi, mitte number: server lahendab selle luku all ja
 * renderduse ajal nihkunud lehenumber ei saada PDF-i vale lehe järele.
 */
export function afterToAnchor(addAfterPage: number, pages: { page_num: number; filename: string }[]): string {
  if (addAfterPage === 0) return 'start';
  return pages.find((p) => p.page_num === addAfterPage)?.filename ?? 'end';
}
