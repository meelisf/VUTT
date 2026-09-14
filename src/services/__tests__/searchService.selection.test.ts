import { describe, it, expect, vi, beforeAll } from 'vitest';

// `checkMixedContent` loeb `window.location.protocol`-i; testikeskkond on node.
beforeAll(() => {
  vi.stubGlobal('window', { location: { protocol: 'http:' } });
});
import {
  searchWorks, searchContent, getGenreFacets, getTypeFacets,
  getTeoseTagsFacets, getAuthorFacets,
} from '../searchService';
import type { Index } from 'meilisearch';

const fakeIndex = (response: Record<string, unknown> = {}) => {
  const search = vi.fn().mockResolvedValue({ hits: [], facetDistribution: {}, ...response });
  return { index: { search, uid: 'teosed' } as unknown as Index, search };
};

const WS = { selection: { kind: 'work_set' as const, id: 'ws_1' }, workSetIds: ['a', 'b'] };

const filterOf = (search: ReturnType<typeof vi.fn>): string[] =>
  (search.mock.calls[0][1] as { filter: string[] }).filter;

describe('valik otsingufiltris (#354)', () => {
  it('töökollektsiooni otsing kasutab work_id filtrit, mitte kollektsioonifiltrit', async () => {
    const { index, search } = fakeIndex();
    await searchWorks(index, 'orati', { collection: WS });
    const filter = filterOf(search);
    expect(filter).toContain('work_id IN ["a", "b"]');
    expect(filter.join(' ')).not.toContain('collections_hierarchy');
  });

  it('püsikogu filtreerib endiselt hierarhia järgi (tagasiühilduv string)', async () => {
    const { index, search } = fakeIndex();
    await searchWorks(index, '', { collection: 'academia-gustaviana' });
    expect(filterOf(search)).toContain('collections_hierarchy = "academia-gustaviana"');
  });

  it('teoste koguarv tuleb totalHits-ist, mitte estimatedTotalHits-ist', async () => {
    const { index } = fakeIndex({ totalHits: 7, estimatedTotalHits: 53 });
    const r = await searchWorks(index, '', { collection: WS });
    expect(r.totalHits).toBe(7);
  });

  it('tühi kogu annab null tulemust, mitte kogu korpust', async () => {
    const { index, search } = fakeIndex();
    await searchWorks(index, '', {
      collection: { selection: { kind: 'work_set', id: 'ws_1' }, workSetIds: [] },
    });
    expect(filterOf(search)).toContain('work_id IN []');
  });

  it('laadimata ID-loend VISKAB, ei tee piiramata päringut', async () => {
    const { index, search } = fakeIndex();
    await expect(searchWorks(index, '', {
      collection: { selection: { kind: 'work_set', id: 'ws_1' }, workSetIds: null },
    })).rejects.toThrow();
    expect(search).not.toHaveBeenCalled();
  });

  it('täistekstiotsing järgib valikut', async () => {
    const { index, search } = fakeIndex({ hits: [] });
    await searchContent(index, 'orati', 1, { collection: WS });
    const filter = filterOf(search);
    expect(filter).toContain('work_id IN ["a", "b"]');
    expect(filter.join(' ')).not.toContain('collections_hierarchy');
  });

  it('teose piires otsides valik ei rakendu (teos on juba piiratud)', async () => {
    const { index, search } = fakeIndex({ hits: [] });
    await searchContent(index, 'orati', 1, { collection: WS, workId: 'x9' });
    const filter = filterOf(search);
    expect(filter).toContain('work_id = "x9"');
    expect(filter.join(' ')).not.toContain('work_id IN');
  });

  it.each([
    ['getGenreFacets', getGenreFacets],
    ['getTypeFacets', getTypeFacets],
    ['getTeoseTagsFacets', getTeoseTagsFacets],
  ])('%s järgib valikut — muidu näitaks facet kogu korpuse arve', async (_nimi, fn) => {
    const { index, search } = fakeIndex();
    await (fn as (i: Index, c: unknown) => Promise<unknown>)(index, WS);
    expect(filterOf(search)).toContain('work_id IN ["a", "b"]');
  });

  it('getAuthorFacets järgib valikut', async () => {
    const { index, search } = fakeIndex();
    await getAuthorFacets(index, WS);
    expect(filterOf(search)).toContain('work_id IN ["a", "b"]');
  });
});
