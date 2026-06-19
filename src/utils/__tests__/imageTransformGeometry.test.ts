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
