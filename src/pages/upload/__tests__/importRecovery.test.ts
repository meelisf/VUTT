import { describe, expect, it, vi } from 'vitest';
import { importUploadWithRecovery } from '../uploadApi';
import type { PollResult, UploadImportResponse } from '../types';

/** 524-leheline teos importis 75 s. nginx vaikimisi `proxy_read_timeout` on
 *  60 s, seega klient sai 504 valmis teose kohta. Vastuse kaotamine EI OLE
 *  impordi ebaõnnestumine — tulemuse tõene allikas on upload'i staatus. */

const olek = (status: string, work_id: string | null = null) =>
  ({ status, work_id, ready: 0, total: 0, expected_pages: null, files: [] }) as PollResult;

const kiire = { pollMs: 0, budgetMs: 1000 };

describe('importUploadWithRecovery', () => {
  it('annab õnnestunud impordi vastuse muutmata edasi', async () => {
    const doImport = vi.fn(async () => ({ work_id: 'abc123' }) as UploadImportResponse);
    const checkStatus = vi.fn();

    const tulemus = await importUploadWithRecovery('u1', 't', {
      ...kiire, doImport, checkStatus,
    });

    expect(tulemus.work_id).toBe('abc123');
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('katkenud päring + serveris lõpetatud import = õnnestumine', async () => {
    const doImport = vi.fn(async () => { throw new Error('504 Gateway Time-out'); });
    const checkStatus = vi.fn(async () => olek('imported', 'wid9'));

    const tulemus = await importUploadWithRecovery('u1', 't', {
      ...kiire, doImport, checkStatus,
    });

    expect(tulemus.work_id).toBe('wid9');
    expect(tulemus.recovered).toBe(true);
  });

  it('ootab lõpuni, kui import serveris veel käib', async () => {
    const doImport = vi.fn(async () => { throw new Error('504'); });
    const checkStatus = vi.fn()
      .mockResolvedValueOnce(olek('importing'))
      .mockResolvedValueOnce(olek('importing'))
      .mockResolvedValueOnce(olek('imported', 'wid9'));

    const tulemus = await importUploadWithRecovery('u1', 't', {
      ...kiire, doImport, checkStatus,
    });

    expect(tulemus.work_id).toBe('wid9');
    expect(checkStatus).toHaveBeenCalledTimes(3);
  });

  it('päris viga jääb veaks: staatus tuli tagasi ja import ei käi', async () => {
    const doImport = vi.fn(async () => { throw new Error('Kaust on juba olemas'); });
    const checkStatus = vi.fn(async () => olek('reviewing'));

    await expect(importUploadWithRecovery('u1', 't', { ...kiire, doImport, checkStatus }))
      .rejects.toThrow('Kaust on juba olemas');
  });

  it('kättesaamatu staatus ei varjuta algset viga', async () => {
    const doImport = vi.fn(async () => { throw new Error('võrguviga'); });
    const checkStatus = vi.fn(async () => { throw new Error('ka staatus ei vasta'); });

    await expect(importUploadWithRecovery('u1', 't', { ...kiire, doImport, checkStatus }))
      .rejects.toThrow('võrguviga');
  });

  it('lõputult `importing` ei jää igaveseks rippu', async () => {
    const doImport = vi.fn(async () => { throw new Error('504'); });
    const checkStatus = vi.fn(async () => olek('importing'));

    await expect(importUploadWithRecovery('u1', 't', { pollMs: 0, budgetMs: 0, doImport, checkStatus }))
      .rejects.toThrow('504');
  });
});
