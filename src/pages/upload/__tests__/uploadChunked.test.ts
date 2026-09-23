import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../services/apiClient';
import { CHUNK_SIZE, CHUNK_MAX_RETRIES, uploadFileChunked, type ChunkStatus } from '../uploadApi';

/** Serveri mudel: kettal olev baitide arv on tõde (nagu `server/upload/chunked.py`). */
function fakeServer(total: number, algne = 0, fp = 'fp') {
  const s = { received: algne, fp: algne > 0 ? fp : null as string | null, saadetud: [] as number[] };
  const getStatus = vi.fn(async (): Promise<ChunkStatus> => ({
    received: s.received, total: s.fp ? total : null, fingerprint: s.fp, name: 'a.pdf', status: 'pending',
  }));
  const send = vi.fn(async (a: { offset: number; blob: Blob; fingerprint: string }) => {
    if (a.offset !== 0 && a.offset !== s.received) {
      return { kind: 'conflict' as const, reason: 'offset', received: s.received };
    }
    s.fp = a.fingerprint;
    s.received = a.offset + a.blob.size;
    s.saadetud.push(a.offset);
    const complete = s.received === total;
    return { kind: 'ok' as const, result: { received: s.received, total, complete, ...(complete ? { expected_pages: 3 } : {}) } };
  });
  return { s, getStatus, send };
}

const fail = (bytes: number) => new File([new Uint8Array(bytes)], 'a.pdf');
const deps = (srv: ReturnType<typeof fakeServer>) => ({
  fingerprint: async () => 'fp', getStatus: srv.getStatus, send: srv.send as never, sleep: async () => {},
});

describe('uploadFileChunked (#235)', () => {
  it('saadab tükid järjest ja tagastab viimase vastuse', async () => {
    const total = CHUNK_SIZE * 2 + 10;
    const srv = fakeServer(total);
    const r = await uploadFileChunked('u', fail(total), 't', {}, deps(srv));
    expect(srv.s.saadetud).toEqual([0, CHUNK_SIZE, CHUNK_SIZE * 2]);
    expect(r).toMatchObject({ complete: true, expected_pages: 3 });
  });

  it('jätkab serveris olevast baidist, kui fail on sama', async () => {
    const total = CHUNK_SIZE * 3;
    const srv = fakeServer(total, CHUNK_SIZE);
    const onResume = vi.fn();
    await uploadFileChunked('u', fail(total), 't', { onResume }, deps(srv));
    expect(onResume).toHaveBeenCalledWith(CHUNK_SIZE);
    expect(srv.s.saadetud).toEqual([CHUNK_SIZE, CHUNK_SIZE * 2]);
  });

  it('teine fail serveris → alustab otsast', async () => {
    const total = CHUNK_SIZE;
    const srv = fakeServer(total, 100, 'MUU');
    await uploadFileChunked('u', fail(total), 't', {}, deps(srv));
    expect(srv.s.saadetud).toEqual([0]);
  });

  it('võrguviga tüki peal: ootab, küsib serveri seisu ja jätkab (tükk jõudis kohale, vastus kadus)', async () => {
    const total = CHUNK_SIZE * 2;
    const srv = fakeServer(total);
    const paris = srv.send.getMockImplementation()!;
    srv.send.mockImplementationOnce(async (a) => { await paris(a); throw new ApiError('Võrguviga', 0); });
    const sleep = vi.fn(async () => {});
    const r = await uploadFileChunked('u', fail(total), 't', {}, { ...deps(srv), sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    // Esimest tükki EI saadetud teist korda.
    expect(srv.s.saadetud).toEqual([0, CHUNK_SIZE]);
    expect(r?.complete).toBe(true);
  });

  it('loobub pärast CHUNK_MAX_RETRIES järjestikust viga', async () => {
    const srv = fakeServer(10);
    srv.send.mockImplementation(async () => { throw new ApiError('Võrguviga', 0); });
    await expect(uploadFileChunked('u', fail(10), 't', {}, deps(srv))).rejects.toThrow('Võrguviga');
    expect(srv.send).toHaveBeenCalledTimes(CHUNK_MAX_RETRIES + 1);
  });

  it('4xx ei korrata (nt vigane fail, õigused)', async () => {
    const srv = fakeServer(10);
    srv.send.mockImplementation(async () => { throw new ApiError('Toetamata failivorming', 400); });
    await expect(uploadFileChunked('u', fail(10), 't', {}, deps(srv))).rejects.toMatchObject({ status: 400 });
    expect(srv.send).toHaveBeenCalledTimes(1);
  });

  it('server ütleb, et fail on juba vastu võetud → null (polling jätkab)', async () => {
    const srv = fakeServer(10);
    srv.send.mockImplementation(async () => ({ kind: 'conflict' as const, reason: 'status', received: 10 }) as never);
    await expect(uploadFileChunked('u', fail(10), 't', {}, deps(srv))).resolves.toBeNull();
  });

  it('edenemine on kogu faili baitides, mitte tüki omas', async () => {
    const total = CHUNK_SIZE + 5;
    const srv = fakeServer(total);
    const nahtud: number[] = [];
    srv.send.mockImplementation(async (a: { offset: number; blob: Blob; fingerprint: string; onProgress?: (n: number) => void }) => {
      a.onProgress?.(a.blob.size);
      srv.s.received = a.offset + a.blob.size;
      return { kind: 'ok' as const, result: { received: srv.s.received, total, complete: srv.s.received === total } };
    });
    await uploadFileChunked('u', fail(total), 't', { onProgress: ({ loaded }) => nahtud.push(loaded) }, deps(srv));
    expect(Math.max(...nahtud)).toBe(total);
    expect(nahtud).toContain(CHUNK_SIZE);
  });
});

describe('fileFingerprint', () => {
  it('sama sisu → sama; muutunud viimane bait → erinev', async () => {
    const { fileFingerprint } = await import('../uploadApi');
    const a = new Uint8Array(3 * 1024 * 1024).fill(7);
    const b = a.slice(); b[b.length - 1] = 8;
    const fa = await fileFingerprint(new File([a], 'x.pdf'));
    expect(await fileFingerprint(new File([a], 'teine-nimi.pdf'))).toBe(fa);
    expect(await fileFingerprint(new File([b], 'x.pdf'))).not.toBe(fa);
    expect(fa.length).toBeLessThanOrEqual(128);
  });
});
