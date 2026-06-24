import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { parseYearDisplayRange, formatYearDisplay } from '../yearDisplayUtils';

describe('parseYearDisplayRange', () => {
  // Olemasolev käitumine (regressioonikaitse)
  it('täpne aasta', () => {
    expect(parseYearDisplayRange(1750, null)).toEqual({ start: 1750, end: 1750 });
  });
  it('ca. aasta → ±10', () => {
    expect(parseYearDisplayRange(1750, 'ca. 1750')).toEqual({ start: 1740, end: 1760 });
  });
  it('vahemik', () => {
    expect(parseYearDisplayRange(null, '1670–1690')).toEqual({ start: 1670, end: 1690 });
  });
  it('vahemik sidekriipsuga', () => {
    expect(parseYearDisplayRange(null, '1686-1696')).toEqual({ start: 1686, end: 1696 });
  });
  it('tühi → null', () => {
    expect(parseYearDisplayRange(null, null)).toBeNull();
    expect(parseYearDisplayRange(0, '')).toBeNull();
  });

  // Uus: sajand
  it('sajand "19. saj"', () => {
    expect(parseYearDisplayRange(null, '19. saj')).toEqual({ start: 1801, end: 1900 });
  });
  it('sajand "19. sajand"', () => {
    expect(parseYearDisplayRange(null, '19. sajand')).toEqual({ start: 1801, end: 1900 });
  });
  it('sajand punktita "19 saj"', () => {
    expect(parseYearDisplayRange(null, '19 saj')).toEqual({ start: 1801, end: 1900 });
  });
  it('sajand tühikutega ja suurtähega', () => {
    expect(parseYearDisplayRange(null, '  17. Saj  ')).toEqual({ start: 1601, end: 1700 });
  });
  it('1-kohaline sajand "9. saj"', () => {
    expect(parseYearDisplayRange(null, '9. saj')).toEqual({ start: 801, end: 900 });
  });
  it('sajand võidab numeric-fallbacki', () => {
    expect(parseYearDisplayRange(1850, '19. saj')).toEqual({ start: 1801, end: 1900 });
  });

  // Uus: sajandite vahemik (issue #31)
  it('sajandite vahemik "17.-19. saj"', () => {
    expect(parseYearDisplayRange(null, '17.-19. saj')).toEqual({ start: 1601, end: 1900 });
  });
  it('sajandite vahemik ilma punktita "17-19. saj"', () => {
    expect(parseYearDisplayRange(null, '17-19. saj')).toEqual({ start: 1601, end: 1900 });
  });
  it('sajandite vahemik tühikutega', () => {
    expect(parseYearDisplayRange(null, '17. - 19. saj')).toEqual({ start: 1601, end: 1900 });
  });
  it('tagurpidi sajandite vahemik normaliseeritakse', () => {
    expect(parseYearDisplayRange(null, '19.-17. saj')).toEqual({ start: 1601, end: 1900 });
  });
  it('sajandite vahemik võidab numeric-fallbacki', () => {
    expect(parseYearDisplayRange(1850, '17.-19. saj')).toEqual({ start: 1601, end: 1900 });
  });

  // Uus: tagurpidi aastavahemik normaliseeritakse (issue #31)
  it('tagurpidi vahemik normaliseeritakse', () => {
    expect(parseYearDisplayRange(null, '1690-1670')).toEqual({ start: 1670, end: 1690 });
  });
});

// Mock-t: tagastab võtme ja parameetrid kontrollitaval kujul
const tMock = ((key: string, opts?: Record<string, unknown>) =>
  `${key}|n=${opts?.n}|ord=${opts?.ord}`) as unknown as TFunction;

describe('formatYearDisplay', () => {
  it('sajand → tõlkevõti n ja ord parameetritega', () => {
    expect(formatYearDisplay('19. saj', null, tMock)).toBe('common:year.century|n=19|ord=19th');
  });
  it('ordinaalid: 21st, 2nd, 3rd, 11th', () => {
    expect(formatYearDisplay('21. saj', null, tMock)).toContain('ord=21st');
    expect(formatYearDisplay('2. saj', null, tMock)).toContain('ord=2nd');
    expect(formatYearDisplay('3. saj', null, tMock)).toContain('ord=3rd');
    expect(formatYearDisplay('11. saj', null, tMock)).toContain('ord=11th');
  });
  it('muu year_display kuvatakse toorelt', () => {
    expect(formatYearDisplay('ca. 1680', 1680, tMock)).toBe('ca. 1680');
    expect(formatYearDisplay('1670–1690', null, tMock)).toBe('1670–1690');
  });
  it('year_display puudub → year number', () => {
    expect(formatYearDisplay(null, 1750, tMock)).toBe('1750');
    expect(formatYearDisplay('', 1750, tMock)).toBe('1750');
  });
  it('kõik puudub → tühi string', () => {
    expect(formatYearDisplay(null, null, tMock)).toBe('');
    expect(formatYearDisplay(null, 0, tMock)).toBe('');
  });
});
