/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadForStaleChunk } from '../staleChunk';

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
