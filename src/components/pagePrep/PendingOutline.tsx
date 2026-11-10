import React from 'react';
import type { PageAdjust } from '../../pages/upload/types';
import { pendingAdjustOutline } from '../../utils/pendingAdjustOutline';

interface Props {
  adjust: PageAdjust | null | undefined;
  /** Kuvatava lehe raami mõõdud pikslites (pööratud leht, mille peale kontuur joonistatakse). */
  width: number;
  height: number;
  testId?: string;
}

/**
 * Oranž kontuur: MIDA ootel kärbe/perspektiiv lõikab. Paigutatakse `absolute
 * inset-0` lehe kasti peale. ÜHINE teose halduse pildiredaktorile ja upload'i
 * ülevaatusele — vt `EditToolbar` märkust. Näita ainult siis, kui kasutaja ei
 * ole uut kasti joonistanud (muidu on kaks kontuuri korraga).
 */
const PendingOutline: React.FC<Props> = ({ adjust, width, height, testId = 'editor-pending-outline' }) => {
  const outline = pendingAdjustOutline(adjust, width, height);
  if (!outline) return null;
  return (
    <svg data-testid={testId} aria-hidden="true"
      className="pointer-events-none absolute inset-0" width={width} height={height}>
      <polygon points={outline.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="rgba(245,158,11,0.12)" stroke="#d97706" strokeWidth={2} strokeDasharray="6 4" />
    </svg>
  );
};

export default PendingOutline;
