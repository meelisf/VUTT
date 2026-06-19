// Kärpe-ristküliku interaktsioon: sangadega resize ja liigutamine (display-pikslites).
// Puhas geomeetria — komponent teisendab normaliseeritud ↔ piksel.

export type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Muudab kasti suurust ühte sanga lohistades. Liigutab ainult sangaga seotud servi,
 *  hoiab min-mõõtu ja klampib piiridesse [0, bounds]. Vaba kuvasuhe. */
export function resizeBox(
  start: Box,
  handle: CropHandle,
  px: number,
  py: number,
  bounds: { w: number; h: number },
  min: number,
): Box {
  let l = start.left;
  let t = start.top;
  let r = start.left + start.width;
  let b = start.top + start.height;

  px = clamp(px, 0, bounds.w);
  py = clamp(py, 0, bounds.h);

  if (handle.includes('w')) l = clamp(Math.min(px, r - min), 0, r - min);
  if (handle.includes('e')) r = clamp(Math.max(px, l + min), l + min, bounds.w);
  if (handle.includes('n')) t = clamp(Math.min(py, b - min), 0, b - min);
  if (handle.includes('s')) b = clamp(Math.max(py, t + min), t + min, bounds.h);

  return { left: l, top: t, width: r - l, height: b - t };
}

/** Liigutab tervet kasti (dx, dy), klampides nii et kast jääb piiridesse. */
export function moveBox(start: Box, dx: number, dy: number, bounds: { w: number; h: number }): Box {
  const dxc = clamp(dx, -start.left, bounds.w - (start.left + start.width));
  const dyc = clamp(dy, -start.top, bounds.h - (start.top + start.height));
  return { left: start.left + dxc, top: start.top + dyc, width: start.width, height: start.height };
}
