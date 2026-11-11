import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, X } from 'lucide-react';
import type { PageAdjust } from '../../pages/upload/types';

interface Props {
  rotate: number;
  adjust: PageAdjust | null;
  /** Poolitusjoone asukoht protsentides; `null` = lehte ei poolitata. */
  splitPercent: number | null;
  onAdjustClear: () => void;
  /** Test-id'd: `{prefix}-pending-group`, `-edit-pending`, `-crop-remove`, `-split-state`. */
  testIdPrefix: string;
  /** Rühma lõppu (nt „Rakenda kõik") — värvitud nupp kollase kapsli sees. */
  children?: React.ReactNode;
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

/**
 * Päise kollane kapsel: mis on SELLE lehega ootel (pööre, kärbe, poolitus) +
 * valikuline lõpunupp (`children`). ÜHINE halduse ja upload'i redaktorile.
 */
const PendingGroup: React.FC<Props> = ({ rotate, adjust, splitPercent, onAdjustClear, testIdPrefix, children }) => {
  const { t } = useTranslation('common');
  const pagePending = Boolean(adjust) || rotate !== 0 || splitPercent != null;
  if (!pagePending && !children) return null;
  return (
    <div data-testid={`${testIdPrefix}-pending-group`}
      className="flex min-w-0 items-stretch overflow-hidden rounded-full border border-amber-300 bg-amber-50 text-xs font-medium text-amber-900">
      {pagePending && (
        <span data-testid={`${testIdPrefix}-edit-pending`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
          <Clock size={12} className="flex-shrink-0" />
          {rotate !== 0 && <span>{t('pagePrep.rotatePending', { deg: rotate })}</span>}
          {adjust && (
            <span className="flex items-center gap-1">
              {adjustLabel(adjust, t as never)}
              <button type="button" data-testid={`${testIdPrefix}-crop-remove`} onClick={onAdjustClear}
                title={t('pagePrep.cropRemove')} aria-label={t('pagePrep.cropRemove')}
                className="rounded-full p-0.5 hover:bg-amber-200">
                <X size={12} />
              </button>
            </span>
          )}
          {splitPercent != null && (
            <span data-testid={`${testIdPrefix}-split-state`}>{t('pagePrep.splitAt', { percent: splitPercent })}</span>
          )}
        </span>
      )}
      {children}
    </div>
  );
};

export default PendingGroup;
