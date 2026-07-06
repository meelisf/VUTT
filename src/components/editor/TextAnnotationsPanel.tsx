import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Edit3, SquarePen, Trash2, X } from 'lucide-react';
import type { TextAnnotation } from '../../types';
import { extractHighlightedText } from '../../utils/annUtils';

interface TextAnnotationsPanelProps {
  textAnnotations: TextAnnotation[];
  textContent: string;
  readOnly: boolean;
  onSaveTextAnnotations: (updated: TextAnnotation[]) => Promise<void>;
  onDeleteTextAnnotation: (annId: number) => Promise<void>;
}

const TextAnnotationsPanel: React.FC<TextAnnotationsPanelProps> = ({
  textAnnotations,
  textContent,
  readOnly,
  onSaveTextAnnotations,
  onDeleteTextAnnotation,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const [editingAnnId, setEditingAnnId] = useState<number | null>(null);
  const [editingAnnText, setEditingAnnText] = useState('');

  if (textAnnotations.length === 0) return null;

  return (
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
  );
};

export default TextAnnotationsPanel;
