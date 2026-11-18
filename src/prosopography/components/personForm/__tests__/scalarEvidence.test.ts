import { describe, expect, it } from 'vitest';
import { recordToDraft, draftToPayload } from '../helpers';
import type { ProsopoRecord, PlaceEntry } from '../../../types';

// #834: agendi ettepanekust kinnitatud sünni, surma ja päritolu tõend peab üle
// elama tavalise vormi salvestuse — vorm ehitab need objektid uuesti üles.
const places: Record<string, PlaceEntry> = {
  Tartu: { id: 'Q13972', labels: { et: 'Tartu' }, type: 'city' },
  Riga: { id: 'Q1773', labels: { et: 'Riia' }, type: 'city' },
};
const A = { source_kind: 'vutt_page', work_id: 'w1', page: 3 };
const B = { source_kind: 'literature', source_id: 'DOC1', locator: 'lk 106', citation: 'Levitski 1902' };
const card = () => ({
  name: { label: 'Johannes Horn' },
  birth: { date: '1755-01-01', precision: 'year', evidence: [A] },
  death: { date: '1807-03-02', precision: 'day', evidence: [B] },
  origin: { place: 'Tartu', evidence: [A, B] },
} as unknown as ProsopoRecord);

describe('skalaarvälja tõend vormis', () => {
  it('säilitab sünni, surma ja päritolu tõendi ringsõidul', () => {
    const original = card();
    const saved = draftToPayload(recordToDraft(original, places), original, [], [], places) as any;
    expect(saved.birth.evidence).toEqual([A]);
    expect(saved.death.evidence).toEqual([B]);
    expect(saved.origin.evidence).toEqual([A, B]);
  });

  it('eemaldatud tõend ei tule tagasi', () => {
    const original = card();
    const draft = { ...recordToDraft(original, places), birth_evidence: [] };
    const saved = draftToPayload(draft, original, [], [], places) as any;
    expect(saved.birth.evidence ?? []).toEqual([]);
  });

  it('muudetud väärtusel vana tõend kaob (tõend käis vana väärtuse kohta)', () => {
    const original = card();
    const draft = recordToDraft(original, places);
    const saved = draftToPayload({ ...draft, birth: { ...draft.birth, year: '1756' }, origin_place: 'Riga' },
      original, [], [], places) as any;
    expect(saved.birth.evidence ?? []).toEqual([]);
    expect(saved.origin.evidence ?? []).toEqual([]);
    expect(saved.death.evidence).toEqual([B]);
  });
});

describe('tegutsemisaja tõend vormis (#834 2. osa)', () => {
  const rec = { name: { label: 'X' }, floruit: { year_from: 1780, year_to: 1807, evidence: [A] } } as unknown as ProsopoRecord;
  it('säilib ringsõidul', () => {
    const saved = draftToPayload(recordToDraft(rec, places), rec, [], [], places) as any;
    expect(saved.floruit.evidence).toEqual([A]);
  });
  it('muudetud aastal kaob', () => {
    const saved = draftToPayload({ ...recordToDraft(rec, places), floruit_from: '1781' }, rec, [], [], places) as any;
    expect(saved.floruit.evidence ?? []).toEqual([]);
  });
});
