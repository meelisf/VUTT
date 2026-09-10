/**
 * Tõlketeenus: veatüüp tuleb SERVERI koodist ja masinloetavast prefiksist,
 * mitte sõnumi sisust (#292 muster: kaks keelt, üks reegel).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslateFailed, fetchSourceDiff, translateText } from '../prosopographyService';

const mockFetch = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

afterEach(() => vi.restoreAllMocks());

describe('translateText', () => {
  it('tagastab tõlke', async () => {
    mockFetch({ status: 'ok', text: 'English biography.' });
    await expect(translateText('Elulugu.', 'et', 'en', 'TOKEN'))
      .resolves.toBe('English biography.');
  });

  it('429 → kind rate_limited', async () => {
    mockFetch({ detail: 'Liiga palju' }, 429);
    await expect(translateText('Elulugu.', 'et', 'en', 'TOKEN'))
      .rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('content_blocked prefiks → kind blocked', async () => {
    mockFetch({ detail: 'content_blocked: Gemini sisufilter keeldus' }, 502);
    await expect(translateText('Elulugu.', 'et', 'en', 'TOKEN'))
      .rejects.toMatchObject({ kind: 'blocked' });
  });

  it('muu viga → kind other', async () => {
    mockFetch({ detail: 'Tõlkepäring ebaõnnestus' }, 502);
    const err = await translateText('Elulugu.', 'et', 'en', 'TOKEN').catch(e => e);
    expect(err).toBeInstanceOf(TranslateFailed);
    expect(err.kind).toBe('other');
  });
});

describe('fetchSourceDiff', () => {
  it('annab found:false ilma erandita', async () => {
    mockFetch({ found: false, commit: null, date: null, text: null });
    await expect(fetchSourceDiff('vutt:Pabc', 'biography_en', 'TOKEN'))
      .resolves.toMatchObject({ found: false });
  });

  it('kodeerib person_id URL-i', async () => {
    const spy = mockFetch({ found: false, commit: null, date: null, text: null });
    await fetchSourceDiff('vutt:Pabc', 'biography_en', 'TOKEN');
    expect(String(spy.mock.calls[0][0])).toContain('vutt%3APabc');
  });
});
