import { describe, it, expect } from 'vitest';
import { resizeBox, moveBox } from '../cropBoxInteraction';

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
