import React from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, Check, Loader2, FileCheck2, AlertCircle } from 'lucide-react';
import PageThumb from './PageThumb';
import { IMAGE_BASE_URL } from '../../config';
import { ReocrState } from '../../utils/reocrStatus';

interface PageCardProps {
  workId: string;
  filename: string;
  imageName: string;
  visiblePageNum: number;
  status: string;
  hasText: boolean;
  reocrState?: ReocrState;
  isSelected: boolean;
  isChanged: boolean;
  thumbCacheBust: number;
  onToggle: (filename: string, shiftKey: boolean) => void;
  onEdit: (visiblePageNum: number) => void;
  isFocused?: boolean;
}

const statusColor = (status: string) => {
  switch (status) {
    case 'Valmis': return 'bg-green-100 text-green-700';
    case 'Kontrollitud': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const PageCard = React.forwardRef<HTMLDivElement, PageCardProps>((p, ref) => {
  const { t } = useTranslation(['workspace', 'common']);
  return (
    <div
      ref={ref}
      className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
        p.isFocused ? 'ring-2 ring-blue-500 motion-safe:animate-pulse'
          : p.isSelected ? 'border-primary-500 ring-2 ring-primary-400'
          : p.isChanged ? 'border-amber-400 ring-1 ring-amber-300' : 'border-gray-200'
      }`}
    >
      {/* Kogu pisipildi-ala on valiku-sihtmärk: klõps valib, Shift+klõps vahemiku.
          select-none väldib Shift+klõpsu teksti-esiletõstu üle ruudustiku. */}
      <div
        className="relative aspect-[3/4] bg-gray-100 overflow-hidden cursor-pointer select-none"
        onClick={(e) => p.onToggle(p.filename, e.shiftKey)}
        title={t('manage.select.toggleHint')}
      >
        {/* Valiku-märkeruut — vasakus ülanurgas (eraldi klõpsatav, klaviatuuri jaoks) */}
        <button
          onClick={(e) => { e.stopPropagation(); p.onToggle(p.filename, e.shiftKey); }}
          className={`absolute top-1 left-1 z-10 w-5 h-5 flex items-center justify-center rounded border shadow-sm ${
            p.isSelected ? 'bg-primary-600 border-primary-600 text-white' : 'bg-white/90 border-gray-600 text-transparent'
          }`}
          title={t('manage.select.toggleHint')}
          aria-pressed={p.isSelected}
        >
          <Check size={13} />
        </button>
        {/* Tekstita märk — üleval paremal (eraldi reocr-märgist) */}
        {!p.hasText && !p.reocrState && (
          <span
            className="absolute top-1 right-1 z-10 px-1 py-0.5 rounded text-[10px] leading-none bg-amber-100 text-amber-700 border border-amber-300 shadow-sm"
            title={t('manage.reocr.badge.noText')}
          >
            {t('manage.reocr.badge.noText')}
          </span>
        )}
        {/* Re-OCR olek — üleval paremal, märgib sõltumatult has_text-st.
            "ocr_ready" tähendab "OCR valmis ülevaatamiseks", MITTE "leht korras". */}
        {p.reocrState === 'processing' && (
          <span className="absolute top-1 right-1 z-10 p-1 rounded bg-white/90 border border-gray-300 shadow-sm"
            title={t('manage.reocr.badge.processing')}>
            <Loader2 size={12} className="animate-spin text-gray-600" />
          </span>
        )}
        {p.reocrState === 'ocr_ready' && (
          <span className="absolute top-1 right-1 z-10 flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] leading-none bg-green-100 text-green-700 border border-green-300 shadow-sm"
            title={t('manage.reocr.badge.ready')}>
            <FileCheck2 size={11} /> {t('manage.reocr.badge.ready')}
          </span>
        )}
        {p.reocrState === 'error' && (
          <span className="absolute top-1 right-1 z-10 p-1 rounded bg-red-100 border border-red-300 shadow-sm"
            title={t('manage.reocr.badge.error')}>
            <AlertCircle size={12} className="text-red-600" />
          </span>
        )}
        <PageThumb
          workId={p.workId}
          src={`${IMAGE_BASE_URL}/${p.workId}/_thumbs/_thumb_${p.imageName}?v=${p.thumbCacheBust}`}
          className="w-full h-full object-cover"
        />
        {/* Nähtav number — all vasakul */}
        <span className={`absolute bottom-1 left-1 text-xs px-1 py-0.5 rounded leading-tight shadow-sm ${statusColor(p.status)}`}>
          {p.visiblePageNum}
        </span>
        {/* Redaktor — all paremal */}
        <button
          onClick={(e) => { e.stopPropagation(); p.onEdit(p.visiblePageNum); }}
          className="absolute bottom-1 right-1 p-1 bg-white/90 border border-gray-600 hover:bg-gray-100 text-gray-600 hover:text-gray-800 rounded shadow-sm transition-colors"
          title={t('manage.editor.title')}
        >
          <Scissors size={14} />
        </button>
      </div>
    </div>
  );
});

PageCard.displayName = 'PageCard';

export default React.memo(PageCard);
