import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, RefreshCw, Trash2, X, Loader2 } from 'lucide-react';

/**
 * Hõljuv alumine kontekstiriba manage-lehe lehekülgede tabis.
 *
 * Konsolideerib varem kolm virnastatud riba (järjekord / valik / transkriptsioon)
 * üheks fikseeritud ribaks, mis ilmub AINULT kui on midagi teha — kas lehti on
 * valitud või on salvestamata järjekorra-muudatusi. Nii on tegevused alati
 * nähtaval (ka 200-lehelisel dokumendil keritult), ilma et pisipiltidelt püsivat
 * püstruumi ära võetaks. Overlay (ei kahanda ruudustikku).
 *
 * Puhtalt esitluslik — kogu loogika ja olek elab WorkManage-s, siia tulevad
 * valmis väärtused ja callbackid.
 */
export interface PageActionBarProps {
  // Valik
  selectedCount: number;
  onClearSelection: () => void;
  // Liiguta (mustand — EI tühjenda valikut, et saaks sama plokki uuesti liigutada)
  moveTarget: string;
  setMoveTarget: (v: string) => void;
  moveCanApply: boolean;
  moveHintText: string | null;
  onMove: () => void;
  // Re-OCR
  ocrModel: 'print' | 'hand';
  setOcrModel: (m: 'print' | 'hand') => void;
  actionsDisabled: boolean;           // hasReorderChanges → re-OCR/kustuta blokeeritud
  actionsDisabledTitle: string;
  onReocrClick: () => void;
  batchConfirm: boolean;
  selectedWithTextCount: number;
  onBatchGo: () => void;
  onBatchCancel: () => void;
  batchError: string | null;
  // Kustuta
  onDeleteClick: () => void;
  bulkDeleteConfirm: boolean;
  bulkDeleting: boolean;
  onBulkDeleteGo: () => void;
  onBulkDeleteCancel: () => void;
  bulkDeleteError: string | null;
  // Järjekord
  hasReorderChanges: boolean;
  changedCount: number;
  reorderSaving: boolean;
  onReorderSave: () => void;
  onDiscardReorder: () => void;
}

