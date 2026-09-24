import React from 'react';
import type { CropHandle } from '../../utils/cropBoxInteraction';
import { quadToDisplayPx } from '../../utils/perspectiveQuad';
import type { CropBoxState } from './useCropBox';

// 8 sanga: nurgad + servad. cursor klassiga.
const CROP_HANDLES: { id: CropHandle; style: React.CSSProperties; cursor: string }[] = [
  { id: 'nw', style: { left: 0, top: 0 }, cursor: 'nwse-resize' },
  { id: 'n', style: { left: '50%', top: 0 }, cursor: 'ns-resize' },
  { id: 'ne', style: { left: '100%', top: 0 }, cursor: 'nesw-resize' },
  { id: 'e', style: { left: '100%', top: '50%' }, cursor: 'ew-resize' },
  { id: 'se', style: { left: '100%', top: '100%' }, cursor: 'nwse-resize' },
  { id: 's', style: { left: '50%', top: '100%' }, cursor: 'ns-resize' },
  { id: 'sw', style: { left: 0, top: '100%' }, cursor: 'nesw-resize' },
  { id: 'w', style: { left: 0, top: '50%' }, cursor: 'ew-resize' },
];

interface Props {
  crop: CropBoxState;
  /** Kaldesanga vihje (tõlgitud). */
  deskewTitle: string;
}

/**
 * Kärpekasti / perspektiivinurkade ülekate. Püüab hiire; paigutatakse
 * `absolute inset-0` pildikasti peale, mille mõõdud on `crop.displayW/H`.
 * Ühine teose haldusele ja upload'i ülevaatusele (#431).
 */
const CropOverlay: React.FC<Props> = ({ crop, deskewTitle }) => {
  const { overlayRef, perspective, quad, overlayBox, cropDraft, displayW, displayH } = crop;
  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 cursor-crosshair"
      onMouseDown={crop.onMouseDown}
    >
      {perspective && quad ? (
        <svg
          className="absolute inset-0 w-full h-full overflow-visible"
          style={{ pointerEvents: 'none' }}
        >
          <polygon
            points={quadToDisplayPx(quad, displayW, displayH).map((p) => `${p.x},${p.y}`).join(' ')}
            fill="rgba(99,102,241,0.15)"
            stroke="rgb(99,102,241)"
            strokeWidth={2}
          />
          {quadToDisplayPx(quad, displayW, displayH).map((p, i) => (
            <circle
              key={i}
              data-corner={i}
              cx={p.x}
              cy={p.y}
              r={7}
              fill="white"
              stroke="rgb(99,102,241)"
              strokeWidth={2}
              style={{ pointerEvents: 'auto', cursor: 'grab' }}
            />
          ))}
        </svg>
      ) : overlayBox && (
        <div
          data-cropbox=""
          className="absolute border-2 border-indigo-500"
          style={{
            left: overlayBox.cx - overlayBox.w / 2,
            top: overlayBox.cy - overlayBox.h / 2,
            width: overlayBox.w,
            height: overlayBox.h,
            transform: `rotate(${overlayBox.angle}deg)`,
            transformOrigin: 'center',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)',
            cursor: 'move',
          }}
        >
          {/* Resize-sangad + pöördesang (ainult kinnitatud kastil) */}
          {!cropDraft && (
            <>
              {CROP_HANDLES.map((hh) => (
                <div
                  key={hh.id}
                  data-handle={hh.id}
                  className="absolute w-2.5 h-2.5 bg-white border border-indigo-600 rounded-sm"
                  style={{ ...hh.style, transform: 'translate(-50%, -50%)', cursor: hh.cursor }}
                />
              ))}
              {/* Pöördesang ülal keskel */}
              <div
                className="absolute w-px bg-indigo-500 pointer-events-none"
                style={{ left: '50%', top: -22, height: 22 }}
              />
              <div
                data-rotate=""
                title={deskewTitle}
                className="absolute w-3 h-3 bg-white border border-indigo-600 rounded-full"
                style={{ left: '50%', top: -22, transform: 'translate(-50%, -50%)', cursor: 'grab' }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CropOverlay;
