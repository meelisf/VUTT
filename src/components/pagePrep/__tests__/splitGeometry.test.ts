import { describe, it, expect } from 'vitest';
import { outputQuad, splitSegment, splitXFromPoint, type OutputQuad } from '../splitGeometry';

describe('splitGeometry', () => {
  it('kärpeta: joon on püstjoon üle kogu raami', () => {
    const q = outputQuad(null, 400, 600);
    expect(splitSegment(q, 0.25)).toEqual([{ x: 100, y: 0 }, { x: 100, y: 600 }]);
    expect(splitXFromPoint(q, { x: 100, y: 321 })).toBeCloseTo(0.25, 3);
  });

  it('telgjoondatud kärbe: joon kärpe laiuse järgi', () => {
    const q = outputQuad({ angle: 0, crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, quad: null }, 400, 600);
    const [top, bottom] = splitSegment(q, 0.5);
    expect(top.x).toBeCloseTo(200); expect(top.y).toBeCloseTo(60);
    expect(bottom.x).toBeCloseTo(200); expect(bottom.y).toBeCloseTo(540);
    // Kärpe vasak serv (x=100) → 0 → clampSplitX alampiir.
    expect(splitXFromPoint(q, { x: 150, y: 300 })).toBeCloseTo(0.25, 3);
  });

  it('pöördfunktsioon on splitSegment-i pöördväärtus ka viltusel nelinurgal', () => {
    // Bilineaarne perspektiiv: servad eri pikkusega, joon ei ole püstine.
    const q: OutputQuad = [{ x: 50, y: 20 }, { x: 380, y: 60 }, { x: 350, y: 580 }, { x: 20, y: 560 }];
    for (const x of [0.1, 0.33, 0.5, 0.77, 0.9]) {
      const [a, b] = splitSegment(q, x);
      const mid = { x: a.x * 0.3 + b.x * 0.7, y: a.y * 0.3 + b.y * 0.7 };
      expect(splitXFromPoint(q, mid)).toBeCloseTo(x, 3);
    }
  });

  it('nelinurgast väljas klõps piiratakse 5…95 %', () => {
    const q = outputQuad(null, 400, 600);
    expect(splitXFromPoint(q, { x: -50, y: 300 })).toBe(0.05);
    expect(splitXFromPoint(q, { x: 999, y: 300 })).toBe(0.95);
  });

  it('kallutatud kärbe: joon pöörleb kastiga kaasa', () => {
    // 10° kalle — joon ei ole enam püstine, aga läbib kasti keskpunkti x=0.5 juures.
    const q = outputQuad({ angle: -10, crop: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 }, quad: null }, 400, 600);
    const [a, b] = splitSegment(q, 0.5);
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(1);
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    expect(splitXFromPoint(q, c)).toBeCloseTo(0.5, 3);
  });
});
