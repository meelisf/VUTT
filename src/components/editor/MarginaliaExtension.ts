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

/**
 * PEIDETUD (suletud) plokkide peitevahemikud kasvavas järjestuses.
 * Kasutavad: marginaliaProtectionFilter ja TextEditor.cleanMarkup —
 * peidetud sisu ei tohi sattuda asendusteksti (muidu dubleeruks).
 */
export function hiddenBlockRanges(state: EditorState): { from: number; to: number }[] {
  const { blocks, openMarks } = state.field(marginaliaField);
  return blocks
    .filter(b => !isOpen(b, openMarks))
    .map(b => ({ from: b.hideFrom, to: b.hideTo }))
    .sort((a, b) => a.from - b.from);
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

// --- Widgetid ---

class MarginNoteWidget extends WidgetType {
  constructor(readonly content: string, readonly blockFrom: number) { super(); }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'vutt-margin-note';
    div.dataset.mFrom = String(this.blockFrom);
    if (this.content.trim() === '') {
      // Tühi noot: ilma placeholder'ita oleks 0-kõrgusega ja klikkimatu
      div.classList.add('vutt-margin-note-empty');
      div.textContent = '(–)';
    } else {
      // renderVuttMarkup escape'ib HTML-i (XSS-kaitse) ja renderdab sisemise märgenduse
      div.innerHTML = renderVuttMarkup(this.content);
    }
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
  const atomicRanges: { from: number; to: number }[] = [];

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
      atomicRanges.push({ from: b.hideFrom, to: b.hideTo });
    }
  }

  items.sort((a, b2) => (a.from - b2.from) || (a.deco.startSide - b2.deco.startSide) || (a.to - b2.to));
  const decoB = new RangeSetBuilder<Decoration>();
  for (const it of items) decoB.add(it.from, it.to, it.deco);

  atomicRanges.sort((a, b2) => (a.from - b2.from) || (a.to - b2.to));
  const atomicB = new RangeSetBuilder<Decoration>();
  for (const r of atomicRanges) atomicB.add(r.from, r.to, atomicMark);

  return { deco: decoB.finish(), atomic: atomicB.finish() };
}

export const marginaliaDecoField = StateField.define<DecoSets>({
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

// --- Kaitse: kasutaja kustutamine ei tohi haarata PEIDETUD plokke ---
// Peidetud vahemikud lõigatakse muudatusest välja; avatud plokk on tavaline tekst.
// Filtreeritakse ainult userEvent-annotatsiooniga tehinguid (nagu vana
// vuttTagProtectionFilter VuttMarkupExtensionis — vt CLAUDE.md).
const marginaliaProtectionFilter = EditorState.transactionFilter.of(tr => {
  if (!tr.docChanged || tr.annotation(Transaction.userEvent) === undefined) return tr;
  const hidden = hiddenBlockRanges(tr.startState);
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
    // Efektid (nt openMarginalia/closeAllMarginalia) peavad ümberkirjutatud
    // tehingus säilima — muidu kaoks kaasapandud olekumuudatus vaikselt
    effects: tr.effects,
    annotations: [Transaction.userEvent.of(tr.annotation(Transaction.userEvent)!)],
    scrollIntoView: tr.scrollIntoView,
  }];
});

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

// --- Avalik laiendusfabrik ---
// Kaitsefilter peab olema VIIMANE listis (vt CLAUDE.md VuttMarkupExtension reeglid)

export function marginaliaExtension(mode: MarginaliaMode): Extension {
  return [
    modeFacet.of(mode),
    marginaliaField,
    marginaliaDecoField,
    marginaliaClickHandler,
    marginaliaKeymap,
    marginaliaLayoutPlugin,
    marginaliaProtectionFilter,
  ];
}
