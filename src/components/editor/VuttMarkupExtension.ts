// VuttMarkupExtension.ts — CM6 dekoraatoriextension VUTT XML märgenduse jaoks

import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { RangeSetBuilder, StateField } from '@codemirror/state';
import type { Extension } from '@codemirror/state';

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

interface MarkupSets {
  deco: DecorationSet;
  atomic: DecorationSet;
}

const atomicReplace = Decoration.replace({});

// Arvutab korraga nii visuaalsed dekoratsioonid kui ka aatomilised vahemikud
function buildMarkup(text: string): MarkupSets {
  const decoRanges: { from: number; to: number; deco: Decoration }[] = [];
  const atomicRanges: { from: number; to: number; deco: Decoration }[] = [];

  for (const tagDef of VUTT_TAGS) {
    if (tagDef.selfClose) {
      const re = new RegExp(`<${tagDef.tag}\\/>`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        const from = m.index;
        const to = m.index + m[0].length;
        const deco = Decoration.replace({ widget: new PageBreakWidget() });
        decoRanges.push({ from, to, deco });
        atomicRanges.push({ from, to, deco: atomicReplace });
      }
    } else if (tagDef.useWidget) {
      const re = new RegExp(`<${tagDef.tag}>(\\d+)<\\/${tagDef.tag}>`, 'g');
      let m;
      while ((m = re.exec(text)) !== null) {
        const from = m.index;
        const to = m.index + m[0].length;
        const deco = Decoration.replace({ widget: new FootnoteWidget(m[1]) });
        decoRanges.push({ from, to, deco });
        atomicRanges.push({ from, to, deco: atomicReplace });
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

        // Avatägi
        decoRanges.push({ from: openIdx, to: contentStart, deco: Decoration.replace({}) });
        atomicRanges.push({ from: openIdx, to: contentStart, deco: atomicReplace });
        
        // Sisu
        if (contentStart < contentEnd && tagDef.cls) {
          decoRanges.push({ from: contentStart, to: contentEnd, deco: Decoration.mark({ class: tagDef.cls }) });
        }
        
        // Sulgtägi
        decoRanges.push({ from: contentEnd, to: closeEnd, deco: Decoration.replace({}) });
        atomicRanges.push({ from: contentEnd, to: closeEnd, deco: atomicReplace });

        searchFrom = closeEnd;
      }
    }
  }

  // Sorteerimine from ASC, to DESC
  const sortFn = (a: any, b: any) => {
    if (a.from !== b.from) return a.from - b.from;
    return b.to - a.to;
  };

  decoRanges.sort(sortFn);
  atomicRanges.sort(sortFn);

  const decoBuilder = new RangeSetBuilder<Decoration>();
  let lastReplaceEnd = -1;
  for (const r of decoRanges) {
    const isReplace = !!(r.deco.spec.widget || r.deco.spec.replaceWith || (r.from < r.to && !r.deco.spec.class));
    if (isReplace) {
      if (r.from < lastReplaceEnd) continue; // Ära lisa kattuvaid asendusi
      lastReplaceEnd = r.to;
    }
    decoBuilder.add(r.from, r.to, r.deco);
  }

  const atomicBuilder = new RangeSetBuilder<Decoration>();
  let lastAtomicEnd = -1;
  for (const r of atomicRanges) {
    if (r.from < lastAtomicEnd) continue;
    lastAtomicEnd = r.to;
    atomicBuilder.add(r.from, r.to, r.deco);
  }

  return { deco: decoBuilder.finish(), atomic: atomicBuilder.finish() };
}

export const vuttMarkupField = StateField.define<MarkupSets>({
  create(state) {
    return buildMarkup(state.doc.toString());
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    return buildMarkup(tr.newDoc.toString());
  },
  provide: f => [
    EditorView.decorations.from(f, val => val.deco),
    EditorView.atomicRanges.from(f, val => val.atomic)
  ]
});

export const vuttMarkupExtension: Extension = [
  vuttMarkupField
];
