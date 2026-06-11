# Marginaalia visuaalse esituse implementatsiooniplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `<m>...</m>` ääremärkused renderduvad editoris visuaalselt marginaaliveerus (nagu originaali skännil), mobiilivaates plokk-kaardina, ja otsinguindeksis eraldi väljal, ilma et failiformaat muutuks.

**Architecture:** Uus CM6 laiendus (`MarginaliaExtension.ts`) peidab omaette ridadel seisvad `<m>`-plokid block-replace dekoratsioonidega ja renderdab sisu widget'itena vasakus veerus (column-mode) või väikese märgina (badge-mode); klikk avab ploki tagasi oma päris kohas redigeerimiseks. Jagatud parser/virnastamisloogika on puhastes funktsioonides `marginaliaUtils.ts`. Meilisearchi puhastus eraldab marginaalia `lehekylje_tekst`-ist uude `marginaalia_tekst` välja (mõlemas indekseerimisteesis).

**Tech Stack:** CodeMirror 6 (StateField, Decoration, ViewPlugin, transactionFilter), React 19, Tailwind, vitest, FastAPI/Python (Meilisearch ops), pytest.

**Spec:** `docs/superpowers/specs/2026-06-11-marginalia-display-design.md`

**Failide kaart:**

| Fail | Roll |
|---|---|
| `src/utils/marginaliaUtils.ts` (uus) | `findMarginaliaBlocks` (parser + ankrureegel) ja `stackMarginalia` (virnastamine) — puhtad, testitavad |
| `src/utils/__tests__/marginaliaUtils.test.ts` (uus) | Unit-testid |
| `src/components/editor/MarginaliaExtension.ts` (uus) | CM6 laiendus: olek, dekoratsioonid, klikid, Esc, kaitse, layout-plugin |
| `src/components/editor/__tests__/MarginaliaExtension.test.ts` (uus) | StateField/dekoratsioonide/kaitse testid (EditorState tasandil, DOM-i pole vaja) |
| `src/components/TextEditor.tsx` | Compartment, lüliti-kiip, kitsa paani automaatika, `insertMarginalia` nupp |
| `src/utils/renderVuttMarkup.ts` | `<m>` → plokk-kaart (mobiilivaade) |
| `src/index.css` | Veeru, märgi, avatud ploki raami, konnektori stiilid |
| `src/locales/{et,en}/workspace.json` | Lüliti/nupu tõlked |
| `server/meilisearch_ops.py` | `split_marginalia`, `marginaalia_tekst` väli |
| `scripts/1-1_consolidate_data.py` | Sama loogika seed-tees (HOIA SÜNKROONIS!) |
| `scripts/2-1_upload_to_meili.py` | `marginaalia_tekst` → searchableAttributes |
| `src/services/searchService.ts`, `src/types.ts`, `src/pages/search/SearchResults.tsx` | Otsing + snippet |
| `tests/test_meilisearch_ops.py`, `tests/test_consolidate_data.py` | pytest |

**Käsud:** vitest: `npx vitest run <fail>`; pytest: `.venv/bin/python -m pytest <fail> -v` (alati venv!); build: `npm run build`.

**Teadaolev CM6 risk (loe enne Task 4):** block-replace dekoratsiooni vahemik peab olema reapiiridel. Plaanis on vahemik `hideFrom` (ploki esimese rea algus) … `hideTo` (ploki viimase rea lõpu reavahetus, st järgmise rea algus). Kui CM viskab erandi piiride kohta (nt "block decorations must cover whole lines"), kasuta alternatiivi: vahemik `hideFrom - 1` (eelneva rea lõpu reavahetus) … `lineEnd` (viimase rea lõpp ilma reavahetuseta). Mõlemad katavad täpselt ühe reavahetuse, et tühja rida ei jääks. Verifitseeri käsitsi Task 9-s.

---

## Osa A — esituskiht (editor + mobiilivaade)

### Task 1: `findMarginaliaBlocks` parser

**Files:**
- Create: `src/utils/marginaliaUtils.ts`
- Test: `src/utils/__tests__/marginaliaUtils.test.ts`

- [ ] **Step 1: Kirjuta failing testid**

```ts
// src/utils/__tests__/marginaliaUtils.test.ts
import { describe, it, expect } from 'vitest';
import { findMarginaliaBlocks } from '../marginaliaUtils';

describe('findMarginaliaBlocks', () => {
  it('leiab omaette real seisva ploki ja ankurdab järgmise rea külge', () => {
    const text = 'rida üks\n<m>Apoc. 12.</m>\nrida kaks';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    const b = blocks[0];
    expect(text.slice(b.from, b.to)).toBe('<m>Apoc. 12.</m>');
    expect(text.slice(b.contentFrom, b.contentTo)).toBe('Apoc. 12.');
    // peidetav ala: ploki rida koos lõpu reavahetusega
    expect(text.slice(b.hideFrom, b.hideTo)).toBe('<m>Apoc. 12.</m>\n');
    // ankur: 'rida kaks' algus
    expect(b.anchorPos).toBe(text.indexOf('rida kaks'));
  });

  it('leiab mitmerealise ploki', () => {
    const text = 'a\n<m>Vide Pic⸗\nrium in</m>\nb';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    expect(text.slice(blocks[0].contentFrom, blocks[0].contentTo)).toBe('Vide Pic⸗\nrium in');
    expect(blocks[0].anchorPos).toBe(text.indexOf('b'));
  });

  it('jätab vahele rea keskel oleva <m> tägi', () => {
    const text = 'tekst <m>inline</m> jätkub';
    expect(findMarginaliaBlocks(text)).toHaveLength(0);
  });

  it('dokumendi lõpus olev plokk ankurdub eelmise rea külge', () => {
    const text = 'viimane rida\n<m>märkus</m>';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(1);
    // peidetav ala sisaldab EELNEVAT reavahetust (lõpus pole oma)
    expect(text.slice(blocks[0].hideFrom, blocks[0].hideTo)).toBe('\n<m>märkus</m>');
    expect(blocks[0].anchorPos).toBe(0); // 'viimane rida' algus
  });

  it('järjestikused plokid: ankur hüppab üle teise peidetud ploki', () => {
    const text = '<m>üks</m>\n<m>kaks</m>\ntekst';
    const blocks = findMarginaliaBlocks(text);
    expect(blocks).toHaveLength(2);
    const textPos = text.indexOf('tekst');
    expect(blocks[0].anchorPos).toBe(textPos);
    expect(blocks[1].anchorPos).toBe(textPos);
  });

  it('tühi tekst', () => {
    expect(findMarginaliaBlocks('')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Käivita ja veendu, et FAILib**

Run: `npx vitest run src/utils/__tests__/marginaliaUtils.test.ts`
Expected: FAIL — "Cannot find module '../marginaliaUtils'"

- [ ] **Step 3: Implementeeri**

```ts
// src/utils/marginaliaUtils.ts
// Marginaalia plokkide leidmine ja virnastamine — puhtad funktsioonid.
// Kasutavad: MarginaliaExtension (editor). Vt spec:
// docs/superpowers/specs/2026-06-11-marginalia-display-design.md

export interface MarginaliaBlock {
  /** '<m>' tägi algus */
  from: number;
  /** '</m>' tägi lõpp */
  to: number;
  /** Sisu vahemik tägide vahel */
  contentFrom: number;
  contentTo: number;
  /** Peidetav ala: ploki read koos ühe reavahetusega (lõpus või, dokumendi lõpus, ees) */
  hideFrom: number;
  hideTo: number;
  /** Ankrurea algus — rida, mille kõrval plokk veerus seisab */
  anchorPos: number;
}

