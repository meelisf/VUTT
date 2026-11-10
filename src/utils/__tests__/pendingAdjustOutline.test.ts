import { describe, it, expect } from 'vitest';
import { pendingAdjustOutline as raw } from '../pendingAdjustOutline';

// Ujukomavea tõttu võrdleme ümardatult.
const pendingAdjustOutline: typeof raw = (a, w, h) =>
  raw(a, w, h)?.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]) ?? null;

describe('pendingAdjustOutline', () => {
  it('kärbe ilma kaldeta on lihtsalt ristkülik px-des', () => {
    const o = pendingAdjustOutline({ angle: 0, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }, quad: null }, 200, 100)!;
    expect(o).toEqual([[20, 20], [120, 20], [120, 60], [20, 60]]);
  });

  it('perspektiiv kasutab quad-i', () => {
    const q: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const o = pendingAdjustOutline({ angle: 0, crop: null, quad: q }, 100, 50)!;
    expect(o).toEqual([[0, 0], [100, 0], [100, 50], [0, 50]]);
  });

  it('täisraam 90° kaldega pöördub tagasi lehe raami', () => {
    // 100×100 leht, 90°: laiendatud raam 100×100; (0,0) → pööre -90° ümber keskpunkti.
    const o = pendingAdjustOutline({ angle: 90, crop: { x: 0, y: 0, w: 1, h: 1 }, quad: null }, 100, 100)!;
    const [x, y] = o[0];
    expect(Math.round(x)).toBe(0);
    expect(Math.round(y)).toBe(100);
  });

  it('ainult kalle (ei kärbet ega quad-i) → null', () => {
    expect(pendingAdjustOutline({ angle: 2, crop: null, quad: null }, 100, 100)).toBeNull();
    expect(pendingAdjustOutline(null, 100, 100)).toBeNull();
  });
});
