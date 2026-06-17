import '../src/index.css';
import { EditorView, lineNumbers, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { vuttMarkupExtension } from '../src/components/editor/VuttMarkupExtension';
import { marginaliaExtension, marginaliaField, openMarginalia } from '../src/components/editor/MarginaliaExtension';
import { vuttTheme } from '../src/components/editor/VuttTheme';
import { findMarginaliaBlocks } from '../src/utils/marginaliaUtils';
import { PAGE_TEXT } from './pagetext';

const cleanSelectionText = (view: EditorView, from: number, to: number) =>
  view.state.doc.sliceString(from, to).replace(/<\/?[a-z]+[^>]*>/g, '').trim();
const cutHandler = (event: ClipboardEvent, view: EditorView) => {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  event.clipboardData?.setData('text/plain', cleanSelectionText(view, from, to));
  event.preventDefault();
  view.dispatch({ changes:{from,to,insert:''}, selection:{anchor:from}, userEvent:'delete.cut' });
  return true;
};
const pasteMarginaliaContext = (view: EditorView, pos: number): 'inside'|'wrap'|'outside' => {
  const { blocks, openMarks } = view.state.field(marginaliaField);
  const openBlocks = blocks.filter(b => openMarks.some(p => p >= b.from && p <= b.to));
  if (openBlocks.length === 0) return 'outside';
  if (blocks.some(b => pos >= b.contentFrom && pos <= b.contentTo)) return 'inside';
  const doc = view.state.doc;
  const lineSpansOpen = (lineNo: number) => openBlocks.some(b => lineNo >= doc.lineAt(b.from).number && lineNo <= doc.lineAt(b.to).number);
  const ln = doc.lineAt(pos).number;
  let up = ln-1; while (up>=1 && doc.line(up).text.trim()==='') up--;
  if (up>=1 && lineSpansOpen(up)) return 'wrap';
  let down = ln+1; while (down<=doc.lines && doc.line(down).text.trim()==='') down++;
  if (down<=doc.lines && lineSpansOpen(down)) return 'wrap';
  return 'outside';
};
const pasteHandler = (event: ClipboardEvent, view: EditorView) => {
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return false;
  const { from, to } = view.state.selection.main;
  const ctx = pasteMarginaliaContext(view, from);
  (window as any).__lastPasteCtx = ctx;
  if (ctx !== 'wrap') return false;
  const wrapped = text.split('\n').map(line=>{const s=line.replace(/<\/?[a-z]+[^>]*>/g,'');return s.trim()===''?'':`<m>${s}</m>`;}).join('\n');
  const doc=view.state.doc; let insert=wrapped;
  const before=from>0?doc.sliceString(from-1,from):'\n';
  const after=to<doc.length?doc.sliceString(to,to+1):'\n';
  if(before!=='\n') insert='\n'+insert;
  if(after!=='\n') insert=insert+'\n';
  view.dispatch({ changes:{from,to,insert}, selection:{anchor:from+insert.length}, userEvent:'input.paste' });
  event.preventDefault(); return true;
};
const view = new EditorView({
  state: EditorState.create({ doc: PAGE_TEXT, extensions: [
    lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
    vuttMarkupExtension, marginaliaExtension('column'), vuttTheme,
    EditorView.domEventHandlers({ cut: cutHandler, paste: pasteHandler }),
  ]}),
  parent: document.getElementById('editor')!,
});
(window as any).__view = view;
(window as any).__mf = marginaliaField;
(window as any).__findBlocks = findMarginaliaBlocks;
// Ava plokk, mis sisaldab antud sisu-markerit (nagu kasutaja klikiks kasti lahti)
(window as any).__openBlockContaining = (marker: string) => {
  const t = view.state.doc.toString();
  const idx = t.indexOf(marker);
  if (idx < 0) return false;
  const { blocks } = view.state.field(marginaliaField);
  const blk = blocks.find(b => idx >= b.from && idx <= b.to);
  if (!blk) return false;
  view.dispatch({ effects: openMarginalia.of(blk.contentFrom) });
  return true;
};
