import { describe, it, expect, vi, afterEach } from 'vitest';
import { adaLookup } from '../adaApi';

/**
 * `/admin/ada/lookup` nõuab admin-rolli (`require_role("admin")`) ja backend
 * loeb tokenit AINULT `Authorization: Bearer` päisest (`server/deps.py`, ilma
 * cookie-fallbackita). Kui `adaLookup` unustab tokeni edastada, saab iga
 * reaalne klõps 401 ja vorm ei täitu kunagi — seda tüüpi viga ei näe
 * `mergeAdaIntoForm`-i puhtad testid, seega testime siin otse fetch-päringut.
 */
function mockFetchOnce(body: unknown) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

const ADA_VASTUS = {
  status: 'success',
  ada: {
    handle: '10062/7822',
    item_uuid: 'uuid-1',
    meta: {
      title: '65 kirja Karl Morgensternile',
      year: '1812',
      year_display: '1812-1823',
      creators: [],
      languages: ['deu'],
      ester_id: null,
      archive_refs: [],
      external_url: null,
    },
    failid: [],
    kogu_baite: 0,
    vahele_jaetud: [],
  },
};

describe('adaLookup — autentimine', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saadab Authorization: Bearer <token> päise', async () => {
    const fetchSpy = mockFetchOnce(ADA_VASTUS);

    await adaLookup('10062/7822', 'salajane-token');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer salajane-token');
  });

  it('token puudub → ei saada Authorization päist (dokumenteerib eelduse)', async () => {
    const fetchSpy = mockFetchOnce(ADA_VASTUS);

    await adaLookup('10062/7822', null);

    const [, init] = fetchSpy.mock.calls[0] as [unknown, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
