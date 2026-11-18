import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Pt } from './splitGeometry';

interface Props {
  /** Joone otspunktid [ülal, all] konteineri pikslites (`splitSegment`). */
  segment: [Pt, Pt];
  onHandleDown: () => void;
  lineTestId?: string;
  handleTestId?: string;
}

/**
 * Poolitusjoon kärpe raamis (ADR 0085): joon võib olla viltu (kallutatud kast,
 * perspektiiv). Sama värv ja käepide nagu `SplitLine`-il (ristkülikul).
 * Joon ei püüa hiirt — klõpsu ja kasti žestid jäävad `CropOverlay`-le; ainult
 * käepide on haaratav (ja peatab sündmuse, et kast ei hakkaks joonistuma).
 */
const SplitGuide: React.FC<Props> = ({ segment: [a, b], onHandleDown, lineTestId, handleTestId }) => {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // Käepide pööratakse joone suunda (püstjoonel 0°).
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) * -180) / Math.PI;
  return (
    <>
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        <line data-testid={lineTestId} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
          stroke="rgb(239,68,68)" strokeOpacity={0.9} strokeWidth={2} />
      </svg>
      <div
        data-testid={handleTestId}
        className="absolute flex h-10 w-5 cursor-col-resize items-center justify-center rounded bg-red-500 shadow-md"
        style={{ left: mid.x, top: mid.y, transform: `translate(-50%, -50%) rotate(${deg}deg)` }}
        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onHandleDown(); }}
      >
        <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
        <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
      </div>
    </>
  );
};

export default SplitGuide;

/**
 * Käepideme lohistus: kursori punkt (konteineri pikslites) → `toX`. Kuulatakse
 * AKNAST, et kursor võiks raamist väljuda; kast mõõdetakse sündmuse hetkel.
 */
export function useSplitGuideDrag(
  containerRef: React.RefObject<HTMLElement | null>,
  toX: (p: Pt) => number,
  onX: (x: number) => void,
) {
  const [dragging, setDragging] = useState(false);
  const toXRef = useRef(toX);
  toXRef.current = toX;
  const onXRef = useRef(onX);
  onXRef.current = onX;

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      onXRef.current(toXRef.current({ x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, containerRef]);

  const startDrag = useCallback(() => setDragging(true), []);
  return { dragging, startDrag };
}
