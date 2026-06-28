import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, uploadImagePage, uploadSingleFile } from '../uploadApi';

function jsonRes(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('uploadApi failide üleslaadimine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('viskab ApiErrori detailse message-ga serveri vea korral (Leid 1)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes(
      { status: 'error', detail: 'SFTP ühendus aegus' },
      { status: 500 },
    ));

    await expect(uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok')).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'SFTP ühendus aegus',
    } satisfies Partial<ApiError>);
  });

  it('märgistab 413 (fail liiga suur) eraldi staatusena', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 413 }));

    await expect(uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok')).rejects.toMatchObject({
      name: 'ApiError',
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it('uploadImagePage edastab lehekülje päised õigesti', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonRes({ ok: true }));

    await uploadImagePage('upl1', new File(['x'], 'p.jpg'), 2, 5, 'tok');

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({
      'X-Filename': 'p.jpg',
      'X-Page-Number': '2',
      'X-Total-Pages': '5',
      Authorization: 'Bearer tok',
    });
  });
});
