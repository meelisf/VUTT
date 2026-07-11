# Joonealuste märkuste esitus — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Joonealused märkused: redigeeritav marker `<fn>N</fn>` jooksvas tekstis + `[^N]:` kehad lehekülje all (lehekülje-skoobis `<pb/>` järgi), loomine valikust/kursorilt, klikk-navigeerimine, mismatch-hoiatused.

**Architecture:** Kogu parsimis-/positsiooniloogika puhastes funktsioonides `src/utils/footnoteUtils.ts` (unit-testitav, CM6-vaba). `src/components/editor/FootnoteExtension.ts` on õhuke CM6-kiht: kutsub util'it ja ehitab dekoratsioonid + dispatch'ib muudatused. `<fn>` marker renderdatakse `VuttMarkupExtension`-is mark-põhiselt (redigeeritav superscript). Mirrordab `MarginaliaExtension` mustreid.

**Tech Stack:** TypeScript, React 19, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`), Vitest (node env), Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-14-footnote-display-design.md`

**Testikäsk (alati):** `npx vitest run <failitee>` (node-keskkond, globals).

---

## File Structure

| Fail | Vastutus |
|---|---|
| `src/utils/footnoteUtils.ts` (uus) | `FN_TOKEN_SOURCE` + regexid; tüübid; `segmentByPageBreak`, `parseFootnotes`, `footnoteMismatches`, `createFootnoteFromSelection`, `createFootnoteFromCursor`. Puhas loogika. |
| `src/utils/__tests__/footnoteUtils.test.ts` (uus) | Util'i unit-testid. |
| `src/components/editor/VuttMarkupExtension.ts` | `<fn>` widget → mark (`vutt-fn`); `FootnoteWidget` eemaldatud. |
| `src/components/editor/VuttTheme.ts` | `.vutt-fn` superscript-stiil. |
| `src/components/editor/FootnoteExtension.ts` (uus) | CM6: keha-dekoratsioonid, mismatch, klikk-navigeerimine, loomis-käsud. |
| `src/components/editor/__tests__/FootnoteExtension.test.ts` (uus) | EditorState-põhised testid. |
| `src/utils/renderVuttMarkup.ts` | `<fn>` token-regex laiendus + `[^N]:` keha-sektsiooni renderdus. |
| `src/utils/__tests__/renderVuttMarkup.test.ts` | Lisatestid `<fn>` sümbol-token + keha. |
| `src/index.css` | Keha-sektsiooni + mismatch + separator stiilid. |
| `src/components/TextEditor.tsx` | Tööriistariba „joonealune" nupp → loomis-käsk. |

---

## Task 1: footnoteUtils — regexid, tüübid, segmentByPageBreak

**Files:**
- Create: `src/utils/footnoteUtils.ts`
- Test: `src/utils/__tests__/footnoteUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/__tests__/footnoteUtils.test.ts
import { describe, it, expect } from 'vitest';
import {
  FN_TOKEN_RE, FN_MARKER_RE, FN_BODY_START_RE, segmentByPageBreak,
} from '../footnoteUtils';

describe('FN regexid', () => {
  it('FN_TOKEN_RE: number/täht/sümbol/(a)/†; mitte tühik/]/</>/:', () => {
    for (const ok of ['1', 'a', '*', '†', '(a)', '12b']) expect(FN_TOKEN_RE.test(ok)).toBe(true);
    for (const bad of ['a b', 'a]b', 'a<b', 'a>b', 'a:b', '']) expect(FN_TOKEN_RE.test(bad)).toBe(false);
  });
  it('FN_MARKER_RE leiab markerid (global)', () => {
    const out = [...'x<fn>1</fn>y<fn>*</fn>'.matchAll(FN_MARKER_RE)].map(m => m[1]);
    expect(out).toEqual(['1', '*']);
  });
  it('FN_BODY_START_RE matchib ainult rea alguses ja annab tokeni', () => {
    expect(FN_BODY_START_RE.exec('[^a]: tekst')?.[1]).toBe('a');
    expect(FN_BODY_START_RE.exec(' [^a]: tekst')).toBeNull(); // mitte rea alguses
  });
});

describe('segmentByPageBreak', () => {
  it('0 <pb/> → 1 segment', () => {
    expect(segmentByPageBreak('abc')).toEqual([{ from: 0, to: 3 }]);
  });
  it('mitu <pb/> → segmendid pb ette', () => {
    const doc = 'a<pb/>bb<pb/>ccc';
    expect(segmentByPageBreak(doc)).toEqual([
      { from: 0, to: 1 },   // 'a'
      { from: 7, to: 9 },   // 'bb' (1 + '<pb/>'(6) = 7)
      { from: 15, to: 15 }, // 'ccc' (9 + 6 = 15)
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: FAIL — `footnoteUtils` ei eksisteeri.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/footnoteUtils.ts
// Joonealuste märkuste puhas loogika (CM6-vaba, unit-testitav).
// Vt spec: docs/superpowers/specs/2026-06-14-footnote-display-design.md

// --- Keskne token-allikas + komponeeritud ankurdatud regexid ---
export const FN_TOKEN_SOURCE = String.raw`[^\[\]\s<>:]+`;
export const FN_TOKEN_RE = new RegExp(`^${FN_TOKEN_SOURCE}$`, 'u');
export const FN_MARKER_RE = new RegExp(`<fn>(${FN_TOKEN_SOURCE})</fn>`, 'gu');
export const FN_BODY_START_RE = new RegExp(String.raw`^\[\^(${FN_TOKEN_SOURCE})\]:`, 'u');

const PB_RE = /<pb\/>/g;

export interface FnSegmentRange { from: number; to: number; }

// Jaga dokument <pb/>-de järgi segmentideks (sisu pb ETTE; pb ise segmentide vahel).
export function segmentByPageBreak(doc: string): FnSegmentRange[] {
  const segs: FnSegmentRange[] = [];
  let start = 0;
  for (const m of doc.matchAll(PB_RE)) {
    segs.push({ from: start, to: m.index! });
    start = m.index! + m[0].length;
  }
  segs.push({ from: start, to: doc.length });
  return segs;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: PASS (5 testi).

- [ ] **Step 5: Commit**

```bash
git add src/utils/footnoteUtils.ts src/utils/__tests__/footnoteUtils.test.ts
git commit -m "feat(footnotes): FN regexid + segmentByPageBreak"
```

---

## Task 2: footnoteUtils — parseFootnotes (markerid + kehad + tsoon)

**Files:**
- Modify: `src/utils/footnoteUtils.ts`
- Test: `src/utils/__tests__/footnoteUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lisa importi: parseFootnotes
import { parseFootnotes } from '../footnoteUtils';

