// Ametite ja hariduskirjete aja- ning asutusevormindus.
// Kirjed on tahaühilduvad kolmes formaadis (vt personForm/helpers.ts recordToDraft):
//   1. date_from / date_to — HistoricalDate objekt
//   2. date_start / date_end — Album Academicumi ISO-string ("1638-01-18")
//   3. year_from / year_to (või year) — vana täisarv

export interface BoundLabels {
  before: string;
  after: string;
}

/** Ühe kuupäeva aasta koos „enne/pärast" ja ligikaudsuse märkega. */
function entryYear(
  d: any,
  isoFallback: any,
  yearFallback: any,
  boundLabels: BoundLabels,
): string {
  const iso = d?.date ?? (typeof isoFallback === 'string' ? isoFallback : null);
  const year = iso
    ? String(iso).slice(0, 4)
    : (yearFallback != null && yearFallback !== '' ? String(yearFallback) : '');
  if (!/^\d{4}$/.test(year)) return '';
  const circa = d?.is_circa ? '~' : '';
  const bound = d?.bound === 'before'
    ? `${boundLabels.before} `
    : d?.bound === 'after' ? `${boundLabels.after} ` : '';
  return `${bound}${circa}${year}`;
}

/** Kirje ajavahemik kujul „1632–1642", „1638" või „–1642"; tühi string, kui aastaid pole. */
export function formatEntryPeriod(entry: any, boundLabels: BoundLabels): string {
  if (!entry || typeof entry !== 'object') return '';
  const from = entryYear(entry.date_from, entry.date_start, entry.year_from ?? entry.year, boundLabels);
  const to = entryYear(entry.date_to, entry.date_end, entry.year_to, boundLabels);
  if (from && to) return from === to ? from : `${from}–${to}`;
  return from || (to ? `–${to}` : '');
}

/** Asutuse nimi kasutaja keeles (institution_labels), muidu toores institution. */
export function institutionLabel(entry: any, lang: string): string {
  if (!entry || typeof entry !== 'object') return '';
  const labels = entry.institution_labels;
  const localized = labels
    ? (labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? '')
    : '';
  return (localized as string) || entry.institution || '';
}
