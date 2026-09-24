import { describe, it, expect } from 'vitest';
import { addRotation, clampSplitX } from '../geometry';

describe('addRotation', () => {
  it('on koguv ja normaliseerib vahemikku [0, 360)', () => {
    expect(addRotation(0, 90)).toBe(90);
    expect(addRotation(270, 90)).toBe(0);
    expect(addRotation(0, -90)).toBe(270);
    expect(addRotation(90, 180)).toBe(270);
    expect(addRotation(180, 180)).toBe(0);
  });
});

describe('clampSplitX', () => {
  it('hoiab joone vahemikus [0.05, 0.95] (sama piir mis split_page-il)', () => {
    expect(clampSplitX(0)).toBe(0.05);
    expect(clampSplitX(1)).toBe(0.95);
    expect(clampSplitX(0.47)).toBe(0.47);
  });
  it('mittearvuline sisend → keskjoon', () => {
    expect(clampSplitX(NaN)).toBe(0.5);
  });
});