describe('parseFootnotes', () => {
  it('markerid + ühe-rea keha samas segmendis', () => {
    const doc = 'tekst <fn>1</fn> jutt\n[^1]: märkus';
    const { segments } = parseFootnotes(doc);
    expect(segments).toHaveLength(1);
    const s = segments[0];
    expect(s.markers.map(m => m.token)).toEqual(['1']);
    expect(s.bodies.map(b => b.token)).toEqual(['1']);
    expect(doc.slice(s.bodies[0].contentFrom, s.bodies[0].to).trim()).toBe('märkus');
    expect(doc.slice(s.markers[0].tokenFrom, s.markers[0].tokenTo)).toBe('1');
  });

  it('mitmerealine keha ulatub kuni järgmise [^M]:/doc lõpuni', () => {
    const doc = '[^1]: rida üks\nrida kaks\n[^2]: teine';
    const s = parseFootnotes(doc).segments[0];
    expect(s.bodies).toHaveLength(2);
    expect(doc.slice(s.bodies[0].from, s.bodies[0].to)).toBe('[^1]: rida üks\nrida kaks\n');
    expect(doc.slice(s.bodies[1].from, s.bodies[1].to)).toBe('[^2]: teine');
  });

  it('lehekülje-skoop: sama [^a] eri segmentides eraldi', () => {
    const doc = '<fn>a</fn>\n[^a]: lk1<pb/>\n<fn>a</fn>\n[^a]: lk2';
    const { segments } = parseFootnotes(doc);
    expect(segments).toHaveLength(2);
    expect(segments[0].bodies[0].token).toBe('a');
    expect(segments[1].bodies[0].token).toBe('a');
    expect(segments[0].bodies[0].from).not.toBe(segments[1].bodies[0].from);
  });

  it('keha lõpp <pb/>-i juures', () => {
    const doc = '[^1]: enne pb\n<pb/>peatekst';
    const s = parseFootnotes(doc).segments[0];
    expect(doc.slice(s.bodies[0].from, s.bodies[0].to)).toBe('[^1]: enne pb\n');
  });

  it('tühi rida ENNE esimest [^N]: jääb peatekstiks; tühi rida tsoonis = jätk', () => {
    const doc = 'peatekst\n\n[^1]: a\n\ncont';
    const s = parseFootnotes(doc).segments[0];
    expect(s.zoneFrom).toBe(doc.indexOf('[^1]:'));
    expect(doc.slice(s.bodies[0].from, s.bodies[0].to)).toBe('[^1]: a\n\ncont');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: FAIL — `parseFootnotes` puudub.

- [ ] **Step 3: Write minimal implementation**

```ts
// lisa footnoteUtils.ts lõppu

export interface FnMarker {
  token: string;
  from: number;       // '<fn>' algus
  to: number;         // pärast '</fn>'
  tokenFrom: number;  // tokeni algus (pärast '<fn>')
  tokenTo: number;    // tokeni lõpp (enne '</fn>')
}

export interface FnBody {
  token: string;
  from: number;        // '[^' algus (rea algus)
  to: number;          // keha lõpp (järgmise keha algus / segmendi lõpp), exclusive
  tokenFrom: number;   // tokeni algus (pärast '[^')
  tokenTo: number;     // tokeni lõpp (enne ']:')
  contentFrom: number; // pärast ']:'
}

export interface FnSegment extends FnSegmentRange {
  markers: FnMarker[];
  bodies: FnBody[];
  zoneFrom: number | null;
}

export interface ParsedFootnotes { segments: FnSegment[]; }

// Reaalguste absoluutpositsioonid vahemikus [from, to).
function lineStartsInRange(doc: string, from: number, to: number): number[] {
  const starts: number[] = [];
  if (from === 0 || doc[from - 1] === '\n') starts.push(from);
  let nl = doc.indexOf('\n', from);
  while (nl !== -1 && nl + 1 < to) {
    starts.push(nl + 1);
    nl = doc.indexOf('\n', nl + 1);
  }
  return starts;
}

function findMarkers(doc: string, from: number, to: number): FnMarker[] {
  const out: FnMarker[] = [];
  const slice = doc.slice(from, to);
  for (const m of slice.matchAll(FN_MARKER_RE)) {
    const mFrom = from + m.index!;
    const tokenFrom = mFrom + 4; // '<fn>'.length
    out.push({ token: m[1], from: mFrom, to: mFrom + m[0].length, tokenFrom, tokenTo: tokenFrom + m[1].length });
  }
  return out;
}

function findBodies(doc: string, from: number, to: number): { bodies: FnBody[]; zoneFrom: number | null } {
  const bodyStarts: { lineStart: number; token: string; prefixLen: number }[] = [];
  for (const ls of lineStartsInRange(doc, from, to)) {
    let le = doc.indexOf('\n', ls);
    if (le === -1 || le > to) le = to;
    const m = FN_BODY_START_RE.exec(doc.slice(ls, le));
    if (m) bodyStarts.push({ lineStart: ls, token: m[1], prefixLen: m[0].length });
  }
  if (bodyStarts.length === 0) return { bodies: [], zoneFrom: null };
  const bodies: FnBody[] = bodyStarts.map((bs, i) => {
    const tokenFrom = bs.lineStart + 2; // '[^'.length
    return {
      token: bs.token,
      from: bs.lineStart,
      to: i + 1 < bodyStarts.length ? bodyStarts[i + 1].lineStart : to,
      tokenFrom,
      tokenTo: tokenFrom + bs.token.length,
      contentFrom: bs.lineStart + bs.prefixLen,
    };
  });
  return { bodies, zoneFrom: bodyStarts[0].lineStart };
}

export function parseFootnotes(doc: string): ParsedFootnotes {
  const segments = segmentByPageBreak(doc).map(seg => {
    const { bodies, zoneFrom } = findBodies(doc, seg.from, seg.to);
    return { ...seg, markers: findMarkers(doc, seg.from, seg.to), bodies, zoneFrom };
  });
  return { segments };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/footnoteUtils.ts src/utils/__tests__/footnoteUtils.test.ts
git commit -m "feat(footnotes): parseFootnotes (markerid + kehad + tsoon)"
```

---

## Task 3: footnoteUtils — footnoteMismatches

**Files:**
- Modify: `src/utils/footnoteUtils.ts`
- Test: `src/utils/__tests__/footnoteUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { footnoteMismatches } from '../footnoteUtils';

describe('footnoteMismatches', () => {
  it('marker ilma kehata + keha ilma markerita', () => {
    const s = parseFootnotes('<fn>1</fn>\n[^2]: x').segments[0];
    const mm = footnoteMismatches(s);
    expect(mm.unmatchedMarkers.map(m => m.token)).toEqual(['1']);
    expect(mm.unmatchedBodies.map(b => b.token)).toEqual(['2']);
  });
  it('duplikaat-marker ja duplikaat-keha samas segmendis', () => {
    const s = parseFootnotes('<fn>1</fn><fn>1</fn>\n[^1]: a\n[^1]: b').segments[0];
    const mm = footnoteMismatches(s);
    expect(mm.duplicateMarkers).toHaveLength(2);
    expect(mm.duplicateBodies).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: FAIL — `footnoteMismatches` puudub.

- [ ] **Step 3: Write minimal implementation**

```ts
// lisa footnoteUtils.ts lõppu
export interface FnMismatches {
  unmatchedMarkers: FnMarker[];
  unmatchedBodies: FnBody[];
  duplicateMarkers: FnMarker[];
  duplicateBodies: FnBody[];
}

function tokenCounts(tokens: string[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const t of tokens) c.set(t, (c.get(t) ?? 0) + 1);
  return c;
}

export function footnoteMismatches(seg: FnSegment): FnMismatches {
  const markerTokens = new Set(seg.markers.map(m => m.token));
  const bodyTokens = new Set(seg.bodies.map(b => b.token));
  const mCount = tokenCounts(seg.markers.map(m => m.token));
  const bCount = tokenCounts(seg.bodies.map(b => b.token));
  return {
    unmatchedMarkers: seg.markers.filter(m => !bodyTokens.has(m.token)),
    unmatchedBodies: seg.bodies.filter(b => !markerTokens.has(b.token)),
    duplicateMarkers: seg.markers.filter(m => (mCount.get(m.token) ?? 0) > 1),
    duplicateBodies: seg.bodies.filter(b => (bCount.get(b.token) ?? 0) > 1),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/footnoteUtils.ts src/utils/__tests__/footnoteUtils.test.ts
git commit -m "feat(footnotes): footnoteMismatches (unmatched/duplicate)"
```

---

## Task 4: footnoteUtils — abifunktsioonid (segmentAt, token-valik, body-insert)

**Files:**
- Modify: `src/utils/footnoteUtils.ts`
- Test: `src/utils/__tests__/footnoteUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { segmentAt, smallestFreeIntToken, firstUnreferencedBodyToken } from '../footnoteUtils';

describe('abifunktsioonid', () => {
  it('segmentAt leiab positsiooni segmendi', () => {
    const p = parseFootnotes('a<pb/>bb');
    expect(segmentAt(p, 0)?.from).toBe(0);
    expect(segmentAt(p, 7)?.from).toBe(7);
  });
  it('smallestFreeIntToken väldib olemasolevaid', () => {
    const s = parseFootnotes('<fn>1</fn>\n[^2]: x').segments[0];
    expect(smallestFreeIntToken(s)).toBe('3');
  });
  it('firstUnreferencedBodyToken = esimene markerita keha dok-järjekorras', () => {
    const s = parseFootnotes('<fn>1</fn>\n[^1]: a\n[^2]: b\n[^3]: c').segments[0];
    expect(firstUnreferencedBodyToken(s)).toBe('2');
  });
  it('firstUnreferencedBodyToken null kui kõik seotud', () => {
    const s = parseFootnotes('<fn>1</fn>\n[^1]: a').segments[0];
    expect(firstUnreferencedBodyToken(s)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: FAIL — funktsioonid puuduvad.

- [ ] **Step 3: Write minimal implementation**

```ts
// lisa footnoteUtils.ts lõppu
export function segmentAt(parsed: ParsedFootnotes, pos: number): FnSegment | null {
  return parsed.segments.find(s => pos >= s.from && pos <= s.to) ?? null;
}

export function smallestFreeIntToken(seg: FnSegment): string {
  const used = new Set([...seg.markers.map(m => m.token), ...seg.bodies.map(b => b.token)]);
  let n = 1;
  while (used.has(String(n))) n++;
  return String(n);
}

export function firstUnreferencedBodyToken(seg: FnSegment): string | null {
  const markerTokens = new Set(seg.markers.map(m => m.token));
  const unref = seg.bodies.find(b => !markerTokens.has(b.token));
  return unref ? unref.token : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/footnoteUtils.ts src/utils/__tests__/footnoteUtils.test.ts
git commit -m "feat(footnotes): segmentAt + token-valiku abifunktsioonid"
```

---

## Task 5: footnoteUtils — createFootnoteFromSelection

**Files:**
- Modify: `src/utils/footnoteUtils.ts`
- Test: `src/utils/__tests__/footnoteUtils.test.ts`

**Selgitus:** Asenda valik markeriga; lisa valitud tekst keha-na segmendi lõppu (`<pb/>` ette), reavahetuse-normaliseerimisega. Valik üle `<pb/>` → `null`.

- [ ] **Step 1: Write the failing test**

```ts
import { createFootnoteFromSelection } from '../footnoteUtils';

// Abimees: rakenda changes järjest (kahanevas from-järjekorras, et offsetid ei nihku)
function applyChanges(doc: string, changes: { from: number; to: number; insert: string }[]): string {
  let out = doc;
  for (const c of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  }
  return out;
}

describe('createFootnoteFromSelection', () => {
  it('marker valiku kohale + keha lehe lõppu', () => {
    const doc = 'enne SISU pärast\n<pb/>';
    const from = doc.indexOf('SISU');
    const to = from + 'SISU'.length;
    const res = createFootnoteFromSelection(doc, from, to)!;
    const out = applyChanges(doc, res.changes);
    expect(out).toBe('enne <fn>1</fn> pärast\n[^1]: SISU\n<pb/>');
  });

  it('mitmerealine valik säilitab reavahetused', () => {
    const doc = 'x SISU\nrida2 y';
    const from = doc.indexOf('SISU');
    const to = doc.indexOf(' y');
    const res = createFootnoteFromSelection(doc, from, to)!;
    const out = applyChanges(doc, res.changes);
    expect(out).toContain('[^1]: SISU\nrida2');
  });

  it('valik üle <pb/> → null', () => {
    const doc = 'a SISU<pb/> KAKS b';
    const from = doc.indexOf('SISU');
    const to = doc.indexOf(' b') + 2;
    expect(createFootnoteFromSelection(doc, from, to)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: FAIL — `createFootnoteFromSelection` puudub.

- [ ] **Step 3: Write minimal implementation**

```ts
// lisa footnoteUtils.ts lõppu
export interface FnChange { from: number; to: number; insert: string; }
export interface FnCreateResult { changes: FnChange[]; selection: { anchor: number }; }

// Lisab keha rea segmendi lõppu (pb ette) reavahetuse-normaliseerimisega.
function bodyInsert(doc: string, insertPos: number, token: string, body: string): { insert: string; contentOffset: number } {
  const needLead = insertPos > 0 && doc[insertPos - 1] !== '\n';
  const needTrail = insertPos < doc.length && doc[insertPos] !== '\n';
  const prefix = `[^${token}]: `;
  const insert = (needLead ? '\n' : '') + prefix + body + (needTrail ? '\n' : '');
  return { insert, contentOffset: (needLead ? 1 : 0) + prefix.length };
}

export function createFootnoteFromSelection(doc: string, from: number, to: number): FnCreateResult | null {
  if (to <= from) return null;
  const parsed = parseFootnotes(doc);
  const seg = segmentAt(parsed, from);
  if (!seg || to > seg.to) return null; // valik üle <pb/> või väljaspool
  const token = smallestFreeIntToken(seg);
  const marker = `<fn>${token}</fn>`;
  const bodyText = doc.slice(from, to);
  const { insert } = bodyInsert(doc, seg.to, token, bodyText);
  return {
    changes: [
      { from, to, insert: marker },
      { from: seg.to, to: seg.to, insert },
    ],
    selection: { anchor: from + marker.length },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/footnoteUtils.ts src/utils/__tests__/footnoteUtils.test.ts
git commit -m "feat(footnotes): createFootnoteFromSelection"
```

---

## Task 6: footnoteUtils — createFootnoteFromCursor (stub / link)

**Files:**
- Modify: `src/utils/footnoteUtils.ts`
- Test: `src/utils/__tests__/footnoteUtils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { createFootnoteFromCursor } from '../footnoteUtils';

describe('createFootnoteFromCursor', () => {
  it('loob markeri + tühja stubi, kursor stubi sisu kohal', () => {
    const doc = 'tekst|\n<pb/>'.replace('|', '');
    const pos = 'tekst'.length;
    const res = createFootnoteFromCursor(doc, pos)!;
    const out = applyChanges(doc, res.changes);
    expect(out).toBe('tekst<fn>1</fn>\n[^1]: \n<pb/>');
    expect(out.slice(res.selection.anchor)).toBe('\n<pb/>'); // kursor pärast '[^1]: '
  });

  it('markerita keha olemas → seo, stubi EI loo', () => {
    const doc = 'tekst\n[^1]: olemas';
    const res = createFootnoteFromCursor(doc, 5)!; // pärast 'tekst'
    expect(res.changes).toHaveLength(1);
    expect(res.changes[0].insert).toBe('<fn>1</fn>');
  });

  it('stub segmendis ilma lõpureavahetuseta normaliseerib', () => {
    const doc = 'rida<pb/>';
    const res = createFootnoteFromCursor(doc, 4)!; // pärast 'rida'
    const out = applyChanges(doc, res.changes);
    expect(out).toBe('rida<fn>1</fn>\n[^1]: \n<pb/>');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: FAIL — `createFootnoteFromCursor` puudub.

- [ ] **Step 3: Write minimal implementation**

```ts
// lisa footnoteUtils.ts lõppu
export function createFootnoteFromCursor(doc: string, pos: number): FnCreateResult | null {
  const parsed = parseFootnotes(doc);
  const seg = segmentAt(parsed, pos);
  if (!seg) return null;
  const unref = firstUnreferencedBodyToken(seg);
  if (unref !== null) {
    // Seo olemasoleva markerita kehaga — ainult marker, stubi ei loo
    const marker = `<fn>${unref}</fn>`;
    return { changes: [{ from: pos, to: pos, insert: marker }], selection: { anchor: pos + marker.length } };
  }
  const token = smallestFreeIntToken(seg);
  const marker = `<fn>${token}</fn>`;
  const { insert, contentOffset } = bodyInsert(doc, seg.to, token, '');
  // keha sisestatakse pos JÄREL → uutes koordinaatides nihkub markeri võrra
  const bodyPosNew = seg.to + marker.length;
  return {
    changes: [
      { from: pos, to: pos, insert: marker },
      { from: seg.to, to: seg.to, insert },
    ],
    selection: { anchor: bodyPosNew + contentOffset },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/footnoteUtils.ts src/utils/__tests__/footnoteUtils.test.ts
git commit -m "feat(footnotes): createFootnoteFromCursor (stub/link)"
```

---

## Task 7: VuttMarkupExtension — `<fn>` widget → mark (redigeeritav superscript)

**Files:**
- Modify: `src/components/editor/VuttMarkupExtension.ts`
- Modify: `src/components/editor/VuttTheme.ts`
- Test: olemasolev `src/components/editor/__tests__/` (kui on VuttMarkup test) — muidu visuaalne

**Selgitus:** `<fn>` ei ole enam replace-widget; tägid peidetakse + token-sisu mark `vutt-fn` (superscript). Sama mehhanism kui `<hi>`.

- [ ] **Step 1: Eemalda FootnoteWidget ja `useWidget`**

`src/components/editor/VuttMarkupExtension.ts` — kustuta `FootnoteWidget` klass (read ~25-36) ja muuda `VUTT_TAGS` kirje:

```ts
// VANA:
//   { tag: 'fn', useWidget: true },
// UUS:
  { tag: 'fn', cls: 'vutt-fn' },
```

`buildMarkup`-is on `<fn>` seni `tagDef.useWidget` haru (read ~168-180). Kuna `useWidget` enam pole, langeb `<fn>` automaatselt tavalise paaristägi-haru alla (avav täg `hiddenTagMark` + sisu mark `vutt-fn`). Eemalda surnud `useWidget` haru ja `FootnoteWidget` import/kasutus. Kontrolli, et `import { ... WidgetType }` jääb alles `PageBreakWidget` jaoks.

- [ ] **Step 2: Lisa `.vutt-fn` stiil**

`src/components/editor/VuttTheme.ts` — lisa `vuttTheme` objekti (nt `.vutt-hidden-tag` kõrvale):

```ts
  '.vutt-fn': {
    verticalAlign: 'super',
    fontSize: '0.7em',
    color: '#0284c7', // primary-600
    fontWeight: 'bold',
  },
```

- [ ] **Step 3: Typecheck + olemasolevad testid**

Run: `npm run typecheck && npx vitest run src/components/editor/__tests__/`
Expected: PASS (kui VuttMarkup-testid eksisteerivad ja viitavad `<fn>`-le, uuenda neid: `<fn>1</fn>` annab nüüd 2 hidden-tag marki + 1 `vutt-fn` sisumargi, mitte replace-widgetit).

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/VuttMarkupExtension.ts src/components/editor/VuttTheme.ts
git commit -m "refactor(footnotes): <fn> widget → mark (redigeeritav superscript)"
```

---

## Task 8: renderVuttMarkup — `<fn>` sümbol-token + `[^N]:` keha-renderdus

**Files:**
- Modify: `src/utils/renderVuttMarkup.ts`
- Test: `src/utils/__tests__/renderVuttMarkup.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lisa renderVuttMarkup.test.ts juurde
import { renderVuttMarkup } from '../renderVuttMarkup';

describe('footnotes renderVuttMarkup', () => {
  it('<fn> sümbol-token superscriptina', () => {
    expect(renderVuttMarkup('x<fn>*</fn>')).toContain('<sup');
    expect(renderVuttMarkup('x<fn>*</fn>')).toContain('*');
  });
  it('[^N]: rida → keha-label', () => {
    const html = renderVuttMarkup('[^1]: märkus');
    expect(html).toContain('footnote-def-number');
    expect(html).toContain('märkus');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/renderVuttMarkup.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`src/utils/renderVuttMarkup.ts` — muuda `<fn>` regex ja lisa `[^N]:` rida-renderdus. Asenda rida
```ts
.replace(/<fn>(\d+)<\/fn>/g, '<sup class="text-gray-400 text-[10px] ml-0.5">$1</sup>')
```
järgnevaga (token laiendatud `FN_TOKEN_SOURCE`-iga; kehad rida-haaval, segment-teadlik = ainult per-rida, ilma dok-ülese linkimiseta):
```ts
import { FN_TOKEN_SOURCE } from './footnoteUtils';
// ...
const FN_MARKER_HTML = new RegExp(`<fn>(${FN_TOKEN_SOURCE})</fn>`, 'gu');
// markeri asendus:
.replace(FN_MARKER_HTML, '<sup class="text-gray-400 text-[10px] ml-0.5">$1</sup>')
```
Lisaks keha-rea renderduseks (pärast olemasolevaid asendusi, enne tundmatute tägide eemaldust), töötle iga rida eraldi:
```ts
// [^N]: keha-read — per rida, ilma dok-ülese footnote-parserita (page-scope nõue)
html = html.split('\n').map(line => {
  const m = new RegExp(String.raw`^\[\^(${FN_TOKEN_SOURCE})\]:\s?(.*)$`, 'u').exec(line);
  if (!m) return line;
  return `<span class="footnote-def-number">${m[1]}.</span> ${m[2]}`;
}).join('\n');
```

**NB:** `[^N]:` töötlus peab toimuma TOORTEKSTIL enne HTML-escape'i mõjutamist; aseta see `renderVuttMarkup`-i alguses, pärast `&`-escape'i ja enne tägi-eemaldust. Vajadusel kohanda olemasoleva pipeline'i järjekorda nii, et `[^` ei satuks tundmatu-tägi-eemaldaja alla.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/renderVuttMarkup.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/renderVuttMarkup.ts src/utils/__tests__/renderVuttMarkup.test.ts
git commit -m "feat(footnotes): renderVuttMarkup sümbol-token + [^N]: keha"
```

---

## Task 9: FootnoteExtension — keha-dekoratsioonid (peit + redigeeritav token + tsoon)

**Files:**
- Create: `src/components/editor/FootnoteExtension.ts`
- Test: `src/components/editor/__tests__/FootnoteExtension.test.ts`

**Selgitus:** `StateField` ehitab dekoratsioonid `parseFootnotes` põhjal: peida `[^` ja `]:` (`vutt-hidden-tag`, atomic), token-range jääb mark'iks (`vutt-fn-body-label`, MITTE atomic → redigeeritav), tsooni read saavad `vutt-fn-body-line`, esimene `vutt-fn-zone-first`. Mirrordab `MarginaliaExtension` `buildDeco` mustrit (RangeSetBuilder, from ASC / to ASC, atomicRanges eraldi).

- [ ] **Step 1: Write the failing test**

```ts
// src/components/editor/__tests__/FootnoteExtension.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { footnoteExtension, footnoteDecoField } from '../FootnoteExtension';

function mk(doc: string) {
  return EditorState.create({ doc, extensions: [footnoteExtension()] });
}
function decoClasses(state: EditorState): string[] {
  const out: string[] = [];
  const it = state.field(footnoteDecoField).deco.iter();
  while (it.value) { out.push((it.value.spec as any).class ?? '(repl)'); it.next(); }
  return out;
}

describe('FootnoteExtension keha-dekoratsioonid', () => {
  it('keha-prefiks peidetud, token-range mark (mitte atomic)', () => {
    const state = mk('<fn>1</fn>\n[^1]: märkus');
    const classes = decoClasses(state);
    expect(classes).toContain('vutt-hidden-tag');     // [^ ja ]:
    expect(classes).toContain('vutt-fn-body-label');  // token
  });
  it('tsoon-read saavad line-klassi', () => {
    const state = mk('peatekst\n[^1]: a\ncont');
    expect(decoClasses(state)).toContain('vutt-fn-zone-first');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: FAIL — `FootnoteExtension` puudub.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/editor/FootnoteExtension.ts
// Joonealuste CM6-esitus (õhuke kiht — kogu loogika footnoteUtils-is).
import { Decoration, DecorationSet, EditorView } from '@codemirror/view';
import { RangeSetBuilder, StateField, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { parseFootnotes, footnoteMismatches } from '../../utils/footnoteUtils';

const atomicMark = Decoration.mark({});
const hiddenTag = Decoration.mark({ class: 'vutt-hidden-tag' });
const bodyLabel = Decoration.mark({ class: 'vutt-fn-body-label' });

interface DecoSets { deco: DecorationSet; atomic: DecorationSet; }

function buildDeco(state: EditorState): DecoSets {
  const doc = state.doc.toString();
  const { segments } = parseFootnotes(doc);
  type Item = { from: number; to: number; deco: Decoration; sort: number };
  const items: Item[] = [];
  const atomic: { from: number; to: number }[] = [];

  for (const seg of segments) {
    for (const b of seg.bodies) {
      // tsooni line-klassid
      const firstLine = state.doc.lineAt(b.from);
      const lastLine = state.doc.lineAt(Math.min(b.to - 1, doc.length));
      for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
        const line = state.doc.line(ln);
        const isZoneFirst = seg.zoneFrom !== null && line.from === state.doc.lineAt(seg.zoneFrom).from;
        const cls = 'vutt-fn-body-line' + (isZoneFirst ? ' vutt-fn-zone-first' : '');
        items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }), sort: -1 });
      }
      // peida '[^' ja ']:' (atomic), token jääb mark'iks (redigeeritav)
      items.push({ from: b.from, to: b.tokenFrom, deco: hiddenTag, sort: 0 });
      atomic.push({ from: b.from, to: b.tokenFrom });
      items.push({ from: b.tokenFrom, to: b.tokenTo, deco: bodyLabel, sort: 1 });
      items.push({ from: b.tokenTo, to: b.contentFrom, deco: hiddenTag, sort: 0 });
      atomic.push({ from: b.tokenTo, to: b.contentFrom });
    }
  }

  items.sort((a, c) => (a.from - c.from) || (a.deco.startSide - c.deco.startSide) || (a.to - c.to) || (a.sort - c.sort));
  const decoB = new RangeSetBuilder<Decoration>();
  for (const it of items) decoB.add(it.from, it.to, it.deco);

  atomic.sort((a, c) => (a.from - c.from) || (a.to - c.to));
  const atomicB = new RangeSetBuilder<Decoration>();
  for (const r of atomic) atomicB.add(r.from, r.to, atomicMark);

  return { deco: decoB.finish(), atomic: atomicB.finish() };
}

export const footnoteDecoField = StateField.define<DecoSets>({
  create: buildDeco,
  update(value, tr) { return tr.docChanged ? buildDeco(tr.state) : value; },
  provide: f => [
    EditorView.decorations.from(f, v => v.deco),
    EditorView.atomicRanges.from(f, v => () => v.atomic),
  ],
});

export function footnoteExtension(): Extension {
  return [footnoteDecoField];
}
```

**NB (line-dekoratsioonide järjekord):** `Decoration.line` peab olema reapiiril; `RangeSetBuilder` nõuab `from ASC`. `firstLine`/`lastLine` arvutus kasutab `b.to - 1`, sest `b.to` on järgmise keha algus (exclusive). Kontrolli, et tühi viimane segment (`b.to === doc.length`) ei viska `lineAt` erandit (`Math.min(..., doc.length)`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/FootnoteExtension.ts src/components/editor/__tests__/FootnoteExtension.test.ts
git commit -m "feat(footnotes): FootnoteExtension keha-dekoratsioonid"
```

---

## Task 10: FootnoteExtension — mismatch-dekoratsioonid

**Files:**
- Modify: `src/components/editor/FootnoteExtension.ts`
- Test: `src/components/editor/__tests__/FootnoteExtension.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('FootnoteExtension mismatch', () => {
  it('marker ilma kehata → vutt-fn-unmatched', () => {
    const state = mk('<fn>1</fn> tekst'); // keha puudub
    expect(decoClasses(state)).toContain('vutt-fn-unmatched');
  });
  it('duplikaat-token → vutt-fn-duplicate', () => {
    const state = mk('<fn>1</fn><fn>1</fn>\n[^1]: a\n[^1]: b');
    expect(decoClasses(state)).toContain('vutt-fn-duplicate');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`FootnoteExtension.ts` — lisa `buildDeco`-sse mismatch-margid. Lisa konstandid:
```ts
const unmatched = Decoration.mark({ class: 'vutt-fn-unmatched' });
const duplicate = Decoration.mark({ class: 'vutt-fn-duplicate' });
```
ja segmendi-tsüklisse (pärast bodies-tsüklit, enne sort'i):
```ts
    const mm = footnoteMismatches(seg);
    for (const m of mm.unmatchedMarkers) items.push({ from: m.tokenFrom, to: m.tokenTo, deco: unmatched, sort: 2 });
    for (const b of mm.unmatchedBodies) items.push({ from: b.tokenFrom, to: b.tokenTo, deco: unmatched, sort: 2 });
    for (const m of mm.duplicateMarkers) items.push({ from: m.tokenFrom, to: m.tokenTo, deco: duplicate, sort: 2 });
    for (const b of mm.duplicateBodies) items.push({ from: b.tokenFrom, to: b.tokenTo, deco: duplicate, sort: 2 });
```

**NB:** mismatch-margid kattuvad `vutt-fn` (VuttMarkup) ja `vutt-fn-body-label` markidega — see on lubatud (`mark`-dekoratsioonid VÕIVAD kattuda). Ära lisa neid atomic-vahemikesse.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/FootnoteExtension.ts src/components/editor/__tests__/FootnoteExtension.test.ts
git commit -m "feat(footnotes): mismatch-dekoratsioonid (unmatched/duplicate)"
```

---

## Task 11: FootnoteExtension — klikk-navigeerimine + loomis-käsud

**Files:**
- Modify: `src/components/editor/FootnoteExtension.ts`
- Test: `src/components/editor/__tests__/FootnoteExtension.test.ts`

**Selgitus:** Loomis-käsud `insertFootnote(view)` kutsuvad util'i `createFootnoteFrom{Selection,Cursor}` ja dispatch'ivad. Klikk-navigeerimine: `.vutt-fn` (marker) → keri segmendi esimesele `[^token]:` kehale; keha-label → keri markerile. Testitav osa: `insertFootnote` käsk.

- [ ] **Step 1: Write the failing test**

```ts
import { insertFootnoteChanges } from '../FootnoteExtension';

describe('insertFootnoteChanges (loomis-spec valik/kursor)', () => {
  it('valikuga → marker + keha', () => {
    const state = mk('enne SISU pärast\n<pb/>');
    const from = state.doc.toString().indexOf('SISU');
    const res = insertFootnoteChanges(state, from, from + 4)!;
    expect(res.changes.some(c => c.insert.startsWith('<fn>'))).toBe(true);
    expect(res.changes.some(c => c.insert.includes('[^1]:'))).toBe(true);
  });
  it('kursoriga (from===to) → marker + stub', () => {
    const state = mk('tekst\n<pb/>');
    const res = insertFootnoteChanges(state, 5, 5)!;
    expect(res.changes.some(c => c.insert === '<fn>1</fn>')).toBe(true);
  });
  it('valik üle <pb/> → null', () => {
    const state = mk('a SISU<pb/> b KAKS');
    const d = state.doc.toString();
    expect(insertFootnoteChanges(state, d.indexOf('SISU'), d.length)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`FootnoteExtension.ts` — lisa importi `createFootnoteFromSelection, createFootnoteFromCursor` (`EditorView` on juba Task 9-s imporditud `@codemirror/view`-st):
```ts
import { createFootnoteFromSelection, createFootnoteFromCursor } from '../../utils/footnoteUtils';
import type { FnCreateResult } from '../../utils/footnoteUtils';

// Puhas vahekiht: arvuta loomis-spec EditorState põhjal (testitav).
export function insertFootnoteChanges(state: EditorState, from: number, to: number): FnCreateResult | null {
  const doc = state.doc.toString();
  return from === to ? createFootnoteFromCursor(doc, from) : createFootnoteFromSelection(doc, from, to);
}

// Käsk tööriistaribale.
export function insertFootnote(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const res = insertFootnoteChanges(view.state, from, to);
  if (!res) return false;
  view.dispatch({ changes: res.changes, selection: res.selection, userEvent: 'input.footnote' });
  view.focus();
  return true;
}
```
Lisa klikk-navigeerimine (domEventHandlers) + lisa `footnoteExtension()` listi:
```ts
const footnoteClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement;
    // Marker → keha; keha-label → marker. Kasutame parseFootnotes positsioone.
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const { segments } = parseFootnotes(view.state.doc.toString());
    for (const seg of segments) {
      const marker = seg.markers.find(m => pos >= m.from && pos <= m.to);
      if (marker) {
        const body = seg.bodies.find(b => b.token === marker.token);
        if (body) { view.dispatch({ selection: { anchor: body.contentFrom }, scrollIntoView: true }); return true; }
      }
      const body = seg.bodies.find(b => pos >= b.tokenFrom && pos <= b.tokenTo);
      if (body) {
        const m = seg.markers.find(mk => mk.token === body.token);
        if (m) { view.dispatch({ selection: { anchor: m.to }, scrollIntoView: true }); return true; }
      }
    }
    return false;
  },
});

export function footnoteExtension(): Extension {
  return [footnoteDecoField, footnoteClick];
}
```
(Eemalda eelmise Task 9 `footnoteExtension` definitsioon — asenda selle uuega.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/FootnoteExtension.ts src/components/editor/__tests__/FootnoteExtension.test.ts
git commit -m "feat(footnotes): klikk-navigeerimine + insertFootnote käsk"
```

---

## Task 12: CSS — keha-sektsioon, token-label, separator, mismatch

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Lisa stiilid**

`src/index.css` — lisa (nt VuttMarkup/marginaalia stiilide kõrvale):

```css
/* --- Joonealused (FootnoteExtension) --- */
/* Keha-sektsiooni read: väiksem kiri */
.vutt-fn-body-line {
  font-size: 0.85em;
  color: #57534e; /* stone-600 */
}
/* Tsooni esimene rida: ülemine eraldusjoon */
.vutt-fn-zone-first {
  border-top: 1px solid #d6d3d1; /* stone-300 */
  margin-top: 4px;
  padding-top: 4px;
}
/* Redigeeritav keha-token-label + dekoratiivne punkt */
.vutt-fn-body-label {
  font-weight: bold;
  color: #0284c7; /* primary-600 */
}
.vutt-fn-body-label::after {
  content: '. ';
  font-weight: bold;
}
/* Mismatch-hoiatused (kerge) */
.vutt-fn-unmatched { text-decoration: underline dotted #dc2626; } /* red-600 */
.vutt-fn-duplicate { text-decoration: underline dotted #d97706; } /* amber-600 */
```

- [ ] **Step 2: Verify build**

Run: `npm run typecheck`
Expected: PASS (CSS ei mõjuta tsekki; kontrolli, et build ei katke).

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(footnotes): keha-sektsiooni + mismatch stiilid"
```

---

## Task 13: TextEditor — ühenda extension + tööriistariba nupp

**Files:**
- Modify: `src/components/TextEditor.tsx`

- [ ] **Step 1: Lisa extension editori seadistusse**

`src/components/TextEditor.tsx` — impordi ja lisa `extensions` massiivi (`vuttMarkupExtension` järele, ~rida 208):
```ts
import { footnoteExtension, insertFootnote } from './editor/FootnoteExtension';
// extensions: [...]
  vuttMarkupExtension,
  footnoteExtension(),
```

- [ ] **Step 2: Ühenda tööriistariba „joonealune" nupp**

Asenda olemasolev nupp (~rida 846):
```tsx
// VANA:
<button type="button" onClick={() => insertAtCursor('<fn>1</fn>')} ... ><Superscript size={14} /></button>
// UUS:
<button type="button" onClick={() => { const v = viewRef.current; if (v) insertFootnote(v); }} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-600" title={t('editor.tooltips.footnote')}><Superscript size={14} /></button>
```

- [ ] **Step 3: Typecheck + build**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Käivita kõik testid**

Run: `npx vitest run src/utils/__tests__/footnoteUtils.test.ts src/components/editor/__tests__/FootnoteExtension.test.ts src/utils/__tests__/renderVuttMarkup.test.ts`
Expected: PASS (kõik).

- [ ] **Step 5: Commit**

```bash
git add src/components/TextEditor.tsx
git commit -m "feat(footnotes): ühenda FootnoteExtension + tööriistariba nupp"
```

---

## Task 14: FootnoteExtension — CM6 hapra-koha testid (token redigeeritav, edit ei lõhu)

**Files:**
- Modify: `src/components/editor/__tests__/FootnoteExtension.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// lisa olemasolevatele importidele FootnoteExtension.test.ts ülaosas:
import { parseFootnotes, footnoteMismatches } from '../../../utils/footnoteUtils';

describe('CM6 hapra-koha kontroll', () => {
  it('token-range EI ole atomic (redigeeritav): tokeni keskele saab kursori', () => {
    const state = mk('[^12]: x');
    // atomic vahemikud katavad ainult [^ ja ]:, mitte tokenit '12'
    const atomic = state.field(footnoteDecoField).atomic;
    let coversToken = false;
    const tokenFrom = parseFootnotes(state.doc.toString()).segments[0].bodies[0].tokenFrom;
    atomic.between(tokenFrom, tokenFrom + 1, () => { coversToken = true; });
    expect(coversToken).toBe(false);
  });

  it('tokeni muutmine 1 → * ei lõhu parsimist', () => {
    let state = mk('<fn>1</fn>\n[^1]: x');
    // muuda markeri token '1' → '*'
    const tokenFrom = state.doc.toString().indexOf('<fn>1') + 4;
    state = state.update({ changes: { from: tokenFrom, to: tokenFrom + 1, insert: '*' } }).state;
    const seg = parseFootnotes(state.doc.toString()).segments[0];
    expect(seg.markers[0].token).toBe('*'); // marker token muutus
    // keha endiselt '1' → mismatch kuni keha muudetakse
    expect(footnoteMismatches(seg).unmatchedMarkers).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify behaviour**

Run: `npx vitest run src/components/editor/__tests__/FootnoteExtension.test.ts`
Expected: PASS. (Kui `footnoteField` pole eksponeeritud, kasuta `footnoteDecoField`/`parseFootnotes` nagu näites.)

- [ ] **Step 3: Commit**

```bash
git add src/components/editor/__tests__/FootnoteExtension.test.ts
git commit -m "test(footnotes): CM6 hapra-koha kontroll (token redigeeritav, edit ei lõhu)"
```

---

## Task 15: Lõplik verifitseerimine

- [ ] **Step 1: Kogu testikomplekt**

Run: `npx vitest run`
Expected: kõik PASS (sh olemasolevad marginaalia/VuttMarkup testid).

- [ ] **Step 2: Typecheck + build**

Run: `npm run typecheck && npm run build`
Expected: PASS, `dist/` valmib.

- [ ] **Step 3: Manuaalne kontroll (`npm run dev`, Firefox)**

Kontrolli:
- Selekteeri tekst → joonealuse nupp → marker + keha lehe lõpus.
- Kursoriga nupp → marker + tühi stub, kursor stubis.
- Token `1` → `*` muutmine markeris (otse trükkides) töötab; keha-token muutmine samaks → mismatch kaob.
- Klikk markeril → keha; klikk keha-numbril → marker.
- `<pb/>`-ga dokumendis: sama token eri lehtedel eraldi.
- Mismatch-alljoonimised ilmuvad.

- [ ] **Step 4: Lõpp-commit (kui vaja) + push**

```bash
git push
```