const M_BLOCK_RE = /<m>([\s\S]*?)<\/m>/g;

/**
 * Leiab marginaalia plokid, mis seisavad omaette ridadel (rea alguses algav <m>,
 * rea lõpus lõppev </m>; servades lubatud ainult tühikud). Rea keskel olevad
 * <m> tägid jäetakse vahele — need renderduvad edasi tavalise inline-margina.
 * Ankrureegel: plokk kuulub JÄRGMISE rea juurde; dokumendi lõpus eelmise rea juurde.
 */
export function findMarginaliaBlocks(text: string): MarginaliaBlock[] {
  const blocks: MarginaliaBlock[] = [];
  M_BLOCK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = M_BLOCK_RE.exec(text)) !== null) {
    const from = m.index;
    const to = from + m[0].length;

    const lineStart = text.lastIndexOf('\n', from - 1) + 1;
    if (text.slice(lineStart, from).trim() !== '') continue;
    let lineEnd = text.indexOf('\n', to);
    if (lineEnd === -1) lineEnd = text.length;
    if (text.slice(to, lineEnd).trim() !== '') continue;

    let hideFrom = lineStart;
    let hideTo: number;
    let anchorPos: number;
    if (lineEnd < text.length) {
      hideTo = lineEnd + 1;            // koos lõpu reavahetusega
      anchorPos = lineEnd + 1;         // järgmise rea algus
    } else {
      // Dokumendi lõpus: võtame eelneva reavahetuse ja ankurdame eelmise rea külge
      hideFrom = lineStart > 0 ? lineStart - 1 : 0;
      hideTo = lineEnd;
      anchorPos = lineStart > 0 ? text.lastIndexOf('\n', lineStart - 2) + 1 : 0;
    }
    blocks.push({ from, to, contentFrom: from + 3, contentTo: to - 4, hideFrom, hideTo, anchorPos });
  }

  // Kui ankur satub teise peidetud ploki sisse (järjestikused plokid),
  // liigu edasi kuni esimese nähtava positsioonini.
  for (const b of blocks) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const other of blocks) {
        if (other !== b && b.anchorPos >= other.hideFrom && b.anchorPos < other.hideTo) {
          b.anchorPos = other.hideTo;
          moved = true;
        }
      }
    }
  }
  return blocks;
}
```

- [ ] **Step 4: Käivita testid, veendu et PASSivad**

Run: `npx vitest run src/utils/__tests__/marginaliaUtils.test.ts`
Expected: PASS (6 testi)

- [ ] **Step 5: Commit**

```bash
git add src/utils/marginaliaUtils.ts src/utils/__tests__/marginaliaUtils.test.ts
git commit -m "feat: marginaalia plokkide parser (findMarginaliaBlocks)"
```

---

### Task 2: `stackMarginalia` virnastamisalgoritm

**Files:**
- Modify: `src/utils/marginaliaUtils.ts`
- Test: `src/utils/__tests__/marginaliaUtils.test.ts`

- [ ] **Step 1: Lisa failing testid testifaili lõppu**

```ts
import { stackMarginalia } from '../marginaliaUtils';

