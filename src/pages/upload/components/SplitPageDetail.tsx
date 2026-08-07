import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { prepressPreviewUrl, prepressStripUrl } from '../uploadApi';
import { clampSplitX } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

const NUDGE = 0.005;      // ühe nupuvajutuse samm (0,5% laiusest)
const STRIP_DEBOUNCE_MS = 400;

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  pageNum: number;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onClose: () => void;
}

/**
 * Kolmas tase: üks leht suurelt, lohistatava joonega. Kõrval natiivse
 * lahutusega riba, mille päringut debounce'itakse — lohistamine ei tohi
 * tulistada iga pointermove'i peale uut 300 DPI renderdust.
 */
const SplitPageDetail: React.FC<Props> = ({
  uploadId, token, plan, pageNum, onPageChange, onClose,
}) => {
  const { t } = useTranslation(['upload', 'common']);
  const page = plan.pages.find((p) => p.n === pageNum);
  const liveX = page?.mode === 'custom' && page.split_x != null
    ? page.split_x
    : plan.default_split_x;

  const [stripX, setStripX] = useState(liveX);
  const imageRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Debounce: riba päritakse alles pärast pausi.
  useEffect(() => {
    const id = setTimeout(() => setStripX(liveX), STRIP_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [liveX]);

  const setX = (x: number) =>
    onPageChange(pageNum, { mode: 'custom', split_x: clampSplitX(Number(x.toFixed(4))) });

  const handlePointer = (e: React.PointerEvent) => {
    if (!dragging.current || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    setX((e.clientX - rect.left) / rect.width);
  };

  if (!page) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded max-w-6xl w-full max-h-full overflow-auto p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{pageNum}</h3>
          <button type="button" onClick={onClose} aria-label={t('common:buttons.close')}>
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-4">
          <div
            ref={imageRef}
            className="relative flex-1 select-none touch-none"
            onPointerDown={(e) => { dragging.current = true; handlePointer(e); }}
            onPointerMove={handlePointer}
            onPointerUp={() => { dragging.current = false; }}
            onPointerLeave={() => { dragging.current = false; }}
          >
            <img
              src={prepressPreviewUrl(uploadId, pageNum, token)}
              alt={`${pageNum}`}
              className="block w-full"
            />
            <div
              data-testid="detail-line"
              className="absolute top-0 bottom-0 w-0.5 bg-rose-600 cursor-ew-resize"
              style={{ left: `${liveX * 100}%` }}
            />
          </div>

          <div className="flex-none">
            <img
              data-testid="detail-strip"
              src={prepressStripUrl(uploadId, pageNum, stripX, token)}
              alt=""
              style={{ height: 420, width: 'auto' }}
              className="block border"
            />
            <div className="text-center text-[11px] mt-1">
              {Math.round(liveX * 1000) / 10}%
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4">
          <button
            type="button" data-testid="nudge-left" className="p-1 border rounded"
            onClick={() => setX(liveX - NUDGE)}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button" data-testid="nudge-right" className="p-1 border rounded"
            onClick={() => setX(liveX + NUDGE)}
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button" className="px-3 py-1 text-sm border rounded"
            onClick={() => onPageChange(pageNum, { mode: 'default', split_x: null })}
          >
            {t('step3split.resetToGlobal')}
          </button>
          <button
            type="button" className="px-3 py-1 text-sm border rounded"
            onClick={() => onPageChange(pageNum, { mode: 'nosplit', split_x: null })}
          >
            {t('step3split.noSplit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SplitPageDetail;
