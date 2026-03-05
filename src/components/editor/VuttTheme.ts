// VuttTheme.ts — CM6 visuaalne teema VUTT editorile
// Serif font, 18px, 1.7 line-height — vastab vana textarea stailile

import { EditorView } from '@codemirror/view';

export const vuttTheme = EditorView.theme({
  '&': {
    height: '100%',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif',
    fontSize: '18px',
    lineHeight: '1.7',
  },
  '.cm-content': {
    padding: '1.5rem',
    caretColor: '#374151',
    whiteSpace: 'pre',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-gutters': {
    fontFamily: 'Georgia, Cambria, "Times New Roman", Times, serif',
    fontSize: '18px',
    lineHeight: '1.7',
    backgroundColor: '#f9fafb',
    borderRight: '1px solid #e5e7eb',
    color: '#9ca3af',
    minWidth: '3rem',
  },
  '.cm-gutterElement': {
    padding: '0 0.5rem 0 0',
    lineHeight: '1.7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    fontSize: '18px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: '#f3f4f6',
  },
  '.cm-selectionBackground': {
    backgroundColor: '#dbeafe !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: '#bfdbfe !important',
  },
  '.cm-cursor': {
    borderLeftColor: '#374151',
    borderLeftWidth: '2px',
  },
  '.cm-line': {
    padding: '0',
  },
});