describe('stackMarginalia', () => {
  it('kattumiseta plokid jäävad oma ankru kõrgusele', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 20 },
      { anchorTop: 100, height: 20 },
    ]);
    expect(out).toEqual([
      { top: 0, offset: 0 },
      { top: 100, offset: 0 },
    ]);
  });

  it('kattuv plokk nihkub eelmise alla (gap 6)', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 90 },
      { anchorTop: 50, height: 20 },
    ]);
    expect(out[1]).toEqual({ top: 96, offset: 46 });
  });

  it('mitu järjestikust konflikti kuhjuvad', () => {
    const out = stackMarginalia([
      { anchorTop: 0, height: 50 },
      { anchorTop: 10, height: 50 },
      { anchorTop: 20, height: 50 },
    ]);
    expect(out[1].top).toBe(56);
    expect(out[2].top).toBe(112);
  });

  it('tühi sisend', () => {
    expect(stackMarginalia([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Käivita, veendu et FAILib** (`stackMarginalia is not a function`)

- [ ] **Step 3: Implementeeri (lisa `marginaliaUtils.ts` lõppu)**

```ts
export interface StackInput {
  /** Ploki loomulik ülaserv (= ankrurea ülaserv), px */
  anchorTop: number;
  height: number;
}
export interface StackedPos {
  top: number;
  /** Nihe loomulikust kohast allapoole; > 0 → vaja konnektorit */
  offset: number;
}

/**
 * Virnastab marginaalia plokid: iga plokk algab oma ankru kõrguselt, aga mitte
 * eelmise ploki peal. Sisend PEAB olema anchorTop järgi kasvavalt sorteeritud.
 */
export function stackMarginalia(items: StackInput[], gap = 6): StackedPos[] {
  const out: StackedPos[] = [];
  let bottom = -Infinity;
  for (const it of items) {
    const top = Math.max(it.anchorTop, bottom + gap);
    out.push({ top, offset: top - it.anchorTop });
    bottom = top + it.height;
  }
  return out;
}
```

- [ ] **Step 4: Käivita testid** — PASS (10 testi)

- [ ] **Step 5: Commit**

```bash
git add src/utils/marginaliaUtils.ts src/utils/__tests__/marginaliaUtils.test.ts
git commit -m "feat: marginaalia virnastamisalgoritm (stackMarginalia)"
```

---

### Task 3: `renderVuttMarkup` — marginaalia plokk-kaart mobiilivaates

**Files:**
- Modify: `src/utils/renderVuttMarkup.ts:19`
- Test: `src/utils/__tests__/renderVuttMarkup.test.ts`

- [ ] **Step 1: Vaata olemasolevat testi ja uuenda/lisa**

Loe `src/utils/__tests__/renderVuttMarkup.test.ts`. Kui seal on `<m>` kohta test, uuenda ootus; lisa test:

```ts
it('renderdab <m> ploki kaardina (block, väiksem kiri, ilma sundkursiivita)', () => {
  const html = renderVuttMarkup('põhi\n<m>Apoc. 12.</m>\ntekst');
  expect(html).toContain('class="block');
  expect(html).toContain('Apoc. 12.');
  expect(html).not.toContain('italic">Apoc'); // sisu EI ole sundkursiivis
});

it('<m> sisemine märgendus renderdub tavaliselt', () => {
  const html = renderVuttMarkup('<m>Vide <i>Picrium</i></m>');
  expect(html).toContain('<em>Picrium</em>');
});
```

- [ ] **Step 2: Käivita, veendu et FAILib**

Run: `npx vitest run src/utils/__tests__/renderVuttMarkup.test.ts`

- [ ] **Step 3: Muuda rida 19** (`<m>` asendus; paaristägide järjekord failis: `<m>` asendus PEAB jääma PÄRAST `<b>`/`<i>`/`<cs>` asendusi — need on `[\s\S]*?` ja töötavad ploki sees nagunii, järjekord ei muuda tulemust, aga ära liiguta asju asjata):

```ts
    // <m>...</m> — marginaalia plokk-kaardina: taane, väiksem kiri, vasak ääris.
    // Sisemine märgendus (<i>, <cs> jne) renderdub tavaliste reeglitega.
    .replace(/<m>([\s\S]*?)<\/m>/g, '<span class="block text-[0.85em] leading-snug text-stone-600 border-l-2 border-stone-300 pl-2 my-1">$1</span>')
```

NB: paaristägide asendused failis käivad järjekorras b → i → cs → m → hi. Et `<i>` ploki SEES asenduks, peab `<m>` asendus tulema pärast — kontrolli, et `<i>` asendus (rida 17) on enne `<m>` asendust; kui `<m>` sisu jääb `<i>` töötlemata (test FAILib), tõsta `<m>` asendus ahela LÕPPU.

- [ ] **Step 4: Käivita testid** — PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils/renderVuttMarkup.ts src/utils/__tests__/renderVuttMarkup.test.ts
git commit -m "feat: marginaalia plokk-kaart mobiilses lugemisvaates"
```

---

### Task 4: MarginaliaExtension — olek ja suletud plokkide peitmine

**Files:**
- Create: `src/components/editor/MarginaliaExtension.ts`
- Test: `src/components/editor/__tests__/MarginaliaExtension.test.ts`

- [ ] **Step 1: Kirjuta failing testid**

```ts
// src/components/editor/__tests__/MarginaliaExtension.test.ts
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import {
  marginaliaExtension,
  marginaliaField,
  openMarginalia,
  closeAllMarginalia,
} from '../MarginaliaExtension';

const DOC = 'rida üks\n<m>Apoc. 12.</m>\nrida kaks\n<m>Vide Picrium</m>\nrida kolm';

function mkState(doc = DOC) {
  return EditorState.create({ doc, extensions: [marginaliaExtension('column')] });
}

describe('marginaliaField', () => {
  it('parsib plokid dokumendist', () => {
    const state = mkState();
    expect(state.field(marginaliaField).blocks).toHaveLength(2);
  });

  it('openMarginalia avab ploki, closeAllMarginalia sulgeb', () => {
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(1);
    state = state.update({ effects: closeAllMarginalia.of(null) }).state;
    expect(state.field(marginaliaField).openMarks).toHaveLength(0);
  });

  it('avatud marker säilib dokumendimuudatuse läbi (mapitakse)', () => {
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    // Lisa teksti dokumendi algusesse — marker peab nihkuma kaasa
    state = state.update({ changes: { from: 0, insert: 'XX' } }).state;
    const { blocks, openMarks } = state.field(marginaliaField);
    expect(openMarks[0]).toBe(b.contentFrom + 2);
    expect(openMarks[0]).toBeGreaterThanOrEqual(blocks[0].from);
    expect(openMarks[0]).toBeLessThanOrEqual(blocks[0].to);
  });
});
```

- [ ] **Step 2: Käivita, veendu et FAILib**

Run: `npx vitest run src/components/editor/__tests__/MarginaliaExtension.test.ts`

- [ ] **Step 3: Implementeeri faili esimene osa**

```ts
// MarginaliaExtension.ts — marginaalia visuaalne esitus CM6-s.
// Režiimid: 'column' (veerg vasakus servas) | 'badge' (väike märk ankrurea alguses).
// Suletud plokk on peidetud (block replace + atomic); klikk veerunoodil/märgil avab
// ploki tagasi oma päris kohas (täisrea taust + punktiirraam + × nupp).
// Vt docs/superpowers/specs/2026-06-11-marginalia-display-design.md
//
// KRIITILISED REEGLID (samad mis VuttMarkupExtension):
// - RangeSetBuilder.add(): from ASC, sama from korral to ASC
// - replace-dekoratsioonid ei tohi kattuda
// - block-replace vahemik peab olema reapiiridel (vt plaani riskimärkus)

import { Decoration, DecorationSet, EditorView, WidgetType, ViewPlugin, keymap } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateField, StateEffect, EditorState, Transaction, Facet } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { findMarginaliaBlocks, stackMarginalia } from '../../utils/marginaliaUtils';
import type { MarginaliaBlock } from '../../utils/marginaliaUtils';
import { renderVuttMarkup } from '../../utils/renderVuttMarkup';

export type MarginaliaMode = 'column' | 'badge';

const modeFacet = Facet.define<MarginaliaMode, MarginaliaMode>({
  combine: values => values[0] ?? 'column',
});

// --- Avatud plokkide olek ---
// Avatud plokki tähistab "marker" — positsioon ploki sees, mida map'itakse
// dokumendimuudatuste läbi. Plokk on avatud, kui mõni marker jääb ta vahemikku.
export const openMarginalia = StateEffect.define<number>();
export const closeMarginalia = StateEffect.define<number>();
export const closeAllMarginalia = StateEffect.define<null>();

export interface MarginaliaState {
  blocks: MarginaliaBlock[];
  openMarks: number[];
}

function isOpen(block: MarginaliaBlock, openMarks: number[]): boolean {
  return openMarks.some(p => p >= block.from && p <= block.to);
}

export const marginaliaField = StateField.define<MarginaliaState>({
  create(state) {
    return { blocks: findMarginaliaBlocks(state.doc.toString()), openMarks: [] };
  },
  update(value, tr) {
    let openMarks = value.openMarks;
    let changed = false;
    if (tr.docChanged) {
      openMarks = openMarks.map(p => tr.changes.mapPos(p));
      changed = true;
    }
    const blocks = tr.docChanged ? findMarginaliaBlocks(tr.state.doc.toString()) : value.blocks;
    for (const e of tr.effects) {
      if (e.is(openMarginalia)) { openMarks = [...openMarks, e.value]; changed = true; }
      if (e.is(closeMarginalia)) {
        const blk = blocks.find(b => e.value >= b.from && e.value <= b.to);
        if (blk) { openMarks = openMarks.filter(p => p < blk.from || p > blk.to); changed = true; }
      }
      if (e.is(closeAllMarginalia)) { openMarks = []; changed = true; }
    }
    if (!changed) return value;
    return { blocks, openMarks };
  },
});
```

Ja seejärel dekoratsioonid (sama faili jätk):

```ts
// --- Widgetid ---

class MarginNoteWidget extends WidgetType {
  constructor(readonly content: string, readonly blockFrom: number) { super(); }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'vutt-margin-note';
    div.dataset.mFrom = String(this.blockFrom);
    // renderVuttMarkup escape'ib HTML-i (XSS-kaitse) ja renderdab sisemise märgenduse
    div.innerHTML = renderVuttMarkup(this.content);
    return div;
  }
  eq(other: MarginNoteWidget) { return other.content === this.content && other.blockFrom === this.blockFrom; }
  ignoreEvent() { return false; }
}

class MarginBadgeWidget extends WidgetType {
  constructor(readonly blockFrom: number) { super(); }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'vutt-marg-badge';
    span.dataset.mFrom = String(this.blockFrom);
    span.textContent = 'm';
    return span;
  }
  eq(other: MarginBadgeWidget) { return other.blockFrom === this.blockFrom; }
  ignoreEvent() { return false; }
}

class MarginCloseWidget extends WidgetType {
  constructor(readonly blockFrom: number) { super(); }
  toDOM() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vutt-marg-close';
    btn.dataset.mFrom = String(this.blockFrom);
    btn.textContent = '×';
    return btn;
  }
  eq(other: MarginCloseWidget) { return other.blockFrom === this.blockFrom; }
  ignoreEvent() { return false; }
}

// --- Dekoratsioonid ---

const atomicMark = Decoration.mark({});

interface DecoSets { deco: DecorationSet; atomic: DecorationSet }

function buildDeco(state: EditorState): DecoSets {
  const { blocks, openMarks } = state.field(marginaliaField);
  const mode = state.facet(modeFacet);
  const doc = state.doc;
  type Item = { from: number; to: number; deco: Decoration };
  const items: Item[] = [];
  const atomicB = new RangeSetBuilder<Decoration>();

  for (const b of blocks) {
    if (isOpen(b, openMarks)) {
      // Avatud plokk: täisrea taust + raam, × nupp esimesel real
      const firstLine = doc.lineAt(Math.min(b.from, doc.length));
      const lastLine = doc.lineAt(Math.min(b.to, doc.length));
      for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
        const line = doc.line(ln);
        let cls = 'vutt-marg-open';
        if (ln === firstLine.number) cls += ' vutt-marg-open-first';
        if (ln === lastLine.number) cls += ' vutt-marg-open-last';
        items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }) });
      }
      items.push({
        from: firstLine.from, to: firstLine.from,
        deco: Decoration.widget({ widget: new MarginCloseWidget(b.from), side: -1 }),
      });
    } else {
      // Suletud plokk: peida read tervikuna + widget ankrurea alguses
      const content = doc.sliceString(b.contentFrom, b.contentTo);
      const widget = mode === 'column'
        ? new MarginNoteWidget(content, b.from)
        : new MarginBadgeWidget(b.from);
      items.push({ from: b.hideFrom, to: b.hideTo, deco: Decoration.replace({ block: true }) });
      const anchor = Math.min(b.anchorPos, doc.length);
      items.push({ from: anchor, to: anchor, deco: Decoration.widget({ widget, side: -1 }) });
      atomicB.add(b.hideFrom, b.hideTo, atomicMark);
    }
  }

  items.sort((a, b2) => (a.from - b2.from) || (a.to - b2.to));
  const decoB = new RangeSetBuilder<Decoration>();
  for (const it of items) decoB.add(it.from, it.to, it.deco);
  return { deco: decoB.finish(), atomic: atomicB.finish() };
}

