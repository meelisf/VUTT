import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Annotation, Page, TextAnnotation } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';
import { closeAllMarginalia } from './MarginaliaExtension';
import type { EditorSavedState } from './useEditorSave';

interface UseEditorStateParams {
  page: Page;
  viewRef: MutableRefObject<EditorView | null>;
  onUnsavedChanges?: (hasChanges: boolean) => void;
}

// Tekstiredaktori põhiline React-state: lehe sisu, salvestatud baasseis ja dirty-arvutus.
export function useEditorState({ page, viewRef, onUnsavedChanges }: UseEditorStateParams) {
  const [isDirty, setIsDirty] = useState(false);
  const [status, setStatus] = useState(page.status);
  const [comments, setComments] = useState<Annotation[]>(page.comments);
  const [textAnnotations, setTextAnnotations] = useState<TextAnnotation[]>(page.text_annotations || []);
  const [page_tags, setPageTags] = useState<(string | LinkedEntity)[]>(page.page_tags || []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Salvestamata mustand-tekst kommentaaride paanil (AnnotationsTab) — enne nupule vajutust.
  const [annotationDraftDirty, setAnnotationDraftDirty] = useState(false);
  const [savedState, setSavedState] = useState<EditorSavedState>({
    status: page.status,
    comments: page.comments,
    page_tags: page.page_tags || [],
    text_annotations: page.text_annotations || [],
  });

  // Arvutame kas on salvestamata muudatusi (shallow compare, mitte JSON.stringify)
  const hasUnsavedChanges = useMemo(() => {
    if (isDirty) return true;
    if (annotationDraftDirty) return true;
    if (status !== savedState.status) return true;
    // page_tags: string/LinkedEntity[] võrdlus sisulise JSON-kuju järgi
    if (JSON.stringify(page_tags) !== JSON.stringify(savedState.page_tags)) return true;
    // comments: Annotation[] shallow compare (id + text + replies)
    if (comments.length !== savedState.comments.length) return true;
    if (comments.some((c, i) => {
      const saved = savedState.comments[i];
      return c.id !== saved?.id || c.text !== saved?.text || JSON.stringify(c.replies || []) !== JSON.stringify(saved.replies || []);
    })) return true;
    if (JSON.stringify(textAnnotations) !== JSON.stringify(savedState.text_annotations)) return true;
    return false;
  }, [isDirty, annotationDraftDirty, status, savedState.status, page_tags, savedState.page_tags, comments, savedState.comments, textAnnotations, savedState.text_annotations]);

  // Uuendame editori sisu lehe vahetusel.
  useEffect(() => {
    setStatus(page.status);
    setComments(page.comments);
    setTextAnnotations(page.text_annotations || []);
    setPageTags(page.page_tags || []);
    setSavedState({ status: page.status, comments: page.comments, page_tags: page.page_tags || [], text_annotations: page.text_annotations || [] });
    setIsDirty(false);

    const view = viewRef.current;
    if (view) {
      const currentText = view.state.doc.toString();
      if (currentText !== page.text_content) {
        view.dispatch({
          changes: { from: 0, to: currentText.length, insert: page.text_content || '' },
          // Lehevahetusel tühjendame openMarks — vana positsioon kukuks nulli ja
          // avaks võõra ploki uuel lehel
          effects: closeAllMarginalia.of(null),
        });
      }
    }
  }, [page, viewRef]);

  // Hoiatus brauseri sulgemise/refreshi korral.
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    onUnsavedChanges?.(hasUnsavedChanges);
  }, [hasUnsavedChanges, onUnsavedChanges]);

  return {
    isDirty,
    setIsDirty,
    status,
    setStatus,
    comments,
    setComments,
    textAnnotations,
    setTextAnnotations,
    page_tags,
    setPageTags,
    isSaving,
    setIsSaving,
    saveError,
    setSaveError,
    annotationDraftDirty,
    setAnnotationDraftDirty,
    savedState,
    setSavedState,
    hasUnsavedChanges,
  };
}
