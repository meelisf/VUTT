// VuttMarkupExtension.ts — CM6 dekoraatoriextension VUTT XML märgenduse jaoks

import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { ChangeSet, EditorState, RangeSetBuilder, StateField, Transaction } from '@codemirror/state';
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

interface TagRange {
  from: number;
  to: number;
}

interface MarkupSets {
  deco: DecorationSet;
  atomic: DecorationSet;
  tagRanges: TagRange[]; // tägi positsioonid protection filteri jaoks
}

const atomicReplace = Decoration.replace({});

// Arvutab korraga nii visuaalsed dekoratsioonid kui ka aatomilised vahemikud
function buildMarkup(text: string): MarkupSets {
  const decoRanges: { from: number; to: number; deco: Decoration }[] = [];
  const atomicRanges: { from: number; to: number; deco: Decoration }[] = [];
  const tagRanges: TagRange[] = [];

  // Regulaaravaldis kõigi toetatud tägide leidmiseks
  const tagRegex = /<(\/?[a-z]+)(\d*)(\/?)>/g;
  let m;
  const stack: { tag: string; from: number; openEnd: number }[] = [];

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
      // Leheküljevahetus või muu isesulguv täg
      const widget = cleanTagName === 'pb' ? new PageBreakWidget() : null;
      const deco = Decoration.replace({ widget: widget || undefined });
      decoRanges.push({ from, to, deco });
      atomicRanges.push({ from, to, deco: atomicReplace });
      tagRanges.push({ from, to });
    } else if (isClosing) {
      // Sulgev täg: leiame vastava avava tägi pinust
      const openIdx = stack.map(s => s.tag).lastIndexOf(cleanTagName);
      if (openIdx !== -1) {
        const open = stack[openIdx];
        stack.splice(openIdx, 1);

        // Peidame sulgeva tägi (replace tähendab, et see ei võta ruumi)
        decoRanges.push({ from, to, deco: Decoration.replace({}) });
        atomicRanges.push({ from, to, deco: atomicReplace });
        tagRanges.push({ from, to });

        // Rakendame sisu stiili (nt kursiiv või marginalia taust)
        if (tagDef.cls && open.openEnd < from) {
          decoRanges.push({ from: open.openEnd, to: from, deco: Decoration.mark({ class: tagDef.cls }) });
        }
      }
    } else {
      // Avav täg
      if (tagDef.useWidget) {
        // Erijuht: <fn>1</fn> - asendame kogu bloki vidinaga
        const closeTag = `</${cleanTagName}>`;
        const closeIdx = text.indexOf(closeTag, to);
        if (closeIdx !== -1) {
          const num = text.slice(to, closeIdx);
          const deco = Decoration.replace({ widget: new FootnoteWidget(num) });
          const totalTo = closeIdx + closeTag.length;
          decoRanges.push({ from, to: totalTo, deco });
          atomicRanges.push({ from, to: totalTo, deco: atomicReplace });
          tagRanges.push({ from, to: totalTo });
          tagRegex.lastIndex = totalTo; // Hüppame üle sulgeva tägi
        }
      } else {
        // Tavaline avav täg: peidame (replace) ja paneme pinu otsa
        decoRanges.push({ from, to, deco: Decoration.replace({}) });
        atomicRanges.push({ from, to, deco: atomicReplace });
        tagRanges.push({ from, to });
        stack.push({ tag: cleanTagName, from, openEnd: to });
      }
    }
  }

  // Sorteerimine CodeMirrori reeglite järgi: from ASC, to ASC
  // RangeSetBuilder nõuab, et sama from korral oleks to kasvav (mitte kahanev)
  const sortFn = (a: any, b: any) => {
    if (a.from !== b.from) return a.from - b.from;
    return a.to - b.to;
  };

  decoRanges.sort(sortFn);
  atomicRanges.sort(sortFn);

  const decoBuilder = new RangeSetBuilder<Decoration>();
  let lastReplaceEnd = -1;
  for (const r of decoRanges) {
    // CodeMirroris ei tohi 'replace' dekoratsioonid omavahel kattuda.
    // 'mark' dekoratsioonid võivad replace'idega kattuda — CM6 näitab neid ainult nähtavas tekstis.
    const isReplace = !!(r.deco.spec.widget || r.deco.spec.replaceWith || !r.deco.spec.class);

    if (isReplace && r.from < lastReplaceEnd) continue;
    if (isReplace) lastReplaceEnd = r.to;

    try {
      decoBuilder.add(r.from, r.to, r.deco);
    } catch (e) {
      // Ignoreeri vead, mis tekivad ebakorrektse XML-i puhul
    }
  }
  const atomicBuilder = new RangeSetBuilder<Decoration>();
  let lastAtomicEnd = -1;
  for (const r of atomicRanges) {
    if (r.from < lastAtomicEnd) continue;
    lastAtomicEnd = r.to;
    try {
      atomicBuilder.add(r.from, r.to, r.deco);
    } catch (e) {}
  }

  return { deco: decoBuilder.finish(), atomic: atomicBuilder.finish(), tagRanges };
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

