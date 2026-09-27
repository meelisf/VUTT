import { describe, expect, it } from 'vitest';
import { draftToPayload, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

describe('kinnitatud ametite ja hariduse vormi ümarreis', () => {
  it('säilitab registrivõtmed ning kirjepõhised tõendid järgmisel vormisalvestusel', () => {
    const card = {
      id: 'vutt:Pabc', updated_at: '2026-09-26T00:00:00+00:00',
      name: { label: 'Test', aliases: [] }, identifiers: [],
      occupations: [{ label: 'Professor', occupation_key: 'professor',
        institution: 'Academia Gustaviana', institution_key: 'academia-gustaviana',
        evidence: [{ source_kind: 'vutt_page', work_id: 'w1', page: 12 }] }],
      education: [{ institution: 'Academia Gustaviana', institution_key: 'academia-gustaviana',
        evidence: [{ source_kind: 'literature', source_id: 'book1', locator: 'lk 4' }] }],
    } as unknown as ProsopoRecord;
    const saved = draftToPayload(recordToDraft(card), card);
    expect(saved.occupations?.[0]).toMatchObject({
      occupation_key: 'professor', institution_key: 'academia-gustaviana',
      evidence: [{ work_id: 'w1', page: 12 }],
    });
    expect(saved.education?.[0]).toMatchObject({
      institution_key: 'academia-gustaviana', evidence: [{ source_id: 'book1', locator: 'lk 4' }],
    });
  });
});
