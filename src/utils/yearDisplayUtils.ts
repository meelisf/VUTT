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

export function parseYearDisplayRange(
  numericYear: number | string | null | undefined,
  yearDisplay: string | null | undefined
): { start: number; end: number } | null {
  const numeric = Number(numericYear) || 0;

  if (yearDisplay) {
    const cm = yearDisplay.trim().match(CENTURY_RE);
    if (cm) {
      // N. sajand = (N-1)*100+1 … N*100 (ajaloolaste konventsioon: 19. saj = 1801–1900)
      const c = Number(cm[1]);
      return { start: (c - 1) * 100 + 1, end: c * 100 };
    }

    const isApprox = /\bca\.?\b/i.test(yearDisplay);
    const years = [...yearDisplay.matchAll(/\d{4}/g)].map(m => Number(m[0]));

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
