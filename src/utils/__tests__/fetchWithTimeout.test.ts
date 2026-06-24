import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { fetchWithTimeout, getAuthHeaders } from '../fetchWithTimeout';

describe('getAuthHeaders', () => {
  it('tagastab tühi objekt kui token puudub', () => {
    expect(getAuthHeaders(null)).toEqual({});
    expect(getAuthHeaders(undefined)).toEqual({});
    expect(getAuthHeaders('')).toEqual({});
  });

  it('tagastab Bearer headeri kehtiva tokeniga', () => {
    expect(getAuthHeaders('abc123')).toEqual({ Authorization: 'Bearer abc123' });
  });
});

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('edastab päringu fetch-ile ja tagastab vastuse', async () => {
    const mockResponse = { ok: true } as Response;
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await fetchWithTimeout('http://example.com');
    expect(result).toBe(mockResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0];
    expect(input).toBe('http://example.com');
    // fetch peab saama AbortSignal-iga init-i
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('kasutab vaike-timeout 10000ms kui timeout puudub', async () => {
    const fetchSpy = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchSpy);

    fetchWithTimeout('http://example.com');
    const signal = fetchSpy.mock.calls[0][1].signal;

    // 9999ms — veel ei katkesta
    vi.advanceTimersByTime(9999);
    expect(signal.aborted).toBe(false);
    // 2ms juurde → üle 10000ms → katkestab
    vi.advanceTimersByTime(2);
    expect(signal.aborted).toBe(true);
  });

  it('katkestab pärast kohandatud timeout-i', async () => {
    const fetchSpy = vi.fn().mockReturnValue(new Promise(() => {})); // ei lahene kunagi
    vi.stubGlobal('fetch', fetchSpy);

    fetchWithTimeout('http://example.com', { timeout: 5000 });
    const signal = fetchSpy.mock.calls[0][1].signal;

    vi.advanceTimersByTime(4999);
    expect(signal.aborted).toBe(false);
    vi.advanceTimersByTime(2);
    expect(signal.aborted).toBe(true);
  });

  it('eemaldab timeout-i pärast edukat vastust (abort ei toimu)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await fetchWithTimeout('http://example.com', { timeout: 1000 });
    const signal = fetchSpy.mock.calls[0][1].signal;

    // Pärast edukat lahenumist ei tohi timeout enam abortida (.finally → clearTimeout)
    vi.advanceTimersByTime(5000);
    expect(signal.aborted).toBe(false);
  });

  it('edastab välise signal-i aborti kontrollerile', async () => {
    const external = new AbortController();
    const fetchSpy = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal('fetch', fetchSpy);

    fetchWithTimeout('http://example.com', { signal: external.signal, timeout: 99999 });
    const passedSignal = fetchSpy.mock.calls[0][1].signal;

    expect(passedSignal.aborted).toBe(false);
    external.abort();
    expect(passedSignal.aborted).toBe(true);
  });

  it('edastab init headers/body/method fetch-ile (ilma signal-ita väljadeta)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await fetchWithTimeout('http://example.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
    });
    const init = fetchSpy.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(init.body).toBe('{"a":1}');
    // signal lisati, timeout eemaldati fetchInit-st
    expect(init.timeout).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
