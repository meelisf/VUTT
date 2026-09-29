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
    expect(parsePlacePeriods('Dorpat: 1700–1690')).toMatchObject({ errorLine: 1, reason: 'format' });
    expect(parsePlacePeriods('Dorpat\nPernau: 16–')).toMatchObject({ errorLine: 2, reason: 'format' });
  });

  it('ainult aastad = koht puudub, mitte koht nimega „1804–1890"', () => {
    // Enne läks rida serverisse võtmena „1804–1890" ja tuli tagasi paljas unknown_place_key.
    expect(parsePlacePeriods('1804–1890')).toEqual({ errorLine: 1, reason: 'years_only', value: '1804–1890' });
    expect(parsePlacePeriods('Dorpat\n 1804 - 1890 ')).toMatchObject({ errorLine: 2, reason: 'years_only' });
  });

  it('laetud kohtade registri vastu tuleb tundmatu võti välja rea ja nimega', () => {
    const keys = new Set(['Dorpat', 'Pernau']);
    expect(parsePlacePeriods('Dorpat: –1699\nPernau: 1699–1710', keys)).toHaveProperty('periods');
    expect(parsePlacePeriods('Dorpat: –1699\nTartu: 1699–', keys))
      .toEqual({ errorLine: 2, reason: 'unknown_place', value: 'Tartu' });
  });
});
