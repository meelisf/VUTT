/**
 * Diakriitikatundetu otsingutekst.
 *
 * NFD + kombineerivate märkide eemaldus: „Jõgi" ja „Jogi" peavad leidma
 * teineteist MÕLEMAS suunas. Eraldi moodul, sest sama normaliseerimist vajavad
 * kasutajaotsing ja kogude otsing — kaks koopiat lahknesid juba korra (#318).
 */
export function normalizeForSearch(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
