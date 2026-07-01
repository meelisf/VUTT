import { Pencil, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TextAnnotation } from '../../types';

interface AnnotationPopoverProps {
  annId: number;
  x: number;
  y: number;
  annotation?: TextAnnotation;
  annotations: TextAnnotation[];
  readOnly: boolean;
  editText: string;
  editing: boolean;
  pendingDelete: boolean;
  authorName: string;
  onEditTextChange: (text: string) => void;
  onEditingChange: (editing: boolean) => void;
  onPendingDeleteChange: (pending: boolean) => void;
  onClose: () => void;
  onSaveTextAnnotations: (annotations: TextAnnotation[]) => void;
  onDeleteTextAnnotation: (annId: number) => void;
  onRemoveAnchor: (annId: number) => void;
}

// Tekstiannotatsiooni ankrul avanev popover (kommentaari lisamine/muutmine/kustutamine).
export default function AnnotationPopover({
  annId,
  x,
  y,
  annotation,
  annotations,
  readOnly,
  editText,
  editing,
  pendingDelete,
  authorName,
  onEditTextChange,
  onEditingChange,
  onPendingDeleteChange,
  onClose,
  onSaveTextAnnotations,
  onDeleteTextAnnotation,
  onRemoveAnchor,
}: AnnotationPopoverProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const btnCancel = 'text-xs text-gray-400 hover:text-gray-700';
  const btnDanger = 'text-xs text-red-600 hover:text-red-800 font-medium';
  const btnSave = 'text-xs text-primary-600 hover:text-primary-800 font-medium disabled:opacity-40';

  const closePopover = () => {
    onClose();
    onEditingChange(false);
    onPendingDeleteChange(false);
  };

  const saveComment = () => {
    const comment = editText.trim();
    if (!comment) return;
    if (annotation) {
      onSaveTextAnnotations(annotations.map(a => a.id === annotation.id ? { ...a, comment } : a));
    } else {
      const newAnn: TextAnnotation = { id: annId, comment, author: authorName, created_at: new Date().toISOString() };
      onSaveTextAnnotations([...annotations, newAnn]);
    }
    closePopover();
  };

  return (
    <div
      className="fixed z-40 bg-white border border-gray-200 rounded-lg shadow-xl w-72 max-w-xs"
      style={{ left: x, top: y - 8, transform: 'translate(-50%, -100%)' }}
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
          {annotation ? t('annotations.annotationLabel', 'Märge') : t('annotations.orphanedAnchor', 'Kommentaar puudub')}
        </span>
        <button type="button" onClick={closePopover} className="text-gray-300 hover:text-gray-600 transition-colors" title={t('common:buttons.close', 'Sulge')}>
          <X size={14} />
        </button>
      </div>

      <div className="px-3 pb-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              autoFocus
              className="w-full px-2 py-1.5 text-sm border border-primary-300 rounded focus:border-primary-500 focus:ring-1 focus:ring-primary-200 outline-none resize-none"
              rows={3}
              placeholder={t('editor.annotateCommentPlaceholder', 'Kommentaar...')}
              value={editText}
              onChange={e => onEditTextChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') onEditingChange(false);
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && editText.trim()) saveComment();
              }}
            />
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => onEditingChange(false)} className={btnCancel}>
                {t('common:buttons.cancel', 'Tühista')}
              </button>
              <button type="button" disabled={!editText.trim()} onClick={saveComment} className={btnSave}>
                {t('common:buttons.save', 'Salvesta')}
              </button>
            </div>
          </div>
        ) : annotation ? (
          <>
            {annotation.comment.trim() ? (
              <p className="text-sm text-gray-800 mb-2 leading-relaxed whitespace-pre-wrap">{annotation.comment}</p>
            ) : (
              <p className="text-sm text-gray-400 italic mb-2">{t('annotations.orphanedAnchor', 'Kommentaar puudub')}</p>
            )}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2">
              <span className="text-xs text-gray-400">{annotation.author}</span>
              {!readOnly && (
                <div className="flex gap-3 items-center">
                  {pendingDelete ? (
                    <>
                      <button type="button" onClick={() => { onDeleteTextAnnotation(annotation.id); closePopover(); }} className={btnDanger}>
                        {t('common:buttons.delete', 'Kustuta')}
                      </button>
                      <button type="button" onClick={() => onPendingDeleteChange(false)} className={btnCancel}>
                        {t('common:buttons.cancel', 'Tühista')}
                      </button>
                    </>
                  ) : (
                    <>
                      <button type="button" onClick={() => { onEditingChange(true); onEditTextChange(annotation.comment); }} className="text-gray-300 hover:text-primary-500 transition-colors" title={t('info.editComment')}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" onClick={() => onPendingDeleteChange(true)} className="text-gray-300 hover:text-red-500 transition-colors" title={t('info.deleteComment')}>
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          !readOnly && (pendingDelete ? (
            <div className="flex gap-3 items-center">
              <button type="button" onClick={() => { onRemoveAnchor(annId); closePopover(); }} className={btnDanger}>
                {t('common:buttons.delete', 'Kustuta')}
              </button>
              <button type="button" onClick={() => onPendingDeleteChange(false)} className={btnCancel}>
                {t('common:buttons.cancel', 'Tühista')}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button type="button" onClick={() => { onEditingChange(true); onEditTextChange(''); }} className="text-xs text-primary-600 hover:text-primary-800">
                {t('annotations.addComment', 'Lisa kommentaar')}
              </button>
              <button type="button" onClick={() => onPendingDeleteChange(true)} className="text-gray-300 hover:text-red-500 transition-colors" title={t('annotations.deleteAnchor', 'Kustuta ankur')}>
                <Trash2 size={13} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
