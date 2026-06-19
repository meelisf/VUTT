// Kärpe-ristküliku interaktsioon: sangadega resize ja liigutamine (display-pikslites).
// Puhas geomeetria — komponent teisendab normaliseeritud ↔ piksel.

import { degToRad } from './imageTransformGeometry';

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

export interface CenterBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
}

/** Resize pööratud kastil (kese-põhine). Töötab kasti LOKAALteljestikus: vastasserv
 *  jääb maailmas paigale, sang järgib kursorit. angleDeg = kasti kalle (CSS, + päripäeva).
 *  Nurga 0 korral identne resizeBox loogikaga. Vaba kuvasuhe. */
export function resizeRotatedBox(
  start: CenterBox,
  angleDeg: number,
  handle: CropHandle,
  px: number,
  py: number,
  min: number,
): CenterBox {
  const r = degToRad(angleDeg);
  const c = Math.cos(r);
  const s = Math.sin(r);
  // Kasti lokaalteljed maailmas (R_cw): e_x=(cos,sin), e_y=(-sin,cos)
  const ex = { x: c, y: s };
  const ey = { x: -s, y: c };

  const dx = px - start.cx;
  const dy = py - start.cy;
  const lu = dx * ex.x + dy * ex.y;   // projektsioon lokaal-x teljele
  const lv = dx * ey.x + dy * ey.y;   // projektsioon lokaal-y teljele

  const hw = start.w / 2;
  const hh = start.h / 2;
  let w = start.w;
  let h = start.h;
  let shiftU = 0;
  let shiftV = 0;

  if (handle.includes('e')) {
    const moving = Math.max(lu, -hw + min);
    w = moving + hw;
    shiftU = (moving - hw) / 2;
  } else if (handle.includes('w')) {
    const moving = Math.min(lu, hw - min);
    w = hw - moving;
    shiftU = (moving + hw) / 2;
  }
  if (handle.includes('s')) {
    const moving = Math.max(lv, -hh + min);
    h = moving + hh;
    shiftV = (moving - hh) / 2;
  } else if (handle.includes('n')) {
    const moving = Math.min(lv, hh - min);
    h = hh - moving;
    shiftV = (moving + hh) / 2;
  }

  return {
    cx: start.cx + shiftU * ex.x + shiftV * ey.x,
    cy: start.cy + shiftU * ex.y + shiftV * ey.y,
    w,
    h,
  };
}
