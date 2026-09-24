import React from 'react';
import { useTranslation } from 'react-i18next';
import { FlipVertical2, RotateCcw, RotateCw } from 'lucide-react';

interface Props {
  /** Pöörde muut kraadides, päripäeva: -90 | 90 | 180. */
  onRotate: (delta: number) => void;
  buttonClassName: string;
  iconSize: number;
  /** Kui antud, saavad nupud `{prefix}-left|right|180` test-id-d. */
  testIdPrefix?: string;
}

/**
 * Kolm pööramisnuppu (vasakule, paremale, 180°). Samad ikoonid ja sildid
 * upload'i ülevaatuses ja teose halduses (#431) — tuttav žest. Ümbris
 * (rida/tulp) jääb kutsujale.
 */
const RotateButtons: React.FC<Props> = ({ onRotate, buttonClassName, iconSize, testIdPrefix }) => {
  const { t } = useTranslation('common');
  const tid = (s: string) => (testIdPrefix ? `${testIdPrefix}-${s}` : undefined);
  return (
    <>
      <button type="button" data-testid={tid('left')} onClick={() => onRotate(-90)}
        title={t('pagePrep.rotateLeft')} className={buttonClassName}>
        <RotateCcw size={iconSize} />
      </button>
      <button type="button" data-testid={tid('right')} onClick={() => onRotate(90)}
        title={t('pagePrep.rotateRight')} className={buttonClassName}>
        <RotateCw size={iconSize} />
      </button>
      <button type="button" data-testid={tid('180')} onClick={() => onRotate(180)}
        title={t('pagePrep.rotate180')} className={buttonClassName}>
        <FlipVertical2 size={iconSize} />
      </button>
    </>
  );
};

export default RotateButtons;
