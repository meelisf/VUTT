import { describe, expect, it, vi } from 'vitest';
import { applyPrepressWithRecovery } from '../uploadApi';
import type { PollResult } from '../types';

/** Apply on ühekordne CAS, mis käivitab taustalõime ja vastab kohe. Kui vastus
 *  kaob (kliendi timeout 512-lehelise teose renderduse ajal, #340), EI tähenda
 *  see, et töö ei alanud — tõene allikas on upload'i staatus. Kordus on ohutu:
 *  teine apply annab 409. */

const olek = (status: string) =>
  ({ status, ready: 0, total: 0, expected_pages: null, files: [] }) as PollResult;

const kiire = { pollMs: 0, budgetMs: 100 };

describe('applyPrepressWithRecovery', () => {
  it('annab õnnestunud vastuse muutmata edasi', async () => {
    const doApply = vi.fn(async () => ({ status: 'applying', path: 'split' }));
    const checkStatus = vi.fn();

    const tulemus = await applyPrepressWithRecovery('u1', 't', { ...kiire, doApply, checkStatus });

    expect(tulemus.status).toBe('applying');
    expect(tulemus.recovered).toBeUndefined();
    expect(checkStatus).not.toHaveBeenCalled();
  });

  it('katkenud vastus + serveris käiv töö = õnnestumine', async () => {
    const doApply = vi.fn(async () => { throw new Error('The operation was aborted.'); });
    const checkStatus = vi.fn(async () => olek('applying'));

    const tulemus = await applyPrepressWithRecovery('u1', 't', { ...kiire, doApply, checkStatus });

    expect(tulemus.status).toBe('applying');
    expect(tulemus.recovered).toBe(true);
  });

  it.each(['reviewing', 'done', 'importing', 'imported'])(
    'töö on juba kaugemal (%s) — ka see on õnnestumine',
    async (staatus) => {
      const doApply = vi.fn(async () => { throw new Error('abort'); });
      const checkStatus = vi.fn(async () => olek(staatus));

      const tulemus = await applyPrepressWithRecovery('u1', 't', { ...kiire, doApply, checkStatus });

      expect(tulemus.recovered).toBe(true);
    },
  );

  it('ootab, kui päring jõuab serverisse alles pärast abordi', async () => {
    const doApply = vi.fn(async () => { throw new Error('abort'); });
    const checkStatus = vi.fn()
      .mockResolvedValueOnce(olek('awaiting_split'))
      .mockResolvedValueOnce(olek('awaiting_split'))
      .mockResolvedValueOnce(olek('applying'));

    const tulemus = await applyPrepressWithRecovery('u1', 't', {
      pollMs: 0, budgetMs: 1000, doApply, checkStatus,
    });

    expect(tulemus.recovered).toBe(true);
    expect(checkStatus).toHaveBeenCalledTimes(3);
  });

  it('töö ei käivitunud eelarve jooksul — algne viga jääb veaks', async () => {
    const doApply = vi.fn(async () => { throw new Error('The operation was aborted.'); });
    const checkStatus = vi.fn(async () => olek('awaiting_split'));

    await expect(applyPrepressWithRecovery('u1', 't', { ...kiire, doApply, checkStatus }))
      .rejects.toThrow('The operation was aborted.');
  });

  it('ka staatus ei vasta — algne viga on parem teade', async () => {
    const doApply = vi.fn(async () => { throw new Error('The operation was aborted.'); });
    const checkStatus = vi.fn(async () => { throw new Error('staatus ei vasta'); });

    await expect(applyPrepressWithRecovery('u1', 't', { ...kiire, doApply, checkStatus }))
      .rejects.toThrow('The operation was aborted.');
  });
});
