import type { TFunction } from 'i18next';

// Parsib year_display stringi filtri aastaajavahemikuks.
// "19. saj"  → { start: 1801, end: 1900 }
// "ca. 1750" → { start: 1740, end: 1760 }
// "1686-1696" → { start: 1686, end: 1696 }
// "1750"      → { start: 1750, end: 1750 }
// Tagastab null kui sobivat aastat ei leita.
// NB: peegelloogika Pythonis: server/utils.py parse_year_range

// Sajandimuster: "19. saj", "19. sajand", "19 saj" (stringi algusest, trimmituna)
export const CENTURY_RE = /^(\d{1,2})\.?\s*saj/i;
// Sajandite vahemik: "17.-19. saj", "17-19. saj", "17. – 19. saj" (vt issue #31).
// Kontrollitakse ENNE CENTURY_RE-d, sest üksik-sajandi muster (ankerdatud,
// nõuab 'saj' kohe pärast numbrit) vahemikku ei taba.
export const CENTURY_RANGE_RE = /^(\d{1,2})\.?\s*[-\u2013\u2014]\s*(\d{1,2})\.?\s*saj/i;

export function parseYearDisplayRange(
  numericYear: number | string | null | undefined,
  yearDisplay: string | null | undefined
): { start: number; end: number } | null {
  const numeric = Number(numericYear) || 0;

  if (yearDisplay) {
    // Sajandite vahemik kõigepealt (üksik-sajandi muster seda ei taba)
    const crm = yearDisplay.trim().match(CENTURY_RANGE_RE);
    if (crm) {
      const c1 = Number(crm[1]);
      const c2 = Number(crm[2]);
      const cLo = Math.min(c1, c2);
      const cHi = Math.max(c1, c2);
      // 17.-19. saj → 17. saj algusest (1601) kuni 19. saj lõpuni (1900)
      return { start: (cLo - 1) * 100 + 1, end: cHi * 100 };
    }

    const cm = yearDisplay.trim().match(CENTURY_RE);
    if (cm) {
      // N. sajand = (N-1)*100+1 … N*100 (ajaloolaste konventsioon: 19. saj = 1801–1900)
      const c = Number(cm[1]);
      return { start: (c - 1) * 100 + 1, end: c * 100 };
    }

    const isApprox = /\bca\.?\b/i.test(yearDisplay);
    // Aastad sorititakse, et tagurpidi vahemik ("1690-1670") annaks
    // (1670, 1690), mitte (1690, 1670) — start peab <= end (vt issue #31)
    const years = [...yearDisplay.matchAll(/\d{4}/g)].map(m => Number(m[0])).sort((a, b) => a - b);
    if (years.length >= 2) {
      return { start: years[0], end: years[years.length - 1] };
    }
    if (years.length === 1) {
      const y = years[0];
      return isApprox ? { start: y - 10, end: y + 10 } : { start: y, end: y };
    }
  }

  if (numeric) return { start: numeric, end: numeric };
  return null;
}

/** Puhas number (3–4 kohaline) — varauusaja aastad. 1–2 kohaline (nt "80", "0")
 *  langeb reeglile 3 (ei parsi → pehme hoiatus + year=0), sest VUTT korpus on
 *  4-kohalised aastad ja 1–2 kohaline on praktikas viga (vt aasta-välja disain). */
const PURE_YEAR_RE = /^\d{3,4}$/;

/**
 * Tuletab `{ year, year_display }` ühest tekstilahtrist (aasta-välja ühendamine).
 * Kasutab `parseYearDisplayRange`-i. Puhas funktsioon — ei puuduta DOM-i.
 *
 * Reeglid (sisend `value = raw.trim()`):
 *  1. tühi                          → { year: 0, year_display: "" }
 *  2. puhas 3–4-kohaline number     → { year: n, year_display: "" }
 *  3. parsib (range !== null)       → { year: (start+end)>>1, year_display: value }
 *  4. ei parsi + value===existing.year_display + existing.year olemas
 *                                   → { year: existing.year, year_display: value } (säilita)
 *  5. ei parsi + uus/muudetud       → { year: 0, year_display: value }
 *
 * Reegel 4 kaitseb vaikse andmekao eest: kui olemasoleval teosel on käsitsi korras
 * `year` parssimata kuva kõrval ja kasutaja dateeringut ei puuduta, ei nullita `year`-it.
 * Säilitamine kehtib AINULT muutmata kuva korral — muudetud string tuletatakse uuesti.
 */
export function deriveYearFields(
  raw: string,
  existing?: { year?: number; year_display?: string }
): { year: number; year_display: string } {
  const value = (raw ?? '').trim();

  // 1. tühi → kuupäevata teos on legitiimne
  if (value === '') {
    return { year: 0, year_display: '' };
  }

  // 2. puhas 3–4-kohaline aasta → number, kuva tühjaks (kuvatakse numbrina)
  const pure = value.match(PURE_YEAR_RE);
  if (pure) {
    return { year: parseInt(value, 10), year_display: '' };
  }

  // 3. parsib kuvastringist → keskpaik (sortimise stabiilsus, vt meili_doc.py:524)
  const range = parseYearDisplayRange(null, value);
  if (range) {
    return { year: (range.start + range.end) >> 1, year_display: value };
  }

  // 4. ei parsi, aga kuva muutmata ja olemasolev year olemas → säilita
  if (
    existing &&
    typeof existing.year === 'number' && existing.year &&
    value === (existing.year_display ?? '').trim()
  ) {
    return { year: existing.year, year_display: value };
  }

  // 5. ei parsi + uus/muudetud → year=0, kuva toorelt
  return { year: 0, year_display: value };
}

// Inglise järgarvu sufiks: 1st, 2nd, 3rd, 4th … 11th–13th erandid, 21st jne
function enOrdinal(n: number): string {
  const r10 = n % 10;
  const r100 = n % 100;
  if (r10 === 1 && r100 !== 11) return `${n}st`;
  if (r10 === 2 && r100 !== 12) return `${n}nd`;
  if (r10 === 3 && r100 !== 13) return `${n}rd`;
  return `${n}th`;
}

// Kuvatav aasta: sajandimuster tõlgitakse ("19. saj" / "19th century"),
// muu year_display (ca., vahemikud) on keele-neutraalne ja kuvatakse toorelt.
export function formatYearDisplay(
  yearDisplay: string | null | undefined,
  year: number | string | null | undefined,
  t: TFunction
): string {
  if (yearDisplay) {
    const cm = yearDisplay.trim().match(CENTURY_RE);
    if (cm) {
      const n = Number(cm[1]);
      return t('common:year.century', { n, ord: enOrdinal(n) });
    }
    return yearDisplay;
  }
  if (year) return String(year);
  return '';
}
