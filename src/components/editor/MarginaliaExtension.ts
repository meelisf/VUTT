// MarginaliaExtension.ts — marginaalia visuaalne esitus CM6-s (overlay-arhitektuur).
// Suletud plokid peidetakse block-replace'iga (ILMA CM-widgetita) ja renderdatakse
// eraldi DOM-ülekattena (position:absolute .cm-scrolleris, coordsAtPos-põhine).
// Avatud plokid (muutmisrežiim): täisrea taust + × nupp, toortekst inline nähtav.
// Vt docs/superpowers/plans/2026-06-13-marginalia-overlay-rendering.md
//
// KRIITILISED REEGLID (samad mis VuttMarkupExtension):
// - RangeSetBuilder.add(): from ASC, sama from korral to ASC
// - replace-dekoratsioonid ei tohi kattuda
// - block-replace vahemik peab olema reapiiridel

import { Decoration, DecorationSet, EditorView, WidgetType, ViewPlugin, keymap } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateField, StateEffect, EditorState, Transaction, Facet } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { findMarginaliaBlocks, stackMarginalia, groupMarginaliaBlocks } from '../../utils/marginaliaUtils';
import type { MarginaliaBlock, MarginaliaGroup } from '../../utils/marginaliaUtils';
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

// Grupp on avatud, kui MÕNI ta liige on avatud. Avamine lisab markeri ainult
// esimese liikme sisse (vt onMouseDown), aga kogu grupp renderdatakse avatuna.
function isGroupOpen(group: MarginaliaGroup, openMarks: number[]): boolean {
  return group.blocks.some(b => isOpen(b, openMarks));
}

/**
 * PEIDETUD (suletud) plokkide peitevahemikud kasvavas järjestuses.
 * Kasutavad: marginaliaProtectionFilter ja TextEditor.cleanMarkup —
 * peidetud sisu ei tohi sattuda asendusteksti (muidu dubleeruks).
 */
