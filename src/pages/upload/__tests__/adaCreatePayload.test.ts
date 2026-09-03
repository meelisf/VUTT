import { describe, it, expect } from 'vitest';
import { buildAdaCreateExtras } from '../adaApi';
import type { AdaLookupResult } from '../types';

const ADA_RESULT: AdaLookupResult = {
  handle: '10062/7822',
  item_uuid: 'u-1',
  meta: {
    title: '65 kirja Karl Morgensternile',
    year: '1812',
    year_display: '1812-1823',
    creators: [{ label: 'Morgenstern, Karl' }],
    languages: ['deu'],
    ester_id: 'b12345',
    archive_refs: [{ archive_id: 'EAA', reference: '402-1-123' }],
    external_url: 'https://dspace.ut.ee/handle/10062/7822',
  },
  failid: [{ name: 'a.pdf', bitstream_uuid: 'b1', size_bytes: 10, tapsus: 0 }],
  kogu_baite: 10,
  vahele_jaetud: [],
};

describe('buildAdaCreateExtras', () => {
  it('tavaline (mitte-ADA) loomine EI kanna ühtki ADA-välja — adaResult on null', () => {
    // See on Task 11 review'st: `handleStep1Submit`-i onSubmit-signatuuri muutus
    // pidi jääma nähtamatuks tavapärasele (enamiku) loomisele — kontrollime
    // seda otse selle funktsiooni peal, mis payload'i ADA-plokki koostab.
    const extras = buildAdaCreateExtras(null);
    expect(extras).toEqual({});
    expect(extras).not.toHaveProperty('ada');
    expect(extras).not.toHaveProperty('languages');
    expect(extras).not.toHaveProperty('creators');
    expect(extras).not.toHaveProperty('year_display');
    expect(extras).not.toHaveProperty('ester_id');
    expect(extras).not.toHaveProperty('archive_refs');
    expect(extras).not.toHaveProperty('external_url');
  });

  it('ADA-loomine kannab ada-ploki ja meta-väljad kaasa', () => {
    const extras = buildAdaCreateExtras(ADA_RESULT);
    expect(extras.ada).toEqual({
      handle: '10062/7822',
      item_uuid: 'u-1',
      sources: [{ name: 'a.pdf', bitstream_uuid: 'b1', size_bytes: 10 }],
    });
    expect(extras.languages).toEqual(['deu']);
    expect(extras.creators).toEqual([{ label: 'Morgenstern, Karl' }]);
    expect(extras.year_display).toBe('1812-1823');
    expect(extras.ester_id).toBe('b12345');
    expect(extras.archive_refs).toEqual([{ archive_id: 'EAA', reference: '402-1-123' }]);
    expect(extras.external_url).toBe('https://dspace.ut.ee/handle/10062/7822');
  });
});