const marginaliaDecoField = StateField.define<DecoSets>({
  create: buildDeco,
  update(value, tr) {
    const relevant = tr.docChanged || tr.effects.some(e =>
      e.is(openMarginalia) || e.is(closeMarginalia) || e.is(closeAllMarginalia));
    if (!relevant) return value;
    return buildDeco(tr.state);
  },
  provide: f => [
    EditorView.decorations.from(f, v => v.deco),
    EditorView.atomicRanges.from(f, v => () => v.atomic),
  ],
});

// --- Avalik laiendusfabrik (täieneb Task 5–7 käigus) ---

export function marginaliaExtension(mode: MarginaliaMode): Extension {
  return [
    modeFacet.of(mode),
    marginaliaField,
    marginaliaDecoField,
  ];
}
```

- [ ] **Step 4: Käivita testid** — PASS (3 testi)

- [ ] **Step 5: Lisa dekoratsioonide test ja käivita uuesti**

Ekspordi `marginaliaDecoField` (lisa `export` võtmesõna) ja lisa test:

```ts
import { marginaliaDecoField } from '../MarginaliaExtension';

describe('dekoratsioonid', () => {
  it('suletud plokid annavad replace + widget dekoratsioonid (2 plokki → 4 dekoratsiooni)', () => {
    const state = mkState();
    expect(state.field(marginaliaDecoField).deco.size).toBe(4);
  });

  it('avatud plokk annab line-dekoratsioonid + × widgeti', () => {
    let state = mkState();
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    // Plokk 1 avatud (1 rida): 1 line-deco + 1 close-widget; plokk 2 suletud: replace + note-widget
    expect(state.field(marginaliaDecoField).deco.size).toBe(4);
  });
});
```

NB: RangeSetBuilder'i järjekorraviga viskaks erandi juba `EditorState.create`/`update` sees — need testid püüavad selle kinni.

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/MarginaliaExtension.ts src/components/editor/__tests__/MarginaliaExtension.test.ts
git commit -m "feat: MarginaliaExtension — olek ja suletud plokkide peitmine"
```

---

### Task 5: avamine ja sulgemine (klikid, Esc, × nupp)

**Files:**
- Modify: `src/components/editor/MarginaliaExtension.ts`

- [ ] **Step 1: Lisa state-tasandi test sulgemisele positsiooni järgi**

```ts
import { closeMarginalia } from '../MarginaliaExtension';

it('closeMarginalia sulgeb ainult selle ploki', () => {
  let state = mkState();
  const [b1, b2] = state.field(marginaliaField).blocks;
  state = state.update({ effects: [openMarginalia.of(b1.contentFrom), openMarginalia.of(b2.contentFrom)] }).state;
  state = state.update({ effects: closeMarginalia.of(b1.from + 1) }).state;
  const { blocks, openMarks } = state.field(marginaliaField);
  expect(openMarks).toHaveLength(1);
  expect(openMarks[0]).toBeGreaterThanOrEqual(blocks[1].from);
});
```

Run: `npx vitest run src/components/editor/__tests__/MarginaliaExtension.test.ts` — see test peaks juba PASSima (loogika tehtud Task 4-s). Kui FAILib, paranda `closeMarginalia` haru.

- [ ] **Step 2: Lisa kliki- ja klahvikäsitlus (faili jätk, enne `marginaliaExtension`-i)**

```ts
// --- Interaktsioon ---

const marginaliaClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement;

    const openEl = target.closest('.vutt-margin-note, .vutt-marg-badge') as HTMLElement | null;
    if (openEl?.dataset.mFrom !== undefined) {
      const from = Number(openEl.dataset.mFrom);
      const blk = view.state.field(marginaliaField).blocks.find(b => b.from === from);
      if (blk) {
        view.dispatch({
          effects: openMarginalia.of(blk.contentFrom),
          selection: { anchor: Math.min(blk.contentFrom, view.state.doc.length) },
        });
        view.focus();
      }
      event.preventDefault();
      return true;
    }

    const closeEl = target.closest('.vutt-marg-close') as HTMLElement | null;
    if (closeEl?.dataset.mFrom !== undefined) {
      view.dispatch({ effects: closeMarginalia.of(Number(closeEl.dataset.mFrom) + 1) });
      event.preventDefault();
      return true;
    }
    return false;
  },
});

// Esc sulgeb kõik avatud plokid (kui mõni on lahti; muidu laseb Esc-i edasi)
const marginaliaKeymap = keymap.of([
  {
    key: 'Escape',
    run: view => {
      if (view.state.field(marginaliaField).openMarks.length === 0) return false;
      view.dispatch({ effects: closeAllMarginalia.of(null) });
      return true;
    },
  },
]);
```

Uuenda fabrikut:

```ts
export function marginaliaExtension(mode: MarginaliaMode): Extension {
  return [
    modeFacet.of(mode),
    marginaliaField,
    marginaliaDecoField,
    marginaliaClickHandler,
    marginaliaKeymap,
  ];
}
```

- [ ] **Step 3: Käivita kõik extensioni testid** — PASS

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/MarginaliaExtension.ts src/components/editor/__tests__/MarginaliaExtension.test.ts
git commit -m "feat: marginaalia avamine/sulgemine (klikk, ×, Esc)"
```

---

### Task 6: kaitsefilter — peidetud plokki ei saa kogemata kustutada

**Files:**
- Modify: `src/components/editor/MarginaliaExtension.ts`
- Test: `src/components/editor/__tests__/MarginaliaExtension.test.ts`

- [ ] **Step 1: Kirjuta failing testid**

```ts
import { Transaction } from '@codemirror/state';

