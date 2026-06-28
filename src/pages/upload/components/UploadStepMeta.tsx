import React from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import type { Collection } from '../../../services/collectionService';
import type { UploadType } from '../types';

interface UploadStepMetaProps {
  title: string;
  setTitle: (value: string) => void;
  year: string;
  setYear: (value: string) => void;
  workType: UploadType;
  setWorkType: (value: UploadType) => void;
  typePrint: UploadType;
  typeHand: UploadType;
  slug: string;
  selectedCollection: string;
  setSelectedCollection: (value: string) => void;
  collectionList: Array<[string, Collection]>;
  lang: string;
  step1Loading: boolean;
  step1Error: string;
  autoCreateLoading: boolean;
  autoCreateError: string;
  replaceWorkId: string | null;
  replaceWorkTitle: string | null;
  onReplaceDismiss: () => void;
  onSubmit: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

const UploadStepMeta: React.FC<UploadStepMetaProps> = ({
  title,
  setTitle,
  year,
  setYear,
  workType,
  setWorkType,
  typePrint,
  typeHand,
  slug,
  selectedCollection,
  setSelectedCollection,
  collectionList,
  lang,
  step1Loading,
  step1Error,
  autoCreateLoading,
  autoCreateError,
  replaceWorkId,
  replaceWorkTitle,
  onReplaceDismiss,
  onSubmit,
  t,
}) => (
  <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
    <h2 className="text-lg font-semibold text-gray-900 mb-5">{t('step1.title')}</h2>

    {/* Automaatne laadimine — replace mode, loome uploadi ilma kasutaja sekkumiseta */}
    {autoCreateLoading && (
      <div className="flex items-center gap-3 py-8 justify-center text-gray-500">
        <Loader2 size={20} className="animate-spin text-primary-600" />
        <span className="text-sm">Laen...</span>
      </div>
    )}

    {/* Automaatse loomise viga — näita vormi eeltäidetult */}
    {!autoCreateLoading && autoCreateError && (
      <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
        {autoCreateError}
      </div>
    )}

    {/* Asenda olemasolevat teost — näidatakse ainult kui replaceWorkId on URL parameetritest loetud */}
    {!autoCreateLoading && replaceWorkId && (
      <div className="mb-6 border border-amber-200 rounded-lg bg-amber-50/60 overflow-hidden">
        <div className="px-4 py-2.5 bg-amber-100/70 border-b border-amber-200 flex items-center gap-2">
          <span className="text-xs font-semibold text-amber-900">{t('replaceWork.label')}</span>
        </div>
        <div className="p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle size={14} className="text-amber-600 shrink-0" />
            <span className="text-xs font-medium text-amber-800">{t('replaceWork.selected')}</span>
            <span className="text-xs text-amber-900 font-semibold flex-1 truncate">{replaceWorkTitle}</span>
            <button
              type="button"
              onClick={onReplaceDismiss}
              className="p-0.5 text-amber-600 hover:text-red-600 transition-colors shrink-0"
              title="Eemalda asendus"
            >
              <X size={14} />
            </button>
          </div>
          <p className="text-xs text-amber-700 mt-2 flex items-start gap-1">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" />
            {t('replaceWork.warning')}
          </p>
        </div>
      </div>
    )}

    {/* Vormi sisu — peidetud auto-loomise ajal */}
    {!autoCreateLoading && (
      <>
        {/* Pealkiri */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('step1.titleLabel')} <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('step1.titlePlaceholder')}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        {/* Tüüp (trükis / käsikiri) */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('step1.materialTypeLabel')}
          </label>
          <div className="flex gap-4">
            {([typePrint, typeHand] as const).map((t_) => (
              <label key={t_.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="workType"
                  value={t_.id}
                  checked={workType.id === t_.id}
                  onChange={() => setWorkType(t_)}
                  className="accent-primary-600"
                />
                <span className="text-sm text-gray-700">
                  {t_.id === 'Q1261026' ? t('step1.materialTypePrint') : t('step1.materialTypeHand')}
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Aasta */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {workType.id === 'Q87167' ? t('step1.yearLabelOptional') : t('step1.yearLabel')} {workType.id !== 'Q87167' && <span className="text-red-500">*</span>}
          </label>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder={t('step1.yearPlaceholder')}
            min={1200}
            max={1800}
            className="w-48 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <p className="text-xs text-gray-400 mt-1">{t('step1.yearHint')}</p>
          {workType.id === 'Q87167' && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
              {t('step1.materialTypeHandYearHint')}
            </p>
          )}
        </div>

        {/* Slug — automaatne, nähtav ainult vihjena */}
        {slug ? (
          <p className="text-xs text-gray-400 mb-4 font-mono">
            data/{slug}/
          </p>
        ) : null}

        {/* Kollektsioon */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {t('step1.collectionLabel')}
          </label>
          <select
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
          >
            <option value="">{t('step1.collectionNone')}</option>
            {collectionList.map(([id, col]) => (
              <option key={id} value={id}>
                {typeof col.name === 'object'
                  ? (col.name[lang as keyof typeof col.name] ?? col.name.et ?? id)
                  : String(col.name)}
              </option>
            ))}
          </select>
        </div>

        {/* Vea teade */}
        {step1Error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {step1Error}
          </div>
        )}

        <button
          onClick={onSubmit}
          disabled={!title.trim() || (workType.id !== 'Q87167' && !year.trim()) || !slug.trim() || step1Loading}
          className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors text-sm"
        >
          {step1Loading ? (
            <Loader2 size={16} className="animate-spin" />
          ) : null}
          {t('step1.continue')}
        </button>
        <p className="text-xs text-gray-400 text-center mt-2">
          ⏱ {t('step1.timeEstimate')}
        </p>
      </>
    )}
  </div>
);

export default UploadStepMeta;
