import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2 } from 'lucide-react';
import { mergePlaces } from '../../prosopography/services/prosopographyService';
import type { PlaceEntry } from '../../prosopography/types';
import { escapeHtml } from '../../utils/sanitizeHtml';

interface PlacesMergeModalProps {
  sourceKey: string;
  sourceEntry: PlaceEntry;
  places: Record<string, PlaceEntry>;
  personCount: number;
  token: string;
  lang: string;
  onMerged: (targetKey: string, redirected: number) => void;
  onClose: () => void;
}

function resolveLabel(labels: Record<string, string> | null | undefined, lang: string): string {
  if (!labels) return '';
  return labels[lang] ?? labels.et ?? labels.en ?? Object.values(labels)[0] ?? '';
}

const PlacesMergeModal: React.FC<PlacesMergeModalProps> = ({
  sourceKey, sourceEntry, places, personCount, token, lang, onMerged, onClose,
}) => {
  const { t } = useTranslation('admin');
  const [query, setQuery] = useState('');
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceName = resolveLabel(sourceEntry.labels, lang);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return [];
    return Object.entries(places)
      .filter(([k]) => k !== sourceKey)
      .filter(([k, e]) => {
        const inLabels = Object.values(e.labels ?? {}).some(l => l.toLowerCase().includes(q));
        const inHist = (e.historical_names ?? []).some((n: string) => n.toLowerCase().includes(q));
        return inLabels || inHist || k.toLowerCase().includes(q);
      })
      .slice(0, 8);
  }, [query, places, sourceKey]);

  const targetEntry = targetKey ? places[targetKey] : null;
  const targetName = targetEntry ? resolveLabel(targetEntry.labels, lang) : '';

  const handleMerge = async () => {
    if (!targetKey) return;
    setMerging(true);
    setError(null);
    try {
      const result = await mergePlaces(sourceKey, targetKey, token);
      onMerged(targetKey, result.redirected);
    } catch (e: any) {
      setError(e.message ?? t('places.mergeError'));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-gray-900">{t('places.mergeTitle')}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>

        <p
          className="text-sm text-gray-600 mb-4"
          dangerouslySetInnerHTML={{ __html: t('places.mergeDescription', { source: escapeHtml(sourceName) }) }}
        />

        {error && <p className="mb-3 text-xs text-red-600">{error}</p>}

        {!targetKey ? (
          <div className="relative">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('places.mergeSearch')}
              autoFocus
              className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 outline-none"
            />
            {filtered.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {filtered.map(([k, e]) => (
                  <button
                    key={k}
                    type="button"
                    onMouseDown={() => { setTargetKey(k); setQuery(''); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-primary-50 border-b border-gray-50 last:border-0 flex items-baseline gap-2"
                  >
                    <span className="font-medium">{resolveLabel(e.labels, lang)}</span>
                    {e.type && <span className="text-xs text-gray-400">({e.type})</span>}
                    <span className="ml-auto text-xs font-mono text-gray-300">{k}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded p-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-800">{targetName}</p>
              <p className="text-xs text-green-600 font-mono">{targetKey}</p>
            </div>
            <button
              type="button"
              onClick={() => setTargetKey(null)}
              className="text-green-400 hover:text-green-600"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            {t('places.cancel')}
          </button>
          <button
            onClick={handleMerge}
            disabled={!targetKey || merging}
            className="px-3 py-1.5 text-sm font-medium bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {merging && <Loader2 size={13} className="animate-spin" />}
            {targetKey
              ? (personCount > 0
                ? t('places.mergeConfirm', { count: personCount, target: targetName })
                : t('places.mergeConfirmZero'))
              : t('places.merge')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlacesMergeModal;
