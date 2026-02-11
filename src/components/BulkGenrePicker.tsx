import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { BookOpen, X, Loader2, Check, Trash2 } from 'lucide-react';
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

interface BulkGenrePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (genre: LinkedEntity | null) => void;
  selectedCount: number;
}

const BulkGenrePicker: React.FC<BulkGenrePickerProps> = ({
  isOpen,
  onClose,
  onSave,
  selectedCount
}) => {
  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const lang = (i18n.language.split('-')[0] as 'et' | 'en') || 'et';

  const [selectedGenre, setSelectedGenre] = useState<LinkedEntity | null>(null);
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
        setSuggestions(result.genres || []);
      }
    } catch (e) {
      console.error('Failed to load suggestions:', e);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleSave = () => {
    setIsSaving(true);
    onSave(selectedGenre);
  };

  const handleClearGenre = () => {
    setSelectedGenre(null);
  };

  const handleClose = () => {
    setSelectedGenre(null);
    onClose();
  };

  if (!isOpen) return null;

  const isLinked = selectedGenre?.id && selectedGenre?.source !== 'manual';
  const entityUrl = selectedGenre ? getEntityUrl(selectedGenre.id, selectedGenre.source) : null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="bg-primary-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <BookOpen size={24} />
            {t('bulkAssign.assignGenre')}
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
            {t('bulkAssign.genreDescription', { count: selectedCount })}
          </p>

          {/* Valitud žanr */}
          {selectedGenre && (
            <div className="space-y-2">
              <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
                {t('bulkAssign.selectedGenre')}
              </label>
              <div className={`flex items-center justify-between px-4 py-3 rounded-lg ${
                isLinked ? 'bg-green-50 border border-green-200' : 'bg-gray-50 border border-gray-200'
              }`}>
                <div className="flex items-center gap-2">
                  <BookOpen size={18} className={isLinked ? 'text-green-600' : 'text-gray-400'} />
                  {entityUrl ? (
                    <a
                      href={entityUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`font-medium hover:underline ${isLinked ? 'text-green-800' : 'text-gray-700'}`}
                    >
                      {getLabel(selectedGenre, lang)}
                    </a>
                  ) : (
                    <span className={`font-medium ${isLinked ? 'text-green-800' : 'text-gray-700'}`}>
                      {getLabel(selectedGenre, lang)}
                    </span>
                  )}
                  {isLinked && (
                    <span className="text-xs text-green-600 bg-green-100 px-1.5 py-0.5 rounded">
                      {selectedGenre.id}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleClearGenre}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors"
                  title={t('common:buttons.remove')}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          {/* EntityPicker žanri valimiseks */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide">
              {selectedGenre ? t('bulkAssign.changeGenre') : t('bulkAssign.selectGenreLabel')}
            </label>
            {isLoadingSuggestions ? (
              <div className="flex items-center gap-2 text-gray-400 py-2">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">{t('common:labels.loading')}</span>
              </div>
            ) : (
              <EntityPicker
                type="genre"
                value={selectedGenre}
                onChange={setSelectedGenre}
                placeholder={t('bulkAssign.searchGenre')}
                lang={lang}
                localSuggestions={suggestions}
              />
            )}
          </div>

          {/* Žanri eemaldamise võimalus */}
          {!selectedGenre && (
            <button
              onClick={() => {
                setIsSaving(true);
                onSave(null);
              }}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Trash2 size={18} />
              <span className="font-medium">{t('bulkAssign.removeGenre')}</span>
            </button>
          )}
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
            disabled={isSaving || !selectedGenre}
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

export default BulkGenrePicker;