describe('marginaliaProtectionFilter', () => {
  it('kasutaja kustutamine üle peidetud ploki jätab ploki alles', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    // Kustuta kogu dokument kasutaja-eventina
    state = state.update({
      changes: { from: 0, to: doc.length, insert: '' },
      annotations: Transaction.userEvent.of('delete.selection'),
    }).state;
    expect(state.doc.toString()).toContain('<m>note</m>');
    expect(state.doc.toString()).not.toContain('AAAA');
    expect(state.doc.toString()).not.toContain('BBBB');
  });

  it('avatud ploki kustutamine on lubatud', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    const b = state.field(marginaliaField).blocks[0];
    state = state.update({ effects: openMarginalia.of(b.contentFrom) }).state;
    state = state.update({
      changes: { from: 0, to: doc.length, insert: '' },
      annotations: Transaction.userEvent.of('delete.selection'),
    }).state;
    expect(state.doc.toString()).toBe('');
  });

  it('programmiline muudatus (ilma userEventita) läheb läbi puutumata', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    state = state.update({ changes: { from: 0, to: doc.length, insert: 'uus' } }).state;
    expect(state.doc.toString()).toBe('uus');
  });

  it('tavaline kustutamine nähtavas tekstis töötab', () => {
    const doc = 'AAAA\n<m>note</m>\nBBBB';
    let state = mkState(doc);
    state = state.update({
      changes: { from: 0, to: 2, insert: '' },
      annotations: Transaction.userEvent.of('delete.backward'),
    }).state;
    expect(state.doc.toString()).toBe('AA\n<m>note</m>\nBBBB');
  });
});
```

- [ ] **Step 2: Käivita, veendu et esimene test FAILib** (plokk kustub)

- [ ] **Step 3: Implementeeri filter (faili jätk)**

```ts
// --- Kaitse: kasutaja kustutamine ei tohi haarata PEIDETUD plokke ---
// Peidetud vahemikud lõigatakse muudatusest välja; avatud plokk on tavaline tekst.
// Filtreeritakse ainult userEvent-annotatsiooniga tehinguid (nagu vana
// vuttTagProtectionFilter VuttMarkupExtensionis — vt CLAUDE.md).
const marginaliaProtectionFilter = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) === undefined) return tr;
  const { blocks, openMarks } = tr.startState.field(marginaliaField);
  const hidden = blocks
    .filter(b => !isOpen(b, openMarks))
    .map(b => ({ from: b.hideFrom, to: b.hideTo }))
    .sort((a, b) => a.from - b.from);
  if (hidden.length === 0) return tr;

  let overlaps = false;
  const pieces: { from: number; to: number; insert: string }[] = [];
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const insertText = inserted.toString();
    const covering = hidden.filter(h => fromA < h.to && toA > h.from);
    if (covering.length === 0) {
      pieces.push({ from: fromA, to: toA, insert: insertText });
      return;
    }
    overlaps = true;
    // Lõika peidetud vahemikud kustutusest välja; insert jääb esimese tüki juurde
    let cursor = fromA;
    let first = true;
    for (const h of covering) {
      const cutTo = Math.min(toA, Math.max(cursor, h.from));
      if (cursor < cutTo || first) {
        pieces.push({ from: cursor, to: cutTo, insert: first ? insertText : '' });
        first = false;
      }
      cursor = Math.max(cursor, h.to);
    }
    if (cursor < toA) {
      pieces.push({ from: cursor, to: toA, insert: first ? insertText : '' });
    }
  });
  if (!overlaps) return tr;
  return [{
    changes: pieces,
    annotations: [Transaction.userEvent.of(tr.annotation(Transaction.userEvent)!)],
    scrollIntoView: tr.scrollIntoView,
  }];
});
```

Lisa fabrikusse VIIMASEKS (nagu vana protection-filteri reegel CLAUDE.md-s):

```ts
export function marginaliaExtension(mode: MarginaliaMode): Extension {
  return [
    modeFacet.of(mode),
    marginaliaField,
    marginaliaDecoField,
    marginaliaClickHandler,
    marginaliaKeymap,
    marginaliaProtectionFilter,
  ];
}
```

- [ ] **Step 4: Käivita testid** — PASS. NB: kui esimene test FAILib sõnumiga, et tulemuses on ka reavahetused ploki ümber — see on OK, täpsusta testi ootust (`toContain('<m>note</m>')` juba lubab seda).

- [ ] **Step 5: Commit**

```bash
git add src/components/editor/MarginaliaExtension.ts src/components/editor/__tests__/MarginaliaExtension.test.ts
git commit -m "feat: peidetud marginaalia kaitse kustutamise eest"
```

---

### Task 7: veeru layout — virnastamine, konnektorid, CSS

**Files:**
- Modify: `src/components/editor/MarginaliaExtension.ts`
- Modify: `src/index.css` (lisa pärast `.vutt-pb-widget` plokki, rida ~113)

- [ ] **Step 1: Lisa layout-ViewPlugin (faili jätk, enne fabrikut)**

```ts
// --- Layout: has-margin klass + virnastamine + konnektorid ---
// Mõõtmine käib requestMeasure kaudu (mitte update sees!) — väldib värelust.
// transform ei muuda layouti, seega uut measure-tsüklit ei teki.
const marginaliaLayoutPlugin = ViewPlugin.fromClass(class {
  constructor(readonly view: EditorView) {
    this.schedule();
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged ||
        u.transactions.some(tr => tr.effects.some(e =>
          e.is(openMarginalia) || e.is(closeMarginalia) || e.is(closeAllMarginalia)))) {
      this.schedule();
    }
  }
  schedule() {
    const view = this.view;
    view.requestMeasure({
      read: () => {
        const notes = Array.from(view.contentDOM.querySelectorAll<HTMLElement>('.vutt-margin-note'));
        return notes.map(el => ({
          el,
          // offsetParent on .cm-line (position: relative) — anchorTop = rea ülaserv sisu suhtes
          anchorTop: (el.offsetParent as HTMLElement | null)?.offsetTop ?? 0,
          height: el.offsetHeight,
        }));
      },
      write: measured => {
        const mode = view.state.facet(modeFacet);
        const hasBlocks = view.state.field(marginaliaField).blocks.length > 0;
        view.dom.classList.toggle('vutt-marg-mode', true);
        view.dom.classList.toggle('vutt-has-margin', mode === 'column' && hasBlocks);
        if (measured.length === 0) return;
        const sorted = [...measured].sort((a, b) => a.anchorTop - b.anchorTop);
        const stacked = stackMarginalia(sorted.map(m => ({ anchorTop: m.anchorTop, height: m.height })));
        sorted.forEach((m, i) => {
          const { offset } = stacked[i];
          m.el.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
          let conn = m.el.querySelector<HTMLElement>('.vutt-margin-connector');
          if (offset > 0) {
            if (!conn) {
              conn = document.createElement('div');
              conn.className = 'vutt-margin-connector';
              m.el.appendChild(conn);
            }
            conn.style.height = `${offset}px`;
            conn.style.top = `${-offset}px`;
          } else if (conn) {
            conn.remove();
          }
        });
      },
    });
  }
});
```

Lisa fabrikusse `marginaliaKeymap` järele (enne protection-filtrit):

```ts
    marginaliaLayoutPlugin,
