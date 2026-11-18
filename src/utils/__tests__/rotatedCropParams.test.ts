import { describe, it, expect } from 'vitest';
import { rotatedCropToServerParams, serverParamsToRotatedCrop } from '../rotatedCropParams';

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

describe('serverParamsToRotatedCrop (pöördteisendus, ADR 0085)', () => {
  it.each([0, 3.5, -7, 12, -0.4])('edasi-tagasi annab sama kasti (kalle %s°)', (angleDeg) => {
    const box = { cx: 210, cy: 330, w: 180, h: 260, angleDeg };
    const back = serverParamsToRotatedCrop(rotatedCropToServerParams(box, 400, 600), 400, 600);
    expect(back.cx).toBeCloseTo(box.cx, 6);
    expect(back.cy).toBeCloseTo(box.cy, 6);
    expect(back.w).toBeCloseTo(box.w, 6);
    expect(back.h).toBeCloseTo(box.h, 6);
    expect(back.angleDeg).toBeCloseTo(angleDeg, 6);
  });

  it('serveri nurk [0, 360) kujul (nt 357°) annab kalde +3°', () => {
    const p = rotatedCropToServerParams({ cx: 200, cy: 300, w: 100, h: 100, angleDeg: 3 }, 400, 600);
    const back = serverParamsToRotatedCrop({ ...p, angle: ((p.angle % 360) + 360) % 360 }, 400, 600);
    expect(back.angleDeg).toBeCloseTo(3, 6);
  });
});
