import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Work, Page, Annotation } from '../../types';
import type { TextAnnotation } from '../../types';
import { LinkedEntity } from '../../types/LinkedEntity';
import PageCommentsPanel from './PageCommentsPanel';
import CommentHistoryPanel from './CommentHistoryPanel';
import PageTagsPanel from './PageTagsPanel';
import WorkInfoPanel from './WorkInfoPanel';
import WorkTagsPanel from './WorkTagsPanel';
import WorkSetsPanel from './WorkSetsPanel';
import WorkPartsPanel from './WorkPartsPanel';
import { canEditWork, isAtLeast } from '../../utils/roleUtils';
import TextAnnotationsPanel from './TextAnnotationsPanel';
import AnnotationsGuide, { type GuideKey } from './AnnotationsGuide';

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

  // Tähelepanujuht (pillid „Teose info" päises): osade ja kogude arvu teatavad
  // paneelid ise, lehe andmed on siin käes. Klõps kerib paneeli juurde.
  const [partsCount, setPartsCount] = useState(0);
  const [setsCount, setSetsCount] = useState(0);
  const [tocOpenSignal, setTocOpenSignal] = useState(0);
  const anchors = {
    toc: useRef<HTMLDivElement>(null), workSets: useRef<HTMLDivElement>(null),
    workTags: useRef<HTMLDivElement>(null), textAnnotations: useRef<HTMLDivElement>(null),
    pageTags: useRef<HTMLDivElement>(null), pageNotes: useRef<HTMLDivElement>(null),
  };
  const jump = (key: GuideKey) => {
    if (key === 'toc') setTocOpenSignal(n => n + 1);
    const target = anchors[key === 'addNote' ? 'pageNotes' : key].current;
    // Järgmisel kaadril: kokkuklapitud sisukord peab enne kerimist lahti olema
    requestAnimationFrame(() => {
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (key === 'addNote') target?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
    });
  };
  const guide = (
    <AnnotationsGuide
      counts={{
        toc: partsCount, workSets: setsCount, workTags: work?.tags?.length ?? 0,
        textAnnotations: textAnnotations.length, pageTags: page_tags.length, pageNotes: comments.length,
      }}
      canAddNote={!readOnly && !!user}
      onJump={jump}
    />
  );

  return (
    <div className="h-full flex flex-col bg-gray-50 p-6 overflow-y-auto">

      <WorkInfoPanel
        work={work}
        lang={lang}
        onOpenMetaModal={onOpenMetaModal}
        guide={guide}
      />

      {/* Teose osade sisukord (#464) — teose info all, kokkuklapitav */}
      <div ref={anchors.toc} className="scroll-mt-4">
        <WorkPartsPanel workId={work?.work_id} token={authToken} currentPage={_page.page_number}
          canEdit={isAtLeast(user?.role, 'editor') && canEditWork(user, work)}
          onCount={setPartsCount} openSignal={tocOpenSignal} />
      </div>

      {/* Töökollektsioonid on „kõrgema taseme märksõna" — kuraatori, mitte
          sisu tasandi väide teose kohta. Seepärast teose märksõnade EES. */}
      <div ref={anchors.workSets} className="scroll-mt-4">
        <WorkSetsPanel workId={work?.work_id} lang={lang} readOnly={readOnly} onCount={setSetsCount} />
      </div>

      <div ref={anchors.workTags} className="scroll-mt-4">
        <WorkTagsPanel work={work} lang={lang} />
      </div>

      <div ref={anchors.textAnnotations} className="scroll-mt-4">
        <TextAnnotationsPanel
          textAnnotations={textAnnotations}
          textContent={textContent}
          readOnly={readOnly}
          onSaveTextAnnotations={onSaveTextAnnotations}
          onDeleteTextAnnotation={onDeleteTextAnnotation}
        />
      </div>

      {/* Tags */}
      <div ref={anchors.pageTags} className="scroll-mt-4">
        <PageTagsPanel
          pageTags={page_tags}
          setPageTags={setPageTags}
          readOnly={readOnly}
          authToken={authToken}
          lang={lang}
        />
      </div>

      {/* Comments — key lähtestab mustandiväljad lehe vahetusel.
          Editor ei monteeru enam lehe pöördel maha (ADR 0010), seega jääks
          pooleli kirjutatud kommentaar muidu järgmisele lehele rippuma. */}
      <div ref={anchors.pageNotes} className="scroll-mt-4">
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
      </div>

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
