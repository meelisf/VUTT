import { describe, it, expect } from 'vitest';
import { rotatedCropToServerParams } from '../rotatedCropParams';

describe('rotatedCropToServerParams', () => {
  it('nurk 0 → identne telg-joondatud kärbe (vasak-üla normaliseeritud)', () => {
    const r = rotatedCropToServerParams({ cx: 60, cy: 30, w: 40, h: 20, angleDeg: 0 }, 200, 100);
    expect(r.angle).toBeCloseTo(0, 6);
    expect(r.crop.x).toBeCloseTo((60 - 20) / 200, 6);
    expect(r.crop.y).toBeCloseTo((30 - 10) / 100, 6);
    expect(r.crop.w).toBeCloseTo(40 / 200, 6);
    expect(r.crop.h).toBeCloseTo(20 / 100, 6);
  });

  it('keskele paigutatud kast → kärpe kese (0.5, 0.5) mis tahes nurga korral', () => {
    for (const a of [-12, -3, 5, 17]) {
      const r = rotatedCropToServerParams({ cx: 100, cy: 50, w: 30, h: 20, angleDeg: a }, 200, 100);
      const cx = r.crop.x + r.crop.w / 2;
      const cy = r.crop.y + r.crop.h / 2;
      expect(cx).toBeCloseTo(0.5, 6);
      expect(cy).toBeCloseTo(0.5, 6);
    }
  });

  it('90° kalle, off-center kast → käsitsi arvutatud tulemus', () => {
    // Kast keskpunkt (150,50) = 50px keskpunktist paremal; angleDeg=-90 → send angle=+90
    const r = rotatedCropToServerParams({ cx: 150, cy: 50, w: 20, h: 10, angleDeg: -90 }, 200, 100);
    expect(r.angle).toBeCloseTo(90, 6);
    // Pööratud (expand) raam on 100×200; kese läheb (50,150)
    expect(r.crop.x).toBeCloseTo(0.4, 6);
    expect(r.crop.y).toBeCloseTo(0.725, 6);
    expect(r.crop.w).toBeCloseTo(0.2, 6);
    expect(r.crop.h).toBeCloseTo(0.05, 6);
  });

  it('saadab serverile angle = -angleDeg (deskew suund)', () => {
    const r = rotatedCropToServerParams({ cx: 100, cy: 50, w: 30, h: 20, angleDeg: 5 }, 200, 100);
    expect(r.angle).toBeCloseTo(-5, 6);
  });
});
