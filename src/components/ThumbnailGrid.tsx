import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Work } from '../types';

interface PageThumbnail {
  pageNum: number;
  imageUrl: string;
  hasAnnotations?: boolean;
}

interface ThumbnailGridProps {
  pages: PageThumbnail[];
  currentPage: number;
  loading: boolean;
  onSelectPage: (pageNum: number) => void;
  onClose: () => void;
  work?: Work | null;
  cols: number;
  onColsChange: (cols: number) => void;
}

const ThumbnailGrid: React.FC<ThumbnailGridProps> = ({
  pages,
  currentPage,
  loading,
  onSelectPage,
  onClose,
  work,
  cols,
  onColsChange,
}) => {
  const { t } = useTranslation(['workspace', 'common']);
  const MIN_COLS = 3;
  const MAX_COLS = 10;

  // Teose kontekst päisesse
  const workAuthor = work?.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || null;
  const workYear = work?.year ?? null;
  const workTitle = work?.title || null;
  const currentRef = useRef<HTMLDivElement>(null);

  // Skrolli praegusele lehele kui grid on laetud
  useEffect(() => {
    if (!loading && currentRef.current) {
      currentRef.current.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, [loading]);

  // ESC sulgemiseks
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Slider: parem = suurem thumbnail (vähem veerge)
  // slider max → MIN_COLS, slider min → MAX_COLS
  const sliderValue = MAX_COLS + MIN_COLS - cols;
  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    onColsChange(MAX_COLS + MIN_COLS - Number(e.target.value));
  };

  return (
    <div className="absolute inset-0 z-30 bg-slate-900 flex flex-col">
      {/* Tööriistariba */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 flex-shrink-0 min-w-0">

        {/* Vasakul: teose kontekst */}
        <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
          {workAuthor && (
            <span className="text-white/60 text-xs font-medium truncate shrink-0 max-w-[160px]">
              {workAuthor}
            </span>
          )}
          {workAuthor && (workYear || workTitle) && (
            <span className="text-white/20 text-xs shrink-0">•</span>
          )}
          {workYear && (
            <span className="text-white/40 text-xs tabular-nums shrink-0">{workYear}</span>
          )}
          {workYear && workTitle && (
            <span className="text-white/20 text-xs shrink-0">•</span>
          )}
          {workTitle && (
            <span className="text-white/30 text-xs italic truncate">{workTitle}</span>
          )}
        </div>

        {/* Keskel: suumi slider */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onColsChange(Math.min(cols + 1, MAX_COLS))}
            disabled={cols >= MAX_COLS}
            className="p-1 text-white/40 hover:text-white/80 hover:bg-white/10 rounded transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title={t('thumbnails.smaller')}
          >
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={MIN_COLS}
            max={MAX_COLS}
            step={1}
            value={sliderValue}
            onChange={handleSlider}
            className="w-24 accent-white/50 cursor-pointer"
            title={t('thumbnails.size')}
          />
          <button
            onClick={() => onColsChange(Math.max(cols - 1, MIN_COLS))}
            disabled={cols <= MIN_COLS}
            className="p-1 text-white/40 hover:text-white/80 hover:bg-white/10 rounded transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
            title={t('thumbnails.larger')}
          >
            <ZoomIn size={14} />
          </button>
        </div>

        {/* Paremal: lehtede arv + sulge */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-white/30 text-xs tabular-nums">
            {loading ? '…' : `${pages.length} ${t('common:labels.pages')}`}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 text-white/60 hover:text-white hover:bg-white/15 rounded transition-colors"
            title={t('thumbnails.closeEsc')}
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Sisu — eraldi scroll wrapper (kriitilised: min-h-0 + overflow-y-auto) */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="text-white/30 animate-spin" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {/* Grid on eraldi, ei ole scroll wrapper — lahendab aspect ratio probleemi */}
          <div
            className="p-3"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gap: '8px',
              alignItems: 'start',  // Kriitilline: ei siruta üksuseid rea kõrguseni
            }}
          >
            {pages.map(page => {
              const isCurrent = page.pageNum === currentPage;
              return (
                <div
                  key={page.pageNum}
                  ref={isCurrent ? currentRef : undefined}
                  onClick={() => onSelectPage(page.pageNum)}
                  className={`cursor-pointer rounded overflow-hidden relative aspect-[3/4] bg-slate-700 ${
                    isCurrent
                      ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900'
                      : 'hover:ring-2 hover:ring-white/40 hover:ring-offset-1 hover:ring-offset-slate-900'
                  }`}
                >
                  {page.imageUrl && (
                    <img
                      src={page.imageUrl}
                      alt={`Lk ${page.pageNum}`}
                      loading="lazy"
                      className="absolute inset-0 w-full h-full object-contain"
                    />
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white/70 text-xs text-center py-0.5 leading-tight flex items-center justify-center gap-1">
                    {page.hasAnnotations && (
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                    )}
                    {page.pageNum}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThumbnailGrid;
