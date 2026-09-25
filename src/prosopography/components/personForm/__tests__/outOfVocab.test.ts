import { describe, it, expect } from 'vitest';
import { applyEnrichmentToDraft, draftToPayload, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

// Sõnastikuväline konfessioon säilitab salvestusel oma sildi (varem sai sildiks Q-kood).

const VOCAB = [{ id: 'Q1841', label: { et: 'Katoliiklane', en: 'Catholic' } }];

const kaart = {
  id: 'vutt:Ptest04', name: { label: 'Comenius', aliases: [] }, identifiers: [],
  confessions: [
    { id: 'Q97738262', label: 'Vennastekogudus', labels: { en: 'Unity of the Brethren' } },
    { id: 'Q1841', label: 'Katoliiklane' },
  ],
} as unknown as ProsopoRecord;

describe('sõnastikuväline väärtus', () => {
  it('säilitab salvestatud kirje', () => {
    const p = draftToPayload(recordToDraft(kaart), kaart, [], VOCAB);
    expect(p.confessions).toEqual([
      { id: 'Q97738262', label: 'Vennastekogudus', labels: { en: 'Unity of the Brethren' } },
      { id: 'Q1841', label: 'Katoliiklane', labels: { et: 'Katoliiklane', en: 'Catholic' } },
    ]);
  });

  it('rikastus lisab kõik uued konfessioonid korra', () => {
    const d = applyEnrichmentToDraft(
      { confessions: [{ id: 'Q1841' }, { id: 'Q75809' }] }, recordToDraft(kaart));
    expect(d.confessions).toEqual(['Q97738262', 'Q1841', 'Q75809']);
  });
});
