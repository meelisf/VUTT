import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowRight, ArrowLeftRight, X, Trash2, AlertTriangle } from 'lucide-react';
import type { ProsopoIndexEntry } from '../types';

interface MergePersonsModalProps {
  personA: ProsopoIndexEntry;
  personB: ProsopoIndexEntry;
  onConfirm: (sourceId: string, targetId: string) => void;
  onClose: () => void;
  loading: boolean;
  error: string | null;
}

const PersonSummary: React.FC<{ person: ProsopoIndexEntry; label: string; highlight: 'source' | 'target' }> = ({
  person, label, highlight,
}) => {
  const { t } = useTranslation(['prosopography']);
  const lifespanNode = (() => {
    const sym = 'text-primary-500';
    const b = person.birth_year ? <><span className={sym}>*</span>{person.birth_year}</> : null;
    const d = person.death_year ? <><span className={sym}>†</span>{person.death_year}</> : null;
    if (b && d) return <>{b}{'  '}{d}</>;
    if (b) return b;
    if (d) return d;
    return <>—</>;
  })();

  const isSource = highlight === 'source';
  return (
    <div className={`flex-1 rounded-lg border-2 p-4 ${isSource ? 'border-red-200 bg-red-50' : 'border-green-200 bg-green-50'}`}>
      <p className={`text-[10px] font-bold uppercase tracking-widest mb-2 ${isSource ? 'text-red-500' : 'text-green-600'}`}>
        {label}
      </p>
      <h3 className="text-base font-bold text-gray-900 leading-tight mb-1">{person.label}</h3>
      <p className="text-sm text-gray-500 mb-2">{lifespanNode}</p>
      {person.status_label && <p className="text-xs text-gray-600">{person.status_label}</p>}
      <div className="mt-3 flex items-center gap-1 flex-wrap">
        {person.has_wikidata && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white border border-primary-200 text-primary-700">WD</span>}
        {person.has_gnd     && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white border border-primary-200 text-primary-700">GND</span>}
        {person.has_aa      && <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-white border border-primary-200 text-primary-700">AA</span>}
        {person.work_count > 0 && (
          <span className="text-xs text-gray-500 ml-1">{person.work_count} {t('works', { count: person.work_count })}</span>
        )}
      </div>
      {isSource && (
        <p className="mt-3 flex items-center gap-1 text-xs text-red-600">
          <Trash2 size={11} /> {t('merge.tombstone')}
        </p>
      )}
    </div>
  );
};

const MergePersonsModal: React.FC<MergePersonsModalProps> = ({
  personA, personB, onConfirm, onClose, loading, error,
}) => {
  const { t } = useTranslation(['prosopography', 'common']);
  // source = kustutatav, target = säilitatav
  const [sourceIsA, setSourceIsA] = useState(true);

  const source = sourceIsA ? personA : personB;
  const target = sourceIsA ? personB : personA;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl">

        {/* Päis */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {t('merge.title', 'Liida kaks isikut')}
          </h2>
          <button onClick={onClose} disabled={loading} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Kaardid kõrvuti */}
        <div className="px-5 py-5 flex items-center gap-3">
          <PersonSummary person={source} label={t('merge.source', 'Kustutatav')} highlight="source" />

          <div className="flex flex-col items-center gap-2 shrink-0">
            <ArrowRight size={20} className="text-gray-400" />
            <button
              onClick={() => setSourceIsA(v => !v)}
              disabled={loading}
              title={t('merge.swap', 'Vaheta kohad')}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
            >
              <ArrowLeftRight size={14} />
            </button>
          </div>

          <PersonSummary person={target} label={t('merge.target', 'Säilitatav')} highlight="target" />
        </div>

        {/* Selgitus */}
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">
            {t('merge.warning',
              '«{{source}}» märgitakse tombstone-iks ja suunatakse «{{target}}»-ile. Toiming on pöördumatu.',
              { source: source.label, target: target.label })}
          </p>
        </div>

        {error && (
          <p className="mx-5 mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
        )}

        {/* Nupud */}
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
          >
            {t('common:cancel', 'Tühista')}
          </button>
          <button
            onClick={() => onConfirm(source.id, target.id)}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg transition-colors flex items-center gap-1.5"
          >
            {loading ? (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            ) : (
              <ArrowRight size={14} />
            )}
            {t('merge.confirm', 'Liida')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default MergePersonsModal;
