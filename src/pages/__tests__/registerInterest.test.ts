import { describe, it, expect } from 'vitest';
import { MAX_INTEREST_COLLECTIONS, toggleInterest } from '../registerInterest';

describe('toggleInterest', () => {
  it('lisab ja eemaldab', () => {
    expect(toggleInterest([], 'ag')).toEqual(['ag']);
    expect(toggleInterest(['ag', 'agc'], 'ag')).toEqual(['agc']);
  });

  it('ei lisa üle piiri', () => {
    const full = ['a', 'b', 'c'];
    expect(toggleInterest(full, 'd')).toEqual(full);
    expect(full).toHaveLength(MAX_INTEREST_COLLECTIONS);
  });

  it('eemaldamine on lubatud ka täis loendist', () => {
    expect(toggleInterest(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('eemaldamine on lubatud ka üle piiri läinud loendist', () => {
    // Piiri vähendamine ei tohi kasutajat lukku jätta.
    expect(toggleInterest(['a', 'b', 'c', 'd'], 'a', 3)).toEqual(['b', 'c', 'd']);
  });
});
