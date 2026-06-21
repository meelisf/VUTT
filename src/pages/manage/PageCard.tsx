import React from 'react';
import { useTranslation } from 'react-i18next';
import { Scissors, ChevronUp, ChevronDown, Check } from 'lucide-react';
import PageThumb from './PageThumb';
import { IMAGE_BASE_URL } from '../../config';

interface PageCardProps {
  workId: string;
  filename: string;
  imageName: string;
  visiblePageNum: number;
  status: string;
  isSelected: boolean;
  isChanged: boolean;
  thumbCacheBust: number;
  onToggle: (filename: string, shiftKey: boolean) => void;
  onNudge: (filename: string, dir: -1 | 1) => void;
  onEdit: (visiblePageNum: number) => void;
  canNudgeUp: boolean;
  canNudgeDown: boolean;
}

const statusColor = (status: string) => {
  switch (status) {
    case 'Valmis': return 'bg-green-100 text-green-700';
    case 'Kontrollitud': return 'bg-blue-100 text-blue-700';
    default: return 'bg-gray-100 text-gray-600';
  }
};

const PageCard: React.FC<PageCardProps> = (p) => {
  const { t } = useTranslation(['workspace', 'common']);
  return (
    <div
      className={`relative flex flex-col rounded-lg border overflow-hidden bg-white ${
        p.isSelected ? 'border-primary-500 ring-2 ring-primary-400'
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
      {/* Üles/alla nooled (üksammuline nügimine nähtaval järjekorral) */}
      <div className="px-1.5 py-1 flex items-center justify-center gap-3">
        <button onClick={() => p.onNudge(p.filename, -1)} disabled={!p.canNudgeUp}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-20"><ChevronUp size={16} /></button>
        <button onClick={() => p.onNudge(p.filename, 1)} disabled={!p.canNudgeDown}
          className="text-gray-400 hover:text-gray-700 disabled:opacity-20"><ChevronDown size={16} /></button>
      </div>
    </div>
  );
};

export default React.memo(PageCard);