export function hiddenBlockRanges(state: EditorState): { from: number; to: number }[] {
  const { blocks, openMarks } = state.field(marginaliaField);
  // Üks pidev peitevahemik suletud grupi kohta (järjestikused plokid liidetud).
  return groupMarginaliaBlocks(blocks)
    .filter(g => !isGroupOpen(g, openMarks))
    .map(g => ({ from: g.hideFrom, to: g.hideTo }))
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

// MarginBadgeWidget: märgivaate väike 'm' ankureal (badge-mode, ei ole block-piiril)
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
  constructor(readonly blockFrom: number, readonly canDelete: boolean) { super(); }
  toDOM() {
    const wrap = document.createElement('span');
    wrap.className = 'vutt-marg-actions';
    if (this.canDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'vutt-marg-delete';
      del.dataset.mFrom = String(this.blockFrom);
      del.textContent = '🗑';
      del.title = 'Kustuta marginaalia / Delete marginalia';
      wrap.appendChild(del);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vutt-marg-close';
    btn.dataset.mFrom = String(this.blockFrom);
    btn.textContent = '×';
    wrap.appendChild(btn);
    return wrap;
  }
  eq(other: MarginCloseWidget) { return other.blockFrom === this.blockFrom && other.canDelete === this.canDelete; }
  ignoreEvent() { return false; }
}

/**
 * Ploki täieliku kustutamise muudatus (rida + reavahetus). Dispatchitakse ILMA
 * userEvent-annotatsioonita — programmaatiline muudatus läbib kaitsefiltrid;
 * undo (Ctrl+Z) taastab ploki.
 */
export function deleteMarginaliaSpec(state: EditorState, blockFrom: number): { from: number; to: number } | null {
  // Kustutab terve grupi (kogu ääremärkuse), mitte üksiku `<m>` rea.
  const groups = groupMarginaliaBlocks(state.field(marginaliaField).blocks);
  const g = groups.find(gr => gr.blocks.some(b => b.from === blockFrom));
  if (!g) return null;
  return { from: g.hideFrom, to: g.hideTo };
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

  // Grupeerime järjestikused plokid: suletud grupp = ÜKS block-replace (mitte N
  // kõrvutist → väldib CM6 kõrvutiste block-replace'ide habrast renderdust) ja
  // overlay's üks kaart. Avatud grupp = kõik liikme-read nähtavale muutmiseks.
  const groups = groupMarginaliaBlocks(blocks);
  for (const g of groups) {
    if (isGroupOpen(g, openMarks)) {
      // Avatud grupp: täisrea taust + raam üle kõigi liikme-ridade, × esimesel real
      const firstLine = doc.lineAt(Math.min(g.blocks[0].from, doc.length));
      const lastLine = doc.lineAt(Math.min(g.blocks[g.blocks.length - 1].to, doc.length));
      for (let ln = firstLine.number; ln <= lastLine.number; ln++) {
        const line = doc.line(ln);
        let cls = 'vutt-marg-open';
        if (ln === firstLine.number) cls += ' vutt-marg-open-first';
        if (ln === lastLine.number) cls += ' vutt-marg-open-last';
        items.push({ from: line.from, to: line.from, deco: Decoration.line({ class: cls }) });
      }
      items.push({
        from: firstLine.from, to: firstLine.from,
        deco: Decoration.widget({ widget: new MarginCloseWidget(g.from, state.facet(EditorView.editable)), side: -1 }),
      });
    } else {
      // Suletud grupp: üks block-replace ILMA widgetita üle terve klastri.
      // Veerurežiim → overlay plugin renderdab koordinaadipõhiselt (ei saa kaduda).
      // Märgivaade → badge widget ankureal (ei ole block-piiril → usaldusväärne).
      items.push({ from: g.hideFrom, to: g.hideTo, deco: Decoration.replace({ block: true }) });
      atomicRanges.push({ from: g.hideFrom, to: g.hideTo });
      if (mode === 'badge') {
        const anchor = Math.min(g.anchorPos, doc.length);
        items.push({ from: anchor, to: anchor, deco: Decoration.widget({ widget: new MarginBadgeWidget(g.from), side: -1 }) });
      }
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

// --- Overlay ViewPlugin ---
// Renderdab suletud marginaalia plokid vasakveergu DOM-ülekattena.
// Overlay on position:absolute .cm-scrolleris (view.scrollDOM) — scrollib koos sisuga.
// .cm-scroller-il ON position:relative (CM6 base theme) → containing block korrektne.
// Positsioneerimine: coordsAtPos(anchorPos) → top = viewportY - scrollerTop + scrollTop.
// EI kasuta CM-widgete → ei saa materialiseerumata jääda (lahendab põhivea).

interface OverlayItem {
  blockFrom: number;
  content: string;
  top: number;     // scroller-suhteline y (viewport-y - scrollerTop + scrollTop), px
  height: number;  // olemasoleva elemendi kõrgus (eelmine tsükkel), px
}
interface OverlayMeasure {
  items: OverlayItem[];
  hasBlocks: boolean;
  mode: MarginaliaMode;
}

const marginaliaOverlayPlugin = ViewPlugin.fromClass(class {
  overlay: HTMLDivElement;
  noteEls: Map<number, HTMLDivElement> = new Map();

  constructor(readonly view: EditorView) {
    this.overlay = document.createElement('div');
    this.overlay.className = 'vutt-margin-overlay';
    // KRIITILINE: EditorView.domEventHandlers seob kuulajad contentDOM-i külge,
    // aga overlay on scrollDOM-is (contentDOM-i ÕDE, mitte järglane) → klikk
    // overlay-noodil ei jõuaks marginaliaClickHandler-ini. Seega oma kuulaja siia.
    this.overlay.addEventListener('mousedown', this.onMouseDown);
    view.scrollDOM.appendChild(this.overlay);
    this.schedule();
  }

  // Klikk overlay-noodil → ava plokk muutmiseks (toortekst inline nähtavale).
  onMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement;
    const noteEl = target.closest('.vutt-margin-note') as HTMLElement | null;
    if (noteEl?.dataset.mFrom === undefined) return;
    const from = Number(noteEl.dataset.mFrom);
    const blk = this.view.state.field(marginaliaField).blocks.find(b => b.from === from);
    if (blk) {
      this.view.dispatch({
        effects: openMarginalia.of(blk.contentFrom),
        selection: { anchor: Math.min(blk.contentFrom, this.view.state.doc.length) },
      });
      this.view.focus();
    }
    event.preventDefault();
  };

  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.geometryChanged ||
        u.transactions.some(tr => tr.effects.some(e =>
          e.is(openMarginalia) || e.is(closeMarginalia) || e.is(closeAllMarginalia)))) {
      this.schedule();
    }
  }

  schedule() {
    const view = this.view;
    view.requestMeasure<OverlayMeasure>({
      key: this,   // ainult üks ootel mõõtmine korraga
      read: (): OverlayMeasure => {
        const mode = view.state.facet(modeFacet);
        const { blocks, openMarks } = view.state.field(marginaliaField);
        const hasBlocks = blocks.length > 0;
        if (mode !== 'column') return { items: [], hasBlocks, mode };

        const scrollerRect = view.scrollDOM.getBoundingClientRect();
        const scrollTop = view.scrollDOM.scrollTop;
        const docLen = view.state.doc.length;

        const items: OverlayItem[] = [];
        // Üks kaart suletud grupi kohta; sisu = liikmete read '\n'-iga liidetud.
        for (const g of groupMarginaliaBlocks(blocks)) {
          if (isGroupOpen(g, openMarks)) continue;
          const anchorPos = Math.min(g.anchorPos, docLen);
          const coords = view.coordsAtPos(anchorPos);
          if (coords === null) continue;
          const content = g.blocks
            .map(b => view.state.doc.sliceString(b.contentFrom, b.contentTo))
            .join('\n');
          items.push({
            blockFrom: g.from,
            content,
            top: coords.top - scrollerRect.top + scrollTop,
            // Loe olemasoleva elemendi kõrgus (eelmisest tsüklist) — ühes read-faasis
            height: this.noteEls.get(g.from)?.offsetHeight ?? 20,
          });
        }
        items.sort((a, b) => a.top - b.top);
        return { items, hasBlocks, mode };
      },
      write: ({ items, hasBlocks, mode }: OverlayMeasure): void => {
        view.dom.classList.toggle('vutt-marg-mode', true);
        view.dom.classList.toggle('vutt-has-margin', mode === 'column' && hasBlocks);

        if (mode !== 'column') {
          this.overlay.style.display = 'none';
          return;
        }
        this.overlay.style.display = '';

        // Uuenda note elementide sisu
        const prevEls = new Map(this.noteEls);
        const newEls = new Map<number, HTMLDivElement>();

        for (const item of items) {
          let el = prevEls.get(item.blockFrom);
          if (!el) {
            el = document.createElement('div');
            el.className = 'vutt-margin-note';
            el.dataset.mFrom = String(item.blockFrom);
            this.overlay.appendChild(el);
          }
          const isEmpty = item.content.trim() === '';
          el.classList.toggle('vutt-margin-note-empty', isEmpty);
          if (isEmpty) {
            el.textContent = '(–)';
          } else {
            el.innerHTML = renderVuttMarkup(item.content);
          }
          newEls.set(item.blockFrom, el);
        }
        for (const [from, el] of prevEls) {
          if (!newEls.has(from)) el.remove();
        }
        this.noteEls = newEls;

        // Virna (stackMarginalia): kasutab eelmise tsükli kõrgusi read-faasist
        const stacked = stackMarginalia(
          items.map(i => ({ anchorTop: i.top, height: i.height }))
        );

        // Paiguta note divid
        items.forEach((item, i) => {
          const el = newEls.get(item.blockFrom);
          if (!el) return;
          const { top, offset } = stacked[i];
          el.style.top = `${top}px`;

          // Konnektor ankurist nihkunud noodi juurde
          let conn = el.querySelector<HTMLElement>('.vutt-margin-connector');
          if (offset > 0) {
            if (!conn) {
              conn = document.createElement('div');
              conn.className = 'vutt-margin-connector';
              el.appendChild(conn);
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

  destroy() {
    this.overlay.removeEventListener('mousedown', this.onMouseDown);
    this.overlay.remove();
  }
});

// --- Interaktsioon ---

const marginaliaClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const target = event.target as HTMLElement;

    // Klikk suletud ploki noodil (overlay või badge) → ava plokk muutmiseks
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

    const deleteEl = target.closest('.vutt-marg-delete') as HTMLElement | null;
    if (deleteEl?.dataset.mFrom !== undefined && view.state.facet(EditorView.editable)) {
      const spec = deleteMarginaliaSpec(view.state, Number(deleteEl.dataset.mFrom));
      if (spec) {
        // ILMA userEvent'ita: kaitsefiltrid ei sekku; undo taastab
        view.dispatch({ changes: spec });
        view.focus();
      }
      event.preventDefault();
      return true;
    }

    // Klikk avatud ploki peidetud tägialale (nt tühja ploki kasti): kursor
    // klammerdatakse sisu piiridesse, et tippimine/paste läheks ploki SISSE
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos !== null) {
      const { blocks, openMarks } = view.state.field(marginaliaField);
      // Avatud grupi KÕIK liikmed on klammerdatavad (mitte ainult markeriga esimene).
      const openBlocks = groupMarginaliaBlocks(blocks)
        .filter(g => isGroupOpen(g, openMarks))
        .flatMap(g => g.blocks);
      const blk = openBlocks.find(b => pos >= b.from && pos <= b.to
        && (pos < b.contentFrom || pos > b.contentTo));
      if (blk) {
        view.dispatch({ selection: { anchor: pos < blk.contentFrom ? blk.contentFrom : blk.contentTo } });
        view.focus();
        event.preventDefault();
        return true;
      }
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
// Filtreeritakse ainult userEvent-annotatsiooniga tehinguid (vt CLAUDE.md).
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

// --- Avalik laiendusfabrik ---
// Kaitsefilter peab olema VIIMANE listis (vt CLAUDE.md VuttMarkupExtension reeglid)

export function marginaliaExtension(mode: MarginaliaMode): Extension {
  return [
    modeFacet.of(mode),
    marginaliaField,
    marginaliaDecoField,
    marginaliaClickHandler,
    marginaliaKeymap,
    marginaliaOverlayPlugin,
    marginaliaProtectionFilter,
  ];
}
