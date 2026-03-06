// VuttMarkupExtension.ts — CM6 dekoraatoriextension VUTT XML märgenduse jaoks
// XML tägid peidetakse alati (mitte cursor-reveals), sisestamine ainult toolbar kaudu.

import { ViewPlugin, Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';

// Nähtamatu widget tagi karakterite asendamiseks — teeb ala atoomiliseks
// (kursor hüppab üle, mitte ei roomab tähthaaval peidetud tagi sees)
class HiddenTagWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'vutt-tag-hidden';
    span.setAttribute('aria-hidden', 'true');
    return span;
  }
  ignoreEvent() { return true; }
  get estimatedHeight() { return -1; }
}

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

// Ehitab dekoraatorikogu kogu dokumendi teksti põhjal.
// Märgendite nestimist toetab CM6 loomulikult (replace sees mark on OK).
function buildDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const ranges: DecoRange[] = [];

  for (const tagDef of VUTT_TAGS) {
    if (tagDef.selfClose) {
      // <pb/> — asendame widget'iga
      const re = /<pb\/>/g;
      let m;
      while ((m = re.exec(text)) !== null) {
        ranges.push({
          from: m.index,
          to: m.index + m[0].length,
          deco: Decoration.replace({ widget: new PageBreakWidget() }),
        });
      }

    } else if (tagDef.useWidget) {
      // <fn>n</fn> — asendame superscript widget'iga
      const re = new RegExp(`<${tagDef.tag}>(\\d+)<\\/${tagDef.tag}>`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        ranges.push({
          from: m.index,
          to: m.index + m[0].length,
          deco: Decoration.replace({ widget: new FootnoteWidget(m[1]) }),
        });
      }

    } else {
      // <i>...</i>, <b>...</b> jne — peidame tägid, stailime sisu
      // Toetab mitmerearilisi spanne: from..to võib ületada realõppe
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

        // Peidame avatägi — widget teeb ala atoomiliseks (kursor hüppab üle)
        ranges.push({ from: openIdx, to: contentStart, deco: Decoration.replace({ widget: new HiddenTagWidget() }) });
        // Stailime sisu
        if (contentStart < contentEnd) {
          ranges.push({ from: contentStart, to: contentEnd, deco: Decoration.mark({ class: tagDef.cls! }) });
        }
        // Peidame sulgtägi — sama
        ranges.push({ from: contentEnd, to: closeEnd, deco: Decoration.replace({ widget: new HiddenTagWidget() }) });

        searchFrom = closeEnd;
      }
    }
  }

  // Sorteerime from järgi (RangeSetBuilder nõue); sama from korral väiksem to ees
  ranges.sort((a, b) => a.from !== b.from ? a.from - b.from : a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to, deco } of ranges) {
    builder.add(from, to, deco);
  }
  return builder.finish();
}

// CM6 ViewPlugin — dekoraatoriextension, mis peidab XML tägid ja stailib sisu
export const vuttMarkupExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: v => v.decorations }
);
