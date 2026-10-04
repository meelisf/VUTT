import type { MouseEvent } from 'react';
import { ChevronRight, Settings2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import SafeHtml from '../SafeHtml';
import CharSetEditor from './CharSetEditor';
import type { SpecialCharacter } from './useSpecialChars';
import type { CombiningMark } from '../../utils/combiningMarks';

// Kombineerivate märkide rühm paneeli ees, kasutaja märgikomplektist sõltumatu.
// Märk läheb kursori ees olevale tähele (makron ADR 0062; makronil ka Alt-M).
const COMBINING_MARK_BUTTONS: CombiningMark[] = ['macron', 'circumflex', 'lenis', 'asper'];
// Nupu kujutis: märk punktiirringi (U+25CC) peal — keeleülene, ei vaja tõlget.
const MARK_GLYPHS: Record<CombiningMark, string> = {
  macron: '\u25cc\u0304',
  circumflex: '\u25cc\u0302',
  lenis: '\u25cc\u0313',
  asper: '\u25cc\u0314',
};

interface SpecialCharsPanelProps {
  authToken: string | null;
  user: unknown;
  readOnly: boolean;
  specialCharacters: SpecialCharacter[];
  isCustomChars: boolean;
  showCharPanel: boolean;
  showCharEditor: boolean;
  showTranscriptionGuide: boolean;
  transcriptionGuideHtml: string;
  setShowCharPanel: (show: boolean) => void;
  setShowCharEditor: (show: boolean) => void;
  setShowTranscriptionGuide: (show: boolean) => void;
  setSpecialCharacters: (chars: SpecialCharacter[]) => void;
  setIsCustomChars: (custom: boolean) => void;
  insertSpecialChar: (char: string, event: MouseEvent<HTMLButtonElement>) => void;
  insertCombiningMark: (kind: CombiningMark, event: MouseEvent<HTMLButtonElement>) => void;
}

// Erimärkide paneel koos kasutaja märgikomplekti redaktori ja transkriptsioonijuhendi modaali avamisega.
export default function SpecialCharsPanel({
  authToken,
  user,
  readOnly,
  specialCharacters,
  isCustomChars,
  showCharPanel,
  showCharEditor,
  showTranscriptionGuide,
  transcriptionGuideHtml,
  setShowCharPanel,
  setShowCharEditor,
  setShowTranscriptionGuide,
  setSpecialCharacters,
  setIsCustomChars,
  insertSpecialChar,
  insertCombiningMark,
}: SpecialCharsPanelProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const toggleCharPanel = () => setShowCharPanel(!showCharPanel);
  // Staatilised võtmed, et translationKeysResolve valvur neid kontrolliks.
  const markHints: Record<CombiningMark, string> = {
    macron: t('editor.combiningMarks.macronHint'),
    circumflex: t('editor.combiningMarks.circumflexHint'),
    lenis: t('editor.combiningMarks.lenisHint'),
    asper: t('editor.combiningMarks.asperHint'),
  };

  return (
    <>
      {!readOnly && (
        <div className="border-t border-gray-200 bg-white shrink-0">
          <details className="group" open={showCharPanel}>
            <summary
              className="flex items-center gap-2 px-4 py-1.5 cursor-pointer hover:bg-gray-50 text-[11px] font-medium text-gray-500 select-none outline-none transition-colors border-b border-transparent group-open:border-gray-50"
              onClick={(e) => { e.preventDefault(); toggleCharPanel(); }}
            >
              <div className={`transition-transform duration-200 text-gray-400 ${showCharPanel ? 'rotate-90' : ''}`}>
                <ChevronRight size={12} />
              </div>
              {t('editor.specialChars')}
              {isCustomChars && (
                <span className="text-[10px] text-primary-500 font-normal">✦</span>
              )}
              {Boolean(user) && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setShowCharEditor(true); }}
                  className="ml-auto text-gray-400 hover:text-gray-600 transition-colors"
                  title={t('editor.editChars', 'Kohanda märgikomplekti')}
                >
                  <Settings2 size={12} />
                </button>
              )}
            </summary>

            <div className="px-3 py-1.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1">
                {COMBINING_MARK_BUTTONS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={(e) => insertCombiningMark(kind, e)}
                    disabled={readOnly}
                    title={markHints[kind]}
                    aria-label={markHints[kind]}
                    className="w-[22px] h-[22px] flex items-center justify-center text-sm font-serif bg-primary-50 border border-primary-200 text-primary-800 rounded hover:bg-primary-100 hover:border-primary-300 transition-colors shadow-sm"
                  >
                    {MARK_GLYPHS[kind]}
                  </button>
                ))}
                <span className="w-px h-[22px] bg-gray-200 mx-0.5" aria-hidden="true" />
                {specialCharacters.map((char, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={(e) => insertSpecialChar(char.character, e)}
                    disabled={readOnly}
                    title={char.name || char.character}
                    className="w-[22px] h-[22px] flex items-center justify-center text-xs font-serif bg-white border border-gray-200 rounded hover:bg-primary-50 hover:border-primary-300 transition-colors shadow-sm"
                  >
                    {char.character}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setShowTranscriptionGuide(true)}
                className="text-[11px] text-primary-600 hover:text-primary-800 hover:underline py-1 transition-colors"
              >
                {t('editor.openGuide')}
              </button>
            </div>
          </details>
        </div>
      )}

      {showCharEditor && authToken && (
        <CharSetEditor
          characters={specialCharacters}
          isCustom={isCustomChars}
          authToken={authToken}
          onClose={() => setShowCharEditor(false)}
          onSaved={(chars, custom) => {
            setSpecialCharacters(chars);
            setIsCustomChars(custom);
          }}
        />
      )}

      {showTranscriptionGuide && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowTranscriptionGuide(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">{t('editor.guideTitle')}</h2>
              <button onClick={() => setShowTranscriptionGuide(false)} className="text-gray-500 hover:text-gray-700">
                <X size={20} />
              </button>
            </div>
            <SafeHtml
              kind="trusted"
              html={transcriptionGuideHtml || `<p>${t('common:labels.loading')}...</p>`}
              className="p-6 overflow-y-auto max-h-[calc(80vh-60px)]"
            />
          </div>
        </div>
      )}
    </>
  );
}
