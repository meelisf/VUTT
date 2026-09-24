import { describe, it, expect } from 'vitest';
import { applyEnrichmentToDraft, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

// Seotud ID-d (VIAF-i ja nüüd ka GND `sameAs` kaudu) täidavad TÜHJAD ID-väljad
// iga allika puhul — varem tehti seda ainult VIAF-i eelvaates, kahes kohas.

const tühi = recordToDraft({
  id: 'vutt:Ptest02', name: { label: 'Hezel', aliases: [] }, identifiers: [],
} as unknown as ProsopoRecord);

describe('seotud ID-d eelvaatest', () => {
  it('täidab tühjad Wikidata, GND ja VIAF väljad', () => {
    const d = applyEnrichmentToDraft(
      { _linked_wikidata: 'Q16405824', _linked_gnd: '116796197', _linked_viaf: '34486358' }, tühi);
    expect([d.wikidata_id, d.gnd_id, d.viaf_id]).toEqual(['Q16405824', '116796197', '34486358']);
  });

  it('ei kirjuta olemasolevat ID-d üle', () => {
    const d = applyEnrichmentToDraft({ _linked_wikidata: 'Q2' }, { ...tühi, wikidata_id: 'Q1' });
    expect(d.wikidata_id).toBe('Q1');
  });
});
