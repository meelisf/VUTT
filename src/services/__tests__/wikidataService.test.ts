import { describe, it, expect, vi, afterEach } from 'vitest';
import { searchWikidata } from '../wikidataService';

describe('searchWikidata — throwOnError (fix round 1: kukkunud allikas ei tohi vaikselt kaduda)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('vaikimisi (opts puudub) neelab tõrke ja tagastab tühja loendi — EntityPicker jm ei tohi muutuda', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchWikidata('Luden', 'et')).resolves.toEqual([]);
  });

  it('throwOnError: true korral viskab tõrke edasi (ei tagasta vaikselt [])', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchWikidata('Luden', 'et', { throwOnError: true })).rejects.toThrow();
  });
});
