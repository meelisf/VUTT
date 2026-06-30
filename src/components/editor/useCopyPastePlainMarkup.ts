import { useMemo } from 'react';
import { EditorView } from '@codemirror/view';
import { marginaliaField } from './MarginaliaExtension';

// Valiku puhastamine lõikelaua jaoks: VUTT-tägid (<m>, <i> jms) eemaldatud,
// reavahetused JA poolituskriipsud säilivad täpselt. Ettearvatav plain-tekst.
const cleanSelectionText = (view: EditorView, from: number, to: number) =>
  view.state.doc.sliceString(from, to).replace(/<\/?[a-z]+[^>]*>/g, '').trim();

// Kleepimise kontekst marginaalia suhtes:
//  'inside'  — kursor olemasoleva <m>…</m> sisus → juba marginaalia, tavaline paste
//  'wrap'    — tühi/paljas rida AVATUD marginaalia-kasti sees → mähime read <m>-i
//  'outside' — mujal → tavaline paste
// "Avatud kasti sees" = paljas rida, mille lähim mittetühi rida (üles või alla,
// tühje vahele jättes) kuulub avatud <m> ploki ridade hulka. Nii satub ka End+Enter
// tehtud uus rida (mis tegelikult tekib peidetud </m> taha) õigesse konteksti.
const pasteMarginaliaContext = (view: EditorView, pos: number): 'inside' | 'wrap' | 'outside' => {
  const { blocks, openMarks } = view.state.field(marginaliaField);
  const openBlocks = blocks.filter(b => openMarks.some(p => p >= b.from && p <= b.to));
  if (openBlocks.length === 0) return 'outside';
  if (blocks.some(b => pos >= b.contentFrom && pos <= b.contentTo)) return 'inside';
  const doc = view.state.doc;
  const lineSpansOpen = (lineNo: number) => openBlocks.some(b =>
    lineNo >= doc.lineAt(b.from).number && lineNo <= doc.lineAt(b.to).number);
  const ln = doc.lineAt(pos).number;
  let up = ln - 1;
  while (up >= 1 && doc.line(up).text.trim() === '') up--;
  if (up >= 1 && lineSpansOpen(up)) return 'wrap';
  let down = ln + 1;
  while (down <= doc.lines && doc.line(down).text.trim() === '') down++;
  if (down <= doc.lines && lineSpansOpen(down)) return 'wrap';
  return 'outside';
};

// CodeMirrori lõikelaua käitlus: kopeerimine/lõikamine alati plain markup'ita;
// marginaaliaplokki kleepides määrab sihtkoht vormingu ja read mähitakse <m>-i.
export function useCopyPastePlainMarkup() {
  return useMemo(() => {
    const copyHandler = (event: ClipboardEvent, view: EditorView) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      event.clipboardData?.setData('text/plain', cleanSelectionText(view, from, to));
      event.preventDefault();
      return true;
    };

    // Lõikamine (Ctrl-X): sama puhastus mis kopeerimisel, AGA peame kustutuse ka
    // ise teostama, sest preventDefault tühistab CM6 vaikimisi lõikamise. Ilma
    // selleta jätaks vaikimisi cut toore teksti (<m> tägid + reavahetused)
    // lõikelauale → paste taasloob osalise marginaalia (vt fix).
    const cutHandler = (event: ClipboardEvent, view: EditorView) => {
      const { from, to } = view.state.selection.main;
      if (from === to) return false;
      event.clipboardData?.setData('text/plain', cleanSelectionText(view, from, to));
      event.preventDefault();
      view.dispatch({
        changes: { from, to, insert: '' },
        selection: { anchor: from },
        userEvent: 'delete.cut',
      });
      return true;
    };

    // Kleepimine (Ctrl-V): kui sihtkoht on avatud marginaalia-kast, mähime iga
    // kleebitava rea omaette <m>…</m> plokki (sihtkoht määrab vormingu). Mujal
    // (sh olemasoleva <m> sisus) jätame CM6 vaikekäitumise.
    const pasteHandler = (event: ClipboardEvent, view: EditorView) => {
      const text = event.clipboardData?.getData('text/plain');
      if (!text) return false;
      const { from, to } = view.state.selection.main;
      if (pasteMarginaliaContext(view, from) !== 'wrap') return false;
      const wrapped = text.split('\n')
        .map(line => {
          const s = line.replace(/<\/?[a-z]+[^>]*>/g, '');   // väldi pesastatud <m><m>
          return s.trim() === '' ? '' : `<m>${s}</m>`;
        })
        .join('\n');
      // KRIITILINE: iga <m>…</m> peab jääma OMALE reale. Kui sisestuskoha naabermärk
      // ei ole reavahetus (nt kleepime otse olemasoleva `<m>…` rea ette), siis
      // `<m>X</m><m>Y</m>` satuks ühele reale → kumbki EI ole eraldiseisev plokk →
      // mõlemad renderduksid tavatekstina. Polsterdame reavahetustega.
      const doc = view.state.doc;
      let insert = wrapped;
      const before = from > 0 ? doc.sliceString(from - 1, from) : '\n';
      const after = to < doc.length ? doc.sliceString(to, to + 1) : '\n';
      if (before !== '\n') insert = '\n' + insert;
      if (after !== '\n') insert = insert + '\n';
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
        userEvent: 'input.paste',
      });
      event.preventDefault();
      return true;
    };

    return EditorView.domEventHandlers({ copy: copyHandler, cut: cutHandler, paste: pasteHandler });
  }, []);
}
