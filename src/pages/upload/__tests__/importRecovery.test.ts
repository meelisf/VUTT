import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../services/workSetService', () => ({ invalidateWorkSetIds: vi.fn() }));
vi.mock('../../../services/apiClient', async (orig) => ({
  ...(await orig<typeof import('../../../services/apiClient')>()),
  apiPost: vi.fn(async () => ({ work_id: 'asendatud' })),
}));

import { importUploadWithRecovery, replaceWorkUpload } from '../uploadApi';
import { invalidateWorkSetIds } from '../../../services/workSetService';
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


/** Import lisab teose töökollektsioonidesse SERVERIS. Kliendi kogu-ID vahemälu
 *  (`workSetService.idCache`) jäi vanaks ja kogu vaade ei näidanud uut teost
 *  enne lehe uuesti laadimist (kaebus 2026-11-12, ADA import + töökollektsioon). */
describe('töökollektsioonide vahemälu pärast importi', () => {
  beforeEach(() => vi.mocked(invalidateWorkSetIds).mockClear());

  it('õnnestunud import tühjendab kogu-ID vahemälu', async () => {
    const doImport = vi.fn(async () => ({ work_id: 'abc123' }) as UploadImportResponse);
    await importUploadWithRecovery('u1', 't', { ...kiire, doImport, checkStatus: vi.fn() });
    expect(invalidateWorkSetIds).toHaveBeenCalledWith();
  });

  it('staatuse kaudu taastatud import tühjendab samuti', async () => {
    const doImport = vi.fn(async () => { throw new Error('504'); });
    const checkStatus = vi.fn(async () => olek('imported', 'wid9'));
    await importUploadWithRecovery('u1', 't', { ...kiire, doImport, checkStatus });
    expect(invalidateWorkSetIds).toHaveBeenCalledWith();
  });

  it('ebaõnnestunud import vahemälu ei puuduta', async () => {
    const doImport = vi.fn(async () => { throw new Error('500'); });
    const checkStatus = vi.fn(async () => olek('error'));
    await expect(importUploadWithRecovery('u1', 't', { ...kiire, doImport, checkStatus })).rejects.toThrow();
    expect(invalidateWorkSetIds).not.toHaveBeenCalled();
  });

  it('sisu asendus (replace-work) tühjendab samuti', async () => {
    await replaceWorkUpload('u1', 'w1', 't');
    expect(invalidateWorkSetIds).toHaveBeenCalledWith();
  });
});
