/** @vitest-environment jsdom */
/**
 * Raportöör ei tohi ISE vigu tekitada (#133).
 *
 * Kui vearaport viskaks või tulistaks, tekitaks veateade uue veateate ja
 * kasutaja näeks silmust selle asemel, mida ta tegema tuli.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

async function freshReporter() {
  vi.resetModules();
  return import('../clientErrorReporter');
}

function mockFetch() {
  // Argumendid PEAVAD olema tüübis: ilma nendeta on `mock.calls` tüüp `[]` ja
  // `calls[0][1]` ei kompileeru (CI püüdis, `build` mitte).
  const fn = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve({ ok: true } as Response));
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('clientErrorReporter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('saadab vea serverisse', async () => {
    const fetchMock = mockFetch();
    const { reportClientError } = await freshReporter();

    reportClientError({ message: 'katki', stack: 'fe@x.js:1', source: 'boundary' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/client-error');
    const body = JSON.parse(init!.body as string);
    expect(body.message).toBe('katki');
    expect(body.source).toBe('boundary');
    // `keepalive`: viga võib tabada vahetult enne lehelt lahkumist.
    expect(init!.keepalive).toBe(true);
  });

  it('ei saada sama viga korduvalt aknas', async () => {
    const fetchMock = mockFetch();
    const { reportClientError } = await freshReporter();

    for (let i = 0; i < 5; i++) {
      reportClientError({ message: 'sama', source: 'window' });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('erinevad vead lähevad eraldi', async () => {
    const fetchMock = mockFetch();
    const { reportClientError } = await freshReporter();

    reportClientError({ message: 'a', source: 'window' });
    reportClientError({ message: 'b', source: 'window' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('lehesessiooni lagi hoiab tsükli kinni', async () => {
    const fetchMock = mockFetch();
    const { reportClientError } = await freshReporter();

    // Katkine render-tsükkel annab lõputult ERINEVAID teateid — dedupe ei
    // aitaks, lagi aitab.
    for (let i = 0; i < 50; i++) {
      reportClientError({ message: `viga ${i}`, source: 'boundary' });
    }

    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(10);
  });

  it('tühja teadet ei saadeta', async () => {
    const fetchMock = mockFetch();
    const { reportClientError } = await freshReporter();

    reportClientError({ message: '', source: 'window' });
    reportClientError({ message: '   ', source: 'window' });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetch-i tõrge ei vise kutsujale', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('võrk maas'))));
    const { reportClientError } = await freshReporter();

    expect(() => reportClientError({ message: 'x', source: 'window' })).not.toThrow();
  });

  it('puuduv fetch ei vise kutsujale', async () => {
    // Vana brauser või testikeskkond ilma fetch-ita: raportöör peab vaikima.
    vi.stubGlobal('fetch', undefined);
    const { reportClientError } = await freshReporter();

    expect(() => reportClientError({ message: 'x', source: 'window' })).not.toThrow();
  });

  it('globaalsed kuulajad raporteerivad', async () => {
    const fetchMock = mockFetch();
    const { installGlobalErrorReporting } = await freshReporter();
    installGlobalErrorReporting();

    window.dispatchEvent(new ErrorEvent('error', {
      message: 'globaalne viga',
      error: new Error('globaalne viga'),
    }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.source).toBe('window');
  });
});
