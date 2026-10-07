import { describe, expect, it, vi } from 'vitest';
import type { Index } from 'meilisearch';
import { buildLetterFilter, emptyLetterFilters, searchLetters } from '../letterSearch';

describe('buildLetterFilter', () => {
  it('kogu piirang on alati kaasas', () => {
    expect(buildLetterFilter(emptyLetterFilters(), 'kirjad-rara'))
      .toEqual(['collections_hierarchy = "kirjad-rara"']);
  });

  it('töökollektsioon: laadimata ID-loend VISKAB (ADR 0042)', () => {
    const scope = { selection: { kind: 'work_set' as const, id: 's1' }, workSetIds: null };
    expect(() => buildLetterFilter(emptyLetterFilters(), scope)).toThrow();
  });

  it('töökollektsioon: work_id IN', () => {
    const scope = { selection: { kind: 'work_set' as const, id: 's1' }, workSetIds: ['w1'] };
    expect(buildLetterFilter(emptyLetterFilters(), scope)).toEqual(['work_id IN ["w1"]']);
  });

  it('aastavahemik on kattuvusfilter', () => {
    const f = { ...emptyLetterFilters(), yearStart: 1685, yearEnd: 1685 };
    expect(buildLetterFilter(f, undefined)).toEqual(['date_end >= 16850101', 'date_start <= 16851231']);
  });

  it('isikud ja kohad sildi järgi, jutumärk escape\'itud', () => {
    const f = {
      ...emptyLetterFilters(),
      authors: ['Spener', 'Ab "Cd"'],
      addressees: ['Fischer'],
      placeFrom: ['Frankfurt'],
      placeTo: ['Riga'],
      languages: ['deu'],
    };
    expect(buildLetterFilter(f, undefined)).toEqual([
      'authors IN ["Spener", "Ab \\"Cd\\""]',
      'addressees IN ["Fischer"]',
      'place_from IN ["Frankfurt"]',
      'place_to IN ["Riga"]',
      'languages IN ["deu"]',
    ]);
  });
});

describe('searchLetters', () => {
  it('ilma päringuta sorditakse kuupäeva järgi kasvavalt', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], totalHits: 0, totalPages: 0, facetDistribution: {} });
    await searchLetters({ search } as unknown as Index, '', emptyLetterFilters(), undefined, 1);
    expect(search.mock.calls[0][1].sort).toEqual(['date_sort:asc']);
  });

  it('päringuga ja asjakohasusega sorti ei anta', async () => {
    const search = vi.fn().mockResolvedValue({ hits: [], totalHits: 0, totalPages: 0, facetDistribution: {} });
    await searchLetters({ search } as unknown as Index, 'daß', emptyLetterFilters(), undefined, 2);
    const [q, params] = search.mock.calls[0];
    expect(q).toBe('dass');           // ß → ss nagu teosed-is
    expect(params.sort).toBeUndefined();
    expect(params.page).toBe(2);
  });
});
