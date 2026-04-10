// VuttMarkupExtension.ts — CM6 dekoraatoriextension VUTT XML märgenduse jaoks
// TÖÖTAV MUDEL (2026-03):
// - tavalised paaristägid (<i>, </i>, <b>, </b>, ...) EI tohi olla Decoration.replace().
//   See murdis plain caret ArrowLeft/ArrowRight liikumise, kuigi Shift+Arrow selection töötas.
// - paaristägid on mark-dekoratsioon + atomicRanges: DOM-is peidetud, aga editori liikumine
//   käsitleb neid ühe vahemikuna.
// - replace/atomic on jäetud ainult päris widget-plokkidele (<pb/>, <fn>...</fn>).
// Orv tägid eemaldatakse automaatselt pärast kasutaja muudatust (vuttAutoSanitizer).

import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { Annotation, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
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
  withId?: boolean;  // lisab data-ann-id atribuudi numbrilise sufiksi järgi
}

const VUTT_TAGS: TagDef[] = [
  { tag: 'i',  cls: 'vutt-italic' },
  { tag: 'b',  cls: 'vutt-bold' },
  { tag: 'cs', cls: 'vutt-cs' },
  { tag: 'm',  cls: 'vutt-marginalia' },
  { tag: 'hi', cls: 'vutt-highlight' },
  { tag: 'fn', useWidget: true },
  { tag: 'pb', selfClose: true },
  { tag: 'ann', cls: 'vutt-ann', withId: true },
];

export interface TagRange {
  from: number;
  to: number;
}

interface MarkupSets {
  deco: DecorationSet;
  atomic: DecorationSet;
  tagRanges: TagRange[]; // kõik tägi positsioonid; hoitud tulevaste editori operatsioonide jaoks
}

const atomicMark = Decoration.mark({});

// Leiab orvud (paarita) tägid dokumendis. Teksti ennast ei muuda.
export function findOrphanTags(text: string): TagRange[] {
  const tagRegex = /<(\/?[a-z]+)(\d*)(\/?)>/g;
  const allTags: { from: number; to: number; tagName: string; isClose: boolean; isSelf: boolean }[] = [];
  let m;

  while ((m = tagRegex.exec(text)) !== null) {
    const rawName = m[1];
    const isClose = rawName.startsWith('/');
    const cleanName = isClose ? rawName.slice(1) : rawName;
    const isSelf = m[3] === '/' || cleanName === 'pb';
    if (!VUTT_TAGS.find(t => t.tag === cleanName)) continue;
    allTags.push({ from: m.index, to: m.index + m[0].length, tagName: cleanName, isClose, isSelf });
  }

  const orphans: TagRange[] = [];
  const tagNames = [...new Set(allTags.filter(t => !t.isSelf).map(t => t.tagName))];

  for (const name of tagNames) {
    const tags = allTags.filter(t => t.tagName === name);
    const stack: typeof allTags = [];
    const unmatched: typeof allTags = [];

    for (const t of tags) {
      if (!t.isClose) {
        stack.push(t);
      } else {
        if (stack.length > 0) {
          stack.pop(); // sobiv paar leitud
        } else {
          unmatched.push(t); // orv sulge täg
        }
      }
    }
    for (const t of stack) unmatched.push(t); // orv avav täg
    for (const t of unmatched) orphans.push({ from: t.from, to: t.to });
  }

  return orphans;
}

