import { EditorSelection, type ChangeSet, type EditorState } from '@codemirror/state';
import { cleanSelectionChanges } from './cleanSelection';
import { STRUCTURAL_TAGS, STYLE_TAGS } from '../../markup/consumers';

// wrapWithTag abifunktsioonid

export interface TagPair {
  open: number; openEnd: number; close: number; closeEnd: number;
}

/**
 * Leiab, kas antud positsioon asub konkreetse tägi vahel.
 * Otsing on piiratud searchFrom ja searchTo vahemikuga (tavaliselt üks rida).
 */
export function findContainer(tag: string, pos: number, docText: string, searchFrom = 0, searchTo = docText.length): TagPair | null {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;

  // Leiame viimase avava tägi ENNE positsiooni, aga vahemiku piires
  const lastOpen = docText.lastIndexOf(openTag, pos);
  if (lastOpen === -1 || lastOpen < searchFrom) return null;

  // Leiame esimese sulgeva tägi PÄRAST seda avavat tägi
  const firstClose = docText.indexOf(closeTag, lastOpen + openTag.length);
  if (firstClose === -1 || firstClose > searchTo) return null;

  const closeEnd = firstClose + closeTag.length;
  // Kontrollime, kas kursor/valik on tõesti selle paari vahel
  if (pos >= lastOpen && pos <= closeEnd) {
    return { open: lastOpen, openEnd: lastOpen + openTag.length, close: firstClose, closeEnd };
  }
  return null;
}

/**
 * Nagu findContainer, aga paaritus käib üle kogu dokumendi (sulgev täg seotakse
 * viimase avatud sama nimega tägiga) ja leitakse SISEMINE pos-i sisaldav paar.
 * Mitmerealine paar (Enter keset `<f>`-rida, ADR 0077 p 3a) leitakse samuti —
 * reapõhine otsing ei leidnud teda ja lüliti mähkis topelt.
 */
export function findContainerGlobal(tag: string, pos: number, docText: string): TagPair | null {
  const re = new RegExp(`<(/?)${tag}>`, 'g');
  const stack: number[] = [];
  let best: TagPair | null = null;
  for (const m of docText.matchAll(re)) {
    if (!m[1]) { stack.push(m.index); continue; }
    const open = stack.pop();
    if (open === undefined) continue;
    const closeEnd = m.index + m[0].length;
    if (pos >= open && pos <= closeEnd && (!best || open > best.open)) {
      best = { open, openEnd: open + tag.length + 2, close: m.index, closeEnd };
    }
  }
  return best;
}

/**
 * Leiab kõik antud tägi paarid vahemikus [from, to].
 */
export function findInnerPairs(tag: string, from: number, to: number, docText: string): TagPair[] {
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const pairs: TagPair[] = [];
  let searchFrom = from;
  while (searchFrom < to) {
    const openIdx = docText.indexOf(openTag, searchFrom);
    if (openIdx === -1 || openIdx >= to) break;
    const closeIdx = docText.indexOf(closeTag, openIdx + openTag.length);
    if (closeIdx === -1 || closeIdx > to) break; // Sulgev tägi peab ka jääma vahemikku
    const closeEnd = closeIdx + closeTag.length;
    if (openIdx >= from && closeEnd <= to) {
      pairs.push({ open: openIdx, openEnd: openIdx + openTag.length, close: closeIdx, closeEnd });
    }
    searchFrom = closeEnd;
  }
  return pairs;
}

// Teineteist välistavad stiilid (ADR 0077 p 3): gooti kirjal kursiivi ei ole.
const EXCLUSIVE: Record<string, string> = { i: 'f', f: 'i' };

/**
 * Stiilitägi lülitamine VALIKU peal (võib olla mitu rida). Tagastab muudatused;
 * dispatch ja valiku kaardistus jäävad kutsujale (`wrapWithTag`).
 * - lahtipakkimine = „Puhasta" ainult selle tägi kohta (paar poolitub valiku
 *   kohalt, paaritus üle kogu dokumendi);
 * - `<i>` mähkimine eemaldab valikult enne `<f>`-i ja vastupidi:
 *   `<f>den ⟦exercitiis⟧ finden</f>` + i → `<f>den </f><i>exercitiis</i><f> finden</f>`.
 */
export function selectionWrapChanges(state: EditorState, tag: string): ChangeSet {
  const { from, to } = state.selection.main;
  const other = EXCLUSIVE[tag];
  if (other && wrapMode(state, tag) === 'wrap') {
    const first = state.changes(cleanSelectionChanges(state.doc.toString(), from, to, [], [other]));
    if (!first.empty) {
      const next = state.update({
        changes: first,
        selection: EditorSelection.range(first.mapPos(from, 1), first.mapPos(to, -1)),
      }).state;
      return first.compose(next.changes(wrapSpecs(next, tag)));
    }
  }
  return state.changes(wrapSpecs(state, tag));
}

/**
 * NUTIKAS PESASTAMINE: stiilitägi (i, b, f) puhul liigume struktuuri-tägide
 * (registri wrapBlock: m, hi, add, fn, lehe tähistus) SISSE. Nii otsustamisel kui
 * tegevusel — muidu nägi otsus valikut `<m><i>ab</i></m>` mähkimisena ja jättis
 * orvu `<m><i>ab</m>`.
 */
