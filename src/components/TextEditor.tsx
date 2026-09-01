import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Page, PageStatus, Annotation, Work } from '../types';
import type { Collections } from '../services/collectionService';
import type { TextAnnotation } from '../types';
import { useUser } from '../contexts/UserContext';
import { isAtLeast } from '../utils/roleUtils';
import EditorHeader from './editor/EditorHeader';
import EditorEditTab from './editor/EditorEditTab';
import EditorInfoHistoryTabs from './editor/EditorInfoHistoryTabs';
import AnnotationDialog from './editor/AnnotationDialog';
import AnnotationPopover from './editor/AnnotationPopover';


// CM6 impordid
import type { EditorView } from '@codemirror/view';
import { useSpecialChars } from './editor/useSpecialChars';
import { useCopyPastePlainMarkup } from './editor/useCopyPastePlainMarkup';
import { useReOcr } from './editor/useReOcr';
import { useEditorState } from './editor/useEditorState';
import { useEditorSave } from './editor/useEditorSave';
import { useEditorFormattingActions } from './editor/useEditorFormattingActions';
import { useTextAnnotationActions } from './editor/useTextAnnotationActions';
import { useCodeMirrorLifecycle } from './editor/useCodeMirrorLifecycle';
import { useTranscriptionGuide } from './editor/useTranscriptionGuide';
import { useGeminiEnabled } from '../hooks/useGeminiEnabled';
import type { EditorTab } from './editor/types';

