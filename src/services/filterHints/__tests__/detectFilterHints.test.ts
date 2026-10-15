import { describe, it, expect } from 'vitest';
import { detectFilterHints, VocabEntry } from '../detectFilterHints';

const vocab: VocabEntry[] = [
  { kind: 'genre', id: 'Q3497659', labels: { et: 'põhikiri', en: 'statutes' }, facetCount: 7 },
  { kind: 'genre', id: 'Q1123131', labels: { et: 'disputatsioon', en: 'disputation' }, facetCount: 900 },
  { kind: 'genre', id: 'Q856713', labels: { et: 'kirikulaul', en: 'Christian hymn' }, facetCount: 5 },
  { kind: 'type', id: 'Q87167', labels: { et: 'käsikiri', en: 'manuscript' }, facetCount: 300 },
  { kind: 'tag', id: 'Q2534157', labels: { et: 'loengukataloog', en: 'course catalog' }, facetCount: 18 },
];

const ids = (q: string, lang: 'et' | 'en' = 'et') => detectFilterHints(q, vocab, lang).map(c => `${c.kind}:${c.value}`);

describe('detectFilterHints', () => {
  it('sildi sõna algus, tõstu- ja diakriitikutundetu', () => {
    expect(ids('põhiki')).toEqual(['genre:Q3497659']);
    expect(ids('pohiki')).toEqual(['genre:Q3497659']);
    expect(ids('PÕHIKI')).toEqual(['genre:Q3497659']);
  });

  it('ingliskeelne silt sobitub ja kuvasilt tuleb UI keeles', () => {
    const [c] = detectFilterHints('statut', vocab, 'et');
    expect(c.value).toBe('Q3497659');
    expect(c.label).toBe('Põhikiri');
    expect(detectFilterHints('statut', vocab, 'en')[0].label).toBe('Statutes');
  });

  it('aasta + ülejäänud tekst', () => {
    const r = detectFilterHints('1702 constitu', vocab, 'et');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: 'year', value: '1702', label: '1702', matched: [0, 0], remainingQuery: 'constitu' });
  });

  it('aasta väljaspool vahemikku ei ole vihje', () => {
    expect(ids('1350')).toEqual([]);
    expect(ids('2026')).toEqual([]);
    expect(ids('17020')).toEqual([]);
  });

  it('alla 4 tähe ei sobitu', () => {
    expect(ids('põh')).toEqual([]);
    expect(ids('kir')).toEqual([]);
  });

  it('sõna keskelt ei sobitu: kiri → kirikulaul (algus), mitte põhikiri (keskel)', () => {
    expect(ids('kiri')).toEqual(['genre:Q856713']);
  });

  it('mitmesõnaline silt: täissõnad + poolik viimane', () => {
    const r = detectFilterHints('christian hym', vocab, 'en');
    expect(r[0]).toMatchObject({ kind: 'genre', value: 'Q856713', matched: [0, 1], matchedTokens: 2, remainingQuery: '' });
  });

  it('üksik teine sõna mitmesõnalisest sildist sobitub', () => {
    expect(ids('hymn', 'en')).toEqual(['genre:Q856713']);
  });

  it('jutumärgiga sõna ei tõlgendata filtrina', () => {
    expect(ids('"põhikiri"')).toEqual([]);
    expect(ids('"oratio põhiki"')).toEqual([]);
  });

  it('remainingQuery normaliseerib tühikud', () => {
    const r = detectFilterHints('  Ludenius   loengukat  1690 ', vocab, 'et');
    const tag = r.find(c => c.kind === 'tag')!;
    expect(tag.remainingQuery).toBe('Ludenius 1690');
    const year = r.find(c => c.kind === 'year')!;
    expect(year.remainingQuery).toBe('Ludenius loengukat');
  });

  it('eeljärjestus: pikem sobitus, siis fassetiloendur', () => {
    const v: VocabEntry[] = [
      { kind: 'tag', id: 'Qa', labels: { et: 'disputatio' }, facetCount: 1 },
      { kind: 'genre', id: 'Qb', labels: { et: 'disputatsioon' }, facetCount: 900 },
    ];
    expect(detectFilterHints('disput', v, 'et').map(c => c.value)).toEqual(['Qb', 'Qa']);
  });

  it('sama kood mitme sildi kaudu tuleb üks kord (pikim sobitus)', () => {
    const v: VocabEntry[] = [{ kind: 'genre', id: 'Qx', labels: { et: 'loengu kataloog', en: 'loengu' } }];
    const r = detectFilterHints('loengu kata', v, 'et');
    expect(r).toHaveLength(1);
    expect(r[0].matchedTokens).toBe(2);
  });

  it('terms (sünonüümid) sobituvad nagu sildid', () => {
    const v: VocabEntry[] = [{ kind: 'genre', id: 'Q3497659', labels: { et: 'põhikiri' }, terms: ['constitutiones'] }];
    expect(detectFilterHints('constitu', v, 'et').map(c => c.value)).toEqual(['Q3497659']);
  });

  it('tühi päring → tühi tulemus', () => {
    expect(ids('')).toEqual([]);
    expect(ids('   ')).toEqual([]);
  });
});
