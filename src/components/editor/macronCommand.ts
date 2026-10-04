import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { macronChangeAt } from '../../utils/macron';

// Makron kursori ees olevale tähele (ADR 0062): kiirklahv Alt-M ja erimärkide
// paneeli nupp. Teine vajutus eemaldab; tilde asendatakse. `input.type` nagu
// tavaline trükkimine — sanitiseerijad ja marginaalia kaitsefilter käituvad samuti.
export function applyMacron(view: EditorView): boolean {
  if (!view.state.facet(EditorView.editable)) return false;
  const { head } = view.state.selection.main;
  const line = view.state.doc.lineAt(head);
  const change = macronChangeAt(line.text, head - line.from);
  if (!change) return true; // võtame klahvi endale: Alt-M ei tohi trükkida „µ" vms
  const from = line.from + change.from;
  view.dispatch({
    changes: { from, to: line.from + change.to, insert: change.insert },
    selection: EditorSelection.cursor(from + change.insert.length),
    annotations: Transaction.userEvent.of('input.type'),
  });
  return true;
}
