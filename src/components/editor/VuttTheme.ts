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
  // Paaristägid peidetakse CSS-iga, mitte replace-widgetina.
  // See käib kokku VuttMarkupExtensioni mark+atomic mudeliga, mis oli viimane stabiilselt töötanud
  // lahendus plain caret nooleliikumise jaoks tagide ümber.
  '.vutt-hidden-tag': {
    display: 'none',
  },
  '.vutt-ann': {
    backgroundColor: '#fef9c3',
    borderBottom: '2px solid #eab308',
    borderRadius: '2px',
    cursor: 'help',
  },
  // Otsingupaneel — block-layout et <br> töötaks, kõik read eraldi
  '.cm-search': {
    padding: '5px 8px 6px',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '13px',
    backgroundColor: '#f9fafb',
    borderTop: '1px solid #e5e7eb',
    lineHeight: '2',
  },
  '.cm-search .cm-textfield': {
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
    fontSize: '13px',
    padding: '2px 6px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    outline: 'none',
    width: '130px',
  },
  '.cm-search .cm-textfield:focus': {
    borderColor: '#6366f1',
    boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.2)',
  },
  '.cm-search .cm-button': {
    padding: '2px 7px',
    fontSize: '12px',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    backgroundColor: 'white',
    cursor: 'pointer',
  },
  '.cm-search .cm-button:hover': {
    backgroundColor: '#f3f4f6',
  },
  '.cm-search label': {
    fontSize: '11px !important',
    color: '#6b7280',
    cursor: 'pointer',
    marginRight: '4px',
    whiteSpace: 'nowrap !important',
  },
  '.cm-searchMatch': {
    backgroundColor: '#fef08a',
    outline: '1px solid #fbbf24',
    borderRadius: '2px',
  },
  '.cm-searchMatch-selected': {
    backgroundColor: '#fde68a',
    outline: '1px solid #f59e0b',
  },
});