function skipStructural(docText: string, tag: string, sFrom: number, sTo: number): [number, number] {
  if (!STYLE_TAGS.includes(tag)) return [sFrom, sTo];
  let adjusted = true;
  while (adjusted) {
    adjusted = false;
    const startTagMatch = docText.slice(sFrom, sFrom + 20).match(/^<[^>]+>/);
    const startName = startTagMatch?.[0].match(/[a-z]+/)?.[0];
    if (startTagMatch && startName && STRUCTURAL_TAGS.includes(startName)) {
      sFrom += startTagMatch[0].length;
      adjusted = true;
    }
    const endTagMatch = docText.slice(Math.max(0, sTo - 15), sTo).match(/<\/[^>]+>$/);
    const endName = endTagMatch?.[0].match(/[a-z]+/)?.[0];
    if (endTagMatch && endName && STRUCTURAL_TAGS.includes(endName)) {
      sTo -= endTagMatch[0].length;
      adjusted = true;
    }
    if (sFrom >= sTo) break;
  }
  return [sFrom, sTo];
}

/** Valiku rea `line` sisuline osa: servatühikud maha, struktuuritägide sisse. */
function lineSegment(state: EditorState, tag: string, lineNo: number): [number, number] {
  const { from, to } = state.selection.main;
  const docText = state.doc.toString();
  const line = state.doc.line(lineNo);
  let sFrom = Math.max(from, line.from);
  let sTo = Math.min(to, line.to);
  while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
  while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;
  if (sFrom >= sTo) return [sFrom, sFrom];
  return skipStructural(docText, tag, sFrom, sTo);
}

/**
 * Kas lüliti mähib või pakib lahti: otsustab esimene sisuline valitud rida —
 * kui ta on juba tägi sees (paaritus üle kogu dokumendi), pakitakse lahti.
 */
function wrapMode(state: EditorState, tag: string): 'wrap' | 'unwrap' {
  const { from, to } = state.selection.main;
  const docText = state.doc.toString();
  for (let i = state.doc.lineAt(from).number; i <= state.doc.lineAt(to).number; i++) {
    const [sFrom, sTo] = lineSegment(state, tag, i);
    if (sFrom >= sTo) continue;
    const container = findContainerGlobal(tag, sFrom, docText);
    return container && sTo <= container.closeEnd ? 'unwrap' : 'wrap';
  }
  return 'wrap';
}

function wrapSpecs(state: EditorState, tag: string): { from: number; to: number; insert: string }[] {
  if (wrapMode(state, tag) === 'unwrap') {
    const { from, to } = state.selection.main;
    return cleanSelectionChanges(state.doc.toString(), from, to, [], [tag]);
  }
  const { from, to } = state.selection.main;
  const docText = state.doc.toString();
  const openTag = `<${tag}>`;
  const closeTag = `</${tag}>`;
  const changes: { from: number; to: number; insert: string }[] = [];
  // Read läbi ükshaaval (tägid ei ületa reapiiri).
  for (let i = state.doc.lineAt(from).number; i <= state.doc.lineAt(to).number; i++) {
    const line = state.doc.line(i);
    let [sFrom, sTo] = lineSegment(state, tag, i);
    if (sFrom >= sTo) continue; // Tühi rida jääb vahele

    // Kui sFrom/sTo asub olemasoleva sama tägi sees, laienda piir tägi alguse/lõpuni
    const startContainer = findContainer(tag, sFrom, docText, line.from, line.to);
    if (startContainer && sFrom > startContainer.open) sFrom = startContainer.open;
    const endContainer = findContainer(tag, sTo, docText, line.from, line.to);
    if (endContainer && sTo < endContainer.closeEnd) sTo = endContainer.closeEnd;

    // Eemaldame enne sisemised sama tüüpi tägid, et vältida dubleerimist
    const innerPairs = findInnerPairs(tag, sFrom, sTo, docText);
    // Kui selektsioon algab/lõpeb täpselt olemasoleva tägi piiril, kasuta seda tägina
    // (ära loo uut tägi samale positsioonile — tekitaks konflikti ja pesastuse)
    const leadingPair = innerPairs.length > 0 && innerPairs[0].open === sFrom ? innerPairs[0] : null;
    const trailingPair = innerPairs.length > 0 && innerPairs[innerPairs.length - 1].closeEnd === sTo ? innerPairs[innerPairs.length - 1] : null;
    if (!leadingPair) changes.push({ from: sFrom, to: sFrom, insert: openTag });
    for (const p of innerPairs) {
      if (p === leadingPair) {
        changes.push({ from: p.close, to: p.closeEnd, insert: '' });
      } else if (p === trailingPair) {
        changes.push({ from: p.open, to: p.openEnd, insert: '' });
      } else {
        changes.push({ from: p.open, to: p.openEnd, insert: '' });
        changes.push({ from: p.close, to: p.closeEnd, insert: '' });
      }
    }
    if (!trailingPair) changes.push({ from: sTo, to: sTo, insert: closeTag });
  }
  return changes;
}
