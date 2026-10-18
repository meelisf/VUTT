// Osade isikud teose otsingus (ADR 0072): miks teos tulemustes on, kui pealkiri ega
// teose isikud seda ei seleta. Ligikaudne — Meili trükiveataluvust ei korrata, siis
// jääb vihje lihtsalt näitamata.

interface MatchableWork {
  title?: string;
  title_en?: string;
  title_original?: string;
  authors_text?: string[];
  part_persons_text?: string[];
}

const fold = (s: string): string =>
  s.replace(/ß/g, 'ss').replace(/ẞ/g, 'SS').replace(/ſ/g, 's')
    .normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const tokens = (s: string): string[] => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Kas päringusõna sobib mõne tekstisõnaga: viimane sõna eesliitena, muud tervena (nagu Meilis). */
const hits = (word: string, isLast: boolean, textTokens: string[]): boolean =>
  textTokens.some(tok => (isLast ? tok.startsWith(word) : tok === word));

/** Osade isikunimed, mille leiab mõni päringusõna, mida teose enda väljad ei seleta. */
export function partPersonMatches(work: MatchableWork, query: string): string[] {
  const names = work.part_persons_text || [];
  const words = tokens(query);
  if (!names.length || !words.length) return [];

  const own = [work.title, work.title_en, work.title_original, ...(work.authors_text || [])]
    .flatMap(s => (s ? tokens(s) : []));
  const unexplained = words
    .map((w, i) => ({ w, last: i === words.length - 1 }))
    .filter(({ w, last }) => !hits(w, last, own));
  if (!unexplained.length) return [];

  return names.filter(name => {
    const nt = tokens(name);
    return unexplained.some(({ w, last }) => hits(w, last, nt));
  });
}
