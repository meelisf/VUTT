import { useTranslation } from 'react-i18next';
import { Columns2, RemoveFormatting, SeparatorHorizontal, SquarePen, StickyNote, Superscript } from 'lucide-react';
import type { MarginaliaMode } from './MarginaliaExtension';

interface EditorToolbarProps {
  readOnly: boolean;
  compactToolbar: boolean;
  narrowPane: boolean;
  marginaliaCount: number;
  marginaliaUserMode: MarginaliaMode;
  wrapWithTag: (tag: 'b' | 'i' | 'cs') => void;
  insertMarginalia: () => void;
  insertAtCursor: (text: string) => void;
  cleanMarkup: () => void;
  onAnnotateSelection: () => void;
  toggleMarginaliaMode: () => void;
}

// Transkriptsiooniredaktori vormindamise tööriistariba.
export default function EditorToolbar({
  readOnly,
  compactToolbar,
  narrowPane,
  marginaliaCount,
  marginaliaUserMode,
  wrapWithTag,
  insertMarginalia,
  insertAtCursor,
  cleanMarkup,
  onAnnotateSelection,
  toggleMarginaliaMode,
}: EditorToolbarProps) {
  const { t } = useTranslation(['workspace']);

  if (readOnly) return <div className="flex items-center gap-4 overflow-x-auto no-scrollbar" />;

  return (
    <div className="flex items-center gap-4 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => wrapWithTag('b')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-bold border border-transparent hover:border-gray-200 text-gray-700 font-serif" title={`${t('editor.tooltips.bold')} (Ctrl+B)`}>B</button>
        <button type="button" onClick={() => wrapWithTag('i')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 italic font-serif border border-transparent hover:border-gray-200 text-gray-700" title={`${t('editor.tooltips.italic')} (Ctrl+I)`}>I</button>
        <button type="button" onClick={() => wrapWithTag('cs')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 font-serif border border-transparent hover:border-gray-200 text-gray-700" title={`${t('editor.tooltips.fractur')} (Ctrl+K)`}>𝔉</button>
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        <button type="button" onClick={insertMarginalia} className={`h-7 flex items-center justify-center gap-1 rounded hover:bg-gray-100 text-[11px] text-gray-600 border border-transparent hover:border-gray-200 ${compactToolbar ? 'w-7' : 'px-2'}`} title={t('editor.tooltips.marginalia')}><StickyNote size={14} />{!compactToolbar && <span>Marginalia</span>}</button>
        <button type="button" onClick={() => insertAtCursor('<fn>1</fn>')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-600" title={t('editor.tooltips.footnote')}><Superscript size={14} /></button>
        <button type="button" onClick={() => insertAtCursor('<pb/>\n')} className="w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 border border-transparent hover:border-gray-200 text-gray-400" title={t('editor.tooltips.pageBreak')}><SeparatorHorizontal size={14} /></button>
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        <button type="button" onClick={cleanMarkup} className={`h-7 flex items-center justify-center gap-1 rounded hover:bg-red-50 text-[11px] text-red-600 border border-transparent hover:border-red-100 ${compactToolbar ? 'w-7' : 'px-2'}`} title={t('editor.tooltips.cleanMarkup')}><RemoveFormatting size={14} />{!compactToolbar && <span>{t('editor.tooltips.cleanMarkupButton')}</span>}</button>
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        <button
          type="button"
          onClick={onAnnotateSelection}
          className={`h-7 flex items-center justify-center gap-1 rounded hover:bg-yellow-100 text-[11px] text-yellow-700 border border-transparent hover:border-yellow-200 ${compactToolbar ? 'w-7' : 'px-2'}`}
          title={t('editor.tooltips.annotate', 'Märgi ja kommenteeri (vali tekst enne)')}
        >
          <SquarePen size={14} />{!compactToolbar && <span>Ann</span>}
        </button>
        {marginaliaCount > 0 && !narrowPane && (
          <button
            type="button"
            onClick={toggleMarginaliaMode}
            className={`h-7 flex items-center justify-center gap-1 rounded text-[11px] border ${compactToolbar ? 'w-7' : 'px-2'} ${marginaliaUserMode === 'column' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'text-gray-600 border-transparent hover:border-gray-200 hover:bg-gray-100'}`}
            title={marginaliaUserMode === 'column' ? t('editor.marginalia.collapse') : t('editor.marginalia.expand')}
          >
            <Columns2 size={14} />{!compactToolbar && <span>{t('editor.marginalia.toggle')}</span>}
          </button>
        )}
      </div>
    </div>
  );
}
