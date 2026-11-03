/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importWithStaleChunkReload, reloadForStaleChunk } from '../staleChunk';

// Deploy järel puuduv chunk → üks uuestilaadimine; korduv tõrge ei tohi tsüklisse minna.
describe('reloadForStaleChunk', () => {
  const reload = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('esimene tõrge laeb lehe uuesti', () => {
    expect(reloadForStaleChunk()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('kordus 30 s piires ei lae uuesti — viga jõuab veapiiri', () => {
    reloadForStaleChunk();
    expect(reloadForStaleChunk()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('pärast valvuriaega lubatakse uus katse (järgmine deploy)', () => {
    sessionStorage.setItem('vutt_stale_chunk_reload_at', String(Date.now() - 31_000));
    expect(reloadForStaleChunk()).toBe(true);
  });

  it('sessionStorage puudub → ei lae uuesti (tsüklit ei saaks vältida)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(reloadForStaleChunk()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe('importWithStaleChunkReload', () => {
  const reload = vi.fn();
  // Ootel promise'i kontroll: kas lahenes/kukkus mikrotööde jooksul?
  const settled = async (p: Promise<unknown>) => {
    let done = false;
    p.then(() => { done = true; }, () => { done = true; });
    await new Promise(r => setTimeout(r, 0));
    return done;
  };

  beforeEach(() => {
    sessionStorage.clear();
    reload.mockClear();
    vi.stubGlobal('location', { ...window.location, reload });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('edukas import tagastab mooduli', async () => {
    const mod = { default: 'X' };
    await expect(importWithStaleChunkReload(() => Promise.resolve(mod))).resolves.toBe(mod);
  });

  it('Vite neelas preloadError-i (moodul undefined) → jääb ootele, ei anna lazy-le undefined-i', async () => {
    const p = importWithStaleChunkReload(() => Promise.resolve(undefined as unknown as { default: string }));
    expect(await settled(p)).toBe(false);
  });

  it('import viskab → üks uuestilaadimine ja ootel promise', async () => {
    const p = importWithStaleChunkReload(() => Promise.reject(new Error('chunk')));
    expect(await settled(p)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('import viskab valvuriaja sees → viga jõuab veapiiri', async () => {
    sessionStorage.setItem('vutt_stale_chunk_reload_at', String(Date.now()));
    await expect(importWithStaleChunkReload(() => Promise.reject(new Error('chunk')))).rejects.toThrow('chunk');
    expect(reload).not.toHaveBeenCalled();
  });
});
