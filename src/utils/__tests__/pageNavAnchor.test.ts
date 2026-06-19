import { describe, it, expect } from 'vitest';
import { computeNextAnchor, resolveIndexAfter } from '../pageNavAnchor';

describe('computeNextAnchor', () => {
  it('tagastab järgmise faili', () => {
    expect(computeNextAnchor(['a.jpg', 'b.jpg', 'c.jpg'], 'b.jpg')).toBe('c.jpg');
  });
  it('viimasel lehel → null', () => {
    expect(computeNextAnchor(['a.jpg', 'b.jpg'], 'b.jpg')).toBe(null);
  });
});

describe('resolveIndexAfter', () => {
  it('crop/rotate: failinimi säilib → sama leht', () => {
    // Nimekiri ei muutunud; ankur oli "b.jpg" ja see on alles
    const r = resolveIndexAfter(['a.jpg', 'b.jpg', 'c.jpg'], 'b.jpg', 'a.jpg');
    expect(r).toEqual({ index: 1, done: false });
  });
  it('split: ankur (järgmine originaal) hüppab üle uute pooolte', () => {
    // Enne: [a,b,c]; poolitati a → [a1,a2,b,c]; ankur oli "b.jpg"
    const r = resolveIndexAfter(['a1.jpg', 'a2.jpg', 'b.jpg', 'c.jpg'], 'b.jpg', 'a.jpg');
    expect(r).toEqual({ index: 2, done: false });
  });
  it('viimane leht (ankur null), praegune kadunud → done viimasel', () => {
    const r = resolveIndexAfter(['a1.jpg', 'a2.jpg'], null, 'a.jpg');
    expect(r).toEqual({ index: 1, done: true });
  });
  it('viimane leht (ankur null), praegune alles → done samal', () => {
    const r = resolveIndexAfter(['a.jpg', 'b.jpg'], null, 'b.jpg');
    expect(r).toEqual({ index: 1, done: true });
  });
});