const PageActionBar: React.FC<PageActionBarProps> = (props) => {
  const { t } = useTranslation(['workspace', 'common']);
  const hasSelection = props.selectedCount > 0;

  // Riba puudub täielikult kui pole valikut ega järjekorra-muudatusi → pisipildid täies mahus
  if (!hasSelection && !props.hasReorderChanges) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[1100] flex justify-center px-3 pb-3 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-4xl rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">

        {/* Kinnitus: kustutamine (avaneb riba kohale) */}
        {props.bulkDeleteConfirm && (
          <div className="px-4 py-3 bg-red-50 border-b border-red-200 flex flex-wrap items-center gap-3">
            <span className="text-sm text-red-800">{t('manage.bulkDelete.confirm', { count: props.selectedCount })}</span>
            <button onClick={props.onBulkDeleteGo} disabled={props.bulkDeleting}
              className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded">
              {props.bulkDeleting ? <Loader2 size={13} className="animate-spin inline" /> : t('manage.bulkDelete.button')}
            </button>
            <button onClick={props.onBulkDeleteCancel}
              className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
              {t('common:buttons.cancel', 'Tühista')}
            </button>
          </div>
        )}
        {props.bulkDeleteError && (
          <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">{props.bulkDeleteError}</div>
        )}

        {/* Kinnitus: re-OCR (avaneb riba kohale) */}
        {props.batchConfirm && (
          <div className="px-4 py-3 bg-green-50 border-b border-green-200 flex flex-col gap-2">
            <span className="text-sm text-green-900">
              {t('manage.reocr.confirm.line1', { count: props.selectedCount })} {t('manage.reocr.confirm.line2')}
            </span>
            {props.selectedWithTextCount > 0 && (
              <span className="text-xs text-green-700">{t('manage.reocr.confirm.withText', { count: props.selectedWithTextCount })}</span>
            )}
            <div className="flex items-center gap-3">
              <button onClick={props.onBatchGo} className="px-3 py-1 text-sm bg-green-600 hover:bg-green-700 text-white rounded">
                {t('manage.reocr.confirm.go')}
              </button>
              <button onClick={props.onBatchCancel} className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                {t('manage.reocr.confirm.cancel')}
              </button>
            </div>
          </div>
        )}
        {props.batchError && (
          <div className="px-4 py-2 bg-green-50 border-b border-green-200 text-sm text-red-700">{props.batchError}</div>
        )}

        {/* Järjekorra-rida — ilmub kui salvestamata muudatusi */}
        {props.hasReorderChanges && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
              <ArrowUpDown size={15} />
              {t('manage.reorder.changedSummary', { count: props.changedCount })}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={props.onDiscardReorder}
                className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50">
                {t('manage.reorder.discard')}
              </button>
              <button onClick={props.onReorderSave} disabled={props.reorderSaving}
                className="flex items-center gap-1.5 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded">
                {props.reorderSaving ? <Loader2 size={14} className="animate-spin" /> : <ArrowUpDown size={14} />}
                {t('manage.reorderSave')}
              </button>
            </div>
          </div>
        )}

        {/* Valiku-rida — ilmub kui ≥1 leht valitud */}
        {hasSelection && (
          <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-sm font-medium text-primary-800 shrink-0">
              {t('manage.select.count', { count: props.selectedCount })}
            </span>

            {/* Liiguta */}
            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
              <button onClick={props.onMove} disabled={!props.moveCanApply}
                className="flex items-center gap-1.5 px-3 py-1 text-sm bg-primary-600 hover:bg-primary-700 disabled:opacity-40 text-white rounded">
                <ArrowUpDown size={14} />
                {t('manage.move.button')}
              </button>
              <input
                type="text" inputMode="numeric" value={props.moveTarget}
                onChange={(e) => props.setMoveTarget(e.target.value)}
                placeholder={t('manage.move.placeholder')}
                className="w-14 text-sm text-center border border-gray-300 rounded px-1 py-0.5"
              />
              <label className="text-sm text-gray-600">{t('manage.move.label')}</label>
            </div>

            {/* Re-OCR — sekundaarne (outline), vähem prominentne kui Liiguta */}
            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
              <button onClick={props.onReocrClick} disabled={props.actionsDisabled}
                title={props.actionsDisabled ? props.actionsDisabledTitle : ''}
                className="flex items-center gap-1.5 px-2.5 py-1 text-sm border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40 rounded">
                <RefreshCw size={13} />
                {t('manage.reocr.button', { count: props.selectedCount })}
              </button>
              <select value={props.ocrModel} onChange={(e) => props.setOcrModel(e.target.value as 'print' | 'hand')}
                title={t('manage.reocr.model.label')}
                className="text-xs text-gray-600 border border-gray-300 rounded px-1 py-1">
                <option value="print">{t('manage.reocr.model.print')}</option>
                <option value="hand">{t('manage.reocr.model.hand')}</option>
              </select>
            </div>

            {/* Kustuta + Tühista (paremal) */}
            <div className="ml-auto flex items-center gap-2 border-l border-gray-200 pl-3">
              <button onClick={props.onDeleteClick} disabled={props.actionsDisabled}
                title={props.actionsDisabled ? props.actionsDisabledTitle : ''}
                className="flex items-center gap-1.5 px-3 py-1 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50 disabled:opacity-40">
                <Trash2 size={14} />
                {t('manage.bulkDelete.button')}
              </button>
              <button onClick={props.onClearSelection}
                className="flex items-center gap-1 px-2 py-1 text-sm text-gray-500 hover:text-gray-700 rounded hover:bg-gray-100">
                <X size={15} />
                {t('manage.select.clear')}
              </button>
            </div>

            {/* Liiguta vea-vihje (täislaiuses, ainult kui kehtetu) */}
            {props.moveHintText && (
              <span className="w-full text-sm text-amber-700">{props.moveHintText}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PageActionBar;
