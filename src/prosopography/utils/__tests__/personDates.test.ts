import { describe, it, expect } from 'vitest';
import { formatLifeDate, formatFloruit } from '../personDates';

const bounds = { before: 'enne', after: 'pärast' };
const fmt = (d: any) => formatLifeDate(d, bounds, 'et');

describe('formatLifeDate', () => {
  it('aasta-täpsusega kuupäev näidatakse ainult aastana', () => {
    expect(fmt({ date: '1616-01-01', precision: 'year' })).toBe('1616');
  });

  it('päeva-täpsus näitab ka kuud ja päeva', () => {
    const out = fmt({ date: '1616-06-29', precision: 'day' });
    expect(out).toContain('1616');
    expect(out).toContain('29');
    expect(out).not.toBe('1616');
  });

  it('kuu-täpsus näitab kuud, aga mitte päeva', () => {
    const out = fmt({ date: '1616-06-29', precision: 'month' });
    expect(out).toContain('1616');
    expect(out).not.toContain('29');
    expect(out).not.toBe('1616');
  });

  it('0000 tähendab „teadmata", mitte aastat null', () => {
    expect(fmt({ date: '0000-00-00', precision: 'day' })).toBe('');
  });

  it('tühi või puuduv kuupäev annab tühja stringi', () => {
    expect(fmt(null)).toBe('');
    expect(fmt({ date: null })).toBe('');
    expect(fmt({ date: '' })).toBe('');
  });

  it('sõnaline kuupäev näidatakse tervikuna, mitte lõigatud aastana', () => {
    // Andmetes on ~40 kirjet kujul "um 1677" / "nach 1686" — varem lõigati
    // neist `slice(0, 4)` ja ekraanile jõudis "um 1".
    expect(fmt({ date: 'um 1677', precision: 'year' })).toBe('um 1677');
    expect(fmt({ date: 'nach 1686', precision: 'year' })).toBe('nach 1686');
  });

  it('umbkaudsus ja piir jõuavad ette', () => {
    expect(fmt({ date: '1616-01-01', precision: 'year', is_circa: true })).toBe('~1616');
    expect(fmt({ date: '1616-01-01', precision: 'year', bound: 'before' })).toBe('enne 1616');
  });

  it('koht lisatakse lõppu', () => {
    expect(fmt({ date: '1616-01-01', precision: 'year', place: { label: 'Riga' } }))
      .toBe('1616, Riga');
  });
});

describe('formatFloruit', () => {
  it('mõlemad aastad', () => {
    expect(formatFloruit(1690, 1700)).toBe('1690–1700');
  });

  it('ainult algus või ainult lõpp', () => {
    expect(formatFloruit(1690, null)).toBe('1690–');
    expect(formatFloruit(null, 1700)).toBe('–1700');
  });

  it('kumbagi ei ole', () => {
    expect(formatFloruit(null, null)).toBe('');
    expect(formatFloruit(undefined, undefined)).toBe('');
  });
});
