import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiGet, apiPost } from '../apiClient';

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
