// Lehe tähistuse sisestus (ADR 0070, spekk 2026-10-16 §3) — puhas funktsioon
// stringidel, et servajuhud oleks testitavad ilma redaktorita.
//
// Reeglid: tähistus ei haara kunagi valimata põhiteksti; olemasoleva tähistuse
// puudutamisel tegutsetakse terve paari peal; üle <pb/>-i, <m> piiri, peidetud
// marginaalia või annotatsiooni/viite piiri ei märgendata (keeldumine, tekst ei muutu).
import { parsePageMarks } from '../../markup/pageMarks';
import { VUTT_TAG_REGISTRY, type PageMarkKind } from '../../markup/vuttTags';
import { findMarginaliaBlocks } from '../../utils/marginaliaUtils';

export type PageMarkRefusal = 'multiple' | 'pageBreak' | 'marginalia' | 'tagBoundary';
export type PageMarkEditResult =
  | { ok: true; changes: { from: number; to: number; insert: string }[]; cursor?: number }
  | { ok: false; reason: PageMarkRefusal };

// Vormindustägid, mida tohib poolitada: inline, nummerdamata, mitte tähistus (i b cs hi add).
const FORMAT_TAGS = new Set(
  VUTT_TAG_REGISTRY.filter(t => t.marginaliaInline && !t.numbered && !t.pageMark).map(t => t.name),
);
const TOKEN_RE = /<(\/?)([a-z]+)(\d*)(\/?)>/g;

interface Token { from: number; to: number; name: string; close: boolean; self: boolean }
interface Pair { name: string; openFrom: number; openTo: number; closeFrom: number; closeTo: number }

function tokens(doc: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(doc)) !== null) {
    out.push({ from: m.index, to: m.index + m[0].length, name: m[2] + m[3], close: m[1] === '/', self: m[4] === '/' || m[2] === 'pb' });
  }
  return out;
}

function pairsOf(toks: Token[]): Pair[] {
  const stacks = new Map<string, Token[]>();
  const pairs: Pair[] = [];
  for (const t of toks) {
    if (t.self) continue;
    const s = stacks.get(t.name) ?? [];
    stacks.set(t.name, s);
    if (!t.close) s.push(t);
    else if (s.length) {
      const o = s.pop()!;
      pairs.push({ name: t.name, openFrom: o.from, openTo: o.to, closeFrom: t.from, closeTo: t.to });
    }
  }
  return pairs;
}

const isWs = (c: string) => c === ' ' || c === '\t';

