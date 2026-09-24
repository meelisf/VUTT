import React from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Check, Columns2, RefreshCw, Trash2, X, Loader2, Sparkles } from 'lucide-react';
import FloatingActionBar from '../../components/pagePrep/FloatingActionBar';
import RotateButtons from '../../components/pagePrep/RotateButtons';
import ProgressBar from '../../components/ProgressBar';

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
  // Re-OCR (mudel tuletatakse teose tüübist WorkManage-s — eraldi valikut pole)
  actionsDisabled: boolean;           // hasReorderChanges → re-OCR/kustuta blokeeritud
  actionsDisabledTitle: string;
  onReocrClick: () => void;
  // Gemini-pakkuja (superadmin-only) — nupp puudub, kui käivitaja seda ei anna
  onGeminiReocrClick?: () => void;
  geminiEnabled?: boolean;
  batchProvider: 'loss' | 'gemini';
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
  // Ootel pöörded/poolitused (#431) — sama mudel nagu upload'i ülevaatuses
  pageOpsCount: number;
  pageOpsDisabled: boolean;           // järjekorra mustand ootel → pööre/poolitus blokeeritud
  onSplitSelected: () => void;
  onNoSplitSelected: () => void;
  onRotateSelected: (delta: number) => void;
  splitPercent: string;
  setSplitPercent: (v: string) => void;
  pageOpsSaving: boolean;
  /** Taustatöö edenemine; null = tööd ei jälgita. */
  pageOpsProgress: { done: number; total: number } | null;
  pageOpsError: string | null;
  onApplyPageOps: () => void;
  onDiscardPageOps: () => void;
}

