import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Page, PageStatus, Annotation, Work } from '../types';
import type { Collections } from '../services/collectionService';
import type { TextAnnotation } from '../types';
import { useUser } from '../contexts/UserContext';
import { isAtLeast } from '../utils/roleUtils';
import EditorHeader from './editor/EditorHeader';
import { initialEditorTab } from './editor/initialTab';
import EditorEditTab from './editor/EditorEditTab';
import EditorInfoHistoryTabs from './editor/EditorInfoHistoryTabs';
import AnnotationDialog from './editor/AnnotationDialog';
import PageConflictDialog from './editor/PageConflictDialog';
import type { PageFields, SaveOutcome } from './editor/pageConflict';
import AnnotationPopover from './editor/AnnotationPopover';
import TextProposalPanel from './editor/TextProposalPanel';
import { useTextProposal } from './editor/useTextProposal';
import type { RestoreResult } from './editor/pageRestore';
import type { ProposalRef } from '../services/pageService';


// CM6 impordid
import type { EditorView } from '@codemirror/view';
import { useSpecialChars } from './editor/useSpecialChars';
import { useCopyPastePlainMarkup } from './editor/useCopyPastePlainMarkup';
import { useReOcr } from './editor/useReOcr';
import { useEditorState } from './editor/useEditorState';
import { useEditorSave } from './editor/useEditorSave';
import { useEditorFormattingActions } from './editor/useEditorFormattingActions';
import { readPaletteOpen, writePaletteOpen } from './editor/PageMarkPalette';
import { useTextAnnotationActions } from './editor/useTextAnnotationActions';
import { useCodeMirrorLifecycle } from './editor/useCodeMirrorLifecycle';
import { useTranscriptionGuide } from './editor/useTranscriptionGuide';
import { useGeminiEnabled } from '../hooks/useGeminiEnabled';
import type { EditorTab } from './editor/types';

interface TextEditorProps {
  page: Page;
  work?: Work;
  onSave: (updatedPage: Page, base: PageFields, proposal?: ProposalRef) => Promise<SaveOutcome>;
  onUnsavedChanges?: (hasChanges: boolean) => void;
  onOpenMetaModal?: () => void;
  readOnly?: boolean;
  statusDirty?: boolean;
  currentStatus?: PageStatus | null;
  onStatusChange?: (status: PageStatus) => void;
  triggerSave?: React.MutableRefObject<(() => Promise<boolean>) | null>;
  onWorkUpdate?: (updatedWork: Partial<Work>) => void;
  collections?: Collections;
  /** Git-taaste salvestas lehe serveris — vanem uuendab oma `page`-objekti (#375). */
  onPageRestored?: (patch: Partial<Page>) => void;
  /** Agendi tekstiettepanekud (#641): Workspace'i ühtne dialoog + lehele liikumine. */
  runGuarded?: (fn: () => void) => void;
  onNavigateToPage?: (pageNo: number) => void;
}

const runNow = (fn: () => void) => fn();
const noNav = () => {};

