import React from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Kollane punktiirraam + silt Poolita-vahekaardi KÄRBITUD eelvaate peal.
 *
 * Poolitusjoon on murdosa juba kärbitud pildi laiusest, seega näitab Poolita
 * vahekaart serveri eelvaadet, kus kärbe on sees — see näeb välja nagu rakendatud.
 * Raam ütleb, et see on ootel kärbe (sama kollane kui kontuur „Pööra ja kärbi"
 * vahekaardil). ÜHINE halduse ja upload'i redaktorile. Paigutatakse `absolute inset-0`
 * eelvaate kasti peale.
 */
const CroppedPreviewMark: React.FC<{ className?: string; style?: React.CSSProperties }> = ({
  className = 'absolute inset-0', style,
}) => {
  const { t } = useTranslation('common');
  return (
    <div data-testid="cropped-preview-mark" aria-hidden="true"
      style={style}
      className={`pointer-events-none border-2 border-dashed border-amber-600 ${className}`}>
      <span className="absolute left-1.5 top-1.5 rounded-full bg-amber-50/95 px-2.5 py-0.5 text-[11px] font-medium text-amber-900 shadow-sm">
        {t('pagePrep.croppedPreview')}
      </span>
    </div>
  );
};

export default CroppedPreviewMark;
