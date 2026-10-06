import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorView } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import type { TextAnnotation } from '../../types';
import { annotationSegments, containsAnnTag, nextAnnId } from '../../utils/annUtils';

interface UseTextAnnotationActionsParams {
  viewRef: MutableRefObject<EditorView | null>;
  editorContainerRef: MutableRefObject<HTMLDivElement | null>;
  readOnly: boolean;
  textAnnotations: TextAnnotation[];
  setTextAnnotations: (annotations: TextAnnotation[]) => void;
  authorName: string;
}

// Tekstisiseste annotatsiooniankrute valimine, lisamine ja eemaldamine.
export function useTextAnnotationActions({
  viewRef,
  editorContainerRef,
  readOnly,
  textAnnotations,
  setTextAnnotations,
  authorName,
}: UseTextAnnotationActionsParams) {
  const { t } = useTranslation(['workspace']);
  const [annDialogOpen, setAnnDialogOpen] = useState(false);
  const [annDialogComment, setAnnDialogComment] = useState('');
  const [annPopover, setAnnPopover] = useState<{ annId: number; x: number; y: number } | null>(null);
  const [annPopoverEditing, setAnnPopoverEditing] = useState(false);
  const [annPopoverEditText, setAnnPopoverEditText] = useState('');
  const [annPopoverPendingDelete, setAnnPopoverPendingDelete] = useState(false);
  const [annDialogError, setAnnDialogError] = useState('');
  const [pendingAnnSelection, setPendingAnnSelection] = useState<{ segments: { from: number; to: number }[]; text: string } | null>(null);

  const closePopover = useCallback(() => {
    setAnnPopover(null);
    setAnnPopoverEditing(false);
    setAnnPopoverPendingDelete(false);
  }, []);

  const handleAnnotateSelection = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.from === sel.to) return;
    const docText = view.state.doc.toString();
    // Ankur kitsendatakse tasakaalus lõiguks: `</annN>` peab jääma `</m>` ette,
    // muidu ristub ta marginaaliaplokiga (`<m><ann1>x</m>\n</ann1>`).
    // Mitmerealine marginaaliakaart saab tüki igale reale (sama ID).
    const segments = annotationSegments(docText, sel.from, sel.to);
    if (!segments) {
      setAnnDialogError(t('editor.annotateCrossesTagError', 'Valik ületab märgendi või marginaaliaploki piiri — vali tekst ühe ploki sees'));
      setAnnDialogOpen(true);
      setPendingAnnSelection(null);
      return;
    }
    if (segments.some(({ from, to }) => containsAnnTag(docText, from, to))) {
      setAnnDialogError(t('editor.annotateOverlapError', 'Valitud tekst sisaldab juba annotatsiooni'));
      setAnnDialogOpen(true);
      setPendingAnnSelection(null);
      return;
    }
    const text = segments.map(({ from, to }) => docText.slice(from, to)).join(' ');
    setPendingAnnSelection({ segments, text });
    setAnnDialogComment('');
    setAnnDialogError('');
    setAnnDialogOpen(true);
  }, [t, viewRef]);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as Element).closest('[data-ann-id]') as HTMLElement | null;
      if (!target) {
        closePopover();
        return;
      }
      const annId = parseInt(target.getAttribute('data-ann-id') || '', 10);
      if (isNaN(annId)) return;
      e.stopPropagation();
      const rect = target.getBoundingClientRect();
      setAnnPopover({ annId, x: rect.left + rect.width / 2, y: rect.top });
      setAnnPopoverEditing(false);
      setAnnPopoverEditText('');
      setAnnPopoverPendingDelete(false);
    };

    container.addEventListener('click', handleClick);
    return () => container.removeEventListener('click', handleClick);
  }, [closePopover, editorContainerRef]);

  // Sulge popover klikkimisel väljaspool.
  useEffect(() => {
    if (!annPopover) return;
    document.addEventListener('click', closePopover);
    return () => document.removeEventListener('click', closePopover);
  }, [annPopover, closePopover]);

  const insertAnnotation = useCallback((comment: string) => {
    const view = viewRef.current;
    if (!view || !pendingAnnSelection || readOnly) return;
    const annId = nextAnnId(textAnnotations);
    const openTag = `<ann${annId}>`;
    const closeTag = `</ann${annId}>`;

    view.dispatch({
      changes: pendingAnnSelection.segments.flatMap(({ from, to }) => [
        { from, insert: openTag },
        { from: to, insert: closeTag },
      ]),
      annotations: [Transaction.userEvent.of('input.format')],
    });

    const newAnnotation: TextAnnotation = {
      id: annId,
      comment,
      author: authorName,
      created_at: new Date().toISOString(),
    };
    setTextAnnotations([...textAnnotations, newAnnotation]);
    setPendingAnnSelection(null);
    setAnnDialogOpen(false);
    setAnnDialogComment('');
    setAnnDialogError('');
  }, [authorName, pendingAnnSelection, readOnly, setTextAnnotations, textAnnotations, viewRef]);

  const removeAnnotationFromEditor = useCallback((annId: number) => {
    const view = viewRef.current;
    if (!view) return;
    const text = view.state.doc.toString();
    const openTag = `<ann${annId}>`;
    const closeTag = `</ann${annId}>`;
    // Kõik tükid (mitmerealisel marginaaliakaardil on ankur igal real).
    // Muudatused on algdokumendi koordinaatides — CodeMirror nihutab ise.
    const changes: { from: number; to: number }[] = [];
    for (const tag of [openTag, closeTag]) {
      for (let i = text.indexOf(tag); i !== -1; i = text.indexOf(tag, i + tag.length)) {
        changes.push({ from: i, to: i + tag.length });
      }
    }
    if (changes.length === 0) return;
    view.dispatch({ changes, annotations: [Transaction.userEvent.of('input.format')] });
  }, [viewRef]);

  return {
    annDialogOpen,
    annDialogComment,
    annPopover,
    annPopoverEditing,
    annPopoverEditText,
    annPopoverPendingDelete,
    annDialogError,
    pendingAnnSelection,
    setAnnDialogOpen,
    setAnnDialogComment,
    setAnnPopover,
    setAnnPopoverEditing,
    setAnnPopoverEditText,
    setAnnPopoverPendingDelete,
    setAnnDialogError,
    setPendingAnnSelection,
    handleAnnotateSelection,
    insertAnnotation,
    removeAnnotationFromEditor,
  };
}
