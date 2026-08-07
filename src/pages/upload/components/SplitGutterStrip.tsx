import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { prepressStripUrl } from '../uploadApi';
import { inkLevel, visibleWindow } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';

const ITEM_WIDTH = 132;   // riba laius + vahe (px)
const STRIP_HEIGHT = 300; // vertikaalne surumine: laius jääb natiivseks
const X_DEBOUNCE_MS = 400;

const BORDER: Record<string, string> = {
  ok: 'border-green-500',
  warn: 'border-amber-500',
  bad: 'border-red-600',
};

interface Props {
  uploadId: string;
  token: string | null;
  plan: PrepressPlan;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onOpenPage: (n: number) => void;
}

/**
 * Köitevahe-riba: igast lehest kitsas NATIIVSE lahutusega vertikaalne lõige
 * joone ümbert. Lehe kõrgus on kokku surutud, laius mitte — "kas tint ületab
 * joone" on horisontaalne küsimus, nii et vertikaalne surumine ei kaota infot.
 */
const SplitGutterStrip: React.FC<Props> = ({
  uploadId, token, plan, onOpenPage,
}) => {
  const { t } = useTranslation(['upload']);
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState<[number, number]>([0, 12]);

  const pages = plan.pages.filter((p) => !p.excluded);

  // Globaalse joone sisestusväli muutub iga klahvivajutusega. Ilma
  // debounce'ita tellitaks igale nähtavale lehele uus 300 DPI renderdus.
  const [debouncedGlobal, setDebouncedGlobal] = useState(plan.default_split_x);
  useEffect(() => {
    const id = setTimeout(() => setDebouncedGlobal(plan.default_split_x), X_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [plan.default_split_x]);

  /** Lehe joon ribapäringu jaoks: custom rakendub kohe, globaalne viivitusega. */
  const debouncedX = (page: PrepressPage): number =>
    (page.mode === 'custom' && page.split_x != null ? page.split_x : debouncedGlobal);

  const recompute = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setRange(visibleWindow(el.scrollLeft, ITEM_WIDTH, el.clientWidth, pages.length));
  }, [pages.length]);

  useEffect(() => {
    recompute();
    const el = ref.current;
    if (!el) return;
    el.addEventListener('scroll', recompute, { passive: true });
    window.addEventListener('resize', recompute);
    return () => {
      el.removeEventListener('scroll', recompute);
      window.removeEventListener('resize', recompute);
    };
  }, [recompute]);

  const [start, end] = range;

  return (
    <div
      ref={ref}
      data-testid="split-gutter-strip"
      className="flex gap-2 overflow-x-auto bg-gray-100 p-2 rounded"
      style={{ minHeight: STRIP_HEIGHT + 24 }}
    >
      <div style={{ width: start * ITEM_WIDTH, flex: '0 0 auto' }} aria-hidden />
      {pages.slice(start, end).map((page) => {
        const level = inkLevel(page.ink);
        return (
          <div key={page.n} className="relative flex-none" style={{ width: ITEM_WIDTH - 8 }}>
            <button
              type="button"
              title={t('step3split.openPage')}
              className={`block border-2 ${BORDER[level]}`}
              onClick={() => onOpenPage(page.n)}
            >
              <img
                src={prepressStripUrl(uploadId, page.n, debouncedX(page), token)}
                alt={`${page.n}`}
                loading="lazy"
                style={{ height: STRIP_HEIGHT, width: ITEM_WIDTH - 12, objectFit: 'fill' }}
                className="block"
              />
            </button>
            <div
              className="absolute top-0 w-px bg-rose-600 pointer-events-none"
              style={{ left: '50%', height: STRIP_HEIGHT }}
            />
            <div className="text-center text-[10px] mt-1">{page.n}</div>
          </div>
        );
      })}
      <div
        style={{ width: Math.max(0, (pages.length - end) * ITEM_WIDTH), flex: '0 0 auto' }}
        aria-hidden
      />
    </div>
  );
};

export default SplitGutterStrip;
