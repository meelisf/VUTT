import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchViaf } from '../viafService';

describe('searchViaf — throwOnError (fix round 1: kukkunud allikas ei tohi vaikselt kaduda)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vaikimisi (opts puudub) neelab tõrke ja tagastab tühja loendi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchViaf('Luden')).resolves.toEqual([]);
  });

  it('throwOnError: true korral viskab tõrke edasi (ei tagasta vaikselt [])', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchViaf('Luden', { throwOnError: true })).rejects.toThrow();
  });
});
