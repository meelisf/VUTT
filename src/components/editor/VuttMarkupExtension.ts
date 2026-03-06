// VuttMarkupExtension.ts — CM6 dekoraatoriextension VUTT XML märgenduse jaoks
// XML tägid peidetakse alati (mitte cursor-reveals), sisestamine ainult toolbar kaudu.

import { ViewPlugin, Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, RangeSet } from '@codemirror/state';
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

// VUTT märgendussüsteemi XML-tägide definitsioonid
const VUTT_TAGS: TagDef[] = [
  { tag: 'i',  cls: 'vutt-italic' },
  { tag: 'b',  cls: 'vutt-bold' },
  { tag: 'cs', cls: 'vutt-cs' },
  { tag: 'm',  cls: 'vutt-marginalia' },
  { tag: 'hi', cls: 'vutt-highlight' },
  { tag: 'fn', useWidget: true },
  { tag: 'pb', selfClose: true },
];

interface DecoRange {
  from: number;
  to: number;
  deco: Decoration;
}

// Aatomiline märgend — väärtus ei loe, ainult positsioon (EditorView.atomicRanges jaoks)
const atomicMark = Decoration.mark({});

interface BuildResult {
  decorations: DecorationSet;
  atomicRanges: RangeSet<Decoration>;
}

// Ehitab dekoraatorikogu + aatomilistede tägialade kogumi kogu dokumendi põhjal.
// atomicRanges tagab et kursor hüppab peidetud tägimärkide üle ühel sammul (mõlemas suunas).
function buildAll(view: EditorView): BuildResult {
  const text = view.state.doc.toString();
  const decoRanges: DecoRange[] = [];
  const atomicList: { from: number; to: number }[] = [];

  for (const tagDef of VUTT_TAGS) {
    if (tagDef.selfClose) {
      // <pb/> — asendame widget'iga
      const re = /<pb\/>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        decoRanges.push({ from: m.index, to: m.index + m[0].length, deco: Decoration.replace({ widget: new PageBreakWidget() }) });
        atomicList.push({ from: m.index, to: m.index + m[0].length });
      }

    } else if (tagDef.useWidget) {
      // <fn>n</fn> — asendame superscript widget'iga
      const re = new RegExp(`<${tagDef.tag}>(\\d+)<\\/${tagDef.tag}>`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        decoRanges.push({ from: m.index, to: m.index + m[0].length, deco: Decoration.replace({ widget: new FootnoteWidget(m[1]) }) });
        atomicList.push({ from: m.index, to: m.index + m[0].length });
      }

    } else {
      // <i>...</i>, <b>...</b> jne — peidame tägid, stailime sisu
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

        decoRanges.push({ from: openIdx, to: contentStart, deco: Decoration.replace({}) });
        atomicList.push({ from: openIdx, to: contentStart });

        if (contentStart < contentEnd) {
          decoRanges.push({ from: contentStart, to: contentEnd, deco: Decoration.mark({ class: tagDef.cls! }) });
        }

        decoRanges.push({ from: contentEnd, to: closeEnd, deco: Decoration.replace({}) });
        atomicList.push({ from: contentEnd, to: closeEnd });

        searchFrom = closeEnd;
      }
    }
  }

  decoRanges.sort((a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to);
  const decoBuilder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of decoRanges) {
    decoBuilder.add(from, to, deco);
  }

  atomicList.sort((a, b) => a.from - b.from);
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of atomicList) {
    atomicBuilder.add(from, to, atomicMark);
  }

  return { decorations: decoBuilder.finish(), atomicRanges: atomicBuilder.finish() };
}

// CM6 ViewPlugin — dekoraatoriextension + atomicRanges (kursor hüppab tägide üle)
export const vuttMarkupExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    atomicRanges: RangeSet<Decoration>;

    constructor(view: EditorView) {
      const r = buildAll(view);
      this.decorations = r.decorations;
      this.atomicRanges = r.atomicRanges;
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        const r = buildAll(update.view);
        this.decorations = r.decorations;
        this.atomicRanges = r.atomicRanges;
      }
    }
  },
  {
    decorations: v => v.decorations,
    // provide: EditorView.atomicRanges.of tagab et CM6 cursorCharRight/Left
    // hüppab peidetud tägimärkide (nt <i>, </cs>) üle ühel sammul, mitte char-haaval
    provide: plugin => EditorView.atomicRanges.of(view =>
      view.plugin(plugin)?.atomicRanges ?? RangeSet.empty
    ),
  }
);
