/**
 * Eluloo ja katke ahel (ADR 0039, spekk otsused 4 ja 6).
 *
 * AA-plokk on ahelast VÄLJAS kuvamisel, aga katke ahela LÕPUS: ilma selleta
 * kaotaks 308 kaarti nimekirjas katke ära.
 */
import { describe, expect, it } from 'vitest';
import { pickBiography, pickSnippet, snippetBadgeKey, type SnippetSource } from '../biographyChain';

const rec = (et?: string | null, en?: string | null) =>
  ({ biography_et: et ?? null, biography_en: en ?? null }) as any;

const entry = (o: Partial<Record<string, string>>) =>
  ({
    biography_snippet_et: '', biography_snippet_en: '',
    notes_snippet: '', aa_snippet: '', ...o,
  }) as any;

describe('pickBiography', () => {
  it('eelistab lugeja keelt ja ei märgi varuvarianti', () => {
    expect(pickBiography(rec('Eesti', 'English'), 'en'))
      .toEqual({ text: 'English', lang: 'en', isFallback: false });
    expect(pickBiography(rec('Eesti', 'English'), 'et'))
      .toEqual({ text: 'Eesti', lang: 'et', isFallback: false });
  });

  it('langeb teise keelde ja MÄRGIB selle', () => {
    expect(pickBiography(rec('Eesti', null), 'en'))
      .toEqual({ text: 'Eesti', lang: 'et', isFallback: true });
    expect(pickBiography(rec(null, 'English'), 'et'))
      .toEqual({ text: 'English', lang: 'en', isFallback: true });
  });

  it('tagastab null, kui kumbagi ei ole', () => {
    expect(pickBiography(rec(null, null), 'et')).toBeNull();
    expect(pickBiography(rec('   ', ''), 'et')).toBeNull();
  });

  it('EI kasuta AA-kirjet eluloo varuvariandina', () => {
    const person = { biography_et: null, biography_en: null, aa_raw: '154. AA' } as any;
    expect(pickBiography(person, 'et')).toBeNull();
  });
});

describe('pickSnippet', () => {
  it('eelistab lugeja keele katget', () => {
    const pick = pickSnippet(entry({ biography_snippet_et: 'Eesti', biography_snippet_en: 'Eng' }), 'en');
    expect(pick).toEqual({ text: 'Eng', source: 'biography_en', lang: 'en', isFallback: false });
  });

  it('ahel: teine keel → märkmed → AA', () => {
    expect(pickSnippet(entry({ biography_snippet_et: 'Eesti' }), 'en')?.source).toBe('biography_et');
    expect(pickSnippet(entry({ notes_snippet: 'Märkmed' }), 'en')?.source).toBe('notes');
    expect(pickSnippet(entry({ aa_snippet: '154. AA' }), 'en')?.source).toBe('aa_raw');
  });

  it('märkmete ja AA katke ei kanna keelt', () => {
    expect(pickSnippet(entry({ aa_snippet: '154. AA' }), 'et'))
      .toEqual({ text: '154. AA', source: 'aa_raw', lang: null, isFallback: true });
  });

  it('tagastab null, kui ühtki allikat ei ole', () => {
    expect(pickSnippet(entry({}), 'et')).toBeNull();
  });
});

describe('snippetBadgeKey', () => {
  it('oma keele katkel märget ei ole', () => {
    const pick = pickSnippet(entry({ biography_snippet_et: 'Eesti' }), 'et')!;
    expect(snippetBadgeKey(pick)).toBeNull();
  });

  it('teise keele katkel on keelemärge', () => {
    const pick = pickSnippet(entry({ biography_snippet_en: 'English' }), 'et')!;
    expect(snippetBadgeKey(pick)).toBe('snippetInEnglish');
  });

  it('märkmete ja AA katkel on oma märge, mitte keelemärge', () => {
    const notes = pickSnippet(entry({ notes_snippet: 'Märkmed' }), 'et')!;
    expect(snippetBadgeKey(notes)).toBe('snippetNotes');
    const aa = pickSnippet(entry({ aa_snippet: '154. AA' }), 'et')!;
    expect(snippetBadgeKey(aa)).toBe('snippetAaRecord');
  });

  it('kaardistus katab KÕIK allikad — uus allikas ei tohi vaikselt märketa jääda', () => {
    const allikad: SnippetSource[] = ['biography_et', 'biography_en', 'notes', 'aa_raw'];
    for (const source of allikad) {
      expect(snippetBadgeKey({ text: 'x', source, lang: null, isFallback: true }))
        .toEqual(expect.any(String));
    }
  });
});
