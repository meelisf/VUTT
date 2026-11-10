import type { PageAdjust } from '../pages/upload/types';
import { expandedBoundingBox } from './imageTransformGeometry';

/**
 * Ootel `adjust`-i kontuur lehe enda raamis (px), et kasutaja näeks tagasi tulles,
 * MIDA rakendus lõikab. `adjust.crop`/`quad` on koordinaadid 0..1 kalde võrra
 * pööratud ja laiendatud raamis (server: pööre `expand=True`, siis kärbe), seega
 * viime punktid pöördega tagasi lehe raami. Kärbet ega perspektiivi ei ole → null.
 */
export function pendingAdjustOutline(
  adjust: PageAdjust | null | undefined, w: number, h: number,
): [number, number][] | null {
  if (!adjust || w <= 0 || h <= 0) return null;
  let pts: [number, number][];
  if (adjust.quad && adjust.quad.length === 4) {
    pts = adjust.quad;
  } else if (adjust.crop) {
    const { x, y, w: cw, h: ch } = adjust.crop;
    pts = [[x, y], [x + cw, y], [x + cw, y + ch], [x, y + ch]];
  } else {
    return null;
  }
  const exp = expandedBoundingBox(w, h, adjust.angle);
  const r = (adjust.angle * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return pts.map(([u, v]) => {
    const dx = u * exp.width - exp.width / 2;
    const dy = v * exp.height - exp.height / 2;
    // Pööre -angle (CSS +angle = päripäeva, y alla).
    return [w / 2 + dx * cos + dy * sin, h / 2 - dx * sin + dy * cos];
  });
}
