import React from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Crop, RotateCw, X } from 'lucide-react';
import type { PageAdjust } from '../../pages/upload/types';

interface Props {
  rotate: number;
  adjust: PageAdjust | null;
  /** Poolitusjoone asukoht protsentides; `null` = lehte ei poolitata. */
  splitPercent: number | null;
  onRotateClear: () => void;
  onAdjustClear: () => void;
  onSplitClear: () => void;
  /** Test-id'd: `{prefix}-edit-pending`, `-rotate-remove`, `-crop-remove`, `-split-state`, `-split-remove`. */
  testIdPrefix: string;
}

/** Ootel pööre/kärbe/kalle/perspektiiv sõnastus; ÜKS tõde kahele redaktorile. */
export function adjustLabel(adjust: PageAdjust, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (adjust.quad) return t('pagePrep.perspectivePending');
  if (adjust.crop) {
    return Math.abs(adjust.angle) >= 0.05
      ? t('pagePrep.cropTiltPending', { deg: adjust.angle.toFixed(1) })
      : t('pagePrep.cropPending');
  }
  return t('pagePrep.tiltPending', { deg: adjust.angle.toFixed(1) });
}

const Chip: React.FC<{
  icon: React.ReactNode; label: string; removeLabel: string; onRemove: () => void;
  testId?: string; removeTestId: string;
}> = ({ icon, label, removeLabel, onRemove, testId, removeTestId }) => (
  <span data-testid={testId}
    className="flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded border border-amber-300 bg-amber-50 py-0.5 pl-1.5 pr-0.5 text-xs font-medium text-amber-900">
    {icon}{label}
    <button type="button" data-testid={removeTestId} onClick={onRemove}
      title={removeLabel} aria-label={removeLabel}
      className="rounded p-0.5 hover:bg-amber-200">
      <X size={12} />
    </button>
  </span>
);

/**
 * Päises: mis on SELLE lehega ootel — eraldi kiip pöördele, kärpele ja poolitusele,
 * igaühel oma ✕ (tühistab ainult selle). Ikoonid on samad mis pisipiltide ribal.
 * ÜHINE halduse ja upload'i redaktorile. Kogu teose „Rakenda kõik" EI ole siin —
 * see on eraldi nupp (kehtib kõigile lehtedele, mitte sellele lehele).
 */
const PendingGroup: React.FC<Props> = ({
  rotate, adjust, splitPercent, onRotateClear, onAdjustClear, onSplitClear, testIdPrefix,
}) => {
  const { t } = useTranslation('common');
  if (!adjust && rotate === 0 && splitPercent == null) return null;
  return (
    <div data-testid={`${testIdPrefix}-edit-pending`} className="flex min-w-0 flex-nowrap items-center gap-1.5">
      <span className="flex-shrink-0 whitespace-nowrap text-xs text-gray-500">{t('pagePrep.thisPage')}</span>
      {rotate !== 0 && (
        <Chip icon={<RotateCw size={12} />} label={t('pagePrep.rotatePending', { deg: rotate })}
          removeLabel={t('pagePrep.rotateRemove')} onRemove={onRotateClear}
          removeTestId={`${testIdPrefix}-rotate-remove`} />
      )}
      {adjust && (
        <Chip icon={<Crop size={12} />} label={adjustLabel(adjust, t as never)}
          removeLabel={t('pagePrep.cropRemove')} onRemove={onAdjustClear}
          removeTestId={`${testIdPrefix}-crop-remove`} />
      )}
      {splitPercent != null && (
        <Chip icon={<Columns2 size={12} />} label={t('pagePrep.splitAt', { percent: splitPercent })}
          removeLabel={t('pagePrep.splitRemove')} onRemove={onSplitClear}
          testId={`${testIdPrefix}-split-state`} removeTestId={`${testIdPrefix}-split-remove`} />
      )}
    </div>
  );
};

export default PendingGroup;
