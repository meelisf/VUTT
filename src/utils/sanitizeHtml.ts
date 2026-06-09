// sanitizeHtml.ts — turvaline Meilisearch _formatted highlight-väljade renderdamine.
//
// Meilisearch tagastab _formatted väljad (snippet, kommentaarid, tag'id) koos
// highlight-tägidega, AGA ei saniteeri aluseks olevat kasutajasisendit. Kuna neid
// renderdatakse dangerouslySetInnerHTML kaudu, saaks pahatahtlik toimetaja sisestada
// stored XSS-i (nt <img src=x onerror=alert(1)> kommentaari). Vt security_review Leid B.
//
// Lähenemine: escape KOGU HTML, seejärel taasta AINULT teadaolevad rakenduse-kontrollitud
// highlight-tägid (allpool konstandid). See on range allowlist — mitte HTML-parser —
// seega atribuudid (onerror, onclick) ega skriptitägid ei pääse kunagi läbi.

// Highlight-tägid — ÜKS allikas. Kasutusel ka searchService.ts highlightPreTag/PostTag väärtustes.
export const HIGHLIGHT_PRE_TAG = '<em class="bg-yellow-200 font-bold not-italic">';
export const HIGHLIGHT_POST_TAG = '</em>';

/** Escape HTML erimärgid teksti-kontekstis (&, <, >). Jutumärke ei pea escape'ima,
 *  sest sisu läheb elemendi sisusse, mitte atribuuti. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Saniteerib Meilisearchi _formatted välja turvaliseks HTML-iks: escape kõik,
 * taasta ainult highlight-tägid. allowBr=true asendab reavahetused <br>-iga (snippet).
 */
export function sanitizeHighlight(text: string, opts: { allowBr?: boolean } = {}): string {
  let out = escapeHtml(text)
    // Taasta täpsed rakenduse highlight-tägid (escape'itud kujust → originaal).
    .split(escapeHtml(HIGHLIGHT_PRE_TAG)).join(HIGHLIGHT_PRE_TAG)
    .split(escapeHtml(HIGHLIGHT_POST_TAG)).join(HIGHLIGHT_POST_TAG);
  if (opts.allowBr) {
    out = out.replace(/\n/g, '<br>');
  }
  return out;
}
