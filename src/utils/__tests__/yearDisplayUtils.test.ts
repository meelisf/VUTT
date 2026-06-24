import { describe, it, expect } from 'vitest';
import type { TFunction } from 'i18next';
import { parseYearDisplayRange, formatYearDisplay, deriveYearFields } from '../yearDisplayUtils';

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


describe('deriveYearFields', () => {
  // --- Reegel 1: tühi ---
  it('tühi sisend → year=0, tühi kuva', () => {
    expect(deriveYearFields('')).toEqual({ year: 0, year_display: '' });
    expect(deriveYearFields('   ')).toEqual({ year: 0, year_display: '' });
  });

  // --- Reegel 2: puhas 3–4-kohaline number ---
  it('puhas 4-kohaline aasta → number, kuva tühi', () => {
    expect(deriveYearFields('1680')).toEqual({ year: 1680, year_display: '' });
  });
  it('puhas 3-kohaline aasta → number', () => {
    expect(deriveYearFields('800')).toEqual({ year: 800, year_display: '' });
  });
  it('tühikutega ümbritsetud number → trimmitakse', () => {
    expect(deriveYearFields('  1680  ')).toEqual({ year: 1680, year_display: '' });
  });
  it('reegel 2 servajuht: 1–2-kohaline EI ole puhas aasta (langeb reeglile 3/5)', () => {
    // "80" ei klapi PURE_YEAR_RE-ga (nõuab 3–4) ega parsi (\d{4} ei taba)
    expect(deriveYearFields('80')).toEqual({ year: 0, year_display: '80' });
    expect(deriveYearFields('0')).toEqual({ year: 0, year_display: '0' });
  });

  // --- Reegel 3: parsib kuvastringist → keskpaik ---
  it('ca. → keskpaik, kuva alles', () => {
    expect(deriveYearFields('ca. 1680')).toEqual({ year: 1680, year_display: 'ca. 1680' });
  });
  it('vahemik → keskpaik', () => {
    // (1670+1690)>>1 = 1680
    expect(deriveYearFields('1670–1690')).toEqual({ year: 1680, year_display: '1670–1690' });
  });
  it('sajand → keskpaik (sama mis 1601–1700)', () => {
    // (1601+1700)>>1 = 1650
    expect(deriveYearFields('17. saj')).toEqual({ year: 1650, year_display: '17. saj' });
  });
  it('sajandi vahemik → keskpaik', () => {
    // (1601+1900)>>1 = 1750
    expect(deriveYearFields('17.-19. saj')).toEqual({ year: 1750, year_display: '17.-19. saj' });
  });
  it('üksik aasta tekstis → keskpaik (kasutab 4-kohalist)', () => {
    expect(deriveYearFields('trükitud 1680')).toEqual({ year: 1680, year_display: 'trükitud 1680' });
  });

  // --- Reegel 4: ei parsi + muutmata existing → säilita ---
  it('ei parsi + muutmata kuva + olemasolev year → säilitab year (vaikse rikkumise kaitse)', () => {
    const existing = { year: 1650, year_display: 'XVII saj' };
    expect(deriveYearFields('XVII saj', existing)).toEqual({ year: 1650, year_display: 'XVII saj' });
  });
  it('reegel 4 eeldab existing.year > 0 (0 ei loe säilitatavaks)', () => {
    expect(deriveYearFields('XVII saj', { year: 0, year_display: 'XVII saj' })).toEqual({ year: 0, year_display: 'XVII saj' });
  });
  it('reegel 4 eiratab tühimike erinevust (trimmitud vördlus)', () => {
    const existing = { year: 1650, year_display: '  XVII saj  ' };
    expect(deriveYearFields('XVII saj', existing)).toEqual({ year: 1650, year_display: 'XVII saj' });
  });

  // --- Reegel 5: ei parsi + muudetud/uus → year=0 ---
  it('ei parsi + muudetud kuva (existing.year_display erineb) → year=0', () => {
    const existing = { year: 1650, year_display: 'XVII saj' };
    // Kasutaja muutis kuva: "XVIII saj" — ei klapi existing-iga → tuletatakse
    expect(deriveYearFields('XVIII saj', existing)).toEqual({ year: 0, year_display: 'XVIII saj' });
  });
  it('ei parsi + uus väärtus ilma existing-ita → year=0', () => {
    // Rooman numbrid / tekst ilma 4-kohalise aastata ja ilma sajandimustrita
    expect(deriveYearFields('XVII saj')).toEqual({ year: 0, year_display: 'XVII saj' });
    expect(deriveYearFields('s.a.')).toEqual({ year: 0, year_display: 's.a.' });
    expect(deriveYearFields('sajand XIV')).toEqual({ year: 0, year_display: 'sajand XIV' });
  });
  it('NB: tekstis peituv 4-kohaline aasta parsitakse (reegel 3)', () => {
    // "post 1700" ja "enne 1650" sisaldavad 4-kohalist aastat → ekstraheeritakse
    expect(deriveYearFields('post 1700')).toEqual({ year: 1700, year_display: 'post 1700' });
    expect(deriveYearFields('enne 1650')).toEqual({ year: 1650, year_display: 'enne 1650' });
  });
  it('null/undefined raw → tühi (ei viska)', () => {
    expect(deriveYearFields(null as unknown as string)).toEqual({ year: 0, year_display: '' });
    expect(deriveYearFields(undefined as unknown as string)).toEqual({ year: 0, year_display: '' });
  });
});
