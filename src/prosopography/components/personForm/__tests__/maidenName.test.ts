import { describe, expect, it } from 'vitest';
import { draftToPayload, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

const card = (maiden_name: string | null) => ({
  id: 'vutt:Pabc', updated_at: '2026-11-09T00:00:00+00:00',
  name: { label: 'Rosine Elisabeth Fischer', aliases: [], maiden_name }, identifiers: [], sources: [],
}) as unknown as ProsopoRecord;

describe('neiupõlvenime vormi ümarreis', () => {
  it('salvestatud väärtus jääb samaks', () => {
    expect(draftToPayload(recordToDraft(card('Marckthaler')), card('Marckthaler')).name?.maiden_name)
      .toBe('Marckthaler');
  });

  it('mustandi väärtus kirjutab üle, tühikud lõigatakse', () => {
    const draft = recordToDraft(card(null));
    draft.name_maiden = '  Marckthaler ';
    expect(draftToPayload(draft, card(null)).name?.maiden_name).toBe('Marckthaler');
  });

  it('tühjendatud väli on kustutamine, mitte vana väärtus', () => {
    const draft = recordToDraft(card('Marckthaler'));
    draft.name_maiden = '';
    expect(draftToPayload(draft, card('Marckthaler')).name?.maiden_name).toBeNull();
  });
});
