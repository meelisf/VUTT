import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/wikidataService', () => ({
  // Kiirotsing toob ka Q9, mida täistekstiotsing ei tunne — kontrollib, et
  // järjekord tuleneb täistekstist (I4), mitte lihtsalt Promise.allSettled-i järjekorrast.
  searchWikidata: vi.fn(async () => [{ id: 'Q9', label: 'Kiirotsingu-ainus', url: '' }, { id: 'Q1', label: 'Lorenz Luden', url: '' }]),
  searchWikidataPersonsFulltext: vi.fn(async () => [
    { id: 'Q1', label: 'Lorenz Luden', url: '' }, { id: 'Q7', label: 'Johann Luden', url: '' }]),
}));
vi.mock('../../../services/gndService', () => ({
  searchGnd: vi.fn(async () => { throw new Error('lobid maas'); }),
}));
vi.mock('../../../services/viafService', () => ({
  searchViaf: vi.fn(async () => [{ id: 'VIAF:3', viafId: '3', label: 'Luden, Lorenz', url: '' }]),
}));

import { searchPersonSources } from '../searchSources';

describe('searchPersonSources', () => {
  beforeEach(() => vi.clearAllMocks());
  it('ühendab Wikidata kaks otsingut kordusteta, täistekst (isik-ainult) ees; märgib kukkunud allika', async () => {
    const r = await searchPersonSources('Luden', 'et');
    expect(r.refs.map(x => `${x.scheme}:${x.id}`)).toEqual(['wikidata:Q1', 'wikidata:Q7', 'wikidata:Q9', 'viaf:3']);
    expect(r.failed).toEqual(['gnd']);
  });

  it('focusRef, mida tulemustes pole, lisatakse esimeseks ja kogusumma jääb ≤ 15', async () => {
    const r = await searchPersonSources('Luden', 'et', { scheme: 'gnd', id: '999' });
    expect(r.refs[0]).toEqual({ scheme: 'gnd', id: '999', label: '999' });
    expect(r.refs.length).toBeLessThanOrEqual(15);
  });

  it('focusRef, mis juba tulemustes on (normaliseeritult), ei duplitseeru ega tõste ennast ette', async () => {
    const r = await searchPersonSources('Luden', 'et', { scheme: 'viaf', id: 'viaf:3' });
    expect(r.refs.filter(x => x.scheme === 'viaf' && x.id === '3')).toHaveLength(1);
    expect(r.refs[0].scheme).not.toBe('viaf');
  });
});
