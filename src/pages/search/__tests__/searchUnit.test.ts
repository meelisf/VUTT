import { describe, expect, it } from 'vitest';
import { readLetterFilters, readUnit, switchUnitParams, writeLetterFilters } from '../searchUnit';
import { emptyLetterFilters } from '../../../services/letterSearch';

describe('switchUnitParams', () => {
  it('Täistekst → Kirjad: säilivad ainult q ja kogu, filtrid ja leht kaovad', () => {
    const prev = new URLSearchParams('q=orati&collection=rara&author=Luden&scope=annotation&ys=1680&genre=Q1&p=3');
    const next = switchUnitParams(prev, 'letters');
    expect(Object.fromEntries(next)).toEqual({ q: 'orati', collection: 'rara', unit: 'letters' });
  });

  it('Kirjad → Täistekst: kirjade filtrid kaovad, töökollektsioon jääb', () => {
    const prev = new URLSearchParams('q=x&set=s1&unit=letters&la=Spener&lys=1680&lsort=date_desc&p=2');
    const next = switchUnitParams(prev, 'text');
    expect(Object.fromEntries(next)).toEqual({ q: 'x', set: 's1' });
  });

  it('readUnit', () => {
    expect(readUnit(new URLSearchParams('unit=letters'))).toBe('letters');
    expect(readUnit(new URLSearchParams('unit=muu'))).toBe('text');
    expect(readUnit(new URLSearchParams(''))).toBe('text');
  });
});

describe('kirjade filtrid URL-is', () => {
  it('edasi-tagasi, koma nimes säilib (korduv parameeter, mitte komaloend)', () => {
    const f = { ...emptyLetterFilters(), authors: ['Spenerus, Philippus', 'Luden'], placeTo: ['Riga'],
      yearStart: 1680, yearEnd: 1690, sort: 'date_desc' as const };
    const params = new URLSearchParams('q=x');
    writeLetterFilters(params, f);
    expect(params.get('q')).toBe('x');
    expect(readLetterFilters(params)).toEqual(f);
  });

  it('vigane aasta ignoreeritakse, tundmatu sort → relevance', () => {
    const f = readLetterFilters(new URLSearchParams('lys=abc&lsort=xyz'));
    expect(f.yearStart).toBeUndefined();
    expect(f.sort).toBe('relevance');
  });
});
