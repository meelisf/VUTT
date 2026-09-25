import { useCallback, type MouseEvent, type MutableRefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import { EditorSelection, Transaction } from '@codemirror/state';
import { vuttMarkupField } from './VuttMarkupExtension';
import { hiddenBlockRanges, marginaliaField, openMarginalia } from './MarginaliaExtension';
import { findContainer, selectionWrapChanges } from './wrapTagUtils';
import { cleanMarkupSpecs, marginaliaFromSelection, openGroupAt, rangeTouchesOpenMarginalia, toggleGroupStyle } from '../../utils/marginaliaUtils';

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
      // Kursor avatud marginaaliakaardi sees → stiil kogu kaardile (kasutaja
      // soov: dispositsioon kursiivi ilma põhiteksti puudutamata).
      if (tag === 'i' || tag === 'b' || tag === 'cs') {
        const { blocks, openMarks } = view.state.field(marginaliaField);
        const group = openGroupAt(blocks, openMarks, from);
        if (group) {
          const specs = toggleGroupStyle(docText, group, tag);
          if (specs.length > 0) {
            const changes = view.state.changes(specs);
            view.dispatch({
              changes,
              selection: EditorSelection.cursor(changes.mapPos(from, 1)),
              scrollIntoView: false,
              annotations: Transaction.userEvent.of('input.format'),
            });
          }
          view.focus();
          return;
        }
      }
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
    const changes = selectionWrapChanges(view.state, tag);

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
      // Tühjal real saab rida ise plokiks — muidu jääks ploki alla tühi rida.
      const emptyLine = line.text.trim() === '';
      view.dispatch({
        changes: emptyLine
          ? { from: line.from, to: line.to, insert: '<m></m>' }
          : { from: line.from, insert: '<m></m>\n' },
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
