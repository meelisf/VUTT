import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Briefcase, X, Loader2, Check, Replace, ListPlus } from 'lucide-react';
import EntityPicker from '../../components/EntityPicker';
import type { LinkedEntity } from '../../types/LinkedEntity';
import { getLangCode } from '../../utils/getLangCode';
import { getPersonFacets } from '../services/prosopographyService';

interface BulkOccupationModalProps {
  personCount: number;
  onClose: () => void;
  onApply: (occupation: LinkedEntity, mode: 'add' | 'replace') => Promise<void>;
}

const BulkOccupationModal: React.FC<BulkOccupationModalProps> = ({
  personCount,
  onClose,
  onApply,
}) => {
  const { t, i18n } = useTranslation(['prosopography', 'common']);
  const lang = getLangCode(i18n.language);

  const [occupation, setOccupation] = useState<LinkedEntity | null>(null);
  const [mode, setMode] = useState<'add' | 'replace'>('replace');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localSuggestions, setLocalSuggestions] = useState<{ label: string; id: string }[]>([]);

  useEffect(() => {
    getPersonFacets().then(data => {
      setLocalSuggestions(
        (data.occupations || [])
          .filter(o => o.id && o.id.startsWith('Q'))
          .map(o => ({
            id: o.id!,
            label: o.labels?.[lang] || o.labels?.et || o.labels?.en || o.label,
          }))
      );
    }).catch(() => {});
  }, [lang]);

  const handleApply = async () => {
    if (!occupation) return;
    setLoading(true);
    setError(null);
    try {
      await onApply(occupation, mode);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common:error.unknown', 'Viga'));
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-primary-600 px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Briefcase size={20} />
            {t('bulkOccupation.title', 'Määra amet')}
          </h2>
          <button onClick={onClose} className="text-white/80 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-gray-600">
            {t('bulkOccupation.description', 'Rakendatakse {{count}} isikule.', { count: personCount })}
          </p>

          {/* Mode */}
          <div className="flex gap-2">
            <button
              onClick={() => setMode('add')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                mode === 'add'
                  ? 'border-primary-500 bg-primary-50 text-primary-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <ListPlus size={16} />
              {t('bulkOccupation.modeAdd', 'Lisa')}
            </button>
            <button
              onClick={() => setMode('replace')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border-2 text-sm font-medium transition-all ${
                mode === 'replace'
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <Replace size={16} />
              {t('bulkOccupation.modeReplace', 'Asenda kõik')}
            </button>
          </div>
          <p className="text-xs text-gray-500 -mt-1">
            {mode === 'add'
              ? t('bulkOccupation.modeAddHint', 'Lisab ameti neile, kellel seda veel pole.')
              : t('bulkOccupation.modeReplaceHint', 'Eemaldab kõik olemasolevad ametid ja asendab valitud ametiga.')}
          </p>

          {/* Amet */}
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
              {t('occupations', 'Amet')}
            </label>
            <EntityPicker
              label=""
              placeholder={t('form.occupation', 'pastor, jurist, professor…')}
              type="topic"
              value={occupation}
              onChange={v => setOccupation(v)}
              lang={lang}
              localSuggestions={localSuggestions}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 px-6 py-4 bg-gray-50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium text-sm transition-colors"
          >
            {t('common:buttons.cancel', 'Tühista')}
          </button>
          <button
            onClick={handleApply}
            disabled={loading || !occupation}
            className="flex items-center gap-2 px-5 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {t('bulkOccupation.apply', 'Rakenda')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BulkOccupationModal;
