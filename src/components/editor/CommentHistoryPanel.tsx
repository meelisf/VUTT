import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, History as HistoryIcon } from 'lucide-react';
import type { Annotation, Page, Work } from '../../types';
import { canEditWork } from '../../utils/roleUtils';
import { fetchCommentHistory, restoreComment, type CommentHistory } from '../../services/commentHistoryService';
import { lineDiff } from '../../utils/lineDiff';
import MarkdownView from '../MarkdownView';

interface CommentHistoryPanelProps {
  page: Page;
  work?: Work;
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  onCommentsRestored?: (comments: Annotation[]) => void;
  authToken: string | null;
  user: any;
}

// Kommentaaride versiooniajalugu ja taaste. Restore-endpoint salvestab ise kettale;
// parenti sünkroniseeritakse ainult uue comments-massiiviga.
const CommentHistoryPanel: React.FC<CommentHistoryPanelProps> = ({
  page,
  work,
  comments,
  setComments,
  onCommentsRestored,
  authToken,
  user,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const [commentHistory, setCommentHistory] = useState<CommentHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  // Server lubab /page-comments/history ja /page-comments/restore contributor'ile
  // TEMA ENDA kollektsiooni ulatuses (ADR 0031, can_write_work) — mitte ainult
  // editor+'ile. Väravaks peab olema sama ulatuse-kontroll, mitte fikseeritud roll.
  const canRestore = canEditWork(user, work);
  if (!canRestore) return null;

  const loadHistory = async (force = false) => {
    if (!force && (commentHistory || historyLoading)) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setCommentHistory(await fetchCommentHistory(page, authToken || undefined));
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  };

  const doRestore = async (
    mode: 'version' | 'deleted', commentId: string, commitHash: string,
  ) => {
    try {
      const updated = await restoreComment(
        page, { mode, comment_id: commentId, commit_hash: commitHash }, authToken || undefined,
      );
      if (onCommentsRestored) onCommentsRestored(updated);
      else setComments(updated);
      await loadHistory(true);   // värskenda ajaloo-kaart uue seisuga
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : t('info.restoreError'));
    }
  };

  return (
    <div className="mt-4 bg-white rounded-lg border border-gray-200 shadow-sm">
      <button
        onClick={async () => { await loadHistory(); setRestoreOpen(o => !o); }}
        className="flex items-center gap-2 w-full px-5 py-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg"
      >
        <HistoryIcon size={18} className="text-primary-600" />
        <h4 className="font-bold">{t('info.versionHistory')}</h4>
        {commentHistory && (
          <span className="ml-1 text-xs text-gray-400">
            ({Object.keys(commentHistory.versions).length + commentHistory.deleted.length})
          </span>
        )}
        {restoreOpen
          ? <ChevronUp size={16} className="ml-auto text-gray-400" />
          : <ChevronDown size={16} className="ml-auto text-gray-400" />}
      </button>

      {restoreOpen && (
        <div className="px-5 pb-5 space-y-5">
          {historyLoading && <p className="text-xs text-gray-400">…</p>}
          {historyError && <p className="text-xs text-red-600">{historyError}</p>}
          {!historyLoading && commentHistory && (
            <>
              {/* Muudetud kommentaaride varasemad versioonid (diff vana → praegune) */}
              <div>
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  {t('info.editedComments')}
                </h5>
                {Object.keys(commentHistory.versions).length === 0 ? (
                  <p className="text-xs text-gray-400 italic">{t('info.noOlderVersions')}</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(commentHistory.versions).map(([cid, versions]) => {
                      const cur = comments.find(c => c.id === cid);
                      return (
                        <div key={cid} className="border-l-2 border-gray-200 pl-3">
                          {cur && (
                            <p className="text-xs text-gray-500 mb-1.5 truncate">
                              <span className="font-semibold text-primary-700">{cur.author}</span>
                              {cur.text ? ` — ${cur.text.replace(/\s+/g, ' ').slice(0, 80)}` : ''}
                            </p>
                          )}
                          <div className="space-y-2">
                            {versions.map(v => (
                              <div key={v.commit_hash} className="bg-gray-50 border border-gray-100 rounded overflow-hidden">
                                <div>
                                  {lineDiff(v.text, cur?.text ?? '').map((d, idx) => (
                                    <div
                                      key={idx}
                                      className={`font-mono text-xs whitespace-pre-wrap break-words px-2 py-0.5 border-l-2 ${
                                        d.type === 'add'
                                          ? 'bg-green-50 text-green-900 border-green-400'
                                          : d.type === 'del'
                                            ? 'bg-red-50 text-red-900 border-red-300'
                                            : 'text-gray-500 border-transparent'
                                      }`}
                                    >
                                      <span className="select-none opacity-60 mr-1">
                                        {d.type === 'add' ? '+' : d.type === 'del' ? '−' : ' '}
                                      </span>
                                      {d.text || ' '}
                                    </div>
                                  ))}
                                </div>
                                <div className="flex justify-between items-center text-xs text-gray-400 px-2 py-1 bg-white border-t border-gray-100">
                                  <span>{v.author} · {new Date(v.timestamp).toLocaleString('et-EE')}</span>
                                  <button
                                    onClick={() => doRestore('version', cid, v.commit_hash)}
                                    className="text-primary-600 hover:text-primary-800 font-medium"
                                  >
                                    {t('info.restoreText')}
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Kustutatud kommentaarid */}
              <div>
                <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  {t('info.deletedComments')} ({commentHistory.deleted.length})
                </h5>
                {commentHistory.deleted.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">{t('info.noDeletedComments')}</p>
                ) : (
                  <div className="space-y-2">
                    {commentHistory.deleted.map(d => (
                      <div key={d.id} className="bg-gray-50 border border-gray-100 rounded px-2 py-1.5">
                        <div className="vutt-md-comment text-sm text-gray-700">
                          <MarkdownView content={d.text} softBreaks />
                        </div>
                        <div className="flex justify-between items-center text-xs text-gray-400 mt-1">
                          <span>{d.author} · {new Date(d.created_at).toLocaleString('et-EE')}</span>
                          <button
                            onClick={() => doRestore('deleted', d.id, d.last_seen_commit)}
                            className="text-primary-600 hover:text-primary-800 font-medium"
                          >
                            {t('info.restoreComment')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {commentHistory.truncated && (
                <p className="text-xs text-gray-400 italic">{t('info.historyTruncated')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CommentHistoryPanel;
