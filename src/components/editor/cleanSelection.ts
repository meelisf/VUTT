import { VUTT_TAG_REGISTRY } from '../../markup/vuttTags';
import { CLEAN_SPLIT_TAGS } from '../../markup/consumers';
import type { CleanChangeSpec } from '../../utils/marginaliaUtils';

// „Puhasta" valiku peal: valitud tekst jääb märgenduseta, valikust väljapoole
// jääv tekst hoiab oma märgenduse. Varem eemaldati ainult valikusse jäänud
// tägi-tokenid — valik paari sees ei teinud midagi ja valik üle ühe tokeni
// jättis orvu, mille sanitiseerija koristas KOOS valikust väljapoole jäänud
// tekstiga (ADR 0077: fraktuurlehel eemaldatakse antiikvasõnadelt `<f>`).

interface Token { name: string; num: string; closing: boolean; self: boolean; from: number; to: number }
interface Pair { name: string; num: string; o1: number; o2: number; c1: number; c2: number }

const KNOWN = new Set(VUTT_TAG_REGISTRY.map(t => t.name));
const REMOVABLE = new Set(VUTT_TAG_REGISTRY.filter(t => t.cleanMarkup === 'remove').map(t => t.name));
const SPLIT = new Set(CLEAN_SPLIT_TAGS);

function tokenize(doc: string): Token[] {
  const out: Token[] = [];
  for (const m of doc.matchAll(/<(\/?)([a-z]+)(\d*)(\/?)>/g)) {
    if (!KNOWN.has(m[2])) continue;
    out.push({ name: m[2], num: m[3], closing: m[1] === '/', self: m[4] === '/', from: m.index, to: m.index + m[0].length });
  }
  return out;
}

// Paarid sama reegliga nagu redaktori parser (VuttMarkupExtension): sulgev
// täg seotakse viimase sama nimega avatud tägiga.
function matchPairs(tokens: Token[]): { pairs: Pair[]; loose: Token[] } {
  const stack: Token[] = [];
  const pairs: Pair[] = [];
  const loose: Token[] = [];
  for (const t of tokens) {
    if (t.self) { loose.push(t); continue; }
    if (!t.closing) { stack.push(t); continue; }
    let i = stack.length - 1;
    while (i >= 0 && !(stack[i].name === t.name && stack[i].num === t.num)) i--;
    if (i < 0) { loose.push(t); continue; }
    const o = stack.splice(i, 1)[0];
    pairs.push({ name: t.name, num: t.num, o1: o.from, o2: o.to, c1: t.from, c2: t.to });
  }
  return { pairs, loose: loose.concat(stack) };
}

const onlyBlank = (s: string) => s.replace(/<[^>]*>/g, '').trim() === '';

/**
 * Muudatused, mis eemaldavad valikult [from, to) märgenduse:
 * - stiilipaar (CLEAN_SPLIT_TAGS), mis ulatub valikust välja, poolitatakse —
 *   suletakse valiku ees ja avatakse pärast; ainult tühikuks jääv pool kaob;
 * - struktuuripaar (m, fn, lehe tähistus) eemaldub tervikuna, kui valik puudutab
 *   tema tägi; kui valik on ainult tema sees, jääb ta alles;
 * - annotatsiooni (cleanMarkup 'keep') ei puudutata. Kui ta on poolitatava
 *   paari sees ja lõikekohas avatud, liigub lõige tema ümber — ristuvat
 *   pesastust ei teki, ankru tekst jääb lihtsalt samuti puhtaks;
 * - peidetud marginaaliaplokke (`hidden`) ei puudutata.
 * Valiku servatühik jääb välja (nagu mähkimisel).
 *
 * `only` piirab eemaldatavad tägid nendega (lüliti lahtipakkimine, `<f>`/`<i>`
 * välistus); muud tägid jäävad alles.
 */
