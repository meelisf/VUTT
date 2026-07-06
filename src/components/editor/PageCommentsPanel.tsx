import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Edit3, MessageSquare, Reply, Send, Trash2, X } from 'lucide-react';
import type { Annotation } from '../../types';
import { isAtLeast } from '../../utils/roleUtils';
import MarkdownEditor from '../MarkdownEditor';
import MarkdownView from '../MarkdownView';

interface EditablePostProps {
  text: string;
  author: string;
  createdAt: string;
  canModify: boolean;
  isEditing: boolean;
  editingText: string;
  onEditingTextChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onDelete: () => void;
  labels: {
    cancel: string;
    save: string;
    edit: string;
    delete: string;
  };
  extraActions?: React.ReactNode;
  minRows?: number;
  contentClassName?: string;
}

// Ühine komponent nii juurkommentaari kui vastuse teksti muutmiseks/kustutamiseks.
const EditablePost: React.FC<EditablePostProps> = ({
  text,
  author,
  createdAt,
  canModify,
  isEditing,
  editingText,
  onEditingTextChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  labels,
  extraActions,
  minRows = 3,
  contentClassName = '',
}) => {
  if (isEditing) {
    return (
      <div className="space-y-2">
        <MarkdownEditor
          value={editingText}
          onChange={onEditingTextChange}
          minRows={minRows}
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancelEdit}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
          >
            <X size={12} />
            {labels.cancel}
          </button>
          <button
            onClick={onSaveEdit}
            disabled={!editingText.trim()}
            className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
          >
            <Check size={12} />
            {labels.save}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`text-gray-800 text-sm mb-2 leading-relaxed pr-12 vutt-md-comment ${contentClassName}`}>
        <MarkdownView content={text} softBreaks />
      </div>
      <div className="flex justify-between items-center text-xs text-gray-500">
        <span className="font-semibold text-primary-700">{author}</span>
        <span>{new Date(createdAt).toLocaleString('et-EE')}</span>
      </div>
      {(extraActions || canModify) && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 rounded-md shadow-sm border border-gray-100 px-1 py-0.5">
          {extraActions}
          {canModify && (
            <>
              <button
                onClick={onStartEdit}
                className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                title={labels.edit}
              >
                <Edit3 size={14} />
              </button>
              <button
                onClick={onDelete}
                className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-white transition-colors"
                title={labels.delete}
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
};

interface PageCommentsPanelProps {
  comments: Annotation[];
  setComments: (comments: Annotation[]) => void;
  onDraftChange?: (hasDraft: boolean) => void;
  flushRef?: React.MutableRefObject<(() => Annotation[] | null) | null>;
  onSaveAnnotations?: (comments: Annotation[]) => Promise<void>;
  onReplyToComment?: (commentId: string, replyText: string) => Promise<void>;
  readOnly: boolean;
  user: any;
  highlightedCommentId: string | null;
}

const PageCommentsPanel: React.FC<PageCommentsPanelProps> = ({
  comments,
  setComments,
  onDraftChange,
  flushRef,
  onSaveAnnotations,
  onReplyToComment,
  readOnly,
  user,
  highlightedCommentId,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const [newComment, setNewComment] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [replyingToCommentId, setReplyingToCommentId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [savingReplyId, setSavingReplyId] = useState<string | null>(null);
  const [editingReplyCommentId, setEditingReplyCommentId] = useState<string | null>(null);
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [editingReplyText, setEditingReplyText] = useState('');

  const isAdmin = isAtLeast(user?.role, 'admin');
  const canModifyOwnPost = (authorUsername?: string) => (
    isAdmin || Boolean(user?.username && authorUsername && user.username === authorUsername)
  );

  // Teavita parenti salvestamata kommentaari/muudatuse mustandist.
  useEffect(() => {
    onDraftChange?.(Boolean(newComment.trim() || editingText.trim() || editingReplyText.trim()));
  }, [newComment, editingText, editingReplyText, onDraftChange]);

  // Komponendi eemaldamisel nulli mustand-lipp, et see ei jääks toppama.
  useEffect(() => () => onDraftChange?.(false), [onDraftChange]);

  // Registreeri flush: liidab mustandi kommentaaridesse ja tühjendab mustandi-välja.
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = () => {
      let merged = comments;
      let changed = false;
      if (editingCommentId && editingText.trim()) {
        merged = merged.map(c => c.id === editingCommentId ? { ...c, text: editingText } : c);
        changed = true;
      }
      if (newComment.trim()) {
        merged = [...merged, {
          id: Date.now().toString(),
          text: newComment,
          author: user?.name || 'Anonüümne',
          author_username: user?.username,
          created_at: new Date().toISOString(),
        }];
        changed = true;
      }
      if (!changed) return null;
      setNewComment('');
      setEditingCommentId(null);
      setEditingText('');
      onDraftChange?.(false);
      return merged;
    };
    return () => { if (flushRef) flushRef.current = null; };
  }, [flushRef, comments, editingCommentId, editingText, newComment, user, onDraftChange]);

  const addComment = async () => {
    if (!newComment.trim()) return;
    const comment: Annotation = {
      id: Date.now().toString(),
      text: newComment,
      author: user?.name || 'Anonüümne',
      author_username: user?.username,
      created_at: new Date().toISOString()
    };
    const updated = [...comments, comment];
    setComments(updated);
    setNewComment('');
    if (onSaveAnnotations) await onSaveAnnotations(updated);
  };

  const removeComment = (commentId: string) => {
    if (!window.confirm(t('info.deleteCommentConfirm'))) return;
    setComments(comments.filter(c => c.id !== commentId));
  };

  const startEditComment = (comment: Annotation) => {
    setEditingCommentId(comment.id);
    setEditingText(comment.text);
  };

  const saveEditComment = async (commentId: string) => {
    if (!editingText.trim()) return;
    const updated = comments.map(c => c.id === commentId ? { ...c, text: editingText } : c);
    setComments(updated);
    setEditingCommentId(null);
    setEditingText('');
    if (onSaveAnnotations) await onSaveAnnotations(updated);
  };

  const saveReply = async (commentId: string) => {
    if (!replyText.trim() || !onReplyToComment) return;
    setReplyError(null);
    setSavingReplyId(commentId);
    try {
      await onReplyToComment(commentId, replyText.trim());
      setReplyText('');
      setReplyingToCommentId(null);
    } catch (e: any) {
      setReplyError(e.message || t('common:errors.unknownError'));
    } finally {
      setSavingReplyId(null);
    }
  };

  const startEditReply = (commentId: string, replyId: string, text: string) => {
    setEditingReplyCommentId(commentId);
    setEditingReplyId(replyId);
    setEditingReplyText(text);
  };

  const cancelEditReply = () => {
    setEditingReplyCommentId(null);
    setEditingReplyId(null);
    setEditingReplyText('');
  };

  const saveEditReply = async (commentId: string, replyId: string) => {
    if (!editingReplyText.trim()) return;
    const updated = comments.map(comment => comment.id === commentId
      ? {
          ...comment,
          replies: (comment.replies || []).map(reply => reply.id === replyId
            ? { ...reply, text: editingReplyText }
            : reply),
        }
      : comment);
    setComments(updated);
    cancelEditReply();
    if (onSaveAnnotations) await onSaveAnnotations(updated);
  };

  const removeReply = async (commentId: string, replyId: string) => {
    if (!window.confirm(t('info.deleteCommentConfirm'))) return;
    const updated = comments.map(comment => comment.id === commentId
      ? { ...comment, replies: (comment.replies || []).filter(reply => reply.id !== replyId) }
      : comment);
    setComments(updated);
    if (onSaveAnnotations) await onSaveAnnotations(updated);
  };

  const labels = {
    cancel: t('info.cancelEdit'),
    save: t('info.saveEdit'),
    edit: t('info.editComment'),
    delete: t('info.deleteComment'),
  };

  return (
    <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm flex-1 flex flex-col">
      <div className="flex items-center gap-2 mb-4 text-gray-800 border-b border-gray-100 pb-2">
        <MessageSquare size={18} className="text-primary-600" />
        <h4 className="font-bold">{t('workspace:info.pageAnnotations')}</h4>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 mb-4 min-h-[100px]">
        {comments.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <p className="text-sm italic">{t('info.noAnnotationsHint')}</p>
          </div>
        )}
        {comments.map(comment => (
          <div
            id={`comment-${comment.id}`}
            key={comment.id}
            className={`bg-gray-50 p-3 rounded-lg border relative group ${
              highlightedCommentId === comment.id ? 'border-primary-300 ring-2 ring-primary-100' : 'border-gray-100'
            }`}
          >
            <EditablePost
              text={comment.text}
              author={comment.author}
              createdAt={comment.created_at}
              canModify={!readOnly && canModifyOwnPost(comment.author_username)}
              isEditing={editingCommentId === comment.id}
              editingText={editingText}
              onEditingTextChange={setEditingText}
              onStartEdit={() => startEditComment(comment)}
              onCancelEdit={() => { setEditingCommentId(null); setEditingText(''); }}
              onSaveEdit={() => saveEditComment(comment.id)}
              onDelete={() => removeComment(comment.id)}
              labels={labels}
              extraActions={!readOnly && onReplyToComment ? (
                <button
                  onClick={() => {
                    setReplyingToCommentId(comment.id);
                    setReplyText('');
                    setReplyError(null);
                  }}
                  className="text-gray-400 hover:text-primary-600 p-1 rounded hover:bg-white transition-colors"
                  title={t('info.replyToComment')}
                >
                  <Reply size={14} />
                </button>
              ) : null}
              minRows={6}
            />
            {editingCommentId !== comment.id && (
              <>
                {(comment.replies || []).length > 0 && (
                  <div className="mt-3 space-y-2 border-l-2 border-primary-100 pl-3">
                    {(comment.replies || []).map(reply => (
                      <div key={reply.id} className="bg-white border border-gray-100 rounded-md px-3 py-2 relative group">
                        <EditablePost
                          text={reply.text}
                          author={reply.author}
                          createdAt={reply.created_at}
                          canModify={!readOnly && canModifyOwnPost(reply.author_username)}
                          isEditing={editingReplyCommentId === comment.id && editingReplyId === reply.id}
                          editingText={editingReplyText}
                          onEditingTextChange={setEditingReplyText}
                          onStartEdit={() => startEditReply(comment.id, reply.id, reply.text)}
                          onCancelEdit={cancelEditReply}
                          onSaveEdit={() => saveEditReply(comment.id, reply.id)}
                          onDelete={() => removeReply(comment.id, reply.id)}
                          labels={labels}
                          minRows={3}
                          contentClassName="mb-1"
                        />
                      </div>
                    ))}
                  </div>
                )}
                {replyingToCommentId === comment.id && (
                  <div className="mt-3 space-y-2">
                    <MarkdownEditor
                      value={replyText}
                      onChange={setReplyText}
                      placeholder={t('info.replyPlaceholder')}
                      minRows={3}
                    />
                    {replyError && <p className="text-xs text-red-600">{replyError}</p>}
                    <div className="flex gap-2 justify-end">
                      <button
                        onClick={() => { setReplyingToCommentId(null); setReplyText(''); setReplyError(null); }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 border border-gray-300 rounded hover:bg-gray-100 transition-colors"
                      >
                        <X size={12} />
                        {t('info.cancelEdit')}
                      </button>
                      <button
                        onClick={() => saveReply(comment.id)}
                        disabled={!replyText.trim() || savingReplyId === comment.id}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-white bg-primary-600 rounded hover:bg-primary-700 disabled:opacity-50 transition-colors"
                      >
                        <Send size={12} />
                        {t('info.sendReply')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {!readOnly ? (
        <div className="mt-auto">
          <MarkdownEditor
            value={newComment}
            onChange={setNewComment}
            placeholder={t('info.commentPlaceholder')}
            minRows={5}
          />
          <button
            onClick={addComment}
            disabled={!newComment.trim()}
            className="w-full py-2 bg-gray-900 text-white text-xs font-bold uppercase tracking-wider rounded hover:bg-gray-800 disabled:opacity-50 transition-colors"
          >
            {t('info.addComment').toUpperCase()}
          </button>
        </div>
      ) : (
        <div className="mt-auto text-center py-4 text-sm text-gray-400">
          {t('info.loginToComment')}
        </div>
      )}
    </div>
  );
};

export default PageCommentsPanel;
