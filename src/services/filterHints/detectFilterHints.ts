/**
 * Filtrivihje tuvastaja (#605, spec 2026-10-15): otsingupäring + sõnavara →
 * filtrikandidaadid. Puhas funktsioon — loendurid ja „juba rakendatud" on
 * hooki (`useFilterHints`) töö.
 *
 * Reegel: päringu sõna on SILDI SÕNA ALGUS (tõstu- ja diakriitikutundetu).
 * Mitmesõnaline silt sobitub järjestikuste päringusõnadega, kus kõik peale
 * viimase on täissõnad ja viimane võib olla poolik.
 */
import { normalizeForSearch } from '../../utils/diacritics';

export type HintKind = 'year' | 'genre' | 'tag' | 'type';

export interface VocabEntry {
  kind: 'genre' | 'tag' | 'type';
  id: string;
  labels: { et?: string; en?: string };
  /** Sünonüümid (spec „Laiendus"); osa 1-s tühi. */
  terms?: string[];
  /** Ulatuse fassetiloendur — eeljärjestuse teine kriteerium. */
  facetCount?: number;
}

export interface FilterHintCandidate {
  kind: HintKind;
  value: string;
  label: string;
  /** Sõnaindeksite vahemik päringus (kaasa arvatud). */
  matched: [number, number];
  matchedTokens: number;
  matchedChars: number;
  remainingQuery: string;
  facetCount: number;
}

export interface DetectOptions {
  minYear?: number;
  maxYear?: number;
  minTokenLength?: number;
}

const DEFAULTS = { minYear: 1400, maxYear: 1950, minTokenLength: 4 };

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * Mitu päringusõna alates `start`-ist sobitub sildisõnadega alates `w`-st.
 * Kõik peale viimase peavad olema täpselt võrdsed, viimane on algus.
 * Tagastab pikima kehtiva arvu (0 = ei sobitu).
 */
function runLength(tokens: string[], start: number, words: string[], w: number, minLen: number): number {
  let best = 0;
  let chars = 0;
  for (let k = 1; start + k - 1 < tokens.length && w + k - 1 < words.length; k++) {
    const tok = tokens[start + k - 1];
    const word = words[w + k - 1];
    if (!word.startsWith(tok)) break;
    chars += tok.length;
    // Lühike poolik sõna üksi ei loe: kogu sobitus peab kandma ≥ minLen tähte
    if (chars >= minLen) best = k;
    // Järgmine samm nõuab, et see sõna oleks TÄIS-sõna
    if (tok !== word) break;
  }
  return best;
}

export function detectFilterHints(
  query: string,
  vocab: VocabEntry[],
  lang: 'et' | 'en',
  opts: DetectOptions = {},
): FilterHintCandidate[] {
  const { minYear, maxYear, minTokenLength } = { ...DEFAULTS, ...opts };
  const raw = (query || '').trim().split(/\s+/).filter(Boolean);
  if (raw.length === 0) return [];
  // Jutumärke sisaldav päring on fraasiotsing — ei lõhu seda filtriks
  if (raw.some(t => t.includes('"'))) return [];
  const tokens = raw.map(normalizeForSearch);

  const remaining = (from: number, to: number) =>
    raw.filter((_, i) => i < from || i > to).join(' ');

  const out: FilterHintCandidate[] = [];

  tokens.forEach((tok, i) => {
    if (/^\d{4}$/.test(tok)) {
      const y = Number(tok);
      if (y >= minYear && y <= maxYear) {
        out.push({
          kind: 'year', value: tok, label: tok, matched: [i, i], matchedTokens: 1,
          matchedChars: tok.length, remainingQuery: remaining(i, i), facetCount: Number.MAX_SAFE_INTEGER,
        });
      }
    }
  });

  for (const entry of vocab) {
    const phrases = [entry.labels.et, entry.labels.en, ...(entry.terms || [])].filter(Boolean) as string[];
    let best: { start: number; k: number; chars: number } | null = null;
    for (const phrase of phrases) {
      const words = normalizeForSearch(phrase).split(/\s+/).filter(Boolean);
      for (let start = 0; start < tokens.length; start++) {
        for (let w = 0; w < words.length; w++) {
          const k = runLength(tokens, start, words, w, minTokenLength);
          if (k === 0) continue;
          const chars = tokens.slice(start, start + k).join('').length;
          if (!best || k > best.k || (k === best.k && chars > best.chars)) best = { start, k, chars };
        }
      }
    }
    if (best) {
      out.push({
        kind: entry.kind,
        value: entry.id,
        label: capitalize(entry.labels[lang] || entry.labels.et || entry.labels.en || entry.id),
        matched: [best.start, best.start + best.k - 1],
        matchedTokens: best.k,
        matchedChars: best.chars,
        remainingQuery: remaining(best.start, best.start + best.k - 1),
        facetCount: entry.facetCount ?? 0,
      });
    }
  }

  return out.sort((a, b) =>
    b.matchedTokens - a.matchedTokens || b.matchedChars - a.matchedChars || b.facetCount - a.facetCount);
}
