/**
 * Huvipakkuvate kogude valik registreerimisvormil (#321).
 *
 * Piir on **soovil, mitte õigusel**: kaheksa linnukest ei ütle kinnitajale
 * midagi, kolm ütleb, kust inimene päriselt alustaks. Admini ulatuse-valikut
 * see EI piira — see on tema otsus (ADR 0031).
 *
 * Sama piir on serveris (`server/registration.py`), sest vorm ei ole
 * turvapiir: kaks keelt, üks reegel.
 */
export const MAX_INTEREST_COLLECTIONS = 3;

/**
 * Lülitab kogu valikusse või sealt välja. Eemaldamine on ALATI lubatud —
 * ka üle piiri läinud loendist (nt kui piiri kunagi vähendatakse), muidu
 * jääks kasutaja lukku.
 */
export function toggleInterest(
  current: string[],
  id: string,
  max: number = MAX_INTEREST_COLLECTIONS,
): string[] {
  if (current.includes(id)) return current.filter((c) => c !== id);
  if (current.length >= max) return current;
  return [...current, id];
}
