import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Page, PageStatus, Annotation, Work } from '../types';
import type { Collections } from '../services/collectionService';
import type { TextAnnotation } from '../types';
import { useUser } from '../contexts/UserContext';
import AnnotationsTab from './editor/AnnotationsTab';
import HistoryTab from './editor/HistoryTab';
import EditorStatusBar from './editor/EditorStatusBar';
import EditorToolbar from './editor/EditorToolbar';
import EditorHeader from './editor/EditorHeader';
import ReocrPanel from './editor/ReocrPanel';
import SpecialCharsPanel from './editor/SpecialCharsPanel';
import AnnotationDialog from './editor/AnnotationDialog';
import AnnotationPopover from './editor/AnnotationPopover';

import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLangCode } from '../utils/getLangCode';

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
  triggerSave?: React.MutableRefObject<(() => Promise<void>) | null>;
  onWorkUpdate?: (updatedWork: Partial<Work>) => void;
  collections?: Collections;
}

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, onOpenMetaModal, readOnly = false, statusDirty = false, currentStatus, onStatusChange, triggerSave, onWorkUpdate, collections }) => {
  const { i18n } = useTranslation(['workspace', 'common']);
  const { user, authToken, userSettings } = useUser();
  const lang = getLangCode(i18n.language);
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

  const [showTranscriptionGuide, setShowTranscriptionGuide] = useState(false);
  const [transcriptionGuideHtml, setTranscriptionGuideHtml] = useState<string>('');

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
    viewRef,
    setIsDirty,
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

  // Laadime transkribeerimise juhendi
  useEffect(() => {
    const loadTranscriptionGuide = async () => {
      try {
        const fileSuffix = lang === 'en' ? '_en' : '';
        const response = await fetchWithTimeout(`/transcription_guide${fileSuffix}.html`, { timeout: 5000 });
        if (response.ok) {
          const html = await response.text();
          const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
          const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
          const styleTag = styleMatch ? `<style>${styleMatch[1]}</style>` : '';
          const bodyContent = bodyMatch ? bodyMatch[1] : html;
          setTranscriptionGuideHtml(styleTag + bodyContent);
        }
      } catch (e) {
        console.warn('Transkribeerimise juhendi laadimine ebaõnnestus:', e);
      }
    };
    loadTranscriptionGuide();
  }, [lang]);

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
        <div className={`flex-1 flex flex-col overflow-hidden ${activeTab === 'edit' ? '' : 'hidden'}`}>
            {/* 2. SECONDARY TOOLBAR */}
            <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 py-1.5 shrink-0 gap-4">

              {/* Editor Tools (Left) */}
              <EditorToolbar
                readOnly={readOnly}
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
              />

              {/* Page Status (Right) */}
              <EditorStatusBar
                status={currentStatus || page.status}
                readOnly={readOnly}
                onStatusChange={onStatusChange}
              />
            </div>

            <ReocrPanel
              variant="banner"
              status={reocrStatus}
              text={reocrText}
              error={reocrError}
              onApply={applyReOcr}
              onDelete={deleteOcrFile}
            />

            {/* 3. EDITOR AREA */}
            <div className="flex-1 relative flex overflow-hidden bg-white">
              <ReocrPanel
                variant="overlay"
                status={reocrStatus}
                text={reocrText}
                error={reocrError}
                onApply={applyReOcr}
                onDelete={deleteOcrFile}
              />
              <div ref={editorContainerRef} className="flex-1 overflow-hidden" />
            </div>

            {/* 4. COLLAPSIBLE FOOTER (erimärkide paneel) — ainult sisselogitud kasutajale */}
            <SpecialCharsPanel
              authToken={authToken}
              user={user}
              readOnly={readOnly}
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
        </div>

        {activeTab === 'annotate' && (
          <AnnotationsTab
            work={work}
            page={page}
            page_tags={page_tags}
            setPageTags={setPageTags}
            comments={comments}
            setComments={setComments}
            onDraftChange={setAnnotationDraftDirty}
            flushRef={commentFlushRef}
            onSaveAnnotations={handleSaveAnnotations}
            onCommentsRestored={handleCommentsRestored}
            onReplyToComment={handleReplyToComment}
            readOnly={readOnly || false}
            user={user}
            authToken={authToken}
            onOpenMetaModal={onOpenMetaModal}
            lang={lang}
            textAnnotations={textAnnotations}
            textContent={viewRef.current?.state.doc.toString() ?? page.text_content}
            onSaveTextAnnotations={handleSaveTextAnnotations}
            onDeleteTextAnnotation={handleDeleteAndSaveTextAnnotation}
          />
        )}

        {activeTab === 'history' && (
          <HistoryTab
            page={page}
            work={work}
            user={user}
            authToken={authToken}
            handleReOcr={handleReOcr}
            reocrStatus={reocrStatus}
            onShareableChange={(shareable) => onWorkUpdate?.({ shareable })}
            collections={collections}
            onRestore={(content, restoredTextAnnotations) => {
              const view = viewRef.current;
              if (view) {
                view.dispatch({
                  changes: { from: 0, to: view.state.doc.length, insert: content },
                });
                setIsDirty(true);
              }
              if (Array.isArray(restoredTextAnnotations)) {
                setTextAnnotations(restoredTextAnnotations);
              }
              setActiveTab('edit');
            }}
            readOnly={readOnly || false}
          />
        )}
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
