import type { PageAdjust } from '../../pages/upload/types';
import { pendingAdjustOutline } from '../../utils/pendingAdjustOutline';
import { clampSplitX } from './geometry';

/**
 * Poolitusjoon kärpe raamis (ADR 0085). `split_x` on KÄRBITUD pildi laiuse osa
 * (pööre → adjust → poolitus), aga redaktor näitab toorest (pööratud) pilti.
 *
 * Üks geomeetria kõigile kärpe kujudele: väljundi nelinurk ekraanil
 * [TL, TR, BR, BL]. Joon `x` = lõik lerp(TL,TR,x) → lerp(BL,BR,x).
 * - telgjoondatud ja kallutatud kast: nelinurk on (pööratud) ristkülik — täpne;
 * - perspektiiv: serveri `Image.QUAD` on BILINEAARNE, püstjoon väljundis on
 *   sirge lõik, mis jagab ülemist ja alumist serva samas suhtes — täpne.
 *   (Projektiivse teisenduse korral see EI kehtiks.)
 */

export type Pt = { x: number; y: number };
export type OutputQuad = [Pt, Pt, Pt, Pt];

/** Väljundi nelinurk kuvatava raami pikslites; kärpeta = kogu raam. */
export function outputQuad(adjust: PageAdjust | null | undefined, w: number, h: number): OutputQuad {
  const o = pendingAdjustOutline(adjust, w, h);
  if (!o) return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  return o.map(([x, y]) => ({ x, y })) as OutputQuad;
}

const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Joone otspunktid [ülal, all] kuvatava raami pikslites. */
export function splitSegment(q: OutputQuad, x: number): [Pt, Pt] {
  return [lerp(q[0], q[1], x), lerp(q[3], q[2], x)];
}

/** Punkti märgiga kaugus joonest x (positiivne = joonest paremal väljundi mõttes). */
function side(q: OutputQuad, x: number, p: Pt): number {
  const [a, b] = splitSegment(q, x);
  // Rist: (b - a) × (p - a). Alla suunatud lõigul on parem pool negatiivne → vaheta märk.
  return -((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
}

/**
 * Klõpsupunkti joon `x` (pöördfunktsioon): x, mille joon läbib punkti.
 * Kumera nelinurga sees on `side` x-i suhtes monotoonne → bisektsioon.
 * Tulemus on piiratud `clampSplitX`-iga (ka nelinurgast väljas klõps).
 */
export function splitXFromPoint(q: OutputQuad, p: Pt): number {
  let lo = 0;
  let hi = 1;
  if (side(q, lo, p) <= 0) return clampSplitX(0);
  if (side(q, hi, p) >= 0) return clampSplitX(1);
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (side(q, mid, p) > 0) lo = mid; else hi = mid;
  }
  return clampSplitX(Number(((lo + hi) / 2).toFixed(4)));
}
