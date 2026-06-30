import { useCallback, useRef, type MutableRefObject } from 'react';
import { useTranslation } from 'react-i18next';
import type { EditorView } from '@codemirror/view';
import type { Annotation, Page, PageStatus, TextAnnotation } from '../../types';
import type { LinkedEntity } from '../../types/LinkedEntity';
import { replyToComment } from '../../services/pageService';

export interface EditorSavedState {
  status: PageStatus;
  comments: Annotation[];
  page_tags: (string | LinkedEntity)[];
  text_annotations: TextAnnotation[];
}

interface UseEditorSaveParams {
  page: Page;
  status: PageStatus;
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  page_tags: (string | LinkedEntity)[];
  textAnnotations: TextAnnotation[];
  setTextAnnotations: (annotations: TextAnnotation[]) => void;
  onSave: (updatedPage: Page) => Promise<void>;
  setSavedState: (state: EditorSavedState) => void;
  setIsDirty: (dirty: boolean) => void;
  setIsSaving: (saving: boolean) => void;
  setSaveError: (error: string | null) => void;
  viewRef: MutableRefObject<EditorView | null>;
  commentFlushRef: MutableRefObject<(() => Annotation[] | null) | null>;
  authToken?: string | null;
}

// Tekstiredaktori salvestusloogika ja korduvate savedState uuenduste keskne koht.
export function useEditorSave({
  page,
  status,
  comments,
  setComments,
  page_tags,
  textAnnotations,
  setTextAnnotations,
  onSave,
  setSavedState,
  setIsDirty,
  setIsSaving,
  setSaveError,
  viewRef,
  commentFlushRef,
  authToken,
}: UseEditorSaveParams) {
  const { t } = useTranslation(['workspace', 'common']);
  const isSavingRef = useRef(false);

  const makePage = useCallback((nextComments: Annotation[], nextTextAnnotations: TextAnnotation[]): Page => {
    const text = viewRef.current?.state.doc.toString() ?? '';
    return { ...page, text_content: text, status, comments: nextComments, page_tags, text_annotations: nextTextAnnotations };
  }, [page, status, page_tags, viewRef]);

  const formatSaveError = useCallback((e: any) => (
    t('editor.saveErrorWithMessage', { message: e.message || t('common:errors.unknownError') })
  ), [t]);

  const runSave = useCallback(async (
    updatedPage: Page,
    savedState: EditorSavedState,
    afterSave?: () => void,
  ) => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    setIsSaving(true);
    try {
      await onSave(updatedPage);
      afterSave?.();
      setSavedState(savedState);
      setIsDirty(false);
    } catch (e: any) {
      console.error('Save error:', e);
      setSaveError(formatSaveError(e));
    } finally {
      isSavingRef.current = false;
      setIsSaving(false);
    }
  }, [formatSaveError, onSave, setIsDirty, setIsSaving, setSaveError, setSavedState]);

  const handleSave = useCallback(async () => {
    const updatedPage = makePage(comments, textAnnotations);
    await runSave(updatedPage, { status, comments, page_tags, text_annotations: textAnnotations });
  }, [comments, makePage, page_tags, runSave, status, textAnnotations]);

  // Salvestus "Salvesta ja lahku" jaoks: enne salvestust liidab kommentaari-mustandi
  // kommentaaride hulka, et see ei läheks kaduma.
  const handleSaveWithDrafts = useCallback(async () => {
    if (isSavingRef.current) return;
    const flushed = commentFlushRef.current?.() ?? null;
    const effectiveComments = flushed ?? comments;
    const updatedPage = makePage(effectiveComments, textAnnotations);
    await runSave(
      updatedPage,
      { status, comments: effectiveComments, page_tags, text_annotations: textAnnotations },
      flushed ? () => setComments(flushed) : undefined,
    );
  }, [commentFlushRef, comments, makePage, page_tags, runSave, setComments, status, textAnnotations]);

  // Annotatsioonide kohene salvestus (möödub state async viivitusest)
  const handleSaveAnnotations = useCallback(async (updatedComments: Annotation[]) => {
    const updatedPage = makePage(updatedComments, textAnnotations);
    await runSave(updatedPage, { status, comments: updatedComments, page_tags, text_annotations: textAnnotations });
  }, [makePage, page_tags, runSave, status, textAnnotations]);

  const handleSaveTextAnnotations = useCallback(async (updatedTextAnnotations: TextAnnotation[]) => {
    const updatedPage = makePage(comments, updatedTextAnnotations);
    await runSave(
      updatedPage,
      { status, comments, page_tags, text_annotations: updatedTextAnnotations },
      () => setTextAnnotations(updatedTextAnnotations),
    );
  }, [comments, makePage, page_tags, runSave, setTextAnnotations, status]);

  const handleDeleteAndSaveTextAnnotation = useCallback(async (
    annId: number,
    removeAnnotationFromEditor: (annId: number) => void,
  ) => {
    // removeAnnotationFromEditor dispatch on CM6-s sünkroonne — tekst loetakse pärast dispatch'i.
    removeAnnotationFromEditor(annId);
    const updated = textAnnotations.filter(a => a.id !== annId);
    setTextAnnotations(updated);
    const updatedPage = makePage(comments, updated);
    await runSave(updatedPage, { status, comments, page_tags, text_annotations: updated });
  }, [comments, makePage, page_tags, runSave, setTextAnnotations, status, textAnnotations]);

  const handleCommentsRestored = useCallback((updatedComments: Annotation[]) => {
    setComments(updatedComments);
    setSavedState({ status, comments: updatedComments, page_tags, text_annotations: textAnnotations });
  }, [page_tags, setComments, setSavedState, status, textAnnotations]);

  const handleReplyToComment = useCallback(async (commentId: string, replyText: string) => {
    if (!authToken) throw new Error(t('saveError.tokenMissing'));
    const updatedComments = await replyToComment(page, commentId, replyText, authToken);
    setComments(updatedComments);
    setSavedState({ status, comments: updatedComments, page_tags, text_annotations: textAnnotations });
  }, [authToken, page, page_tags, setComments, setSavedState, status, textAnnotations, t]);

  return {
    isSavingRef,
    handleSave,
    handleSaveWithDrafts,
    handleSaveAnnotations,
    handleSaveTextAnnotations,
    handleDeleteAndSaveTextAnnotation,
    handleCommentsRestored,
    handleReplyToComment,
  };
}
