/**
 * Isiku eluaegade kuvamine (#240).
 *
 * Kolm asja, mis varem valesti läksid:
 *  - kuvati ainult aastat, nii et kaardilt ei olnud näha, kas kuu ja päev on
 *    üldse olemas;
 *  - `0000-00-00` (jäänuk sellest, et tühja aastat ei saanud salvestada)
 *    kuvati aastana `0000`;
 *  - sõnaline kuupäev („um 1677") lõigati `slice(0, 4)`-ga ja ekraanile jõudis
 *    „um 1".
 */
import type { HistoricalDate } from '../types';

export type BoundLabels = { before: string; after: string };

function placeSuffix(d: HistoricalDate, lang: string): string {
  const historical = d.place?.label || '';
  if (!historical) return '';
  const labels = d.place?.labels;
  const modern = labels
    ? (labels[lang] ?? labels['et'] ?? labels['en'] ?? Object.values(labels)[0] ?? '')
    : '';
  return `, ${modern && modern !== historical ? `${historical} (${modern})` : historical}`;
}

function localeDate(year: number, month: number, day: number | null, lang: string): string {
  const opts: Intl.DateTimeFormatOptions = day
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { month: 'long', year: 'numeric' };
  try {
    return new Date(year, month - 1, day || 1)
      .toLocaleDateString(lang === 'et' ? 'et-EE' : 'en-GB', opts);
  } catch {
    return String(year);
  }
}

/** Kuupäev kuvamiseks. Sümbolit (* †) siia ei panda — selle otsustab kutsuja. */
export function formatLifeDate(
  d: HistoricalDate | null | undefined,
  boundLabels: BoundLabels,
  lang: string = 'et',
): string {
  const raw = (d?.date ?? '').trim();
  if (!raw) return '';

  const prefix =
    (d!.bound === 'before' ? `${boundLabels.before} ` : d!.bound === 'after' ? `${boundLabels.after} ` : '') +
    (d!.is_circa ? '~' : '');

  // Sõnaline kuupäev ("um 1677") — näita tervikuna, ära lõika aastaks
  if (!/^\d{4}/.test(raw)) return `${prefix}${raw}${placeSuffix(d!, lang)}`;

  const year = parseInt(raw.slice(0, 4), 10);
  if (!year) return '';          // "0000" = teadmata, mitte aasta null

  const month = parseInt(raw.slice(5, 7), 10);
  const day = parseInt(raw.slice(8, 10), 10);
  const precision = d!.precision;

  let core = String(year);
  if (precision === 'day' && month && day) core = localeDate(year, month, day, lang);
  else if ((precision === 'day' || precision === 'month') && month) core = localeDate(year, month, null, lang);

  return `${prefix}${core}${placeSuffix(d!, lang)}`;
}

/** Tegutsemisperiood, kui sünni-/surmaaastat ei ole teada. */
export function formatFloruit(
  from: number | null | undefined,
  to: number | null | undefined,
): string {
  if (!from && !to) return '';
  return `${from ?? ''}–${to ?? ''}`;
}
