import React, { useEffect, useRef } from 'react';
import { X, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import type { Work } from '../types';

interface PageThumbnail {
  pageNum: number;
  imageUrl: string;
}

interface ThumbnailGridProps {
  pages: PageThumbnail[];
  currentPage: number;
  loading: boolean;
  onSelectPage: (pageNum: number) => void;
  onClose: () => void;
  work?: Work | null;
}

const ThumbnailGrid: React.FC<ThumbnailGridProps> = ({
  pages,
  currentPage,
  loading,
  onSelectPage,
  onClose,
  work,
}) => {
  // cols: 1 (suur) kuni 8 (väike)
  const [cols, setCols] = React.useState(3);

  // Teose kontekst päisesse
  const workAuthor = work?.creators?.find(c => c.role === 'praeses' || c.role === 'auctor')?.name || null;
  const workYear = work?.year ?? null;
  const workTitle = work?.title || null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Skrolli praegusele lehele kui grid on laetud
  useEffect(() => {
    if (!loading && currentRef.current && scrollRef.current) {
      const container = scrollRef.current;
      const item = currentRef.current;
      const itemTop = item.offsetTop;
      const itemHeight = item.offsetHeight;
      const containerHeight = container.clientHeight;
      container.scrollTop = itemTop - containerHeight / 2 + itemHeight / 2;
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
  const sliderValue = 9 - cols; // cols 1..8 → slider 8..1
  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCols(9 - Number(e.target.value));
  };

  // auto-fill: konteiner otsustab mitu tulpa mahub antud miinimum-laiuse juures
  const minThumbWidth = Math.round(400 / cols);

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
          <ZoomOut size={14} className="text-white/25" />
          <input
            type="range"
            min={1}
            max={8}
            step={1}
            value={sliderValue}
            onChange={handleSlider}
            className="w-24 accent-white/50 cursor-pointer"
            title="Thumbnailide suurus"
          />
          <ZoomIn size={14} className="text-white/25" />
        </div>

        {/* Paremal: lehtede arv + sulge */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-white/30 text-xs tabular-nums">
            {loading ? '…' : `${pages.length} lk`}
          </span>
          <button
            onClick={onClose}
            className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded transition-colors"
            title="Sulge (ESC)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Sisu — eraldi scroll wrapper (kriitilised: min-h-0 + overflow-y-auto) */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="text-white/30 animate-spin" />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
          {/* Grid on eraldi, ei ole scroll wrapper — lahendab aspect ratio probleemi */}
          <div
            className="p-3"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${minThumbWidth}px, 1fr))`,
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
                  className={`cursor-pointer rounded overflow-hidden relative ${
                    isCurrent
                      ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-slate-900'
                      : 'hover:ring-2 hover:ring-white/40 hover:ring-offset-1 hover:ring-offset-slate-900'
                  }`}
                >
                  {page.imageUrl ? (
                    <img
                      src={page.imageUrl}
                      alt={`Lk ${page.pageNum}`}
                      loading="lazy"
                      className="w-full h-auto block sepia-[0.2]"
                    />
                  ) : (
                    <div className="w-full aspect-[3/4] bg-slate-700" />
                  )}
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white/70 text-xs text-center py-0.5 leading-tight">
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