const PageActionBar: React.FC<PageActionBarProps> = (props) => {
  const { t } = useTranslation(['workspace', 'common']);
  const hasSelection = props.selectedCount > 0;

  // Riba puudub täielikult kui pole valikut ega järjekorra-muudatusi → pisipildid täies mahus
  if (!hasSelection && !props.hasReorderChanges && props.pageOpsCount === 0 && !props.pageOpsProgress) return null;
  const opBtn = 'flex items-center gap-1.5 px-2.5 py-1 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 rounded';

  return (
    <FloatingActionBar className="overflow-hidden">

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
              {t('manage.reocr.confirm.line1', { count: props.selectedCount })}{' '}
              {props.batchProvider === 'gemini'
                ? t('manage.reocrGemini.confirmSuffix')
                : t('manage.reocr.confirm.line2')}
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

        {/* Ootel pöörete/poolituste rida — sama kuju nagu järjekorra-rida */}
        {(props.pageOpsCount > 0 || props.pageOpsProgress) && (
          <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex flex-wrap items-center gap-x-3 gap-y-2">
            {props.pageOpsCount > 0 && (<>
            <span className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
              <Columns2 size={15} />
              {t('manage.pageOps.summary', { count: props.pageOpsCount })}
            </span>
            <label className="flex items-center gap-1 text-sm text-gray-700">
              {t('manage.pageOps.line')}
              <input
                type="text" inputMode="numeric" value={props.splitPercent}
                onChange={(e) => props.setSplitPercent(e.target.value)}
                data-testid="page-ops-line"
                className="w-14 text-sm text-center border border-gray-300 rounded px-1 py-0.5"
              />
              %
            </label>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={props.onDiscardPageOps} disabled={props.pageOpsSaving}
                className="px-3 py-1 text-sm border border-gray-300 text-gray-600 rounded hover:bg-gray-50 disabled:opacity-50">
                {t('manage.pageOps.discard')}
              </button>
              <button onClick={props.onApplyPageOps} disabled={props.pageOpsSaving}
                data-testid="page-ops-apply"
                className="flex items-center gap-1.5 px-3 py-1 text-sm bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded">
                {props.pageOpsSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {props.pageOpsSaving ? t('manage.pageOps.applying') : t('manage.pageOps.apply')}
              </button>
            </div>
            </>)}
            {/* Pakk võib kesta minuteid — riba näitab, et töö käib (#431). */}
            {props.pageOpsProgress && (
              <div className="w-full" data-testid="page-ops-progress">
                <ProgressBar
                  percent={props.pageOpsProgress.total ? (props.pageOpsProgress.done / props.pageOpsProgress.total) * 100 : 0}
                  label={t('manage.pageOps.applying')}
                  detail={t('manage.pageOps.progress', props.pageOpsProgress)}
                  barClassName="bg-amber-500"
                />
              </div>
            )}
            {props.pageOpsError && (
              <span className="w-full text-sm text-red-700">{props.pageOpsError}</span>
            )}
          </div>
        )}

        {/* Valiku-rida — ilmub kui ≥1 leht valitud. Kaks rida teemade kaupa:
            ülemine muudab lehti/järjekorda (liiguta, poolita, pööra), alumine
            on teksti teema (transkribeeri) keskel ja kustutamine nurgas. */}
        {hasSelection && (
          <div className="px-4 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
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

            {/* Poolitus + pööre ootel plaanina (#431). Samad nupud ja järjekord
                nagu upload'i ülevaatuse SplitActionBar-il. */}
            <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3"
              title={props.pageOpsDisabled ? t('manage.pageOps.blocked') : undefined}>
              <button onClick={props.onSplitSelected} disabled={props.pageOpsDisabled}
                data-testid="page-ops-split" className={opBtn}>
                <Columns2 size={14} />{t('manage.pageOps.split')}
              </button>
              <button onClick={props.onNoSplitSelected} disabled={props.pageOpsDisabled}
                className={opBtn}>
                {t('manage.pageOps.noSplit')}
              </button>
              {props.pageOpsDisabled ? null : (
                <RotateButtons onRotate={props.onRotateSelected} buttonClassName={opBtn} iconSize={14}
                  testIdPrefix="page-ops-rotate" />
              )}
            </div>

            {/* Tühista valik — punane kiri (nagu Dashboardil), pisut prominentsem */}
            <button onClick={props.onClearSelection}
              className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 rounded border-l border-gray-200 pl-3">
              <X size={15} />
              {t('manage.select.clear')}
            </button>

            {/* Liiguta vea-vihje (täislaiuses, ainult kui kehtetu) */}
            {props.moveHintText && (
              <span className="w-full text-sm text-amber-700">{props.moveHintText}</span>
            )}
          </div>

          {/* Transkribeeri keskel (eraldi teema), kustuta paremas nurgas.
              Kolmeveeruline võre hoiab keskmise tõeliselt keskel ka siis,
              kui paremal on ainult ikoon. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-gray-100 pt-2">
            <span />
            {/* Transkribeeri — sekundaarne (outline), vähem prominentne kui Liiguta.
                Mudel tuletatakse teose tüübist (WorkManage), eraldi valikut pole. */}
            <div className="flex items-center justify-center">
              <button onClick={props.onReocrClick} disabled={props.actionsDisabled}
                title={props.actionsDisabled ? props.actionsDisabledTitle : ''}
                className="flex items-center gap-1.5 px-2.5 py-1 text-sm border border-green-300 text-green-700 hover:bg-green-50 disabled:opacity-40 rounded">
                <RefreshCw size={13} />
                {t('manage.reocr.button', { count: props.selectedCount })}
              </button>
              {props.onGeminiReocrClick && props.geminiEnabled && (
                <button onClick={props.onGeminiReocrClick} disabled={props.actionsDisabled}
                  title={props.actionsDisabled ? props.actionsDisabledTitle : ''}
                  className="ml-2 flex items-center gap-1.5 px-2.5 py-1 text-sm border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40 rounded">
                  <Sparkles size={13} />
                  {t('manage.reocrGemini.button', { count: props.selectedCount })}
                </button>
              )}
            </div>

            {/* Kustuta — destruktiivne, ainult ikoon (kinnitusmodaal tuleb niikuinii) */}
            <button onClick={props.onDeleteClick} disabled={props.actionsDisabled}
              title={props.actionsDisabled ? props.actionsDisabledTitle : t('manage.bulkDelete.button')}
              aria-label={t('manage.bulkDelete.button')}
              className="justify-self-end p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
              <Trash2 size={16} />
            </button>

          </div>
          </div>
        )}
    </FloatingActionBar>
  );
};

export default PageActionBar;
