import { describe, it, expect } from 'vitest';
import { clampPosition, defaultPanelPosition } from '../dragPosition';

const VIEW = { w: 1200, h: 800 };

describe('clampPosition', () => {
  it('jätab ekraanil oleva asukoha puutumata', () => {
    expect(clampPosition({ x: 100, y: 100 }, { w: 600, h: 500 }, VIEW)).toEqual({ x: 100, y: 100 });
  });
  it('paneeli võib lükata osaliselt külje taha, aga päise haarderiba jääb nähtavale', () => {
    expect(clampPosition({ x: -2000, y: 100 }, { w: 600, h: 500 }, VIEW).x).toBe(-480);
    expect(clampPosition({ x: 5000, y: 100 }, { w: 600, h: 500 }, VIEW).x).toBe(1080);
  });
  it('päis ei lähe üles ekraanist välja ega alla nähtamatuks', () => {
    expect(clampPosition({ x: 0, y: -50 }, { w: 600, h: 500 }, VIEW).y).toBe(0);
    expect(clampPosition({ x: 0, y: 5000 }, { w: 600, h: 500 }, VIEW).y).toBe(756);
  });
});

describe('defaultPanelPosition', () => {
  it('paremasse serva, päise alla', () => {
    expect(defaultPanelPosition({ w: 672, h: 500 }, VIEW)).toEqual({ x: 1200 - 672 - 24, y: 80 });
  });
  it('kitsal ekraanil 16 px vasakult', () => {
    expect(defaultPanelPosition({ w: 672, h: 500 }, { w: 500, h: 800 }).x).toBe(16);
  });
});
