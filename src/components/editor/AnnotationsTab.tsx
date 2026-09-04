import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Work, Page, Annotation } from '../../types';
import type { TextAnnotation } from '../../types';
import { LinkedEntity } from '../../types/LinkedEntity';
import PageCommentsPanel from './PageCommentsPanel';
import CommentHistoryPanel from './CommentHistoryPanel';
import PageTagsPanel from './PageTagsPanel';
import WorkInfoPanel from './WorkInfoPanel';
import WorkTagsPanel from './WorkTagsPanel';
import TextAnnotationsPanel from './TextAnnotationsPanel';

interface AnnotationsTabProps {
  work?: Work;
  page: Page;
  page_tags: (string | LinkedEntity)[];
  setPageTags: (tags: (string | LinkedEntity)[]) => void;
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  // Teavitab parenti salvestamata mustand-tekstist (uus kommentaar / kommentaari muutmine),
  // et lehelt lahkumise hoiatus käivituks ka enne "Lisa kommentaar" nuppu.
  onDraftChange?: (hasDraft: boolean) => void;
  // Parent saab siit kätte funktsiooni, mis liidab mustandi kommentaaride hulka ja
  // tühjendab mustandi (kasutatakse "Salvesta ja lahku" ajal). Tagastab uue
  // kommentaaride massiivi (mille parent salvestab) või null, kui mustandit polnud.
  flushRef?: React.MutableRefObject<(() => Annotation[] | null) | null>;
  onSaveAnnotations?: (comments: Annotation[]) => Promise<void>;
  // Kommentaarid on serveris juba salvestatud (restore-endpoint commitis) — sünkroni
  // ainult lokaalne + salvestatud baasseis, ÄRA tee teist /save commitit.
  onCommentsRestored?: (comments: Annotation[]) => void;
  onReplyToComment?: (commentId: string, replyText: string) => Promise<void>;
  readOnly: boolean;
  user: any;
  authToken: string | null;
  onOpenMetaModal?: () => void;
  lang: string;
  textAnnotations: TextAnnotation[];
  textContent: string;
  onSaveTextAnnotations: (updated: TextAnnotation[]) => Promise<void>;
  onDeleteTextAnnotation: (annId: number) => Promise<void>;
}

const AnnotationsTab: React.FC<AnnotationsTabProps> = ({
  work,
  page: _page,
  page_tags,
  setPageTags,
  comments,
  setComments,
  onDraftChange,
  flushRef,
  onSaveAnnotations,
  onCommentsRestored,
  onReplyToComment,
  readOnly,
  user,
  authToken,
  onOpenMetaModal,
  lang,
  textAnnotations,
  textContent,
  onSaveTextAnnotations,
  onDeleteTextAnnotation,
}) => {
  const location = useLocation();
  const highlightedCommentId = new URLSearchParams(location.search).get('comment');


  useEffect(() => {
    if (!highlightedCommentId) return;
    const el = document.getElementById(`comment-${highlightedCommentId}`);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [highlightedCommentId, comments]);

  return (
    <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">

      <WorkInfoPanel
        work={work}
        lang={lang}
        onOpenMetaModal={onOpenMetaModal}
      />

      <WorkTagsPanel work={work} lang={lang} />

      <TextAnnotationsPanel
        textAnnotations={textAnnotations}
        textContent={textContent}
        readOnly={readOnly}
        onSaveTextAnnotations={onSaveTextAnnotations}
        onDeleteTextAnnotation={onDeleteTextAnnotation}
      />

      {/* Tags */}
      <PageTagsPanel
        pageTags={page_tags}
        setPageTags={setPageTags}
        readOnly={readOnly}
        authToken={authToken}
        lang={lang}
      />

      {/* Comments — key lähtestab mustandiväljad lehe vahetusel.
          Editor ei monteeru enam lehe pöördel maha (ADR 0010), seega jääks
          pooleli kirjutatud kommentaar muidu järgmisele lehele rippuma. */}
      <PageCommentsPanel
        key={_page.id}
        comments={comments}
        setComments={setComments}
        onDraftChange={onDraftChange}
        flushRef={flushRef}
        onSaveAnnotations={onSaveAnnotations}
        onReplyToComment={onReplyToComment}
        readOnly={readOnly}
        user={user}
        highlightedCommentId={highlightedCommentId}
      />

      <CommentHistoryPanel
        page={_page}
        work={work}
        comments={comments}
        setComments={setComments}
        onCommentsRestored={onCommentsRestored}
        authToken={authToken}
        user={user}
      />
    </div>
  );
};

export default AnnotationsTab;
