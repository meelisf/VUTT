import { describe, expect, it } from 'vitest';
import { formatLetterDating, letterHeadline, letterSnippet, splitMarks } from '../letterDisplay';
import type { LetterHit } from '../../../../services/letterSearch';

const t = (key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ''}`;

const hit = (over: Partial<LetterHit> = {}): LetterHit => ({
  id: 'w__p', work_id: 'w', part_id: 'p', title: '', incipit: '', abstract: '',
  authors: [], addressees: [], place_from: '', place_to: '', first_page: 6, page_count: 1,
  work_title: 'Teos', ...over,
});

describe('formatLetterDating', () => {
  it('vahemik jääb vahemikuks, mitte alguskuupäevaks', () => {
    expect(formatLetterDating({ start: '1684', end: '1686' })).toBe('1684–1686');
  });
  it('allikakuju EI asenda kuupäeva (võib kanda toimetaja märkust, o17ekb)', () => {
    expect(formatLetterDating({ start: '1703-03-03', source_text: 'Moskva, 03.03.1703 (pildilt kinnitatud …)' }))
      .toBe('1703-03-03');
  });
  it('puudub → null', () => {
    expect(formatLetterDating(undefined)).toBeNull();
  });
});

describe('letterHeadline', () => {
  it('autor → adressaat · dateering · koht → koht', () => {
    expect(letterHeadline(hit({
      authors: ['Morgenstern'], addressees: ['Ellinger'], dating: { start: '1812-04-14' },
      place_from: 'Tartu', place_to: 'Riia',
    }), t)).toBe('Morgenstern → Ellinger · 1812-04-14 · Tartu → Riia');
  });
  it('osaliselt: ainult adressaat ja sihtkoht', () => {
    expect(letterHeadline(hit({ addressees: ['Fischer'], place_to: 'Sulzbach' }), t)).toBe('→ Fischer · → Sulzbach');
  });
  it('varukuva: title → incipit → leht; rida ei ole kunagi tühi', () => {
    expect(letterHeadline(hit({ title: 'Kiri X', incipit: 'Cum' }), t)).toBe('Kiri X');
    expect(letterHeadline(hit({ incipit: 'a'.repeat(100) }), t)).toBe(`${'a'.repeat(80)}…`);
    expect(letterHeadline(hit(), t)).toBe('letters.pageFallback{"page":6}');
  });
});

describe('letterSnippet', () => {
  it('tekstivaste → tekstikatke', () => {
    expect(letterSnippet(hit({ _formatted: { letter_text: '…a <mark>b</mark> c…' } }))).toBe('…a <mark>b</mark> c…');
  });
  it('vaste ainult kokkuvõttes → kokkuvõtte katke', () => {
    expect(letterSnippet(hit({ _formatted: { letter_text: '…a b…', abstract: 'x <mark>y</mark>' } }))).toBe('x <mark>y</mark>');
  });
  it('nimevaste (märgendit pole tekstis ega kokkuvõttes) → null', () => {
    expect(letterSnippet(hit({ _formatted: { letter_text: '…a b…', abstract: '' } }))).toBeNull();
  });
});

describe('splitMarks', () => {
  it('tükeldab ilma HTML-ita', () => {
    expect(splitMarks('a <mark>b</mark> <i>c</i>')).toEqual([
      { text: 'a ', mark: false }, { text: 'b', mark: true }, { text: ' <i>c</i>', mark: false },
    ]);
  });
});