// Arvutab dekoratsioonid, atomicRanges ja tagRanges.
function buildMarkup(text: string): MarkupSets {
  const decoRanges: { from: number; to: number; deco: Decoration; isReplace: boolean }[] = [];
  const atomicRanges: { from: number; to: number }[] = [];
  const tagRanges: TagRange[] = [];
  // CSS peidab selle klassi täielikult, aga tekst jääb dokumenti alles.
  // Koos atomicRanges-iga annab see stabiilsema kursori liikumise kui replace-dekoratsioon.
  const hiddenTagMark = Decoration.mark({ class: 'vutt-hidden-tag' });

  const tagRegex = /<(\/?[a-z]+)(\d*)(\/?)>/g;
  let m;
  const stack: { tag: string; from: number; openEnd: number; num: string }[] = [];

  while ((m = tagRegex.exec(text)) !== null) {
    const fullTag = m[0];
    const tagName = m[1];
    const isClosing = tagName.startsWith('/');
    const cleanTagName = isClosing ? tagName.slice(1) : tagName;
    const isSelfClosing = m[3] === '/' || fullTag === '<pb/>';

    const tagDef = VUTT_TAGS.find(t => t.tag === cleanTagName);
    if (!tagDef) continue;

    const from = m.index;
    const to = from + fullTag.length;

    if (isSelfClosing || tagDef.selfClose) {
      const widget = cleanTagName === 'pb' ? new PageBreakWidget() : null;
      const deco = Decoration.replace({ widget: widget || undefined, atomic: true });
      decoRanges.push({ from, to, deco, isReplace: true });
      atomicRanges.push({ from, to });
      tagRanges.push({ from, to });
    } else if (isClosing) {
      const openIdx = stack.map(s => s.tag).lastIndexOf(cleanTagName);
      if (openIdx !== -1) {
        const open = stack[openIdx];
        stack.splice(openIdx, 1);

        decoRanges.push({ from, to, deco: hiddenTagMark, isReplace: false });
        atomicRanges.push({ from, to });
        tagRanges.push({ from, to });

        // Sisu stiilmark (vutt-italic jne) — võib replace-idega kattuda
        if (tagDef.cls && open.openEnd < from) {
          const attrs = tagDef.withId && open.num
            ? { 'data-ann-id': open.num }
            : undefined;
          decoRanges.push({
            from: open.openEnd,
            to: from,
            deco: Decoration.mark({ class: tagDef.cls, attributes: attrs }),
            isReplace: false,
          });
        }
      }
    } else {
      // Avav täg
      if (tagDef.useWidget) {
        // <fn>n</fn>: kogu blokk ühe replace + FootnoteWidget
        const closeTag = `</${cleanTagName}>`;
        const closeIdx = text.indexOf(closeTag, to);
        if (closeIdx !== -1) {
          const totalTo = closeIdx + closeTag.length;
          const num = text.slice(to, closeIdx);
          const deco = Decoration.replace({ widget: new FootnoteWidget(num), atomic: true });
          decoRanges.push({ from, to: totalTo, deco, isReplace: true });
          atomicRanges.push({ from, to: totalTo });
          tagRanges.push({ from, to: totalTo });
          tagRegex.lastIndex = totalTo;
        }
      } else {
        decoRanges.push({ from, to, deco: hiddenTagMark, isReplace: false });
        atomicRanges.push({ from, to });
        tagRanges.push({ from, to });
        stack.push({ tag: cleanTagName, from, openEnd: to, num: m[2] });
      }
    }
  }

  // Sorteerimine CodeMirrori reeglite järgi: from ASC, to ASC
  const sortFn = (a: { from: number; to: number }, b: { from: number; to: number }) => {
    if (a.from !== b.from) return a.from - b.from;
    return a.to - b.to;
  };
  decoRanges.sort(sortFn);
  atomicRanges.sort(sortFn);

  // Replace-dekoratsioonid ei tohi kattuda. Mark-dekoratsioonid (sisu stiilid) võivad.
  const decoBuilder = new RangeSetBuilder<Decoration>();
  let lastReplaceEnd = -1;
  for (const r of decoRanges) {
    if (r.isReplace && r.from < lastReplaceEnd) continue;
    if (r.isReplace) lastReplaceEnd = r.to;
    decoBuilder.add(r.from, r.to, r.deco);
  }

  // EI ühenda atomilisi vahemikke.
  // Varasem katse naabervahemikke ühendada tekitas olukorra, kus kursor jäi ühendatud peitva
  // vahemiku sisse "kinni". Eraldi tag-range'id olid viimane töötav variant.
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  for (const r of atomicRanges) {
    atomicBuilder.add(r.from, r.to, atomicMark);
  }

  return { deco: decoBuilder.finish(), atomic: atomicBuilder.finish(), tagRanges };
}

export const vuttMarkupField = StateField.define<MarkupSets>({
  create(state) {
    return buildMarkup(state.doc.toString());
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    return buildMarkup(tr.state.doc.toString());
  },
  provide: f => [
    EditorView.decorations.from(f, val => val.deco),
    EditorView.atomicRanges.from(f, val => () => val.atomic),
  ],
});

// Märgendus, mis tähistab sanitiseerimis-tehingut — väldib rekursiooni
const SANITIZE = Annotation.define<true>();

// Peale iga kasutaja muudatuse: leia orvud tägid ja eemalda need automaatselt.
// Teksti ennast ei muudeta kunagi — eemaldatakse ainult paarita tägid.
const vuttAutoSanitizer = EditorView.updateListener.of(update => {
  if (!update.docChanged) return;
  const hasUserEvent = update.transactions.some(tr => tr.annotation(Transaction.userEvent) !== undefined);
  if (!hasUserEvent) return;
  const alreadySanitized = update.transactions.some(tr => tr.annotation(SANITIZE));
  if (alreadySanitized) return;

  const text = update.state.doc.toString();
  const orphans = findOrphanTags(text);
  if (orphans.length === 0) return;

  const changes = orphans
    .sort((a, b) => b.from - a.from) // tagantpoolt, et positsioonid ei nihkuks
    .map(o => ({ from: o.from, to: o.to, insert: '' }));

  update.view.dispatch({
    changes,
    annotations: [SANITIZE.of(true), Transaction.userEvent.of('input.format')],
  });
});
export const vuttMarkupExtension: Extension = [
  vuttMarkupField,
  vuttAutoSanitizer,
];