```

- [ ] **Step 2: Lisa CSS `src/index.css`-i (pärast `.vutt-pb-widget` plokki)**

```css
/* --- Marginaalia veerg (MarginaliaExtension) --- */

/* Veerg: sisu saab vasaku paddingu, gutter peidetakse, read positsioneeritavad */
.vutt-has-margin .cm-content { padding-left: 146px; }
.vutt-has-margin .cm-gutters { display: none; }
.vutt-marg-mode .cm-line { position: relative; }

/* Marginaalia-režiimis ei anna teksti-mark enam tausta — avatud ploki taust
   tuleb täisrea line-dekoratsioonidelt (üks ühtlane ala raami sees) */
.vutt-marg-mode .vutt-marginalia { background-color: transparent; }

/* Suletud ploki sisu veerus */
.vutt-margin-note {
  position: absolute;
  left: -138px;
  top: 0;
  width: 118px;
  font-size: 12px;
  line-height: 1.35;
  color: #57534e; /* stone-600 */
  overflow-wrap: break-word;
  white-space: pre-wrap; /* andmete reavahetused säilivad, pikad read murduvad */
  cursor: pointer;
  user-select: none;
  border-radius: 2px;
}
.vutt-margin-note:hover {
  outline: 1px dashed #d6d3d1;
  outline-offset: 3px;
  background-color: #fafaf9;
}

/* Konnektor allapoole nihkunud ploki ja ta päris ankrurea vahel */
.vutt-margin-connector {
  position: absolute;
  left: -8px;
  width: 0;
  border-left: 1px dashed #eab308; /* yellow-500 */
  pointer-events: none;
}
.vutt-margin-connector::before {
  content: '';
  position: absolute;
  top: -2px;
  left: -3px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #eab308;
}

/* Märgivaade: väike kollane m ankrurea alguses */
.vutt-marg-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 15px;
  height: 15px;
  border-radius: 50%;
  background: #fef9c3; /* yellow-100 */
  border: 1px solid #eab308;
  color: #854d0e;
  font-size: 10px;
  font-family: ui-sans-serif, system-ui, sans-serif;
  font-weight: 700;
  vertical-align: 2px;
  margin-right: 4px;
  cursor: pointer;
  user-select: none;
}

