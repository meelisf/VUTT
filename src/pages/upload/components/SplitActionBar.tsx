import React from 'react';
import { useTranslation } from 'react-i18next';
import { Columns2, Eye, EyeOff, X } from 'lucide-react';
import FloatingActionBar from '../../../components/pagePrep/FloatingActionBar';
import RotateButtons from '../../../components/pagePrep/RotateButtons';

interface SplitActionBarProps {
  selectedCount: number;
  onSplit: () => void;
  onNoSplit: () => void;
  onExclude: () => void;
  onInclude: () => void;
  onRotate: (delta: number) => void;
  onClearSelection: () => void;
  resultText: string | null;
}

/**
 * Hõljuv hulgitegevuste riba upload'i ülevaatuses.
 *
 * Karkass (`FloatingActionBar`) on sama mis `manage/PageActionBar`-il — kaks
 * ekraani peavad välja nägema nagu üks süsteem.
 *
 * Käsud on mõlemasuunalised (§6): ühesuunaline „Ära OCR-i" oleks lõks —
 * kogemata valitud 80 lehte saaks korraga välja jätta, aga tagasi ainult
 * ükshaaval. Kaardil on sama asi toggle, siin idempotentsed käsud.
 */
const SplitActionBar: React.FC<SplitActionBarProps> = (props) => {
  const { t } = useTranslation(['upload']);
  if (props.selectedCount === 0) return null;

  const btn = 'flex items-center gap-1.5 px-2.5 py-1 text-sm border border-gray-300 text-gray-700 hover:bg-gray-50 rounded';

  return (
    <FloatingActionBar className="overflow-hidden">
        {props.resultText && (
          <div className="px-4 py-2 border-b border-gray-100 text-sm text-gray-600">
            {props.resultText}
          </div>
        )}
        <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="text-sm font-medium text-primary-800 shrink-0">
            {t('step3split.bar.count', { count: props.selectedCount })}
          </span>

          {/* Poolitusrühm */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
            <button type="button" onClick={props.onSplit} className={btn}>
              <Columns2 size={14} />{t('step3split.bar.split')}
            </button>
            <button type="button" onClick={props.onNoSplit} className={btn}>
              {t('step3split.bar.noSplit')}
            </button>
          </div>

          {/* OCR-rühm — mõlemasuunaline (§6) */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
            <button type="button" onClick={props.onExclude} className={btn}>
              <EyeOff size={14} />{t('step3split.bar.exclude')}
            </button>
            <button type="button" onClick={props.onInclude} className={btn}>
              <Eye size={14} />{t('step3split.bar.include')}
            </button>
          </div>

          {/* Pöörderühm — samad nupud nagu PageImageEditorModal-is (#431).
              Pööre on KOGUV: kaks klõpsu paremale = 180°. Kaardil eraldi ikooni
              EI OLE (§ nurgad on juba täis) — pööratud leht paistab ruudustikus
              lihtsalt pööratuna, sest server serveerib pisipildi juba pööratuna. */}
          <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
            <RotateButtons onRotate={props.onRotate} buttonClassName={btn} iconSize={14} />
          </div>

          <button
            type="button"
            onClick={props.onClearSelection}
            className="flex items-center gap-1 px-2 py-1 text-sm font-medium text-red-600 hover:bg-red-50 rounded border-l border-gray-200 pl-3"
          >
            <X size={15} />{t('step3split.bar.clear')}
          </button>

          <span className="w-full text-xs text-gray-500">{t('step3split.bar.shiftHint')}</span>
        </div>
    </FloatingActionBar>
  );
};

export default SplitActionBar;
