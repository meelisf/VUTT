import type { MutableRefObject } from 'react';
import type { EditorView } from '@codemirror/view';
import type { Annotation, Page, Work, TextAnnotation } from '../../types';
import type { Collections } from '../../services/collectionService';
import AnnotationsTab from './AnnotationsTab';
import HistoryTab from './HistoryTab';
import type { EditorTab } from './types';
import type { ReocrStatus } from './useReOcr';

interface EditorInfoHistoryTabsProps {
  activeTab: EditorTab;
  page: Page;
  work?: Work;
  user: unknown;
  authToken: string | null;
  readOnly: boolean;
  collections?: Collections;
  onOpenMetaModal?: () => void;
  onWorkUpdate?: (updatedWork: Partial<Work>) => void;
  lang: string;
  viewRef: MutableRefObject<EditorView | null>;
  setIsDirty: (dirty: boolean) => void;
  setActiveTab: (tab: EditorTab) => void;

  page_tags: Page['page_tags'];
  setPageTags: (tags: Page['page_tags']) => void;
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  setAnnotationDraftDirty: (dirty: boolean) => void;
  commentFlushRef: MutableRefObject<(() => Annotation[] | null) | null>;
  handleSaveAnnotations: (comments: Annotation[]) => Promise<void>;
  handleCommentsRestored: (comments: Annotation[]) => void;
  handleReplyToComment: (commentId: string, replyText: string) => Promise<void>;

  textAnnotations: TextAnnotation[];
  setTextAnnotations: (annotations: TextAnnotation[]) => void;
  handleSaveTextAnnotations: (annotations: TextAnnotation[]) => Promise<void>;
  handleDeleteAndSaveTextAnnotation: (annId: number) => Promise<void>;

  handleReOcr: () => Promise<void>;
  reocrStatus: ReocrStatus;
  handleGeminiReOcr?: () => Promise<void>;
  geminiReocrStatus?: ReocrStatus;
  geminiEnabled?: boolean;
}

// Info- ja ajaloo-vahekaardid. Edit-tab jääb alati DOM-i eraldi komponendis.
export default function EditorInfoHistoryTabs({
  activeTab,
  page,
  work,
  user,
  authToken,
  readOnly,
  collections,
  onOpenMetaModal,
  onWorkUpdate,
  lang,
  viewRef,
  setIsDirty,
  setActiveTab,
  page_tags,
  setPageTags,
  comments,
  setComments,
  setAnnotationDraftDirty,
  commentFlushRef,
  handleSaveAnnotations,
  handleCommentsRestored,
  handleReplyToComment,
  textAnnotations,
  setTextAnnotations,
  handleSaveTextAnnotations,
  handleDeleteAndSaveTextAnnotation,
  handleReOcr,
  reocrStatus,
  handleGeminiReOcr,
  geminiReocrStatus,
  geminiEnabled,
}: EditorInfoHistoryTabsProps) {
  return (
    <>
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
          handleGeminiReOcr={handleGeminiReOcr}
          geminiReocrStatus={geminiReocrStatus}
          geminiEnabled={geminiEnabled}
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
    </>
  );
}
