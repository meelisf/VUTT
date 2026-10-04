import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markChangeAt, type CombiningMark } from '../../utils/combiningMarks';

// Kombineeriv märk kursori ees olevale tähele: makron (ADR 0062), tsirkumfleks,
// spiritus lenis/asper. Erimärkide paneeli nupud; makronil kiirklahv Alt-M.
// `input.type` nagu tavaline trükkimine — sanitiseerijad ja marginaalia
// kaitsefilter käituvad samuti.
export function applyCombiningMark(view: EditorView, kind: CombiningMark): boolean {
  if (!view.state.facet(EditorView.editable)) return false;
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const change = markChangeAt(line.text, head - line.from, kind);
  if (!change) return true; // võtame klahvi endale: Alt-M ei tohi trükkida „µ" vms
  const from = line.from + change.from;
  view.dispatch({
    changes: { from, to: line.from + change.to, insert: change.insert },
    selection: EditorSelection.cursor(from + change.insert.length),
    annotations: Transaction.userEvent.of('input.type'),
  });
  return true;
}

export const applyMacron = (view: EditorView) => applyCombiningMark(view, 'macron');
