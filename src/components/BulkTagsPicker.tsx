import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, X, Plus, Loader2, Check, Replace, ListPlus } from 'lucide-react';
import EntityPicker from './EntityPicker';
import { LinkedEntity } from '../types/LinkedEntity';
import { FILE_API_URL } from '../config';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { getLabel } from '../utils/metadataUtils';
import { getEntityUrl } from '../utils/entityUrl';

interface SuggestionItem {
  label: string;
  id: string | null;
}

interface BulkTagsPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (tags: LinkedEntity[], mode: 'add' | 'replace') => void;
  selectedCount: number;
}

const BulkTagsPicker: React.FC<BulkTagsPickerProps> = ({
  isOpen,
  onClose,
  onSave,
  selectedCount
}) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const lang = (i18n.language.split('-')[0] as 'et' | 'en') || 'et';

  const [selectedTags, setSelectedTags] = useState<LinkedEntity[]>([]);
  const [mode, setMode] = useState<'add' | 'replace'>('add');
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Laadime soovitused serverist
  useEffect(() => {
    if (isOpen) {
      loadSuggestions();
    }
  }, [isOpen]);

  const loadSuggestions = async () => {
    setIsLoadingSuggestions(true);
    try {
      const token = localStorage.getItem('vutt_token');
      const response = await fetchWithTimeout(`${FILE_API_URL}/get-metadata-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auth_token: token, lang })
      });
      const result = await response.json();
      if (result.status === 'success') {
        setSuggestions(result.tags || []);
      }
    } catch (e) {
      console.error('Failed to load suggestions:', e);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleAddTag = (entity: LinkedEntity | null) => {
    if (!entity) return;

    // Kontrolli duplikaate
    const exists = selectedTags.some(t => {
      if (t.id && entity.id && t.id === entity.id) return true;
      if (t.label.toLowerCase() === entity.label.toLowerCase()) return true;
      return false;
    });

    if (!exists) {
      setSelectedTags([...selectedTags, entity]);
    }
  };

  const handleRemoveTag = (index: number) => {
    setSelectedTags(selectedTags.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (selectedTags.length === 0 && mode !== 'replace') return;
    setIsSaving(true);
    onSave(selectedTags, mode);
  };

  const handleClose = () => {
    setSelectedTags([]);
    setMode('add');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-primary-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Tag size={24} />
            {t('bulkAssign.assignTags')}
          </h2>
          <button
            onClick={handleClose}
            className="text-white/80 hover:text-white transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        {/* Sisu */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Info tekst */}
          <p className="text-sm text-gray-600">
            {t('bulkAssign.tagsDescription', { count: selectedCount })}
          </p>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('add')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                mode === 'add'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <ListPlus size={20} />
              <span className="font-medium">{t('bulkAssign.tagsMode.add')}</span>
            </button>
            <button
              onClick={() => setMode('replace')}
              className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 transition-all ${
                mode === 'replace'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <Replace size={20} />
              <span className="font-medium">{t('bulkAssign.tagsMode.replace')}</span>
            </button>
          </div>

          {/* Mode selgitus */}
          <p className="text-xs text-gray-500 -mt-2">
            {mode === 'add'
              ? t('bulkAssign.tagsModeAddHint')
              : t('bulkAssign.tagsModeReplaceHint')}
          </p>

          {/* Valitud märksõnad */}
          {selectedTags.length > 0 && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                {t('bulkAssign.selectedTags')} ({selectedTags.length})
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedTags.map((tag, idx) => {
                  const isLinked = tag.id && tag.source !== 'manual';
                  const entityUrl = getEntityUrl(tag.id, tag.source);
                  return (
                    <span
                      key={idx}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm ${
                        isLinked
                          ? 'bg-green-100 text-green-800'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      <Tag size={14} className={isLinked ? 'text-green-600' : 'text-gray-400'} />
                      {entityUrl ? (
                        <a
                          href={entityUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {getLabel(tag, lang)}
                        </a>
                      ) : (
                        <span>{getLabel(tag, lang)}</span>
                      )}
                      <button
                        onClick={() => handleRemoveTag(idx)}
                        className="ml-1 p-0.5 rounded-full hover:bg-black/10 transition-colors"
                      >
                        <X size={14} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* EntityPicker märksõnade lisamiseks */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
              {t('bulkAssign.addTag')}
            </label>
            {isLoadingSuggestions ? (
              <div className="flex items-center gap-2 text-gray-400 py-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">{t('common:labels.loading')}</span>
              </div>
            ) : (
              <EntityPicker
                type="topic"
                value={null}
                onChange={handleAddTag}
                placeholder={t('bulkAssign.searchTag')}
                lang={lang}
                localSuggestions={suggestions}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium transition-colors"
          >
            {t('common:buttons.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || (selectedTags.length === 0 && mode === 'add')}
            className="flex items-center gap-2 px-6 py-2 bg-primary-600 hover:bg-primary-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Check size={18} />
            )}
            {t('common:buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkTagsPicker;
