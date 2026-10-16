// Lehe tähistuse parser (ADR 0070) — server/vutt_tags.py parse_page_marks-i peegel.
// Ühine fikstuur tests/fixtures/page_marks_cases.json valvab, et tõlgendus on sama.
import { PAGE_MARK_KINDS, type PageMarkKind } from './vuttTags';

export interface PageMarkPair {
  kind: PageMarkKind;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  /** ei sisalda <pb/>-d ega <m>-tägi ega ristu teise paariga */
  valid: boolean;
  /** ei ole ühegi teise paari sees */
  outer: boolean;
}

const TOKEN_RE = new RegExp(`<(/?)(${PAGE_MARK_KINDS.join('|')})>`, 'g');
const PB_RE = /<pb\s*\/>/;
// <m> või </m> paari sees: tähistus võib olla <m> sees, mitte vastupidi (ADR 0070).
const M_TAG_RE = /<\/?m>/;

export function parsePageMarks(text: string): { pairs: PageMarkPair[]; orphans: { from: number; to: number }[] } {
  const stacks = new Map<string, { from: number; to: number }[]>(PAGE_MARK_KINDS.map(k => [k, []]));
  const raw: { kind: PageMarkKind; of: number; ot: number; cf: number; ct: number }[] = [];
  const orphans: { from: number; to: number }[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const kind = m[2] as PageMarkKind;
    const stack = stacks.get(kind)!;
    const tok = { from: m.index, to: m.index + m[0].length };
    if (!m[1]) stack.push(tok);
    else if (stack.length) {
      const open = stack.pop()!;
      raw.push({ kind, of: open.from, ot: open.to, cf: tok.from, ct: tok.to });
    } else orphans.push(tok);
  }
  for (const s of stacks.values()) orphans.push(...s);
  orphans.sort((a, b) => a.from - b.from);
  raw.sort((a, b) => a.of - b.of);

  const pairs = raw.map((r, i) => {
    let contained = false;
    let crossing = false;
    raw.forEach((o, j) => {
      if (i === j) return;
      if (o.of < r.of && r.ct < o.ct) contained = true;
      else if ((o.of < r.of && r.of < o.ct && o.ct < r.ct) || (r.of < o.of && o.of < r.ct && r.ct < o.ct)) crossing = true;
    });
    const inner = text.slice(r.ot, r.cf);
    const hasPb = PB_RE.test(inner);
    const hasM = M_TAG_RE.test(inner);
    return { kind: r.kind, openFrom: r.of, openTo: r.ot, closeFrom: r.cf, closeTo: r.ct,
      valid: !hasPb && !hasM && !crossing, outer: !contained };
  });
  return { pairs, orphans };
}

/** Kehtivad välimised paarid. */
export function pageMarkSpans(text: string): PageMarkPair[] {
  return parsePageMarks(text).pairs.filter(p => p.valid && p.outer);
}
