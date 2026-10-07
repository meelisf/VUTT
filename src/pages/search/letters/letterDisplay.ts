/**
 * Kirja tulemusrea kuvaloogika (#526) — puhas, et varukuva ahel oleks testitav.
 * Puuduvat välja ei näidata ega asendata oletusega („[teadmata]").
 */
import type { LetterHit } from '../../../services/letterSearch';
import type { WorkDating } from '../../../utils/workDating';

type T = (key: string, opts?: Record<string, unknown>) => string;

const INCIPIT_MAX = 80;

/** Kuupäev; vahemik jääb vahemikuks (alguskuupäev üksi annaks eksliku täpsuse).
 *  Allikakuju (`source_text`) EI asenda kuupäeva: see võib kanda toimetaja märkust —
 *  ta on tulemusreal hõljuv vihje (LetterResults). */
export function formatLetterDating(dating: WorkDating | undefined): string | null {
  if (!dating?.start) return null;
  return dating.end ? `${dating.start}–${dating.end}` : dating.start;
}

const pair = (from: string, to: string): string | null => {
  if (from && to) return `${from} → ${to}`;
  if (from) return from;
  if (to) return `→ ${to}`;
  return null;
};

export function letterHeadline(hit: LetterHit, t: T): string {
  const segments = [
    pair(hit.authors.join(', '), hit.addressees.join(', ')),
    formatLetterDating(hit.dating),
    pair(hit.place_from, hit.place_to),
  ].filter((s): s is string => !!s);
  if (segments.length) return segments.join(' · ');
  if (hit.title) return hit.title;
  if (hit.incipit) return hit.incipit.length > INCIPIT_MAX ? `${hit.incipit.slice(0, INCIPIT_MAX)}…` : hit.incipit;
  return t('letters.pageFallback', { page: hit.first_page });
}

const hasMark = (s?: string): s is string => !!s && s.includes('<mark>');

/** Tekstikatke ainult siis, kui vaste on tekstis või kokkuvõttes; nimevaste korral null. */
export function letterSnippet(hit: LetterHit): string | null {
  const f = hit._formatted;
  if (hasMark(f?.letter_text)) return f!.letter_text!;
  if (hasMark(f?.abstract)) return f!.abstract!;
  return null;
}

/** `<mark>` tükkideks — renderdus ilma dangerouslySetInnerHTML-ita (ülejäänu on tekst). */
export function splitMarks(s: string): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  const re = /<mark>(.*?)<\/mark>/gs;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index), mark: false });
    out.push({ text: m[1], mark: true });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), mark: false });
  return out;
}
