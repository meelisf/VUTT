import type { TextAnnotation } from '../types';

/** Järgmine vaba annotatsioon-ID (max olemasolevast + 1, miinimum 1).
 *  MVP: eeldab ühe kasutaja korraga toimetamist. */
export function nextAnnId(annotations: TextAnnotation[]): number {
  if (annotations.length === 0) return 1;
  return Math.max(...annotations.map(a => a.id)) + 1;
}

/** Ekstrakib highlightitud teksti <annN>...</annN> tägide vahelt. Mitme tükiga
 *  ankru (üks tükk igal marginaaliareal, vt `annotationSegments`) tükid liidetakse. */
export function extractHighlightedText(text: string, id: number): string {
  const re = new RegExp(`<ann${id}>([\\s\\S]*?)<\\/ann${id}>`, 'g');
  return [...text.matchAll(re)].map(m => m[1]).join(' ');
}

/** Eemaldab <annN> ja </annN> tägid, jätab sisu alles. */
export function removeAnnTags(text: string, id: number): string {
  return text
    .replace(new RegExp(`<ann${id}>`, 'g'), '')
    .replace(new RegExp(`<\\/ann${id}>`, 'g'), '');
}

/** Kontrollib, kas tekstilõigus [from, to) esineb mõni ann-täg (avav või sulgev).
 *  Kasutatakse kattumisvältimisel enne uue annotatsiooni lisamist. */
export function containsAnnTag(text: string, from: number, to: number): boolean {
  const slice = text.slice(from, to);
  return /<\/?ann\d+>/.test(slice);
}

/** Leiab kõik ann-ID-d tekstis. Kasutatakse konsistentsikontrollis. */
export function findAnnIdsInText(text: string): number[] {
  const ids = new Set<number>();
  const re = /<ann(\d+)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    ids.add(parseInt(m[1], 10));
  }
  return Array.from(ids);
}

// Paaristäg (`<i>`, `</ann3>`); `<pb/>` ei ole paaris ja ei sobitu. Iga kord uus
// regex: globaalse regexi `lastIndex` kanduks `matchAll`-i kloonile üle.
const pairTags = (s: string) => s.matchAll(/<(\/?)([a-z]+\d*)>/g);

/** Kas `<name>` (positsioonil `at`) sulgub enne `to`-d? Sama nimega pesastus arvestatud. */
function closesBefore(doc: string, name: string, at: number, to: number): boolean {
  let depth = 0;
  for (const m of pairTags(doc.slice(at, to))) {
    if (m[2] !== name) continue;
    depth += m[1] ? -1 : 1;
    if (depth === 0) return true;
  }
  return false;
}

/** Kas `</name>` (lõpeb positsioonil `end`) avati pärast `from`-i? */
function openedAfter(doc: string, name: string, from: number, end: number): boolean {
  let depth = 0;
  const tags = [...pairTags(doc.slice(from, end))].filter(m => m[2] === name);
  for (let i = tags.length - 1; i >= 0; i--) {
    depth += tags[i][1] ? 1 : -1;
    if (depth === 0) return true;
  }
  return false;
}

/** Annoteeritav vahemik valikust: annotatsiooniankur ei tohi ristuda teiste
 *  tägidega ega jääda `<m>`-ist väljapoole (`<m>` on rea välimine täg, ADR 0003).
 *  Servadest kukuvad ära tühik/reavahetus, `<m>`/`</m>` ja paarita täg —
 *  `<m><i>x</i></m>\n` valik annab `<i>x</i>`, nii et `</annN>` jääb `</m>` ette.
 *  Kui ka siis jääb sisse paarita täg (nt valik üle kahe marginaaliaploki),
 *  tagastab `null`: sellist ankrut ei saa korrektselt panna. */
export function annotationRange(doc: string, from: number, to: number): { from: number; to: number } | null {
  let changed = true;
  while (changed && from < to) {
    changed = false;
    while (from < to && /\s/.test(doc[from])) { from++; changed = true; }
    while (to > from && /\s/.test(doc[to - 1])) { to--; changed = true; }

    const start = /^<(\/?)([a-z]+\d*)>/.exec(doc.slice(from, to));
    if (start && (start[1] || start[2] === 'm' || !closesBefore(doc, start[2], from, to))) {
      from += start[0].length;
      changed = true;
      continue;
    }
    const end = /<(\/?)([a-z]+\d*)>$/.exec(doc.slice(from, to));
    if (end && (!end[1] || end[2] === 'm' || !openedAfter(doc, end[2], from, to))) {
      to -= end[0].length;
      changed = true;
    }
  }
  if (from >= to) return null;

  // Sisemus peab olema tasakaalus: iga täg suletakse vahemiku sees õiges järjekorras.
  const stack: string[] = [];
  for (const m of pairTags(doc.slice(from, to))) {
    if (!m[1]) stack.push(m[2]);
    else if (stack.pop() !== m[2]) return null;
  }
  if (stack.length) return null;
  // Ainult tägidest koosnev lõik ei ole annoteeritav tekst.
  if (doc.slice(from, to).replace(/<[^>]*>/g, '').trim() === '') return null;
  return { from, to };
}

/** Annoteeritavad tükid valikust. Tavaliselt üks (`annotationRange`), aga
 *  `<m>`-ridu hõlmav mitmerealine valik jagatakse rea kaupa: iga `<m>`-rida saab
 *  oma tüki SAMA ID-ga, sest ankur ei tohi `<m>`-i ümbritseda (`<m>` on rea
 *  välimine täg, ADR 0003) ega üle ploki piiri ulatuda. Kirje jääb üheks.
 *  `null`, kui mõnda rida ei saa korrektselt ankurdada. */
export function annotationSegments(doc: string, from: number, to: number): { from: number; to: number }[] | null {
  const whole = annotationRange(doc, from, to);
  const slice = whole && doc.slice(whole.from, whole.to);
  if (whole && !(slice!.includes('\n') && slice!.includes('<m>'))) return [whole];

  const segments: { from: number; to: number }[] = [];
  for (let lineStart = doc.lastIndexOf('\n', from - 1) + 1; lineStart < to;) {
    const nl = doc.indexOf('\n', lineStart);
    const lineEnd = nl === -1 ? doc.length : nl;
    const a = Math.max(from, lineStart);
    const b = Math.min(to, lineEnd);
    if (doc.slice(a, b).replace(/<[^>]*>/g, '').trim() !== '') {
      const r = annotationRange(doc, a, b);
      if (!r) return null;
      segments.push(r);
    }
    lineStart = lineEnd + 1;
  }
  return segments.length ? segments : null;
}
