import { describe, it, expect } from 'vitest';
import { resizeBox, moveBox, resizeRotatedBox } from '../cropBoxInteraction';

const bounds = { w: 200, h: 100 };

describe('resizeBox', () => {
  it('se-sang suurendab paremale-alla', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    const r = resizeBox(start, 'se', 120, 80, bounds, 8);
    expect(r).toEqual({ left: 10, top: 10, width: 110, height: 70 });
  });

  it('nw-sang liigutab vasak-üla nurka', () => {
    const start = { left: 50, top: 50, width: 40, height: 30 };
    const r = resizeBox(start, 'nw', 30, 40, bounds, 8);
    expect(r).toEqual({ left: 30, top: 40, width: 60, height: 40 });
  });

  it('servasang (e) muudab ainult ühte külge', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    const r = resizeBox(start, 'e', 100, 999, bounds, 8);
    expect(r).toEqual({ left: 10, top: 10, width: 90, height: 30 });
  });

  it('hoiab min-mõõtu (ei lase serval üle vastaskülje minna)', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    // w-sang lükatakse paremale parema serva (50) taha → klampitakse 50-8=42
    const r = resizeBox(start, 'w', 999, 10, bounds, 8);
    expect(r.left).toBe(42);
    expect(r.width).toBe(8);
  });

  it('klampib piiridesse', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    const r = resizeBox(start, 'se', 999, 999, bounds, 8);
    expect(r.left + r.width).toBe(200);
    expect(r.top + r.height).toBe(100);
  });
});

describe('moveBox', () => {
  it('liigutab kasti', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    expect(moveBox(start, 20, 5, bounds)).toEqual({ left: 30, top: 15, width: 40, height: 30 });
  });

  it('klampib vasakule/üles (ei lähe negatiivseks)', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    expect(moveBox(start, -50, -50, bounds)).toEqual({ left: 0, top: 0, width: 40, height: 30 });
  });

  it('klampib paremale/alla (jääb piiridesse)', () => {
    const start = { left: 10, top: 10, width: 40, height: 30 };
    expect(moveBox(start, 999, 999, bounds)).toEqual({ left: 160, top: 70, width: 40, height: 30 });
  });
});

describe('resizeRotatedBox', () => {
  const start = { cx: 100, cy: 100, w: 40, h: 20 };

  it('nurk 0: se-sang hoiab vastasnurka paigal (nagu resizeBox)', () => {
    // start: vasak=80, üla=90, parem=120, ala=110. se → parem-alla kursorile (140, 130)
    const r = resizeRotatedBox(start, 0, 'se', 140, 130, 8);
    expect(r.w).toBeCloseTo(60, 6);   // 140 - 80
    expect(r.h).toBeCloseTo(40, 6);   // 130 - 90
    expect(r.cx).toBeCloseTo(110, 6); // (80+140)/2
    expect(r.cy).toBeCloseTo(110, 6); // (90+130)/2
  });

  it('nurk 0: e-sang muudab ainult laiust', () => {
    const r = resizeRotatedBox(start, 0, 'e', 150, 999, 8);
    expect(r.w).toBeCloseTo(70, 6);   // 150 - 80
    expect(r.h).toBeCloseTo(20, 6);
    expect(r.cy).toBeCloseTo(100, 6);
  });

  it('90° kalle: e-sang kasvatab piki lokaal-x telge (maailmas alla)', () => {
    // angle=90 → e_x=(0,1). e-sang järgib kursorit piki maailma y-telge.
    const r = resizeRotatedBox(start, 90, 'e', 100, 150, 8);
    expect(r.w).toBeCloseTo(70, 6);   // lu = (150-100) projektsioon e_x=(0,1) = 50; w = 50 + 20
    expect(r.h).toBeCloseTo(20, 6);
    // kese nihkub piki e_x=(0,1): shiftU=(50-20)/2=15 → cy 115, cx 100
    expect(r.cx).toBeCloseTo(100, 6);
    expect(r.cy).toBeCloseTo(115, 6);
  });

  it('hoiab min-mõõtu', () => {
    const r = resizeRotatedBox(start, 0, 'w', 999, 100, 8);
    expect(r.w).toBeCloseTo(8, 6);
  });
});
