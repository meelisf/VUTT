import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/wikidataService', () => ({
  searchWikidata: vi.fn(async () => [{ id: 'Q1', label: 'Lorenz Luden', url: '' }]),
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
  it('ühendab Wikidata kaks otsingut kordusteta, kiirotsing ees; märgib kukkunud allika', async () => {
    const r = await searchPersonSources('Luden', 'et');
    expect(r.refs.map(x => `${x.scheme}:${x.id}`)).toEqual(['wikidata:Q1', 'wikidata:Q7', 'viaf:3']);
    expect(r.failed).toEqual(['gnd']);
  });
});
