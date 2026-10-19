import { describe, expect, it } from 'vitest';
import { abstractSnippet, formatLetterDating, letterHeadline, letterPageExcerpts, splitMarks } from '../letterDisplay';
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

describe('abstractSnippet', () => {
  it('vaste regestis → regesti katke; muidu null', () => {
    expect(abstractSnippet(hit({ _formatted: { abstract: 'x <mark>y</mark>' } }))).toBe('x <mark>y</mark>');
    expect(abstractSnippet(hit({ _formatted: { abstract: 'x y' } }))).toBeNull();
  });
});

/** Kiri lehtedest nagu `build_letter_documents`: '\n'-iga liidetud, alguskohad UTF-8 baitides. */
const letter = (pageTexts: [number, string][], words: string[]) => {
  const enc = new TextEncoder();
  let text = '';
  const pages = pageTexts.map(([n, t]) => {
    const start = enc.encode(text).length + (text ? 1 : 0);
    if (t) text = text ? `${text}\n${t}` : t;
    return { n, img: `a-${n}.jpg`, start };
  });
  const bytes = enc.encode(text);
  const positions = words.flatMap(w => {
    const wb = enc.encode(w);
    const out: { start: number; length: number }[] = [];
    for (let i = 0; i + wb.length <= bytes.length; i++) {
      if (wb.every((x, j) => bytes[i + j] === x)) out.push({ start: i, length: wb.length });
    }
    return out;
  });
  return hit({ letter_text: text, pages, _matchesPosition: { letter_text: positions } });
};

describe('letterPageExcerpts', () => {
  it('leht leitakse BAITIDE järgi: täpitähed enne vastet ei nihuta lehte', () => {
    const h = letter([[6, 'Größe ſo ääääää'], [7, 'Die Messe in Leipzig']], ['Messe']);
    expect(letterPageExcerpts(h)).toEqual({
      excerpts: [{ page: 7, text: 'Die <mark>Messe</mark> in Leipzig' }], hitPages: [7],
    });
  });

  it('üks katke lehe kohta, kõik vasted aknas märgitud; tühi leht ei saa vastet', () => {
    const h = letter([[6, 'messe eins messe zwei'], [7, ''], [8, 'drei messe']], ['messe']);
    const r = letterPageExcerpts(h);
    expect(r.hitPages).toEqual([6, 8]);
    expect(r.excerpts).toEqual([
      { page: 6, text: '<mark>messe</mark> eins <mark>messe</mark> zwei' },
      { page: 8, text: 'drei <mark>messe</mark>' },
    ]);
  });

  it('katke ei ulatu üle lehe piiri ja lõigatakse sõnapiirilt', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    const h = letter([[6, `${long} Messe ${long}`], [7, 'järgmine leht']], ['Messe']);
    const [x] = letterPageExcerpts(h).excerpts;
    expect(x.text.startsWith('…w')).toBe(true);
    expect(x.text.endsWith('…')).toBe(true);
    expect(x.text).not.toContain('järgmine');
    expect(x.text).toMatch(/ <mark>Messe<\/mark> /);
  });

  it('kuni kolm katket, esiletõst kõigil tabatud lehtedel', () => {
    const h = letter([[1, 'a x'], [2, 'b x'], [3, 'c x'], [4, 'd x']], ['x']);
    const r = letterPageExcerpts(h);
    expect(r.excerpts.map(e => e.page)).toEqual([1, 2, 3]);
    expect(r.hitPages).toEqual([1, 2, 3, 4]);
  });

  it('lehtedeta indeks (enne taasehitust): katke sildita, lehte ei oletata', () => {
    const h = { ...letter([[6, 'eine Messe']], ['Messe']), pages: undefined };
    expect(letterPageExcerpts(h)).toEqual({ excerpts: [{ page: null, text: 'eine <mark>Messe</mark>' }], hitPages: [] });
  });

  it('vasteta (nimi, regest) → tühi', () => {
    expect(letterPageExcerpts(letter([[6, 'tekst']], []))).toEqual({ excerpts: [], hitPages: [] });
  });
});

describe('splitMarks', () => {
  it('tükeldab ilma HTML-ita', () => {
    expect(splitMarks('a <mark>b</mark> <i>c</i>')).toEqual([
      { text: 'a ', mark: false }, { text: 'b', mark: true }, { text: ' <i>c</i>', mark: false },
    ]);
  });
});
