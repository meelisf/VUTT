/**
 * Isiku nimeajalugu (ADR 0083). Kirjaviisi variandid on `name.aliases`-is,
 * liigiga nimed (aadlinimi, abielunimi…) `name.names[]`-is. Kasutajale on see
 * üks plokk „Nimed ja nimekujud”.
 *
 * `looksLikeOtherName` on SAMA reegel mis serveri
 * `server/prosopography/person_names.py` — muuda mõlemat koos; testid jagavad
 * juhtumeid (`OTHER_NAME_CASES`).
 */

export const NAME_TYPES = ['birth', 'latinized', 'ennobled', 'married', 'pseudonym', 'religious', 'other'] as const;
export type NameType = typeof NAME_TYPES[number];

export interface PersonNameEntry {
  label: string;
  type: NameType;
  from?: number | null;
  to?: number | null;
  source?: string | null;
  notes?: string | null;
}

/** Vormi rida: aastad ja tekstid stringidena (tühi = puudub). */
export interface PersonNameDraft {
  label: string;
  type: NameType;
  from: string;
  to: string;
  source: string;
  notes: string;
}

const PREFIX = 5;
const RATIO = 0.6;
const ENDINGS = ['ensis', 'ivs', 'ios', 'vs', 'is', 'es', 's', 'i', 'o', 'a', 'e'];
const SUFFIXES = new Set(['jun', 'junior', 'iun', 'iunior', 'sen', 'senior', 'jr', 'sr', 'filius', 'pater', 'dä', 'dj']);

function fold(token: string): string {
  let t = token.normalize('NFKD').replace(/\p{M}/gu, '');
  t = [...t].filter(c => /\p{L}/u.test(c)).join('').toLowerCase();
  return t.replace(/ph/g, 'f').replace(/ch/g, 'k').replace(/ck/g, 'k').replace(/c/g, 'k')
    .replace(/w/g, 'v').replace(/u/g, 'v').replace(/j/g, 'i').replace(/y/g, 'i');
}

function stem(t: string): string {
  for (const e of ENDINGS) {
    if (t.endsWith(e) && t.length - e.length >= 3) return t.slice(0, -e.length);
  }
  return t;
}

const tokens = (text: string) => text.split(/\s+/).map(fold).filter(Boolean);

function nameTokens(text: string): string[] {
  if (text.includes(',')) return tokens(text.split(',', 1)[0]);
  return text.split(/\s+/)
    .filter(w => !SUFFIXES.has(w.replace(/[^\p{L}\p{N}_]/gu, '').toLowerCase()))
    .map(fold).filter(Boolean);
}

const surnamePart = (toks: string[], hadComma: boolean) => (hadComma || toks.length <= 1 ? toks : toks.slice(1));

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)));
    }
    prev = cur;
  }
  return prev[b.length];
}

function similar(x: string, y: string): boolean {
  const a = stem(x), b = stem(y);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  if (common >= PREFIX || (common === Math.min(a.length, b.length) && common >= 3)) return true;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length) >= RATIO;
}

/**
 * Kas kuju näib olevat TEINE nimi, mitte kirjaviisi variant? Ainult vihje —
 * otsustab toimetaja. Variant: kuju sisaldab kanoonilist perekonnanime või
 * tema perekonnanimi sarnaneb kanoonilise nime mõne mitte-eesnimelise sõnaga.
 */
export function looksLikeOtherName(alias: string, label: string): boolean {
  const a = surnamePart(nameTokens(alias || ''), (alias || '').includes(',')).filter(t => t.length >= 3);
  const lab = nameTokens(label || '');
  const b = surnamePart(lab, false).length ? surnamePart(lab, false) : lab;
  if (!a.length || !b.length) return false;
  if (a.some(x => similar(x, b[b.length - 1]))) return false;
  return !b.some(y => similar(a[a.length - 1], y));
}

