import { describe, it, expect, vi, beforeEach } from 'vitest';

// config.ts kasutab window.location.origin — mockime vältimaks node-env viga
vi.mock('../../config', () => ({ FILE_API_URL: '/api/files' }));

describe('entityLabelsService', () => {
  let getEntityLabelsCache: typeof import('../entityLabelsService').getEntityLabelsCache;

  beforeEach(async () => {
    // Module-level cache (cache + fetchPromise) peab testide vahel lähtestuma.
    vi.resetModules();
    vi.unstubAllGlobals();
    const mod = await import('../entityLabelsService');
    getEntityLabelsCache = mod.getEntityLabelsCache;
  });

  it('laeb andmed ühe fetch-iga', async () => {
    const data = { Q1: { et: 'A', en: 'A-en' }, Q2: { et: 'B' } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await getEntityLabelsCache();
    expect(result).toEqual(data);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/files/entity-labels');
  });

  it('cache-b: teine kord ei tee uut fetch-i', async () => {
    const data = { Q1: { et: 'A' } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
    vi.stubGlobal('fetch', fetchSpy);

    await getEntityLabelsCache();
    await getEntityLabelsCache();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('dedup-ib samaaegsed päringud (üks fetch)', async () => {
    const data = { Q1: { et: 'A' } };
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    });
    vi.stubGlobal('fetch', fetchSpy);

    const [r1, r2] = await Promise.all([
      getEntityLabelsCache(),
      getEntityLabelsCache(),
      getEntityLabelsCache(),
    ]);
    expect(r1).toEqual(data);
    expect(r2).toEqual(data);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // fetchPromise dedup
  });

  it('tagastab tühja objekti kui response pole ok', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getEntityLabelsCache()).toEqual({});
  });

  it('tagastab tühja objekti võrgu vea korral', async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error('network'));
    vi.stubGlobal('fetch', fetchSpy);

    expect(await getEntityLabelsCache()).toEqual({});
  });
});
