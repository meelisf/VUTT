import type { MouseEvent, MutableRefObject } from 'react';
import { PageStatus } from '../../types';
import type { SpecialCharacter } from './useSpecialChars';
import type { MarginaliaMode } from './MarginaliaExtension';
import type { ReocrStatus } from './useReOcr';
import EditorToolbar from './EditorToolbar';
import EditorStatusBar from './EditorStatusBar';
import ReocrPanel from './ReocrPanel';
import SpecialCharsPanel from './SpecialCharsPanel';

interface EditorEditTabProps {
  active: boolean;
  readOnly: boolean;
  authToken: string | null;
  user: unknown;
  editorContainerRef: MutableRefObject<HTMLDivElement | null>;
  currentStatus?: PageStatus | null;
  pageStatus: PageStatus;
  onStatusChange?: (status: PageStatus) => void;

  compactToolbar: boolean;
  narrowPane: boolean;
  marginaliaCount: number;
  marginaliaUserMode: MarginaliaMode;
  wrapWithTag: (tag: 'b' | 'i' | 'cs') => void;
  insertMarginalia: () => void;
  insertAtCursor: (text: string) => void;
  cleanMarkup: () => void;
  onAnnotateSelection: () => void;
  toggleMarginaliaMode: () => void;

  reocrStatus: ReocrStatus;
  reocrText: string | null;
  reocrError: string | null;
  applyReOcr: () => void;
  deleteOcrFile: () => void | Promise<void>;

  specialCharacters: SpecialCharacter[];
  isCustomChars: boolean;
  showCharPanel: boolean;
  showCharEditor: boolean;
  showTranscriptionGuide: boolean;
  transcriptionGuideHtml: string;
  setShowCharPanel: (show: boolean) => void;
  setShowCharEditor: (show: boolean) => void;
  setShowTranscriptionGuide: (show: boolean) => void;
  setSpecialCharacters: (chars: SpecialCharacter[]) => void;
  setIsCustomChars: (custom: boolean) => void;
  insertSpecialChar: (char: string, event?: MouseEvent) => void;
}

// Redaktori põhivahekaart: toolbar, CodeMirror konteiner, Re-OCR ja erimärgid.
export default function EditorEditTab({
  active,
  readOnly,
  authToken,
  user,
  editorContainerRef,
  currentStatus,
  pageStatus,
  onStatusChange,
  compactToolbar,
  narrowPane,
  marginaliaCount,
  marginaliaUserMode,
  wrapWithTag,
  insertMarginalia,
  insertAtCursor,
  cleanMarkup,
  onAnnotateSelection,
  toggleMarginaliaMode,
  reocrStatus,
  reocrText,
  reocrError,
  applyReOcr,
  deleteOcrFile,
  specialCharacters,
  isCustomChars,
  showCharPanel,
  showCharEditor,
  showTranscriptionGuide,
  transcriptionGuideHtml,
  setShowCharPanel,
  setShowCharEditor,
  setShowTranscriptionGuide,
  setSpecialCharacters,
  setIsCustomChars,
  insertSpecialChar,
}: EditorEditTabProps) {
  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${active ? '' : 'hidden'}`}>
      <div className="bg-white border-b border-gray-100 flex items-center justify-between px-4 py-1.5 shrink-0 gap-4">
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
          onAnnotateSelection={onAnnotateSelection}
          toggleMarginaliaMode={toggleMarginaliaMode}
        />

        <EditorStatusBar
          status={currentStatus || pageStatus}
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
  );
}