const TextEditor: React.FC<TextEditorProps> = ({ page, work, onSave, onUnsavedChanges, onOpenMetaModal, readOnly = false, statusDirty = false, currentStatus, onStatusChange, triggerSave, onWorkUpdate, collections, onPageRestored, runGuarded = runNow, onNavigateToPage = noNav }) => {
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
  const [searchParams] = useSearchParams();
  const partParam = searchParams.get('part');
  const [activeTab, setActiveTab] = useState<EditorTab>(() => initialEditorTab(partParam));
  const hasAppliedDefaultTab = useRef(false);

  // Sünkrooni default_tab serverist (ainult esimesel laadimsel). `?part=` korral
  // EI kirjutata üle — vt initialEditorTab.
  useEffect(() => {
    if (!hasAppliedDefaultTab.current && userSettings.default_tab) {
      setActiveTab(initialEditorTab(partParam, userSettings.default_tab));
      hasAppliedDefaultTab.current = true;
    }
  }, [userSettings.default_tab, partParam]);

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
  // Lehe tähistus (ADR 0070): paneeli lahti/kinni on brauseri mugavusseade,
  // menüü avab Ctrl/⌘+Shift+F kursori juures.
  const openPageMarkMenuRef = useRef<() => void>(() => {});
  const [pageMarkPaletteOpen, setPageMarkPaletteOpen] = useState(readPaletteOpen);
  const [pageMarkMenu, setPageMarkMenu] = useState<{ left: number; top: number } | null>(null);
  const togglePageMarkPalette = useCallback(() => {
    setPageMarkPaletteOpen(o => { writePaletteOpen(!o); return !o; });
  }, []);
  const closePageMarkMenu = useCallback(() => { setPageMarkMenu(null); viewRef.current?.focus(); }, []);
  // Lehevahetus ei monteeri redaktorit maha (ADR 0010): lahtine menüü suletakse
  // selgesõnaliselt. Sama lehe uuendus (ADR 0060) id-d ei muuda.
  useEffect(() => { setPageMarkMenu(null); }, [page.id]);

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
    savedState,
    setSavedState,
    hasUnsavedChanges,
  } = useEditorState({ page, viewRef, onUnsavedChanges });

  // Agendi tekstiettepanek (#641) — ainult superadmin. `useEditorSave` luuakse
  // allpool ja vajab aktiivset viidet, seega vahetatakse callback'id ref'ide kaudu.
  const pageRefreshedRef = useRef<((r: RestoreResult) => void) | null>(null);
  const saveWithDraftsRef = useRef<(() => Promise<boolean>) | null>(null);
  const proposal = useTextProposal({
    page, viewRef, enabled: isAtLeast(user?.role, 'superadmin') && !readOnly, token: authToken,
    hasUnsavedChanges, setSavedState, setComments, setTextAnnotations, setPageTags, setIsDirty,
    runGuarded, navigateToPage: onNavigateToPage,
    onPageRefreshedRef: pageRefreshedRef, saveWithDraftsRef,
  });
  const proposalRefRef = useRef(proposal.activeRef);
  proposalRefRef.current = proposal.activeRef;
  const proposalAfterSave = proposal.afterSave;
  const saveWithProposal = useCallback(async (updatedPage: Page, base: PageFields): Promise<SaveOutcome> => {
    const ref = proposalRefRef.current ?? undefined;
    const outcome = await onSave(updatedPage, base, ref);
    if (ref) void proposalAfterSave();
    return outcome;
  }, [onSave, proposalAfterSave]);

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
    openPageMarkMenuRef,
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
  const {
    reocrStatus: geminiReocrStatus,
    reocrText: geminiReocrText,
    reocrError: geminiReocrError,
    handleReOcr: handleGeminiReOcr,
    applyReOcr: applyGeminiReOcr,
    deleteOcrFile: deleteGeminiOcrFile,
  } = useReOcr({
    page,
    authToken,
    isAdmin: isSuperadmin,
    viewRef,
    setIsDirty,
    provider: 'gemini',
    discover: false,
  });

  // Redaktori paneel (banner + tulemuse ülekate) näitab AINULT ühte instantsi
  // korraga — kumb iganes ei ole 'idle'. LOSS on eelistatud, kui mõlemad on
  // (ei tohiks juhtuda, kuna nupud on üksteise suhtes lukus, aga paneeli
  // valik ei tohi selle eelduse peale toetuda). HistoryTab'i nupud saavad
  // oma tegeliku (jagamata) oleku eraldi allpool.
  const geminiPanelActive = reocrStatus === 'idle' && geminiReocrStatus !== 'idle';
  const panelReocrStatus = geminiPanelActive ? geminiReocrStatus : reocrStatus;
  const panelReocrText = geminiPanelActive ? geminiReocrText : reocrText;
  const panelReocrError = geminiPanelActive ? geminiReocrError : reocrError;
  const panelApplyReOcr = geminiPanelActive ? applyGeminiReOcr : applyReOcr;
  const panelDeleteOcrFile = geminiPanelActive ? deleteGeminiOcrFile : deleteOcrFile;

  const {
    handleSave,
    handleSaveWithDrafts,
    handleSaveAnnotations,
    handleSaveTextAnnotations: saveTextAnnotations,
    handleDeleteAndSaveTextAnnotation: deleteAndSaveTextAnnotation,
    handleCommentsRestored,
    handlePageRestored,
    handleReplyToComment,
    pageConflict,
    resolveConflictKeepMine,
    resolveConflictTakeTheirs,
    resolveConflictWithChoices,
    cancelConflict,
  } = useEditorSave({
    page,
    status,
    comments,
    setComments,
    page_tags,
    textAnnotations,
    setTextAnnotations,
    onSave: saveWithProposal,
    savedState,
    setSavedState,
    setPageTags,
    setIsDirty,
    setIsSaving,
    setSaveError,
    viewRef,
    commentFlushRef,
    authToken,
    onPageRestored,
  });

  const {
    wrapWithTag,
    wrapPageMark,
    insertAtCursor,
    insertSpecialChar,
    insertCombiningMark,
    insertMarginalia,
    cleanMarkup,
  } = useEditorFormattingActions({ viewRef, readOnly });

  useEffect(() => {
    pageRefreshedRef.current = handlePageRestored;
    saveWithDraftsRef.current = handleSaveWithDrafts;
  }, [handlePageRestored, handleSaveWithDrafts]);

  // --- Salvestamine ---
  useEffect(() => {
    handleSaveRef.current = handleSave;
    // triggerSave'i kasutab AINULT "Salvesta ja lahku" (Workspace) → flush-variant.
    if (triggerSave) triggerSave.current = handleSaveWithDrafts;
  }, [handleSave, handleSaveWithDrafts, triggerSave]);

  useEffect(() => { wrapWithTagRef.current = wrapWithTag; }, [wrapWithTag]);
  useEffect(() => {
    openPageMarkMenuRef.current = () => {
      const view = viewRef.current;
      if (!view || readOnly) return;
      const c = view.coordsAtPos(view.state.selection.main.head);
      setPageMarkMenu(c ? { left: c.left, top: c.bottom + 4 } : { left: 40, top: 120 });
    };
  }, [readOnly]);

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

        {activeTab === 'edit' && isAtLeast(user?.role, 'superadmin') && !readOnly && (
          <TextProposalPanel
            review={proposal.review}
            pack={proposal.pack}
            pendingNotLoaded={proposal.pendingNotLoaded}
            loaded={proposal.loaded}
            job={proposal.job}
            error={proposal.error}
            onLoad={() => runGuarded(() => { void proposal.loadIntoEditor(); })}
            onReject={() => { void proposal.reject(); }}
            onRejectPack={() => { void proposal.rejectPack(); }}
            onAcceptPack={proposal.acceptPack}
            onSaveAndNext={() => { void proposal.saveAndNext(); }}
            onPrev={proposal.prev}
            onNext={proposal.next}
          />
        )}

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
          pageMarkPaletteOpen={pageMarkPaletteOpen}
          togglePageMarkPalette={togglePageMarkPalette}
          wrapPageMark={wrapPageMark}
          pageMarkMenu={pageMarkMenu}
          closePageMarkMenu={closePageMarkMenu}
          reocrStatus={panelReocrStatus}
          reocrText={panelReocrText}
          reocrError={panelReocrError}
          applyReOcr={panelApplyReOcr}
          deleteOcrFile={panelDeleteOcrFile}
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
          insertCombiningMark={insertCombiningMark}
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
          setActiveTab={setActiveTab}
          page_tags={page_tags}
          setPageTags={setPageTags}
          comments={comments}
          setComments={setComments}
          setAnnotationDraftDirty={setAnnotationDraftDirty}
          commentFlushRef={commentFlushRef}
          handleSaveAnnotations={handleSaveAnnotations}
          handleCommentsRestored={handleCommentsRestored}
          handlePageRestored={handlePageRestored}
          handleReplyToComment={handleReplyToComment}
          textAnnotations={textAnnotations}
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

    <PageConflictDialog
      conflict={pageConflict}
      onKeepMine={() => { void resolveConflictKeepMine(); }}
      onTakeTheirs={() => { void resolveConflictTakeTheirs(); }}
      onApplyChoices={resolveConflictWithChoices}
      onCancel={cancelConflict}
    />

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