/* Avatud plokk: ühtlane taust + punktiirraam ümber kogu ala */
.vutt-marg-open {
  background-color: #fefce8; /* yellow-50 */
  border-left: 1px dashed #ca8a04; /* yellow-600 */
  border-right: 1px dashed #ca8a04;
}
.vutt-marg-open-first { border-top: 1px dashed #ca8a04; }
.vutt-marg-open-last { border-bottom: 1px dashed #ca8a04; }

/* Sulgemisnupp avatud ploki esimese rea paremas servas */
.vutt-marg-close {
  position: absolute;
  right: 2px;
  top: 1px;
  width: 16px;
  height: 16px;
  line-height: 14px;
  text-align: center;
  font-size: 12px;
  color: #a16207;
  background: #fef9c3;
  border: 1px solid #eab308;
  border-radius: 3px;
  cursor: pointer;
  user-select: none;
  z-index: 2;
}
.vutt-marg-close:hover { background: #fde047; }
```

- [ ] **Step 3: Käivita kõik vitest testid** (`npx vitest run`) — PASS, regressioone pole

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/MarginaliaExtension.ts src/index.css
git commit -m "feat: marginaaliveeru layout — virnastamine, konnektorid, stiilid"
```

---

### Task 8: TextEditor integratsioon (lüliti, kitsas paan, uus marginaalia, gutter)

**Files:**
- Modify: `src/components/TextEditor.tsx` (extensions: rida ~180–202; wrapWithTag nupp: rida ~739; toolbar: rida ~735 ümbrus)
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json`

- [ ] **Step 1: Lisa impordid ja ref-id TextEditor.tsx-i**

```ts
import { marginaliaExtension, marginaliaField, openMarginalia, closeAllMarginalia } from './editor/MarginaliaExtension';
import type { MarginaliaMode } from './editor/MarginaliaExtension';
```

Komponendi algusse (teiste ref-ide juurde, rida ~106 kandis):

```ts
  const marginaliaCompartmentRef = useRef(new Compartment());
  // Kasutaja eelistus (localStorage) + kitsa paani sundrežiim
  const [marginaliaUserMode, setMarginaliaUserMode] = useState<MarginaliaMode>(
    () => (localStorage.getItem('vutt_marginalia_view') === 'badge' ? 'badge' : 'column')
  );
  const [narrowPane, setNarrowPane] = useState(false);
  const [marginaliaCount, setMarginaliaCount] = useState(0);
  const marginaliaMode: MarginaliaMode = narrowPane ? 'badge' : marginaliaUserMode;
```

- [ ] **Step 2: Lisa laiendus editori extensions-listi** (rida ~196, `vuttMarkupExtension` järele):

```ts
          vuttMarkupExtension,
          marginaliaCompartmentRef.current.of(
            marginaliaExtension(localStorage.getItem('vutt_marginalia_view') === 'badge' ? 'badge' : 'column')
          ),
```

Ja olemasolevasse `updateListener`-isse (rida ~198) lisa plokiloendur:

```ts
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setIsDirty(true);
            const count = update.state.field(marginaliaField).blocks.length;
            setMarginaliaCount(prev => (prev === count ? prev : count));
          }),
```

Esmane loendus pärast view loomist (`viewRef.current = view;` järele):

```ts
    setMarginaliaCount(view.state.field(marginaliaField).blocks.length);
```

- [ ] **Step 3: Režiimivahetuse efekt + kitsa paani jälgimine**

```ts
  // Marginaalia režiimi vahetus: reconfigure + sule avatud plokid
  // (facet'i muutus üksi ei käivita dekoratsioonide ümberehitust — closeAll efekt teeb seda)
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: [
        marginaliaCompartmentRef.current.reconfigure(marginaliaExtension(marginaliaMode)),
        closeAllMarginalia.of(null),
      ],
    });
  }, [marginaliaMode]);

  // Kitsas paan (< 640px) sunnib märgivaate — veerg ei mahu
  useEffect(() => {
    const el = editorContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width ?? 9999;
      setNarrowPane(w < 640);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const toggleMarginaliaMode = useCallback(() => {
    setMarginaliaUserMode(prev => {
      const next = prev === 'column' ? 'badge' : 'column';
      localStorage.setItem('vutt_marginalia_view', next);
      return next;
    });
  }, []);
```

- [ ] **Step 4: `insertMarginalia` ja nupu ümbersuunamine**

```ts
  // Uus marginaalia: tühi <m></m> kursori rea kohale omaette reale, kohe avatuna
  const insertMarginalia = useCallback(() => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    view.dispatch({
      changes: { from: line.from, insert: '<m></m>\n' },
      effects: openMarginalia.of(line.from + 3),
      selection: EditorSelection.cursor(line.from + 3),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
  }, [readOnly]);
```

Muuda olemasolev Marginalia-nupp (rida ~739) — `onClick={() => wrapWithTag('m')}` asemel:

```tsx
                    <button type="button" onClick={insertMarginalia} className="px-2 h-7 flex items-center justify-center rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200" title={t('editor.tooltips.marginalia')}>Marginalia</button>
```

- [ ] **Step 5: Lüliti-kiip toolbari** (sama toolbari-rea lõppu, kus B/I/𝔉 nupud; nähtav ainult kui `marginaliaCount > 0 && !narrowPane`):

```tsx
                    {marginaliaCount > 0 && !narrowPane && (
                      <button
                        type="button"
                        onClick={toggleMarginaliaMode}
                        className={`px-2 h-7 flex items-center justify-center gap-1 rounded text-[11px] border ${marginaliaUserMode === 'column' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'text-gray-600 border-transparent hover:border-gray-200 hover:bg-gray-100'}`}
                        title={marginaliaUserMode === 'column' ? t('editor.marginalia.collapse') : t('editor.marginalia.expand')}
                      >
                        ⊟ {t('editor.marginalia.toggle')}
                      </button>
                    )}
```

- [ ] **Step 6: i18n võtmed**

`src/locales/et/workspace.json` — lisa `editor` objekti sisse:

```json
"marginalia": {
  "toggle": "Marginaalid",
  "collapse": "Klapi marginaaliveerg kokku (märgivaade)",
  "expand": "Ava marginaaliveerg"
}
```

`src/locales/en/workspace.json`:

```json
"marginalia": {
  "toggle": "Marginalia",
  "collapse": "Collapse margin column (badge view)",
  "expand": "Show margin column"
}
```

- [ ] **Step 7: Typecheck + build**

Run: `npm run build`
Expected: edukas build, TS vigu pole

- [ ] **Step 8: Commit**

```bash
git add src/components/TextEditor.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat: marginaaliveerg TextEditoris — lüliti, kitsas paan, uue marginaalia nupp"
```

---

### Task 9: käsitsi verifitseerimine (npm run dev)

**Files:** — (ainult kontroll)

- [ ] **Step 1: Käivita `npm run dev` ja ava teos, mille lehel on `<m>` plokke.** Kui dev-keskkonnas andmeid pole, kleebi editorisse `reference_data/1626-...-lzogr0-017.txt` sisu.

- [ ] **Step 2: Kontrolli checklist** (kui mõni punkt FAILib, paranda enne edasiminekut; block-replace piiride erandi korral vt plaani päise riskimärkust):

1. Veerg ilmub ainult marginaaliaga lehel; ilma marginaaliata lehel on gutter + numbrid nagu enne.
2. Marginaalia seisab veerus oma ankrurea kõrval; pikk sisu murdub veeru sisse, EI jookse põhiteksti.
3. Kaks lähestikust plokki: teine nihkub alla, punktiir-konnektor + täpp näitavad ankrurida.
4. Klikk veerunoodil → plokk avaneb tekstis: ühtlane taust, punktiirraam, × nurgas; kursor sees; kirjutamine töötab; erimärkide paneel sisestab avatud plokki.
5. × ja Esc sulgevad; klikk mujale EI sulge; pärast sulgemist muudetud sisu paistab veerus.
6. Kursoriliikumine (←/→/↑/↓) üle peidetud ploki hüppab üle, ei jää kinni — MÕLEMAS suunas.
7. Valik üle peidetud ploki + Delete: nähtav tekst kustub, `<m>` plokk jääb alles (kontrolli: ava plokk).
8. Undo (Ctrl+Z) töötab avamise-muutmise-sulgemise tsükli järel mõistlikult.
9. "Marginalia" nupp loob tühja avatud ploki kursori rea kohale; teksti sisestamine + sulgemine → uus noot veerus.
10. Lüliti klapib veeru kokku (märgivaade) ja lahti; eelistus säilib lehe vahetuse järel (localStorage).
11. Tee brauseriaken kitsaks (paan < 640px) → automaatne märgivaade; laienda tagasi → veerg.
12. readOnly (logi välja / ava avalikult): veerg paistab, klikk avab ploki LUGEMISEKS (sisu nähtav, muuta ei saa — `EditorView.editable` on false), × sulgeb.
13. Salvesta leht — `.txt` failis on `<m>` plokid täpselt algsel kujul algsetes kohtades (võrdle git diff'i: ainult sinu tehtud sisumuudatused).
14. Mobiilivaade (DevTools mobiil + WorkspaceMobileView): marginaalia paistab plokk-kaardina.

- [ ] **Step 3: Commit (kui parandusi tuli)**

```bash
git add -A && git commit -m "fix: marginaaliveeru käsitsi testimise parandused"
```

---

## Osa B — otsinguindeks

### Task 10: `split_marginalia` backendis (live-indekseerimistee)

**Files:**
- Modify: `server/meilisearch_ops.py` (funktsioon rea ~52 ette; kasutus real ~499)
- Test: `tests/test_meilisearch_ops.py`

- [ ] **Step 1: Kirjuta failing testid (lisa `tests/test_meilisearch_ops.py` lõppu)**

```python
# --- split_marginalia ---
from server.meilisearch_ops import split_marginalia, clean_text_for_search


class TestSplitMarginalia:
    def test_eraldab_ploki(self):
        text = "rida üks\n<m>Apoc. 12.</m>\nrida kaks"
        main, marg = split_marginalia(text)
        assert "<m>" not in main
        assert "Apoc. 12." in marg
        assert "rida üks" in main and "rida kaks" in main

    def test_fraas_liitub_yle_ploki(self):
        text = "welcher iſt der Teuffel\n<m>Vide Picrium\nin hyeroglyphicis</m>\nvnd Satanas."
        main, marg = split_marginalia(text)
        assert "Teuffel vnd Satanas" in clean_text_for_search(main)
        assert "Vide Picrium" in marg

    def test_poolitus_yle_ploki(self):
        text = "die rechten we⸗\n<m>märkus</m>\nge deß HErrn"
        main, _ = split_marginalia(text)
        assert "wege" in clean_text_for_search(main)

    def test_mitu_plokki(self):
        text = "a\n<m>üks</m>\nb\n<m>kaks</m>\nc"
        main, marg = split_marginalia(text)
        assert "<m>" not in main
        assert "üks" in marg and "kaks" in marg

    def test_marginaalia_sisemine_margendus_puhastub(self):
        _, marg = split_marginalia("a\n<m>Vide <i>Picrium</i></m>\nb")
        assert clean_text_for_search(marg) == "Vide Picrium"

    def test_plokki_pole(self):
        assert split_marginalia("lihtne tekst") == ("lihtne tekst", "")

    def test_tyhi(self):
        assert split_marginalia("") == ("", "")
        assert split_marginalia(None) == ("", "")
```

- [ ] **Step 2: Käivita, veendu et FAILib**

Run: `.venv/bin/python -m pytest tests/test_meilisearch_ops.py -v -k SplitMarginalia`
Expected: FAIL — "cannot import name 'split_marginalia'"

- [ ] **Step 3: Implementeeri (`server/meilisearch_ops.py`, `clean_text_for_search` ette)**

```python
M_CONTENT_RE = re.compile(r'<m>([\s\S]*?)</m>')


def split_marginalia(text):
    """Eraldab marginaalia plokid põhitekstist enne indekseerimist.

    Tagastab (põhitekst ilma <m>-plokkideta, marginaaliate sisu reavahetustega liidetult).
    Põhiteksti fraasid jätkuvad üle eemaldatud ploki koha — clean_text_for_search
    liidab poolitused ja kollapsib tühikud ka mitme järjestikuse reavahetuse korral.
    NB: hoia SÜNKROONIS scripts/1-1_consolidate_data.py koopiaga!
    """
    if not text:
        return "", ""
    notes = M_CONTENT_RE.findall(text)
    main = M_CONTENT_RE.sub('', text)
    return main, "\n".join(notes)
```

Ja kasutus dokumendi ehitamisel (rida ~499, `doc = {` ette):

```python
        main_text, marginalia_text = split_marginalia(page_text)
```

`doc`-is muuda/lisa:

```python
            "lehekylje_tekst": clean_text_for_search(main_text),   # OTSING: põhitekst ILMA marginaaliata
            "marginaalia_tekst": clean_text_for_search(marginalia_text),  # OTSING: marginaalia eraldi väljal (alati olemas, ka tühjana — attributesToSearchOn nõuab)
            "text_content": page_text,                             # REDAKTOR: algne tekst koos kõigi märkidega
```

- [ ] **Step 4: Käivita testid**

Run: `.venv/bin/python -m pytest tests/test_meilisearch_ops.py -v`
Expected: PASS (kõik, ka olemasolevad)

- [ ] **Step 5: Commit**

```bash
git add server/meilisearch_ops.py tests/test_meilisearch_ops.py
git commit -m "feat: marginaalia eraldi otsinguväljale (split_marginalia, live-tee)"
```

---

### Task 11: sama loogika seed-indekseerimistees

**Files:**
- Modify: `scripts/1-1_consolidate_data.py` (funktsioon `clean_text_for_search` kõrvale, rida ~62; kasutus real ~546)
- Test: `tests/test_consolidate_data.py`

- [ ] **Step 1: Kirjuta failing test (lisa `tests/test_consolidate_data.py` lõppu; kasuta sama importlib-mustrit nagu failis olemas)**

```python
class TestSplitMarginalia:
    def _fns(self):
        spec = importlib.util.spec_from_file_location("consolidate_data", _script_path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod.split_marginalia, mod.clean_text_for_search

    def test_eraldab_ja_fraas_liitub(self):
        split_marginalia, clean = self._fns()
        text = "der Teuffel\n<m>Vide Picrium</m>\nvnd Satanas."
        main, marg = split_marginalia(text)
        assert "Teuffel vnd Satanas" in clean(main)
        assert "Vide Picrium" in marg

    def test_tyhi(self):
        split_marginalia, _ = self._fns()
        assert split_marginalia("") == ("", "")
```

NB: kui skripti laadimine nõuab env muutujat (vt `_load_script`), kasuta sama abifunktsiooni.

- [ ] **Step 2: Käivita, veendu et FAILib**

Run: `.venv/bin/python -m pytest tests/test_consolidate_data.py -v -k SplitMarginalia`

- [ ] **Step 3: Implementeeri** — kopeeri TÄPSELT sama `M_CONTENT_RE` + `split_marginalia` `scripts/1-1_consolidate_data.py`-sse (`clean_text_for_search` kõrvale, mille docstringis on juba sünkroonis-hoidmise märkus; lisa sama märkus ka uude funktsiooni). Kasutus real ~546:

```python
                main_text, marginalia_text = split_marginalia(page_text)
```

ja dokumendis:

```python
                'lehekylje_tekst': clean_text_for_search(main_text),   # OTSING: põhitekst ILMA marginaaliata
                'marginaalia_tekst': clean_text_for_search(marginalia_text),  # OTSING: marginaalia eraldi väljal
                'text_content': page_text,
```

- [ ] **Step 4: Käivita kõik pytest testid**

Run: `.venv/bin/python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/1-1_consolidate_data.py tests/test_consolidate_data.py
git commit -m "feat: marginaalia eraldi otsinguväljale (seed-tee)"
```

---

### Task 12: Meilisearch seaded + frontend otsing

**Files:**
- Modify: `scripts/2-1_upload_to_meili.py:45` (searchableAttributes)
- Modify: `src/types.ts:299` (ContentSearchHit)
- Modify: `src/services/searchService.ts:487-510` (searchOn/retrieve/highlight)
- Modify: `src/pages/search/SearchResults.tsx:154-191` (marginaalia snippet)

- [ ] **Step 1: `scripts/2-1_upload_to_meili.py`** — lisa `'lehekylje_tekst',` järele:

```python
            'marginaalia_tekst',
```

- [ ] **Step 2: `src/types.ts`** — `ContentSearchHit` interface'i: lisa `lehekylje_tekst: string;` järele ja `_formatted` blokki:

```ts
  marginaalia_tekst?: string;
```

```ts
  _formatted?: {
    lehekylje_tekst: string;
    marginaalia_tekst?: string;
    // ... olemasolev jääb
```

- [ ] **Step 3: `src/services/searchService.ts`** — rida ~487-490:

```ts
  let attributesToSearchOn: string[] = ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text'];
  if (options.scope === 'original') attributesToSearchOn = ['lehekylje_tekst', 'marginaalia_tekst'];
```

Rida ~503 `attributesToRetrieve` massiivi lisa `'lehekylje_tekst'` järele `'marginaalia_tekst'`. Rida ~505 `attributesToHighlight`:

```ts
        attributesToHighlight: ['lehekylje_tekst', 'marginaalia_tekst', tagsField, 'comments.text'],
```

NB: failis on MITU `index.search` kohta — tee sama muudatus KÕIGIS kohtades, kus `attributesToHighlight`/`attributesToRetrieve` sisaldab `lehekylje_tekst` (otsi `grep -n "attributesToHighlight" src/services/searchService.ts`).

- [ ] **Step 4: `src/pages/search/SearchResults.tsx`** — `renderHit` sisse (rida ~155 järele):

```ts
        const marginaliaSnippet = hit._formatted?.marginaalia_tekst;
        const showMarginalia = marginaliaSnippet?.includes('<em');
```

Ja JSX-i, põhisnippeti ploki (rida ~186-191) JÄRELE:

```tsx
                        {(scopeParam === 'all' || scopeParam === 'original') && showMarginalia && (
                            <div className="text-xs text-stone-600 leading-relaxed font-serif bg-stone-50 border-l-2 border-stone-300 p-2 mt-1 rounded-r"
                                dangerouslySetInnerHTML={{ __html: sanitizeHighlight(marginaliaSnippet!, { allowBr: true }) }}
                            />
                        )}
```

- [ ] **Step 5: Build + testid**

Run: `npm run build && npx vitest run`
Expected: edukas build, kõik testid PASSivad

- [ ] **Step 6: Commit**

```bash
git add scripts/2-1_upload_to_meili.py src/types.ts src/services/searchService.ts src/pages/search/SearchResults.tsx
git commit -m "feat: marginaalia_tekst otsitav ja kuvatav otsingutulemustes"
```

---

### Task 13: lõppkontroll

- [ ] **Step 1: Kogu testikomplekt**

Run: `.venv/bin/python -m pytest tests/ -v && npx vitest run && npm run build`
Expected: kõik PASS, build edukas

- [ ] **Step 2: Veendu, et töövahekataloog on puhas ja kõik commititud** (`git status`)

- [ ] **Step 3: Deploy (kasutaja kinnitusel, EI tee automaatselt):**

```bash
# 1. Frontend (töötab vana indeksiga, marginaalia_tekst puudumine ei lõhu midagi)
npm run build && rsync -avz dist/ vutt:~/VUTT/dist/
# 2. Backend
ssh vutt 'cd ~/VUTT && ./scripts/server_update.sh'
# 3. Täisreindeks (marginaalia_tekst väli + puhastatud lehekylje_tekst)
ssh vutt 'cd ~/VUTT && ./scripts/server_seed_data.sh'
```

NB: pärast deploy'd kontrolli serveris: fraasiotsing "Teuffel vnd Satanas" leiab teose lzogr0 lk 17; otsing "Picrium" leiab sama lehe marginaalia kaudu.
