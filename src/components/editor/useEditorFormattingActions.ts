import { useCallback, type MouseEvent, type MutableRefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { EditorSelection, Transaction } from '@codemirror/state';
import { vuttMarkupField } from './VuttMarkupExtension';
import { hiddenBlockRanges, marginaliaField, openMarginalia } from './MarginaliaExtension';
import { findContainer, findInnerPairs } from './wrapTagUtils';
import { cleanMarkupSpecs, marginaliaFromSelection, rangeTouchesOpenMarginalia } from '../../utils/marginaliaUtils';

interface UseEditorFormattingActionsParams {
  viewRef: MutableRefObject<EditorView | null>;
  readOnly: boolean;
}

// Toolbar'i vormindus- ja sisestustoimingud CodeMirror dokumendile.
export function useEditorFormattingActions({ viewRef, readOnly }: UseEditorFormattingActionsParams) {
  const wrapWithTag = useCallback((tag: string) => {
    const view = viewRef.current;
    if (!view || readOnly) return;

    const { from, to } = view.state.selection.main;
    const docText = view.state.doc.toString();
    const openTag = `<${tag}>`;
    const closeTag = `</${tag}>`;

    // 1. KÄSITLUS ILMA VALIKUTA (kursor)
    if (from === to) {
      const line = view.state.doc.lineAt(from);
      const container = findContainer(tag, from, docText, line.from, line.to);
      if (container) {
        // Kui kursor on tägi sees, eemaldame tägi
        const changes = [
          { from: container.open, to: container.openEnd, insert: '' },
          { from: container.close, to: container.closeEnd, insert: '' },
        ];
        view.dispatch({
          changes,
          selection: EditorSelection.cursor(view.state.changes(changes).mapPos(from))
        });
      } else {
        // Muul juhul lisame tühjad tägid ja viime kursori vahele
        view.dispatch({
          changes: { from, insert: openTag + closeTag },
          selection: EditorSelection.cursor(from + openTag.length),
        });
      }
      view.focus();
      return;
    }

    // 2. KÄSITLUS VALIKUGA (võib olla mitu rida)
    const lineFrom = view.state.doc.lineAt(from);
    const lineTo = view.state.doc.lineAt(to);
    const changes: { from: number; to: number; insert: string }[] = [];

    // OTSUSTAMINE: Kas me pakime lahti (unwrap) või paneme tägi ümber (wrap)?
    // Reegel: Kui esimese valitud rea sisu on juba tägi sees, siis me pakime LAHTI kõik valitud read.
    let mode: 'wrap' | 'unwrap' = 'wrap';
    for (let i = lineFrom.number; i <= lineTo.number; i++) {
      const line = view.state.doc.line(i);
      let sFrom = Math.max(from, line.from);
      let sTo = Math.min(to, line.to);

      // Puhastame servadest tühikud otsuse tegemiseks
      while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
      while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;

      if (sFrom < sTo) {
        const container = findContainer(tag, sFrom, docText, line.from, line.to);
        if (container && sTo <= container.closeEnd) {
          mode = 'unwrap';
        }
        break; // Võtame esimese sisulise rea järgi otsuse vastu
      }
    }

    // TEGEVUS: Käime read läbi ja rakendame muudatused
    for (let i = lineFrom.number; i <= lineTo.number; i++) {
      const line = view.state.doc.line(i);
      let sFrom = Math.max(from, line.from);
      let sTo = Math.min(to, line.to);

      // Puhastame valiku servadest tühikud/reavahetused
      while (sTo > sFrom && /\s/.test(docText[sTo - 1])) sTo--;
      while (sFrom < sTo && /\s/.test(docText[sFrom])) sFrom++;

      if (sFrom >= sTo) continue; // Tühi rida jääb vahele

      // NUTIKAS PESASTAMINE: Kui mähime stiili-tägiga (i, b, cs), siis
      // liigume automaatselt struktuuri-tägide (m, hi, fn) SISSE.
      if (mode === 'wrap' && ['i', 'b', 'cs'].includes(tag)) {
        let adjusted = true;
        while (adjusted) {
          adjusted = false;
          // 1. Kontrollime algust: kas sFrom juures algab suvaline täg?
          const startTagMatch = docText.slice(sFrom, sFrom + 20).match(/^<[^>]+>/);
          if (startTagMatch) {
            const tagName = startTagMatch[0].match(/[a-z]+/)?.[0];
            // Kui on struktuuri-täg, hüppame sisse
            if (tagName && ['m', 'hi', 'fn'].includes(tagName)) {
              sFrom += startTagMatch[0].length;
              adjusted = true;
            }
          }

          // 2. Kontrollime lõppu: kas sTo juures lõpeb suvaline täg?
          const endTagMatch = docText.slice(Math.max(0, sTo - 15), sTo).match(/<\/[^>]+>$/);
          if (endTagMatch) {
            const tagName = endTagMatch[0].match(/[a-z]+/)?.[0];
            if (tagName && ['m', 'hi', 'fn'].includes(tagName)) {
              sTo -= endTagMatch[0].length;
              adjusted = true;
            }
          }

          if (sFrom >= sTo) break;
        }
      }

      if (mode === 'unwrap') {
        const container = findContainer(tag, sFrom, docText, line.from, line.to);
        if (container && sTo <= container.closeEnd) {
          changes.push({ from: container.open, to: container.openEnd, insert: '' });
          changes.push({ from: container.close, to: container.closeEnd, insert: '' });
        }
      } else {
        // Kui sFrom/sTo asub olemasoleva sama tägi sees, laienda piir tägi alguse/lõpuni
        const startContainer = findContainer(tag, sFrom, docText, line.from, line.to);
        if (startContainer && sFrom > startContainer.open) sFrom = startContainer.open;
        const endContainer = findContainer(tag, sTo, docText, line.from, line.to);
        if (endContainer && sTo < endContainer.closeEnd) sTo = endContainer.closeEnd;

        // WRAP: Eemaldame enne sisemised sama tüüpi tägid, et vältida dubleerimist
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
    }

    if (changes.length > 0) {
      const tr = view.state.update({
        changes,
        selection: EditorSelection.range(
          view.state.changes(changes).mapPos(from, 1),
          view.state.changes(changes).mapPos(to, -1)
        ),
        scrollIntoView: false,
        annotations: Transaction.userEvent.of('input.format')
      });
      view.dispatch(tr);
    }
    view.focus();
  }, [readOnly, viewRef]);

  const insertAtCursor = useCallback((text: string) => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    view.dispatch(view.state.replaceSelection(text));
    view.focus();
  }, [readOnly, viewRef]);

  const insertSpecialChar = useCallback((char: string, e?: MouseEvent) => {
    if (e) e.preventDefault();
    insertAtCursor(char);
  }, [insertAtCursor]);

  // Uus marginaalia: valik tõstetakse <m> plokki valiku algusrea kohale;
  // ilma valikuta tühi <m></m> kursori rea kohale. Mõlemal juhul kohe avatuna.
  const insertMarginalia = useCallback(() => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    let { from, to } = view.state.selection.main;
    const marginaliaState = view.state.field(marginaliaField);

    // Avatud marginaalia on juba marginaalia: nupp ei tohi selle sisse uut
    // `<m>` paari tekitada. See oli pesastatud `<m><m>…` vigade põhiallikas.
    if (rangeTouchesOpenMarginalia(
      marginaliaState.blocks, marginaliaState.openMarks, from, to,
    )) {
      view.focus();
      return;
    }

    if (from === to) {
      const line = view.state.doc.lineAt(from);
      view.dispatch({
        changes: { from: line.from, insert: '<m></m>\n' },
        effects: openMarginalia.of(line.from + 3),
        selection: EditorSelection.cursor(line.from + 3),
        annotations: Transaction.userEvent.of('input.format'),
      });
      view.focus();
      return;
    }

    // Laienda valikut üle poolikute tägide (sama loogika mis cleanMarkup)
    const { tagRanges } = view.state.field(vuttMarkupField);
    for (const r of tagRanges) {
      if (r.from < to && r.to > from) {
        from = Math.min(from, r.from);
        to = Math.max(to, r.to);
      }
    }
    // Tägipiirini laiendamine võib valikusse lisada avatud marginaalia, kuigi
    // algne hiirevalik seda toorpositsioonides ei puudutanud.
    if (rangeTouchesOpenMarginalia(
      marginaliaState.blocks, marginaliaState.openMarks, from, to,
    )) {
      view.focus();
      return;
    }

    const hidden = hiddenBlockRanges(view.state).filter(h => h.from < to && h.to > from);
    const { changes, openPositions, cursor } = marginaliaFromSelection(
      view.state.doc.toString(), from, to, hidden,
    );
    view.dispatch({
      changes,
      effects: openPositions.map(pos => openMarginalia.of(pos)),
      selection: EditorSelection.cursor(cursor),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
  }, [readOnly, viewRef]);

  const cleanMarkup = useCallback(() => {
    const view = viewRef.current;
    if (!view || readOnly) return;
    let { from, to } = view.state.selection.main;
    if (from === to) return;

    // Laienda valikut, et hõlmata kõik osaliselt kattuvad tägid
    // (mouse-valik võib lõppeda tägi sees → ilma laienduseta jääb poolik täg alles)
    const { tagRanges } = view.state.field(vuttMarkupField);
    for (const r of tagRanges) {
      if (r.from < to && r.to > from) {
        from = Math.min(from, r.from);
        to = Math.max(to, r.to);
      }
    }

    // Puhasta iga nähtav segment ERALDI muudatusena — peidetud marginaalia
    // plokke ei puudutata üldse, nii jäävad nad oma ridadele ja ankrutele
    // (üks valikut kattev muudatus laseks kaitsefiltril ploki valiku lõppu
    // nihutada, kus ta degradeeruks inline-margiks)
    const hidden = hiddenBlockRanges(view.state).filter(h => h.from < to && h.to > from);
    const specs = cleanMarkupSpecs(
      view.state.doc.toString(), from, to, hidden,
      s => s.replace(/<\/?(?:i|b|cs|m|hi|fn|pb)[^>]*>/g, ''),
    );
    if (specs.length === 0) return;
    const changes = view.state.changes(specs);

    view.dispatch({
      changes,
      selection: EditorSelection.range(changes.mapPos(from, -1), changes.mapPos(to, 1)),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
  }, [readOnly, viewRef]);

  return {
    wrapWithTag,
    insertAtCursor,
    insertSpecialChar,
    insertMarginalia,
    cleanMarkup,
  };
}
