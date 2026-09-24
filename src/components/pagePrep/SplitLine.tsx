import React from 'react';

interface Props {
  /** Joone asukoht pildi laiuse osana (0..1). */
  x: number;
  /** Pildi kast (px) positsioneeritud vanema suhtes. */
  box: { left: number; top: number; width: number; height: number };
  /** Käepideme mousedown — tavaliselt `useSplitDrag().startDrag`. */
  onHandleDown: () => void;
  lineTestId?: string;
  handleTestId?: string;
}

/**
 * Poolitusjoon + käepide. Üks kuju nii upload'i ülevaatuses kui teose
 * halduses (#431) — sama žest peab mõlemas kohas ühtemoodi välja nägema.
 * Paigutatakse PILDI kasti järgi, mitte konteineri järgi: muidu jookseks
 * joon letterbox'i tühja alasse.
 */
const SplitLine: React.FC<Props> = ({ x, box, onHandleDown, lineTestId, handleTestId }) => (
  <>
    <div
      data-testid={lineTestId}
      className="pointer-events-none absolute w-0.5 bg-red-500 opacity-90"
      style={{ left: box.left + x * box.width, top: box.top, height: box.height }}
    />
    <div
      data-testid={handleTestId}
      className="absolute flex h-10 w-5 -translate-x-1/2 -translate-y-1/2 cursor-col-resize items-center justify-center rounded bg-red-500 shadow-md"
      style={{ left: box.left + x * box.width, top: box.top + box.height / 2 }}
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); onHandleDown(); }}
    >
      <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
      <div className="mx-0.5 h-6 w-0.5 bg-white/70" />
    </div>
  </>
);

export default SplitLine;
