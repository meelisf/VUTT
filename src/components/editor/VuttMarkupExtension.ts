// VuttMarkupExtension.ts — CM6 dekoraatoriextension VUTT XML märgenduse jaoks

import { ViewPlugin, Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, RangeSet, StateField } from '@codemirror/state';
import type { Extension, Transaction } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';

// Widget <pb/> (leheküljevahetus) kuvamiseks
class PageBreakWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'vutt-pb-widget';
    span.textContent = '── lk ──';
    return span;
  }
  ignoreEvent() { return false; }
}

// Widget <fn>n</fn> (joonealuse viite marker) kuvamiseks
class FootnoteWidget extends WidgetType {
  constructor(readonly num: string) { super(); }
  toDOM() {
    const sup = document.createElement('sup');
    sup.className = 'vutt-fn-widget';
    sup.textContent = this.num;
    return sup;
  }
  eq(other: FootnoteWidget) { return this.num === other.num; }
  ignoreEvent() { return false; }
}

interface TagDef {
  tag: string;
  cls?: string;
  selfClose?: boolean;
  useWidget?: boolean;
}

const VUTT_TAGS: TagDef[] = [
  { tag: 'i',  cls: 'vutt-italic' },
  { tag: 'b',  cls: 'vutt-bold' },
  { tag: 'cs', cls: 'vutt-cs' },
  { tag: 'm',  cls: 'vutt-marginalia' },
  { tag: 'hi', cls: 'vutt-highlight' },
  { tag: 'fn', useWidget: true },
  { tag: 'pb', selfClose: true },
];

// Väärtus atomicRanges RangeSet'is — ainult positsioonid loevad, väärtus mitte
const atomicDeco = Decoration.replace({});

// Arvutab kõik peidetud tägide positsioonid (atomicRanges jaoks).
// Kutsutakse StateFieldi create/update'is — alati sünkroonne ja ajakohane.
function computeAtomicRanges(text: string): RangeSet<Decoration> {
  const list: { from: number; to: number }[] = [];

  for (const tagDef of VUTT_TAGS) {
    if (tagDef.selfClose) {
      const re = /<pb\/>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        list.push({ from: m.index, to: m.index + m[0].length });
      }
    } else if (tagDef.useWidget) {
      const re = new RegExp(`<${tagDef.tag}>(\\d+)<\\/${tagDef.tag}>`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        list.push({ from: m.index, to: m.index + m[0].length });
      }
    } else {
      const openTag = `<${tagDef.tag}>`;
      const closeTag = `</${tagDef.tag}>`;
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const openIdx = text.indexOf(openTag, searchFrom);
        if (openIdx === -1) break;
        const closeIdx = text.indexOf(closeTag, openIdx + openTag.length);
        if (closeIdx === -1) break;
        list.push({ from: openIdx,   to: openIdx + openTag.length });    // avatägi
        list.push({ from: closeIdx,  to: closeIdx + closeTag.length });   // sulgtägi
        searchFrom = closeIdx + closeTag.length;
      }
    }
  }

  list.sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of list) {
    builder.add(from, to, atomicDeco);
  }
  return builder.finish();
}

// StateField hoiab atomicRanges'i — uuendatakse ainult dokumendi muutusel,
// mitte viewport muutusel. view.plugin() indirektsioon puudub täielikult.
const hiddenTagField = StateField.define<RangeSet<Decoration>>({
  create(state) {
    return computeAtomicRanges(state.doc.toString());
  },
  update(value: RangeSet<Decoration>, tr: Transaction) {
    if (!tr.docChanged) return value;
    return computeAtomicRanges(tr.newDoc.toString());
  },
});

// Arvutab visuaalsed dekoratsioonid (Decoration.replace + Decoration.mark).
function buildDecorations(text: string): DecorationSet {
  const ranges: { from: number; to: number; deco: Decoration }[] = [];

  for (const tagDef of VUTT_TAGS) {
    if (tagDef.selfClose) {
      const re = /<pb\/>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        ranges.push({ from: m.index, to: m.index + m[0].length, deco: Decoration.replace({ widget: new PageBreakWidget() }) });
      }
    } else if (tagDef.useWidget) {
      const re = new RegExp(`<${tagDef.tag}>(\\d+)<\\/${tagDef.tag}>`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        ranges.push({ from: m.index, to: m.index + m[0].length, deco: Decoration.replace({ widget: new FootnoteWidget(m[1]) }) });
      }
    } else {
      const openTag = `<${tagDef.tag}>`;
      const closeTag = `</${tagDef.tag}>`;
      let searchFrom = 0;
      while (searchFrom < text.length) {
        const openIdx = text.indexOf(openTag, searchFrom);
        if (openIdx === -1) break;
        const closeIdx = text.indexOf(closeTag, openIdx + openTag.length);
        if (closeIdx === -1) break;

        const contentStart = openIdx + openTag.length;
        const contentEnd = closeIdx;
        const closeEnd = closeIdx + closeTag.length;

        ranges.push({ from: openIdx,      to: contentStart, deco: Decoration.replace({}) });
        if (contentStart < contentEnd) {
          ranges.push({ from: contentStart, to: contentEnd,   deco: Decoration.mark({ class: tagDef.cls! }) });
        }
        ranges.push({ from: contentEnd,   to: closeEnd,     deco: Decoration.replace({}) });

        searchFrom = closeEnd;
      }
    }
  }

  ranges.sort((a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

// ViewPlugin — ainult visuaalsed dekoratsioonid
const vuttDecoPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc.toString());
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view.state.doc.toString());
      }
    }
  },
  { decorations: v => v.decorations }
);

// Eksport: StateField (atomicRanges) + atomicRanges facet + ViewPlugin (dekoratsioonid)
export const vuttMarkupExtension: Extension = [
  hiddenTagField,
  EditorView.atomicRanges.of(view => view.state.field(hiddenTagField)),
  vuttDecoPlugin,
];
