// Re-OCR lehe identiteet. Re-OCR olek (banner, tulemus, viga) kuulub LEHELE,
// mitte editori instantsile — editor ei monteeru lehe vahetusel maha (ADR 0010),
// seega peab olek lähtestuma siinse võtme muutumisel.

export interface ReocrPageIdentity {
  /** Pildifaili nimi (nt "foo_pg_001.jpg") või null, kui lehel pilti pole. */
  pageFilename: string | null;
  /** Lehe identiteedi võti — muutumine tähendab, et olek tuleb lähtestada. */
  pageKey: string | null;
  /** localStorage võti poolelioleva töö job_id jaoks (ajalooline formaat). */
  storageKey: string | null;
}

export function reocrPageIdentity(
  workId: string | null | undefined,
  imageUrl: string | null | undefined,
): ReocrPageIdentity {
  const pageFilename = imageUrl ? (imageUrl.split('/').pop() || null) : null;
  if (!workId || !pageFilename) {
    return { pageFilename, pageKey: null, storageKey: null };
  }
  return {
    pageFilename,
    pageKey: `${workId}/${pageFilename}`,
    storageKey: `reocr_job_${workId}_${pageFilename}`,
  };
}
