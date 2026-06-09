// Parsib year_display stringi filtri aastaajavahemikuks.
// "ca. 1750" → { start: 1740, end: 1760 }
// "1686-1696" → { start: 1686, end: 1696 }
// "1750"      → { start: 1750, end: 1750 }
// Tagastab null kui sobivat aastat ei leita.
export function parseYearDisplayRange(
  numericYear: number | string | null | undefined,
  yearDisplay: string | null | undefined
): { start: number; end: number } | null {
  const numeric = Number(numericYear) || 0;

  if (yearDisplay) {
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
