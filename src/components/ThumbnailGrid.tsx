import React, { useEffect, useRef } from 'react';
import { X, Loader2, ZoomIn, ZoomOut } from 'lucide-react';

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
}

const ThumbnailGrid: React.FC<ThumbnailGridProps> = ({
  pages,
  currentPage,
  loading,
  onSelectPage,
  onClose,
}) => {
  // cols: 2 (suur) kuni 8 (väike), slider väärtus on inverteeritud (parem = suurem)
  const [cols, setCols] = React.useState(4);
  const currentRef = useRef<HTMLDivElement>(null);

  // Skrolli praegusele lehele kui grid on laetud
  useEffect(() => {
    if (!loading && currentRef.current) {
      currentRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
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

  // Slider: suurem väärtus = vähem veerge = suuremad thumbnailid
  const sliderValue = 10 - cols; // 2..8 → slider 8..2
  const handleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCols(10 - Number(e.target.value));
  };

  return (
    <div className="absolute inset-0 z-10 bg-slate-900 flex flex-col">
      {/* Tööriistariba */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 flex-shrink-0">
        <span className="text-white/40 text-sm tabular-nums">
          {loading ? '…' : `${pages.length} lk`}
        </span>

        {/* Suumi slider */}
        <div className="flex items-center gap-2">
          <ZoomOut size={15} className="text-white/30" />
          <input
            type="range"
            min={2}
            max={8}
            step={1}
            value={sliderValue}
            onChange={handleSlider}
            className="w-28 accent-white/50 cursor-pointer"
            title="Thumbnailide suurus"
          />
          <ZoomIn size={15} className="text-white/30" />
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-white/50 hover:text-white hover:bg-white/10 rounded transition-colors"
          title="Sulge (ESC)"
        >
          <X size={18} />
        </button>
      </div>

      {/* Sisu */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={28} className="text-white/30 animate-spin" />
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto p-3"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: '10px',
            alignContent: 'start',
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
      )}
    </div>
  );
};

export default ThumbnailGrid;
