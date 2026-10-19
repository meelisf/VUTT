/**
 * Kandidaatteksti diff redaktoris (#641; base on parameeter, et sobiks ka #577-le).
 *
 * `setProposalBase.of(tekst)` lülitab esiletõstmise sisse: dokument võrreldakse
 * base'iga ja lisatu saab mark-dekoratsiooni, kustutatu näidatakse lugemiseks
 * läbikriipsutatud widgetina. Mark, mitte replace (VuttMarkupExtension reeglid);
 * widget ei redigeeri dokumenti. `null` lülitab välja (lehepööre).
 */
import { StateEffect, StateField, type Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { diffWords } from '../../utils/textDiff';

export const setProposalBase = StateEffect.define<string | null>();

class DeletedWidget extends WidgetType {
  constructor(readonly text: string) { super(); }
  eq(other: DeletedWidget) { return other.text === this.text; }
  toDOM() {
    const el = document.createElement('span');
    el.className = 'vutt-prop-del';
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() { return true; }
}

// Replace-dekoratsioonid (VuttMarkupExtension): nende sisse widgetit ei panda.
const REPLACED_RE = /<pb\s*\/>|<fn>[\s\S]*?<\/fn>/g;

export function proposalRanges(base: string, doc: string) {
  const ins: [number, number][] = [];
  const del: { pos: number; text: string }[] = [];
  let pos = 0;
  for (const o of diffWords(base, doc)) {
    if (o.op === 'eq') pos += o.text.length;
    else if (o.op === 'ins') { ins.push([pos, pos + o.text.length]); pos += o.text.length; }
    else del.push({ pos, text: o.text });
  }
  const replaced = [...doc.matchAll(REPLACED_RE)].map(m => [m.index!, m.index! + m[0].length]);
  return {
    ins,
    del: del.filter(d => !replaced.some(([a, b]) => d.pos > a && d.pos < b)),
  };
}

function build(base: string | null, doc: string): DecorationSet {
  if (base === null) return Decoration.none;
  const { ins, del } = proposalRanges(base, doc);
  const ranges: Range<Decoration>[] = [
    ...ins.map(([a, b]) => Decoration.mark({ class: 'vutt-prop-ins' }).range(a, b)),
    ...del.map(d => Decoration.widget({ widget: new DeletedWidget(d.text), side: -1 }).range(d.pos)),
  ];
  // `Decoration.set(…, true)` sorteerib (from ASC, sama from korral startSide).
  return Decoration.set(ranges, true);
}

export const proposalDiffField = StateField.define<{ base: string | null; deco: DecorationSet }>({
  create: () => ({ base: null, deco: Decoration.none }),
  update(value, tr) {
    let base = value.base;
    for (const e of tr.effects) if (e.is(setProposalBase)) base = e.value;
    if (base === value.base && !tr.docChanged) return value;
    return { base, deco: build(base, tr.state.doc.toString()) };
  },
  provide: f => EditorView.decorations.from(f, v => v.deco),
});

export const proposalDiffExtension = () => [proposalDiffField];
