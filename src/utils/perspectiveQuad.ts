// Perspektiivi nelinurga abifunktsioonid. Quad = 4 nurka normaliseeritud [0..1]
// rotated-display-raamis, järjekord TL, TR, BR, BL. Serverile saadetakse samas raamis.

export interface QuadPt { x: number; y: number }
export type Quad4 = [QuadPt, QuadPt, QuadPt, QuadPt];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Vaikenelinurk veidi servadest sissepoole (kõik sangad kohe haaratavad). */
export function defaultQuad(inset = 0.05): Quad4 {
  const a = clamp01(inset);
  const b = clamp01(1 - inset);
  return [{ x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }];
}

/** Ristkülikust (normaliseeritud) 4 nurka TL, TR, BR, BL. */
export function quadFromCropRect(r: { x: number; y: number; w: number; h: number }): Quad4 {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.w, y: r.y },
    { x: r.x + r.w, y: r.y + r.h },
    { x: r.x, y: r.y + r.h },
  ];
}

/** Normaliseeritud quad → display-pikslid. */
export function quadToDisplayPx(quad: Quad4, displayW: number, displayH: number): QuadPt[] {
  return quad.map((p) => ({ x: p.x * displayW, y: p.y * displayH }));
}

/** Display-piksel → normaliseeritud punkt, klambitud [0,1]. */
export function quadPtFromDisplayPx(x: number, y: number, displayW: number, displayH: number): QuadPt {
  return { x: clamp01(x / displayW), y: clamp01(y / displayH) };
}
