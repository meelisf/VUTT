import { describe, it, expect } from 'vitest';
import {
  pendingCount, pruneMissing, rotatePending, setPendingSplit, setPendingSplitX, showsCardLine, toRequest,
} from '../pageOpsPlan';

describe('pageOpsPlan (#431 etapp 3)', () => {
  it('pööre on koguv ja 360° eemaldab kirje', () => {
    let ops = rotatePending({}, ['a.jpg'], 90);
    ops = rotatePending(ops, ['a.jpg'], 90);
    expect(ops['a.jpg']).toEqual({ rotate: 180, split: false });
    ops = rotatePending(ops, ['a.jpg'], 180);
    expect(ops).toEqual({});
  });

  it('poolitus on idempotentne ja mõlemasuunaline; pööre jääb alles', () => {
    let ops = rotatePending({}, ['a.jpg'], 90);
    ops = setPendingSplit(ops, ['a.jpg', 'b.jpg'], true);
    ops = setPendingSplit(ops, ['a.jpg', 'b.jpg'], true);
    expect(pendingCount(ops)).toBe(2);
    ops = setPendingSplit(ops, ['a.jpg', 'b.jpg'], false);
    expect(ops).toEqual({ 'a.jpg': { rotate: 90, split: false, split_x: null } });
  });

  it('pruneMissing viskab kadunud lehed ja hoiab identiteedi, kui midagi ei kadunud', () => {
    const ops = setPendingSplit({}, ['a.jpg', 'b.jpg'], true);
    expect(pruneMissing(ops, ['a.jpg', 'b.jpg', 'c.jpg'])).toBe(ops);
    expect(Object.keys(pruneMissing(ops, ['b.jpg']))).toEqual(['b.jpg']);
  });

  it('lehekohane joon: redaktor seab, „Poolita" hoiab, „Ära poolita" kustutab', () => {
    let ops = setPendingSplitX({}, 'a.jpg', 0.42);
    expect(toRequest(ops, 0.5)).toEqual([{ filename: 'a.jpg', rotate: 0, split_x: 0.42 }]);
    ops = setPendingSplit(ops, ['a.jpg'], true);
    expect(ops['a.jpg'].split_x).toBe(0.42);
    ops = setPendingSplitX(ops, 'a.jpg', null);
    expect(toRequest(ops, 0.5)[0].split_x).toBe(0.5);
    ops = setPendingSplit(setPendingSplitX(ops, 'a.jpg', 0.3), ['a.jpg'], false);
    expect(ops).toEqual({});
  });

  it('toRequest: üldjoon ainult poolitatavatele', () => {
    const ops = setPendingSplit(rotatePending({}, ['a.jpg'], 270), ['b.jpg'], true);
    expect(toRequest(ops, 0.47)).toEqual([
      { filename: 'a.jpg', rotate: 270, split_x: null },
      { filename: 'b.jpg', rotate: 0, split_x: 0.47 },
    ]);
  });

  it('kaardi joon ainult 0°/180° juures', () => {
    expect(showsCardLine({ rotate: 0, split: true })).toBe(true);
    expect(showsCardLine({ rotate: 180, split: true })).toBe(true);
    expect(showsCardLine({ rotate: 90, split: true })).toBe(false);
    expect(showsCardLine({ rotate: 0, split: false })).toBe(false);
    expect(showsCardLine(undefined)).toBe(false);
  });
});