// Transaction filter: kaitseb tägi positsioone kasutaja muudatuste eest.
// Kui kustutamine või asendus kattub tägi positsiooniga, lõigatakse täg muudatusest välja.
// Täid ei ole võimalik kogemata kustutada — ainult tägi sisestamiseks mõeldud toolbar-nupud toimivad.
const vuttTagProtectionFilter = EditorState.transactionFilter.of(tr => {
  // Ainult kasutaja käivitatud muudatused — programmaatilised (laadimine jms) jäetakse puutumata
  if (!tr.docChanged || !tr.annotation(Transaction.userEvent)) return tr;

  const { tagRanges } = tr.startState.field(vuttMarkupField);
  if (tagRanges.length === 0) return tr;

  // Kontrolli, kas mõni kustutamine kattub tägi positsiooniga
  let needsAdjust = false;
  tr.changes.iterChanges((fromA, toA) => {
    if (needsAdjust || fromA >= toA) return;
    for (const r of tagRanges) {
      if (r.from < toA && r.to > fromA) { needsAdjust = true; break; }
    }
  });
  if (!needsAdjust) return tr;

  // Rekonstrueeri muudatused, hoides tägi positsioonid puutumata
  const newSpecs: { from: number; to: number; insert: string }[] = [];

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const ins = inserted.toString();

    if (fromA === toA) {
      // Puhas sisestus — ära luba sisestada tägi sisse (kursorilt ei peaks see juhtuma,
      // aga kaitseme igaks juhuks)
      const insideTag = tagRanges.some(r => fromA > r.from && fromA < r.to);
      if (!insideTag) newSpecs.push({ from: fromA, to: fromA, insert: ins });
      return;
    }

    // Kustutamine (võimalik koos sisestusega) — leia kattuvad tägid
    const overlapping = tagRanges
      .filter(r => r.from < toA && r.to > fromA)
      .sort((a, b) => a.from - b.from);

    if (overlapping.length === 0) {
      newSpecs.push({ from: fromA, to: toA, insert: ins });
      return;
    }

    // Kogu nähtavad lõigud (tägide vahel ja ümber) mida on lubatud kustutada
    const segments: { from: number; to: number }[] = [];
    let pos = fromA;
    for (const tag of overlapping) {
      const segEnd = Math.min(tag.from, toA);
      if (pos < segEnd) segments.push({ from: pos, to: segEnd });
      pos = Math.max(pos, tag.to);
    }
    if (pos < toA) segments.push({ from: pos, to: toA });

    if (segments.length === 0) {
      // Kogu selekteeritud ala on tägid — ainult sisestus (tippimise asendus), kui on
      if (ins) newSpecs.push({ from: fromA, to: fromA, insert: ins });
    } else {
      // Esimene nähtav lõik saab sisestuse (tippimise asenduse korral), ülejäänud kustutatakse
      newSpecs.push({ from: segments[0].from, to: segments[0].to, insert: ins });
      for (let i = 1; i < segments.length; i++) {
        newSpecs.push({ from: segments[i].from, to: segments[i].to, insert: '' });
      }
    }
  });

  try {
    const docLen = tr.startState.doc.length;
    const newChanges = newSpecs.length > 0
      ? ChangeSet.of(newSpecs, docLen)
      : ChangeSet.empty(docLen);
    const userEvent = tr.annotation(Transaction.userEvent);
    return {
      changes: newChanges,
      ...(userEvent !== undefined && { annotations: Transaction.userEvent.of(userEvent) }),
      scrollIntoView: tr.scrollIntoView,
    };
  } catch {
    // Viga muudatuste rekonstrueerimisel — lase originaal läbi
    return tr;
  }
});

export const vuttMarkupExtension: Extension = [
  vuttMarkupField,
  vuttTagProtectionFilter,
];
