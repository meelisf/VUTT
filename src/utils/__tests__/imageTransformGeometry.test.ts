import { describe, it, expect } from 'vitest';
import { degToRad, expandedBoundingBox } from '../imageTransformGeometry';

describe('degToRad', () => {
  it('teisendab kraadid radiaanideks', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 10);
    expect(degToRad(0)).toBe(0);
  });
});

describe('expandedBoundingBox', () => {
  it('0° → samad mõõdud', () => {
    const b = expandedBoundingBox(200, 100, 0);
    expect(b.width).toBeCloseTo(200, 6);
    expect(b.height).toBeCloseTo(100, 6);
  });

  it('90° → vahetab laiuse ja kõrguse', () => {
    const b = expandedBoundingBox(200, 100, 90);
    expect(b.width).toBeCloseTo(100, 6);
    expect(b.height).toBeCloseTo(200, 6);
  });

  it('märk ei mõjuta mõõtu (abs)', () => {
    const a = expandedBoundingBox(200, 100, 30);
    const b = expandedBoundingBox(200, 100, -30);
    expect(a.width).toBeCloseTo(b.width, 6);
    expect(a.height).toBeCloseTo(b.height, 6);
  });
});

// Regressioon: eelvaate img on konteinerist (expand'itud kast) LAIEM, kui rõhtsat pilti
// pöörata 90°/270°. Tailwindi preflight `img { max-width: 100% }` kärbiks siis elemendi
// laiust ja kuvasuhe läheks katki → img vajab `max-w-none`.
describe('eelvaate img vs konteineri laius', () => {
  const containerVsImage = (w: number, h: number, angle: number) => ({
    container: expandedBoundingBox(w, h, angle).width,
    image: w,
  });

  it('rõhtne pilt 90° → img laiem kui konteiner (max-width kärbiks)', () => {
    const { container, image } = containerVsImage(2517, 2019, 90);
    expect(image).toBeGreaterThan(container);
  });

  it('püstine pilt 90° → img mahub ära', () => {
    const { container, image } = containerVsImage(1275, 2169, 90);
    expect(image).toBeLessThanOrEqual(container);
  });

  it('0° ja 180° → img ei ületa kunagi konteinerit', () => {
    for (const angle of [0, 180]) {
      for (const [w, h] of [[2517, 2019], [1275, 2169]]) {
        const { container, image } = containerVsImage(w, h, angle);
        expect(image).toBeLessThanOrEqual(container + 1e-9);
      }
    }
  });
});