interface TextEditorProps {
  page: Page;
  work?: Work;
  onSave: (updatedPage: Page) => Promise<void>;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onOpenMetaModal?: () => void;
  readOnly?: boolean;
  statusDirty?: boolean;
  currentStatus?: PageStatus | null;
  onStatusChange?: (status: PageStatus) => void;
  triggerSave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onWorkUpdate?: (updatedWork: Partial<Work>) => void;
  collections?: Collections;
}

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, onOpenMetaModal, readOnly = false, statusDirty = false, currentStatus, onStatusChange, triggerSave, onWorkUpdate, collections }) => {
  const { user, authToken, userSettings } = useUser();
  const {
    specialCharacters,
    isCustomChars,
    showCharPanel,
    setShowCharPanel,
    showCharEditor,
    setShowCharEditor,
    setSpecialCharacters,
    setIsCustomChars,
  } = useSpecialChars(authToken);
  const copyPastePlainMarkup = useCopyPastePlainMarkup();
  const [activeTab, setActiveTab] = useState<EditorTab>('edit');
  const hasAppliedDefaultTab = useRef(false);

  // Sünkrooni default_tab serverist (ainult esimesel laadimsel)
  useEffect(() => {
    if (!hasAppliedDefaultTab.current && userSettings.default_tab) {
      setActiveTab(userSettings.default_tab as EditorTab);
      hasAppliedDefaultTab.current = true;
    }
  }, [userSettings.default_tab]);

  const {
    lang,
    showTranscriptionGuide,
    setShowTranscriptionGuide,
    transcriptionGuideHtml,
  } = useTranscriptionGuide();

  // CM6 refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const handleSaveRef = useRef<() => void>(() => {});
  // AnnotationsTab registreerib siia kommentaari-mustandi flushi (vt handleSaveWithDrafts)
  const commentFlushRef = useRef<(() => Annotation[] | null) | null>(null);
  const wrapWithTagRef = useRef<(tag: string) => void>(() => {});

  const {
    setIsDirty,
    status,
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
    setAnnotationDraftDirty,
    setSavedState,
    hasUnsavedChanges,
  } = useEditorState({ page, viewRef, onUnsavedChanges });

  const {
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
  } = useTextAnnotationActions({
    viewRef,
    editorContainerRef,
    readOnly,
    textAnnotations,
    setTextAnnotations,
    authorName: user?.name || 'Anonüümne',
  });

  const {
    marginaliaUserMode,
    narrowPane,
    compactToolbar,
    marginaliaCount,
    toggleMarginaliaMode,
  } = useCodeMirrorLifecycle({
    page,
    readOnly,
    editorContainerRef,
    viewRef,
    handleSaveRef,
    wrapWithTagRef,
    copyPastePlainMarkup,
    setIsDirty,
  });

  const { reocrStatus, reocrText, reocrError, handleReOcr, applyReOcr, deleteOcrFile } = useReOcr({
    page,
    authToken,
    isAdmin: isAtLeast(user?.role, 'admin'),
    viewRef,
    setIsDirty,
  });

  // Gemini-tee: eraldi hooks-instants, aga avastamislogika (discover) jääb
  // AINULT eelmisele instantsile — .ocr fail ei tea, kumb pakkuja selle tootis.
  const isSuperadmin = isAtLeast(user?.role, 'superadmin');
  const geminiEnabled = useGeminiEnabled(authToken, isSuperadmin);
  const { reocrStatus: geminiReocrStatus, handleReOcr: handleGeminiReOcr } = useReOcr({
    page,
    authToken,
    isAdmin: isSuperadmin,
    viewRef,
    setIsDirty,
    provider: 'gemini',
    discover: false,
  });

  const {
    handleSave,
    handleSaveWithDrafts,
    handleSaveAnnotations,
    handleSaveTextAnnotations: saveTextAnnotations,
    handleDeleteAndSaveTextAnnotation: deleteAndSaveTextAnnotation,
    handleCommentsRestored,
    handleReplyToComment,
  } = useEditorSave({
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
  });

  const {
    wrapWithTag,
    insertAtCursor,
    insertSpecialChar,
    insertMarginalia,
    cleanMarkup,
  } = useEditorFormattingActions({ viewRef, readOnly });

  // --- Salvestamine ---
  useEffect(() => {
    handleSaveRef.current = handleSave;
    // triggerSave'i kasutab AINULT "Salvesta ja lahku" (Workspace) → flush-variant.
    if (triggerSave) triggerSave.current = handleSaveWithDrafts;
  }, [handleSave, handleSaveWithDrafts, triggerSave]);

  useEffect(() => { wrapWithTagRef.current = wrapWithTag; }, [wrapWithTag]);

  const handleDeleteAndSaveTextAnnotation = useCallback(async (annId: number) => {
    await deleteAndSaveTextAnnotation(annId, removeAnnotationFromEditor);
  }, [deleteAndSaveTextAnnotation, removeAnnotationFromEditor]);

  const handleSaveTextAnnotations = useCallback(async (updatedTextAnnotations: TextAnnotation[]) => {
    await saveTextAnnotations(updatedTextAnnotations);
  }, [saveTextAnnotations]);

  return (
    <>
    <div className="flex flex-col h-full bg-paper font-sans">

      {/* 1. GLOBAL HEADER */}
      <EditorHeader
        work={work}
        activeTab={activeTab}
        readOnly={readOnly}
        isSaving={isSaving}
        hasUnsavedChanges={hasUnsavedChanges}
        statusDirty={statusDirty}
        saveError={saveError}
        onTabChange={setActiveTab}
        onSave={handleSave}
        onClearSaveError={() => setSaveError(null)}
      />

      <div className="flex-1 overflow-hidden relative flex flex-col">

        {/* TEXT TAB CONTENT — alati DOM-is, et CodeMirror ei häviks */}
        <EditorEditTab
          active={activeTab === 'edit'}
          readOnly={readOnly}
          authToken={authToken}
          user={user}
          editorContainerRef={editorContainerRef}
          currentStatus={currentStatus}
          pageStatus={page.status}
          onStatusChange={onStatusChange}
          compactToolbar={compactToolbar}
          narrowPane={narrowPane}
          marginaliaCount={marginaliaCount}
          marginaliaUserMode={marginaliaUserMode}
          wrapWithTag={wrapWithTag}
          insertMarginalia={insertMarginalia}
          insertAtCursor={insertAtCursor}
          cleanMarkup={cleanMarkup}
          onAnnotateSelection={handleAnnotateSelection}
          toggleMarginaliaMode={toggleMarginaliaMode}
          reocrStatus={reocrStatus}
          reocrText={reocrText}
          reocrError={reocrError}
          applyReOcr={applyReOcr}
          deleteOcrFile={deleteOcrFile}
          specialCharacters={specialCharacters}
          isCustomChars={isCustomChars}
          showCharPanel={showCharPanel}
          showCharEditor={showCharEditor}
          showTranscriptionGuide={showTranscriptionGuide}
          transcriptionGuideHtml={transcriptionGuideHtml}
          setShowCharPanel={setShowCharPanel}
          setShowCharEditor={setShowCharEditor}
          setShowTranscriptionGuide={setShowTranscriptionGuide}
          setSpecialCharacters={setSpecialCharacters}
          setIsCustomChars={setIsCustomChars}
          insertSpecialChar={insertSpecialChar}
        />

        <EditorInfoHistoryTabs
          activeTab={activeTab}
          page={page}
          work={work}
          user={user}
          authToken={authToken}
          readOnly={readOnly}
          collections={collections}
          onOpenMetaModal={onOpenMetaModal}
          onWorkUpdate={onWorkUpdate}
          lang={lang}
          viewRef={viewRef}
          setIsDirty={setIsDirty}
          setActiveTab={setActiveTab}
          page_tags={page_tags}
          setPageTags={setPageTags}
          comments={comments}
          setComments={setComments}
          setAnnotationDraftDirty={setAnnotationDraftDirty}
          commentFlushRef={commentFlushRef}
          handleSaveAnnotations={handleSaveAnnotations}
          handleCommentsRestored={handleCommentsRestored}
          handleReplyToComment={handleReplyToComment}
          textAnnotations={textAnnotations}
          setTextAnnotations={setTextAnnotations}
          handleSaveTextAnnotations={handleSaveTextAnnotations}
          handleDeleteAndSaveTextAnnotation={handleDeleteAndSaveTextAnnotation}
          handleReOcr={handleReOcr}
          reocrStatus={reocrStatus}
          handleGeminiReOcr={handleGeminiReOcr}
          geminiReocrStatus={geminiReocrStatus}
          geminiEnabled={geminiEnabled}
        />
      </div>
    </div>

    {annPopover && (
      <AnnotationPopover
        annId={annPopover.annId}
        x={annPopover.x}
        y={annPopover.y}
        annotation={textAnnotations.find(a => a.id === annPopover.annId)}
        annotations={textAnnotations}
        readOnly={readOnly}
        editText={annPopoverEditText}
        editing={annPopoverEditing}
        pendingDelete={annPopoverPendingDelete}
        authorName={user?.name || 'Anonüümne'}
        onEditTextChange={setAnnPopoverEditText}
        onEditingChange={setAnnPopoverEditing}
        onPendingDeleteChange={setAnnPopoverPendingDelete}
        onClose={() => setAnnPopover(null)}
        onSaveTextAnnotations={handleSaveTextAnnotations}
        onDeleteTextAnnotation={handleDeleteAndSaveTextAnnotation}
        onRemoveAnchor={removeAnnotationFromEditor}
      />
    )}

    {annDialogOpen && (
      <AnnotationDialog
        comment={annDialogComment}
        error={annDialogError}
        selectionText={pendingAnnSelection?.text}
        onCommentChange={setAnnDialogComment}
        onSave={insertAnnotation}
        onCancel={() => { setAnnDialogOpen(false); setPendingAnnSelection(null); }}
        onCloseError={() => { setAnnDialogOpen(false); setAnnDialogError(''); }}
      />
    )}
    </>
  );
};

export default TextEditor;
