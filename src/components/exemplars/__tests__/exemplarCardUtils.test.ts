import { describe, it, expect } from 'vitest';
import type { Exemplar } from '../../../types';
import { exceptionPages, formatPageNumbers, manuscriptRefLabel, orderExemplars } from '../exemplarCardUtils';

const ex = (id: string, extra: Partial<Exemplar> = {}): Exemplar => ({ id, holder: `H${id}`, ...extra });

describe('orderExemplars', () => {
  it('transkriptsiooni alus esimesena, teised salvestatud järjekorras', () => {
    const out = orderExemplars([ex('a'), ex('b'), ex('c', { text_witness: true }), ex('d')]);
    expect(out.map(x => x.id)).toEqual(['c', 'a', 'b', 'd']);
  });
  it('aluseta loend jääb samaks', () => {
    expect(orderExemplars([ex('a'), ex('b')]).map(x => x.id)).toEqual(['a', 'b']);
  });
});

describe('formatPageNumbers / exceptionPages', () => {
  it('järjestikused vahemikuks, kordused ja järjekord ühtlustatud', () => {
    expect(formatPageNumbers([7, 1, 2, 3, 3, 9, 10])).toBe('1–3, 7, 9–10');
    expect(formatPageNumbers([])).toBe('');
  });
  it('tüvi → lehenumber, tundmatu tüvi jäetakse vahele', () => {
    expect(exceptionPages(ex('a', { pages: ['0007', '0008', 'x'] }), { '0007': 7, '0008': 8 })).toBe('7–8');
    expect(exceptionPages(ex('a'), {})).toBe('');
  });
});

describe('manuscriptRefLabel', () => {
  const refs = [{ archive_id: 'Tartu RA', reference: 'EAA.995.1.12' }];
  it('käsikiri: hoidja + kohaviit', () => {
    expect(manuscriptRefLabel({ id: 'Q87167' }, refs)).toBe('Tartu RA EAA.995.1.12');
  });
  it('trükis või viiteta käsikiri → null', () => {
    expect(manuscriptRefLabel({ id: 'Q1261026' }, refs)).toBeNull();
    expect(manuscriptRefLabel({ id: 'Q87167' }, [])).toBeNull();
    expect(manuscriptRefLabel(null, refs)).toBeNull();
  });
  it('kohaviiteta: ainult hoidja', () => {
    expect(manuscriptRefLabel({ id: 'Q87167' }, [{ archive_id: 'Tartu RA', reference: '' }])).toBe('Tartu RA');
  });
});