export function cleanSelectionChanges(
  doc: string,
  from: number,
  to: number,
  hidden: { from: number; to: number }[],
  only?: readonly string[],
): CleanChangeSpec[] {
  const removable = (name: string) => (only ? only.includes(name) : REMOVABLE.has(name));
  const splittable = (name: string) => SPLIT.has(name) && removable(name);
  let s = from;
  let e = to;
  while (s < e && /\s/.test(doc[s])) s++;
  while (e > s && /\s/.test(doc[e - 1])) e--;
  if (s >= e) return [];

  const tokens = tokenize(doc);
  // Valiku serv tägi sees → tägi servale.
  for (const t of tokens) {
    if (t.from < s && t.to > s) s = t.from;
    if (t.from < e && t.to > e) e = t.to;
  }

  const inHidden = (a: number, b: number) => hidden.some(h => a < h.to && b > h.from);
  const tokIn = (a: number, b: number) => a >= s && b <= e && !inHidden(a, b);
  const { pairs, loose } = matchPairs(tokens);

  const dels: [number, number][] = [];
  const ins: { pos: number; text: string; closing: boolean; key: number }[] = [];
  const splitPairs: Pair[] = [];
  const kept: Pair[] = [];

  for (const p of pairs) {
    const oIn = tokIn(p.o1, p.o2);
    const cIn = tokIn(p.c1, p.c2);
    const touchesHidden = inHidden(p.o1, p.o2) || inHidden(p.c1, p.c2);
    if (!removable(p.name) || touchesHidden) { kept.push(p); continue; }
    if (oIn && cIn) { dels.push([p.o1, p.o2], [p.c1, p.c2]); continue; }
    if (splittable(p.name)) {
      if (p.c2 <= s || p.o1 >= e) continue; // täiesti valikust väljas
      splitPairs.push(p);
      continue;
    }
    if (oIn || cIn) dels.push([p.o1, p.o2], [p.c1, p.c2]);
    else kept.push(p);
  }

  for (const p of splitPairs) {
    const oIn = tokIn(p.o1, p.o2);
    const cIn = tokIn(p.c1, p.c2);
    const open = `<${p.name}${p.num}>`;
    const close = `</${p.name}${p.num}>`;
    // Lõikekohad: säiliv täg, mis on p sees ja lõikekohas avatud, jääb lõike sisse.
    let sP = s;
    let eP = e;
    for (const k of kept) {
      if (k.o1 <= p.o2 || k.c2 > p.c1) continue; // ei ole p sees
      if (k.o1 < s && k.c2 > s) sP = Math.min(sP, k.o1);
      if (k.o1 < e && k.c2 > e) eP = Math.max(eP, k.c2);
    }
    if (oIn) dels.push([p.o1, p.o2]);
    else if (onlyBlank(doc.slice(p.o2, sP))) dels.push([p.o1, p.o2]);
    else ins.push({ pos: sP, text: close, closing: true, key: p.o1 });
    if (cIn) dels.push([p.c1, p.c2]);
    else if (onlyBlank(doc.slice(eP, p.c1))) dels.push([p.c1, p.c2]);
    else ins.push({ pos: eP, text: open, closing: false, key: p.o1 });
  }

  for (const t of loose) {
    if (removable(t.name) && tokIn(t.from, t.to)) dels.push([t.from, t.to]);
  }

  // Ühes kohas: sulgemised seest välja (hiliseim avaja enne), avamised väljast sisse.
  const byPos = new Map<number, typeof ins>();
  for (const i of ins) byPos.set(i.pos, [...(byPos.get(i.pos) ?? []), i]);
  const specs: CleanChangeSpec[] = [];
  for (const [pos, list] of byPos) {
    const closes = list.filter(i => i.closing).sort((a, b) => b.key - a.key);
    const opens = list.filter(i => !i.closing).sort((a, b) => a.key - b.key);
    specs.push({ from: pos, to: pos, insert: [...closes, ...opens].map(i => i.text).join('') });
  }
  const seen = new Set<number>();
  for (const [a, b] of dels) {
    if (seen.has(a)) continue;
    seen.add(a);
    specs.push({ from: a, to: b, insert: '' });
  }
  return specs.sort((x, y) => x.from - y.from || (x.to - x.from) - (y.to - y.from));
}
