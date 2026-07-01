import { useTranslation } from 'react-i18next';

interface AnnotationDialogProps {
  comment: string;
  error: string;
  selectionText?: string;
  onCommentChange: (comment: string) => void;
  onSave: (comment: string) => void;
  onCancel: () => void;
  onCloseError: () => void;
}

// Valitud tekstile kommentaari lisamise dialoog.
export default function AnnotationDialog({
  comment,
  error,
  selectionText,
  onCommentChange,
  onSave,
  onCancel,
  onCloseError,
}: AnnotationDialogProps) {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-5 w-96 max-w-full">
        <h3 className="font-bold text-gray-800 mb-1">{t('editor.annotateTitle', 'Lisa kommentaar')}</h3>
        {error ? (
          <p className="text-sm text-red-600 mb-3">{error}</p>
        ) : selectionText ? (
          <p className="text-xs text-gray-500 mb-3 italic truncate">„{selectionText}"</p>
        ) : null}
        {!error && (
          <>
            <textarea
              autoFocus
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-yellow-400 outline-none resize-none"
              rows={3}
              placeholder={t('editor.annotateCommentPlaceholder', 'Kommentaar...')}
              value={comment}
              onChange={e => onCommentChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && comment.trim()) onSave(comment.trim());
                if (e.key === 'Escape') onCancel();
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
                {t('common:buttons.cancel', 'Tühista')}
              </button>
              <button
                type="button"
                disabled={!comment.trim()}
                onClick={() => { if (comment.trim()) onSave(comment.trim()); }}
                className="px-3 py-1.5 text-sm bg-yellow-500 hover:bg-yellow-600 text-white rounded disabled:opacity-50"
              >
                {t('common:buttons.save', 'Salvesta')}
              </button>
            </div>
          </>
        )}
        {error && (
          <div className="flex justify-end mt-3">
            <button type="button" onClick={onCloseError} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">
              {t('common:buttons.close', 'Sulge')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