export function pageMarkEdit(
  doc: string, selFrom: number, selTo: number, kind: PageMarkKind,
  hidden: { from: number; to: number }[],
): PageMarkEditResult {
  let from = Math.min(selFrom, selTo);
  let to = Math.max(selFrom, selTo);
  const caret = from === to ? from : -1;

  // 1. Sihtvahemik: valikuta kursori rida (avatud <m> sees ainult ploki sisu).
  if (caret >= 0) {
    from = doc.lastIndexOf('\n', caret - 1) + 1;
    const nl = doc.indexOf('\n', caret);
    to = nl === -1 ? doc.length : nl;
    const block = findMarginaliaBlocks(doc).find(b => caret >= b.contentFrom && caret <= b.contentTo);
    if (block) {
      from = Math.max(from, block.contentFrom);
      to = Math.min(to, block.contentTo);
    }
  }
  while (from < to && isWs(doc[from])) from++;
  while (to > from && isWs(doc[to - 1])) to--;

  // Peidetud (suletud) marginaalia: ka seal olevat tähistust ei vahetata ega
  // eemaldata — kaitsefilter lõikaks muudatusest poole välja ja paar ristuks.
  if (hidden.some(h => (h.from < to && h.to > from) || (caret >= 0 && h.from <= caret && caret <= h.to))) {
    return { ok: false, reason: 'marginalia' };
  }

  // 2. Olemasolev tähistus: puudutamine → terve paar.
  const touched = parsePageMarks(doc).pairs.filter(p =>
    caret >= 0 ? (p.openFrom <= caret && caret <= p.closeTo) || (p.openFrom < to && p.closeTo > from)
      : p.openFrom < to && p.closeTo > from);
  const outerTouched = touched.filter(p => !touched.some(o => o !== p && o.openFrom < p.openFrom && p.closeTo < o.closeTo));
  if (outerTouched.length > 1) return { ok: false, reason: 'multiple' };
  if (outerTouched.length === 1) {
    const p = outerTouched[0];
    if (p.kind === kind) {
      return { ok: true, changes: [{ from: p.openFrom, to: p.openTo, insert: '' }, { from: p.closeFrom, to: p.closeTo, insert: '' }] };
    }
    return { ok: true, changes: [
      { from: p.openFrom, to: p.openTo, insert: `<${kind}>` },
      { from: p.closeFrom, to: p.closeTo, insert: `</${kind}>` },
    ] };
  }

  // 3. Tühi vahemik (tühi rida): tühi paar, kursor sisse.
  if (from >= to) {
    const at = caret >= 0 ? caret : from;
    return { ok: true, changes: [{ from: at, to: at, insert: `<${kind}></${kind}>` }], cursor: at + kind.length + 2 };
  }

  // 4. Serv vormindustägi kõrval: valik, mis algab kohe sulgeva tägi ees või lõpeb
  // kohe avava järel, ei haara seda tägi (muidu ristuks tähistus vormindusega).
  const toks = tokens(doc);
  for (let moved = true; moved;) {
    moved = false;
    const c = toks.find(t => t.close && t.from === from && t.to <= to && FORMAT_TAGS.has(t.name));
    if (c) { from = c.to; moved = true; }
    const o = toks.find(t => !t.close && !t.self && t.to === to && t.from >= from && FORMAT_TAGS.has(t.name));
    if (o) { to = o.from; moved = true; }
  }
  if (from >= to) return { ok: false, reason: 'tagBoundary' };

  // Keeldumised lõpliku vahemiku kohta.
  if (toks.some(t => (t.from < from && from < t.to) || (t.from < to && to < t.to))) return { ok: false, reason: 'tagBoundary' };
  const inside = toks.filter(t => t.from >= from && t.to <= to);
  if (inside.some(t => t.name === 'pb')) return { ok: false, reason: 'pageBreak' };
  if (inside.some(t => t.name === 'm')) return { ok: false, reason: 'marginalia' };

  // 5. Vormindus: ristuvad paarid poolitatakse piiril; muu ristuv paar → keeldu.
  // Paar, mis sisaldab kogu vahemiku või on tervikuna selle sees, ei ristu.
  const crossFrom: Pair[] = [];
  const crossTo: Pair[] = [];
  for (const p of pairsOf(toks)) {
    const atFrom = p.openTo <= from && from < p.closeFrom && p.closeTo <= to;
    const atTo = from <= p.openFrom && p.openTo <= to && to < p.closeFrom;
    if (!atFrom && !atTo) continue;
    if (!FORMAT_TAGS.has(p.name)) return { ok: false, reason: 'tagBoundary' };
    (atFrom ? crossFrom : crossTo).push(p);
  }
  crossFrom.sort((a, b) => a.openFrom - b.openFrom);
  crossTo.sort((a, b) => a.openFrom - b.openFrom);
  const closes = (ps: Pair[]) => [...ps].reverse().map(p => `</${p.name}>`).join('');
  const opens = (ps: Pair[]) => ps.map(p => `<${p.name}>`).join('');
  const a = closes(crossFrom) + `<${kind}>` + opens(crossFrom);
  const b = closes(crossTo) + `</${kind}>` + opens(crossTo);
  return { ok: true, changes: [{ from, to: from, insert: a }, { from: to, to, insert: b }] };
}
