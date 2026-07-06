import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Edit3, X, Trash2, Check, SquarePen } from 'lucide-react';
import { Work, Page, Annotation } from '../../types';
import type { TextAnnotation } from '../../types';
import { extractHighlightedText } from '../../utils/annUtils';
import { LinkedEntity } from '../../types/LinkedEntity';
import PageCommentsPanel from './PageCommentsPanel';
import CommentHistoryPanel from './CommentHistoryPanel';
import PageTagsPanel from './PageTagsPanel';
import WorkInfoPanel from './WorkInfoPanel';
import WorkTagsPanel from './WorkTagsPanel';

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
  const { t } = useTranslation(['workspace', 'common', 'dashboard']);
  const location = useLocation();
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null);
  const [editingAnnText, setEditingAnnText] = useState('');
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

      {/* Tekst-annotatsioonid */}
      {textAnnotations.length > 0 && (
        <div className="bg-white p-5 rounded-lg border border-yellow-200 shadow-sm mb-6">
          <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
            <SquarePen size={16} className="text-yellow-500" />
            <h4 className="font-bold">{t('annotations.textAnnotations', 'Tekst-annotatsioonid')}</h4>
          </div>
          <div className="space-y-3">
            {textAnnotations.map(ann => {
              const highlightedText = extractHighlightedText(textContent, ann.id);
              return (
                <div key={ann.id} className="bg-gray-50 p-3 rounded-lg border border-gray-100 relative group">
                  {editingAnnId === ann.id ? (
                    <div className="space-y-2">
                      {highlightedText && (
                        <p className="text-xs text-gray-500 italic line-clamp-2">„{highlightedText}"</p>
                      )}
                      <textarea
                        autoFocus
                        className="w-full px-2 py-1.5 text-sm border border-primary-300 rounded focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-y"
                        rows={3}
                        value={editingAnnText}
                        onChange={e => setEditingAnnText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setEditingAnnId(null); }}
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setEditingAnnId(null)}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                        >
                          <X size={12} />
                          {t('info.cancelEdit')}
                        </button>
                        <button
                          type="button"
                          disabled={!editingAnnText.trim()}
                          onClick={async () => {
                            const updated = textAnnotations.map(a =>
                              a.id === ann.id ? { ...a, comment: editingAnnText } : a
                            );
                            await onSaveTextAnnotations(updated);
                            setEditingAnnId(null);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                        >
                          <Check size={12} />
                          {t('info.saveEdit')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {highlightedText ? (
                        <p className="text-xs text-gray-500 italic mb-1.5 line-clamp-2">„{highlightedText}"</p>
                      ) : (
                        <p className="text-xs text-amber-600 italic mb-1.5">
                          {t('annotations.anchorMissing', 'Seotud tekstilõiku ei leitud')}
                        </p>
                      )}
                      <p className="text-gray-800 text-sm mb-2 leading-relaxed pr-5">{ann.comment}</p>
                      <div className="flex justify-between items-center text-xs text-gray-500">
                        <span className="font-semibold text-primary-700">{ann.author}</span>
                        <span>{new Date(ann.created_at).toLocaleString('et-EE')}</span>
                      </div>
                      {!readOnly && (
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => { setEditingAnnId(ann.id); setEditingAnnText(ann.comment); }}
                            className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                            title={t('info.editComment')}
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteTextAnnotation(ann.id)}
                            className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-white transition-colors"
                            title={t('info.deleteComment')}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Tags */}
      <PageTagsPanel
        pageTags={page_tags}
        setPageTags={setPageTags}
        readOnly={readOnly}
        authToken={authToken}
        lang={lang}
      />

      {/* Comments */}
      <PageCommentsPanel
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
