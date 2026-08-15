import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, UploadStalledError, uploadImagePage, uploadSingleFile } from '../uploadApi';

// XHR-i test-topelt. Päris XMLHttpRequest'i node-keskkonnas ei ole, ja meil on
// vaja kontrollida ka aja kulgu (progressi seiskumine), mida fetch ei võimalda.
class MockXHR {
  static instances: MockXHR[] = [];

  upload: { onprogress: ((e: ProgressEventLike) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  method = '';
  url = '';
  headers: Record<string, string> = {};
  body: unknown = null;
  aborted = false;
  status = 0;
  responseText = '';

  constructor() {
    MockXHR.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: unknown) {
    this.body = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  // --- testiabilised -------------------------------------------------------
  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total });
  }

  respond(status: number, text = '') {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

interface ProgressEventLike {
  lengthComputable: boolean;
  loaded: number;
  total: number;
}

function lastXHR(): MockXHR {
  return MockXHR.instances[MockXHR.instances.length - 1];
}

/** Annab mikrotaskidele võimaluse joosta, et XHR jõuaks luua enne kui testib. */
async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  MockXHR.instances = [];
  vi.stubGlobal('XMLHttpRequest', MockXHR);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('uploadApi failide üleslaadimine', () => {
  it('saadab faili POST-iga õigele URL-ile ja lahendub 200 korral', async () => {
    const promise = uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok');
    await flush();

    const xhr = lastXHR();
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toMatch(/\/admin\/upload\/upl1\/files$/);
    expect(xhr.headers).toMatchObject({
      'X-Filename': 'a.pdf',
      Authorization: 'Bearer tok',
    });

    xhr.respond(200, JSON.stringify({ status: 'ok' }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('viskab ApiErrori detailse message-ga serveri vea korral (Leid 1)', async () => {
    const promise = uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok');
    await flush();
    lastXHR().respond(500, JSON.stringify({ status: 'error', detail: 'SFTP ühendus aegus' }));

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 500,
      message: 'SFTP ühendus aegus',
    } satisfies Partial<ApiError>);
  });

  it('märgistab 413 (fail liiga suur) eraldi staatusena', async () => {
    const promise = uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok');
    await flush();
    lastXHR().respond(413, '');

    await expect(promise).rejects.toMatchObject({
      name: 'ApiError',
      status: 413,
    } satisfies Partial<ApiError>);
  });

  it('uploadImagePage edastab lehekülje päised õigesti', async () => {
    const promise = uploadImagePage('upl1', new File(['x'], 'p.jpg'), 2, 5, 'tok');
    await flush();

    const xhr = lastXHR();
    expect(xhr.headers).toMatchObject({
      'X-Filename': 'p.jpg',
      'X-Page-Number': '2',
      'X-Total-Pages': '5',
      Authorization: 'Bearer tok',
    });

    xhr.respond(200, '{}');
    await expect(promise).resolves.toBeUndefined();
  });

  it('raporteerib edenemist onProgress kaudu', async () => {
    const seen: Array<{ loaded: number; total: number }> = [];
    const promise = uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok', {
      onProgress: (p) => seen.push(p),
    });
    await flush();

    const xhr = lastXHR();
    xhr.emitProgress(500, 2000);
    xhr.emitProgress(1500, 2000);

    expect(seen).toEqual([
      { loaded: 500, total: 2000 },
      { loaded: 1500, total: 2000 },
    ]);

    xhr.respond(200, '{}');
    await promise;
  });

  // --- Regressioon: aeglane võrk (#upload 499) ------------------------------
  // Vana kood kasutas fetchWithTimeout'i 300 s KOGUpäringu-timeoutiga, mis
  // katkestas 160 MB faili 43 kB/s ühenduses alati 8 % pealt (nginx logis 499).
  it('EI katkesta üleslaadimist, mis kestab üle 20 minuti, kui edenemine liigub', async () => {
    vi.useFakeTimers();
    const promise = uploadSingleFile('upl1', new File(['x'], 'suur.pdf'), 'tok');
    await flush();
    const xhr = lastXHR();

    // 20 minutit aeglast, aga katkematut edenemist
    for (let minut = 1; minut <= 20; minut++) {
      await vi.advanceTimersByTimeAsync(60_000);
      xhr.emitProgress(minut * 2_600_000, 160_000_000);
    }

    expect(xhr.aborted).toBe(false);

    xhr.respond(202, JSON.stringify({ status: 'transferring' }));
    await expect(promise).resolves.toBeUndefined();
  });

  it('katkestab, kui edenemine seiskub kauemaks kui stallTimeout', async () => {
    vi.useFakeTimers();
    // Haagi käsitleja kohe: tagasilükkamine juhtub taimerite kerimise ajal
    const settled = uploadSingleFile('upl1', new File(['x'], 'suur.pdf'), 'tok', {
      stallTimeout: 120_000,
    }).catch((e) => e);
    await flush();
    const xhr = lastXHR();

    xhr.emitProgress(1_000_000, 160_000_000);
    await vi.advanceTimersByTimeAsync(119_000);
    expect(xhr.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(xhr.aborted).toBe(true);
    expect(await settled).toBeInstanceOf(UploadStalledError);
  });

  it('katkestab, kui keha on saadetud, aga server ei vasta responseTimeout jooksul', async () => {
    vi.useFakeTimers();
    const settled = uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok', {
      stallTimeout: 120_000,
      responseTimeout: 300_000,
    }).catch((e) => e);
    await flush();
    const xhr = lastXHR();

    // Keha täielikult saadetud → stall-taimer ei tohi enam tiksuda
    xhr.emitProgress(1000, 1000);
    await vi.advanceTimersByTimeAsync(200_000);
    expect(xhr.aborted).toBe(false);

    // ... aga vastuse ootamisel on oma lagi
    await vi.advanceTimersByTimeAsync(150_000);
    expect(xhr.aborted).toBe(true);
    expect(await settled).toBeInstanceOf(UploadStalledError);
  });

  it('viskab võrguvea korral ApiErrori, mitte ei jää rippuma', async () => {
    const promise = uploadSingleFile('upl1', new File(['x'], 'a.pdf'), 'tok');
    await flush();
    lastXHR().onerror?.();

    await expect(promise).rejects.toBeInstanceOf(ApiError);
  });
});
