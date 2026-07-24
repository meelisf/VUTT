import { describe, it, expect } from 'vitest';
import { adjacentPageTargets } from '../useAdjacentPagePrefetch';

describe('adjacentPageTargets', () => {
  it('eellaeb järgmise enne eelmist', () => {
    expect(adjacentPageTargets(5, 100)).toEqual([6, 4]);
  });

  it('esimesel lehel ainult järgmine', () => {
    expect(adjacentPageTargets(1, 100)).toEqual([2]);
  });

  it('viimasel lehel ainult eelmine', () => {
    expect(adjacentPageTargets(100, 100)).toEqual([99]);
  });

  it('üheleheline teos ei eellaadi midagi', () => {
    expect(adjacentPageTargets(1, 1)).toEqual([]);
  });

  it('teadmata lehearvu korral piirab ainult alt', () => {
    expect(adjacentPageTargets(1, undefined)).toEqual([2]);
    expect(adjacentPageTargets(7, undefined)).toEqual([8, 6]);
  });

  it('lehearv 0 (veel indekseerimata) käitub nagu teadmata', () => {
    expect(adjacentPageTargets(3, 0)).toEqual([4, 2]);
  });

  it('vigane lehenumber ei tekita päringuid', () => {
    expect(adjacentPageTargets(0, 100)).toEqual([]);
    expect(adjacentPageTargets(-2, 100)).toEqual([]);
    expect(adjacentPageTargets(NaN, 100)).toEqual([]);
  });
});
