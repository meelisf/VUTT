import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiPost, setSessionExpiredHandler } from '../apiClient';

function jsonResponse(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('apiClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lisab FILE_API_URL prefiksi ja parsib JSON vastuse', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ status: 'success' }));

    const result = await apiGet<{ status: string }>('/health');

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/files/health');
  });

  it('saadab tokeni Authorization headeris ja JSON body POST päringul', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));

    await apiPost('/admin/example', { id: 'abc' }, { token: 'test-token' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    });
    expect(init?.body).toBe(JSON.stringify({ id: 'abc' }));
  });


  // --- 401 → sessiooni aegumine ---
  // Taust: backendi restart tapab sessioonid (auth.py hoiab neid MÄLUS).
  // UserContext küsis verify-token'it iga 5 min, seega kuni viis minutit
  // kukkusid kõik tegevused oma valdkonna-veateatega ("Salvestamine
  // ebaõnnestus"), mis viitas valele põhjusele.

  it('teatab sessiooni aegumisest, kui token oli kaasas ja server vastab 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(
      { status: 'error', message: 'Unauthorized' }, { status: 401 },
    ));
    const handler = vi.fn();
    setSessionExpiredHandler(handler);

    await expect(apiPost('/admin/upload/x/meta', { title: 'T' }, { token: 'surnud-token' }))
      .rejects.toBeInstanceOf(ApiError);

    expect(handler).toHaveBeenCalledOnce();
    setSessionExpiredHandler(null);
  });

  it('EI teata sessiooni aegumisest, kui tokenit ei olnud kaasas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(
      { status: 'error', message: 'Unauthorized' }, { status: 401 },
    ));
    const handler = vi.fn();
    setSessionExpiredHandler(handler);

    await expect(apiGet('/admin/midagi')).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
    setSessionExpiredHandler(null);
  });

  it('muud veakoodid ei puutu sessiooni', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(
      { status: 'error', message: 'Ligipääs puudub' }, { status: 403 },
    ));
    const handler = vi.fn();
    setSessionExpiredHandler(handler);

    await expect(apiGet('/admin/midagi', { token: 'kehtiv' })).rejects.toBeInstanceOf(ApiError);

    expect(handler).not.toHaveBeenCalled();
    setSessionExpiredHandler(null);
  });

  it('viskab ApiErrori HTTP vea korral ja säilitab status/data', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(
      { status: 'error', message: 'Ligipääs puudub' },
      { status: 403 },
    ));

    await expect(apiGet('/admin/secret')).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      message: 'Ligipääs puudub',
      data: { status: 'error', message: 'Ligipääs puudub' },
    } satisfies Partial<ApiError>);
  });
});