export function possibleNameChange(name: { label?: string | null; aliases?: string[] | null; names?: unknown[] | null }): boolean {
  if (name.names?.length) return false;
  return (name.aliases ?? []).some(a => looksLikeOtherName(a, name.label ?? ''));
}

const key = (s: string) => s.normalize('NFC').trim().toLowerCase();

function yearOrNull(s: string): number | null {
  return /^\s*\d{3,4}\s*$/.test(s) ? parseInt(s, 10) : null;
}

/** Kaardilt vormi mustandiks. */
export function splitNames(names: PersonNameEntry[] | null | undefined): PersonNameDraft[] {
  return (names ?? []).map(n => ({
    label: n.label, type: n.type,
    from: n.from ? String(n.from) : '', to: n.to ? String(n.to) : '',
    source: n.source ?? '', notes: n.notes ?? '',
  }));
}

/** Mustandist kaardile: tühjad read välja, liigiga kuju aliastest välja. */
export function joinNames(aliases: string[], drafts: PersonNameDraft[]): { aliases: string[]; names: PersonNameEntry[] } {
  const names = drafts
    .filter(d => d.label.trim())
    .map(d => ({
      label: d.label.trim(), type: d.type,
      from: yearOrNull(d.from), to: yearOrNull(d.to),
      source: d.source.trim() || null, notes: d.notes.trim() || null,
    }));
  const typed = new Set(names.map(n => key(n.label)));
  return { aliases: aliases.filter(a => a.trim() && !typed.has(key(a))), names };
}

/** Otsinguvõrdluse kuju — serveri `fold_name`-i lihtsustus (diakriitikud, ß). */
function foldQuery(s: string): string {
  return s.replace(/ß/g, 'ss').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Serveri `name_matches`: alamstring VÕI iga päringusõna on mõne nimesõna algus. */
function queryMatches(query: string, name: string): boolean {
  const fq = foldQuery(query).trim();
  if (!fq) return false;
  const fn = foldQuery(name);
  if (fn.includes(fq)) return true;
  const qw = fq.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const nw = fn.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return qw.length > 0 && qw.every(q => nw.some(w => w.startsWith(q)));
}

/**
 * „ka: …” loendis ja valijas (ADR 0083 p 5): kui otsing tabas teist nime, mitte
 * kanoonilist, tagasta see nimi (liigiga nimi enne kirjaviisi varianti).
 * Väliste ID-de aliaste (`person_aliases.json`) tabamust klient ei näe — siis `null`.
 */
export function matchedOtherName(
  entry: { label: string; sort_name?: string | null; aliases?: string[] | null; names?: { label: string; type: string }[] | null },
  query: string | null | undefined,
): { label: string; type: string | null } | null {
  if (!query?.trim()) return null;
  if (queryMatches(query, entry.label) || (entry.sort_name && queryMatches(query, entry.sort_name))) return null;
  const typed = (entry.names ?? []).find(n => queryMatches(query, n.label));
  if (typed) return { label: typed.label, type: typed.type };
  const alias = (entry.aliases ?? []).find(a => queryMatches(query, a));
  return alias ? { label: alias, type: null } : null;
}

/** Isikulehe järjestus: aasta järgi (aastata lõpus), muidu sisestuse järjekord. */
export function sortNamesByTime<T extends { from?: number | null; to?: number | null }>(names: T[]): T[] {
  const at = (n: T) => n.from ?? n.to ?? Infinity;
  return names.map((n, i) => [n, i] as const).sort((a, b) => at(a[0]) - at(b[0]) || a[1] - b[1]).map(([n]) => n);
}

/** Ajavahemik: „1660–1680”, „alates 1660”, „kuni 1680” või tühi. */
export function formatNameSpan(from: number | null | undefined, to: number | null | undefined, words: { from: string; to: string }): string {
  if (from && to) return `${from}–${to}`;
  if (from) return `${words.from} ${from}`;
  if (to) return `${words.to} ${to}`;
  return '';
}
