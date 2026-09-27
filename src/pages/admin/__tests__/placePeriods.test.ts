import { describe, it, expect } from 'vitest';
import { formatPlacePeriods, parsePlacePeriods } from '../placePeriods';

describe('placePeriods', () => {
  it('loeb ja kirjutab ridu; lahtine algus või lõpp', () => {
    const text = 'Dorpat: –1699\nPernau: 1699–1710\n\nKumla församling';
    const parsed = parsePlacePeriods(text);
    expect(parsed).toEqual({ periods: [
      { place_key: 'Dorpat', to: 1699 }, { place_key: 'Pernau', from: 1699, to: 1710 }, { place_key: 'Kumla församling' },
    ] });
    expect(formatPlacePeriods('periods' in parsed ? parsed.periods : [])).toBe('Dorpat: –1699\nPernau: 1699–1710\nKumla församling');
  });

  it('tavaline sidekriips käib ka; vigane rida annab rea numbri', () => {
    expect(parsePlacePeriods('Dorpat: 1690-1699')).toEqual({ periods: [{ place_key: 'Dorpat', from: 1690, to: 1699 }] });
    expect(parsePlacePeriods('Dorpat: 1700–1690')).toEqual({ errorLine: 1 });
    expect(parsePlacePeriods('Dorpat\nPernau: 16–')).toEqual({ errorLine: 2 });
  });
});
