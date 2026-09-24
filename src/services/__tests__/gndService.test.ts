/** @vitest-environment jsdom */
// jsdom vajalik: searchGndSru varutee kasutab brauseri DOMParser-it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchGnd } from '../gndService';

interface MockResponse {
  ok: boolean;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

function mockFetch(lobid: MockResponse, sru: MockResponse) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('lobid.org')) return lobid;
    if (url.includes('services.dnb.de')) return sru;
    throw new Error(`ootamatu URL testis: ${url}`);
  });
}

describe('searchGnd — throwOnError (fix round 1: kukkunud allikas ei tohi vaikselt kaduda)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vaikimisi (opts puudub) neelab tõrke mõlemalt backendilt ja tagastab tühja loendi', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false }, { ok: false }));
    await expect(searchGnd('Luden')).resolves.toEqual([]);
  });

  it('throwOnError: mõlemad backendid nurjuvad → viskab tõrke edasi', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false }, { ok: false }));
    await expect(searchGnd('Luden', { throwOnError: true })).rejects.toThrow();
  });

  it('throwOnError: lobid nurjub, aga SRU vastab (isegi tühjalt) → tagastab, ei viska', async () => {
    vi.stubGlobal('fetch', mockFetch(
      { ok: false },
      { ok: true, text: async () => '<results></results>' },
    ));
    await expect(searchGnd('Luden', { throwOnError: true })).resolves.toEqual([]);
  });
});
