import React from 'react';
import { useTranslation } from 'react-i18next';
import { Crop, Frame, CircleX } from 'lucide-react';
import RotateButtons from './RotateButtons';
import type { CropBoxState } from './useCropBox';

interface Props {
  crop: CropBoxState;
  /** Pöörde muut kraadides, päripäeva: -90 | 90 | 180. */
  onRotate: (delta: number) => void;
  /** Test-id'd: `{prefix}-toolbar`, `{prefix}-tool-crop|perspective`, `{prefix}-rotate-*`. */
  testIdPrefix: string;
}

const toolBtn = 'flex w-full justify-center rounded border border-gray-300 bg-white p-2 hover:bg-gray-100';

/**
 * Vasak tööriistaveerg: pööre, kärbe/perspektiiv, lähtestused, kalde näit.
 *
 * ÜHINE teose halduse pildiredaktorile (`PageImageEditorModal`) ja upload'i
 * ülevaatusele (`SplitPageDetail`) — kasutaja peab nägema sama riba. Muudatus
 * siin mõjutab MÕLEMAT; kontrolli mõlemat vaadet (#431, vt CLAUDE.md
 * „Kaks pildiredaktorit").
 */
const EditToolbar: React.FC<Props> = ({ crop, onRotate, testIdPrefix }) => {
  const { t } = useTranslation('common');
  const tools = [
    { id: 'crop', active: !crop.perspective, label: t('pagePrep.cropTool'), icon: <Crop size={16} /> },
    { id: 'perspective', active: crop.perspective, label: t('pagePrep.perspective'), icon: <Frame size={16} /> },
  ];
  return (
    <div data-testid={`${testIdPrefix}-toolbar`} role="toolbar" aria-orientation="vertical"
      className="flex w-14 flex-shrink-0 flex-col items-center gap-1.5 self-start rounded-lg border border-gray-200 bg-white p-1.5 shadow-sm">
      <RotateButtons onRotate={onRotate} buttonClassName={toolBtn} iconSize={16}
        testIdPrefix={`${testIdPrefix}-rotate`} />
      <div className="my-0.5 h-px w-full bg-gray-200" />
      {/* Kaks erinevat tööriista, üks on alati aktiivne: kärbe (vaikimisi) või perspektiiv. */}
      {tools.map((tool) => (
        <button
          key={tool.id}
          type="button"
          data-testid={`${testIdPrefix}-tool-${tool.id}`}
          onClick={() => { if (!tool.active) crop.togglePerspective(); }}
          aria-pressed={tool.active}
          aria-label={tool.label}
          title={tool.label}
          className={`flex w-full justify-center rounded border p-2 ${tool.active ? 'border-indigo-600 bg-indigo-50 text-indigo-700' : 'border-gray-300 bg-white hover:bg-gray-100'}`}
        >
          {tool.icon}
        </button>
      ))}
      {crop.perspective && crop.quad && (
        <button type="button" onClick={crop.resetQuad} title={t('pagePrep.perspectiveReset')}
          className={`${toolBtn} text-gray-500 hover:text-gray-700`}>
          <CircleX size={16} />
        </button>
      )}
      {crop.cropRect && !crop.perspective && (
        <button type="button" onClick={crop.clearCrop} title={t('pagePrep.cropReset')}
          className={`${toolBtn} text-gray-500 hover:text-gray-700`}>
          <CircleX size={16} />
        </button>
      )}
      {crop.cropRect && !crop.perspective && Math.abs(crop.boxAngle) > 0.05 && (
        <span title={t('pagePrep.deskew')} className="text-[11px] tabular-nums text-gray-600">
          {crop.boxAngle.toFixed(1)}°
        </span>
      )}
    </div>
  );
};

export default EditToolbar;
