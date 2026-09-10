/**
 * Sama räsi mis serveril (`server/prosopo_biography_fields.py::text_hash`).
 * Kaks teostust, üks reegel — see test ON nendevaheline leping.
 */
import { describe, expect, it } from 'vitest';
import { textHash } from '../textHash';

describe('textHash', () => {
  it('lubjab ümbritseva tühiku ja annab 12 märki', async () => {
    expect(await textHash('  tekst \n')).toBe(await textHash('tekst'));
    expect(await textHash('tekst')).toHaveLength(12);
  });

  it('vastab serveri väärtusele', async () => {
    // Genereeritud serveri funktsiooniga, mitte välja mõeldud: sha256("tekst")[:12].
    expect(await textHash('tekst')).toBe('324d0315d575');
  });

  it('tühi, null ja undefined annavad sama räsi', async () => {
    const tyhi = await textHash('');
    expect(await textHash(null)).toBe(tyhi);
    expect(await textHash(undefined)).toBe(tyhi);
  });

  it('erinev tekst annab erineva räsi', async () => {
    expect(await textHash('tekst')).not.toBe(await textHash('teksti'));
  });
});
