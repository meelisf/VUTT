import { describe, expect, it } from 'vitest';
import { draftToPayload, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

const card = (sources: unknown[]) => ({
  id: 'vutt:Pabc', updated_at: '2026-11-08T00:00:00+00:00',
  name: { label: 'Test', aliases: [] }, identifiers: [], sources,
}) as unknown as ProsopoRecord;

describe('allikakirjete vormi ümarreis (ADR 0078)', () => {
  it('vabatekst, vana string ja VUTT-i viide jäävad samaks', () => {
    const sources = [
      { text: 'Recke-Napiersky III', note: 'lühike' },
      { work_id: 'w1', part_id: 'k1', page: 7, printed_page: '14–16', text: 'personaalia' },
      { work_id: 'w2' },
    ];
    const saved = draftToPayload(recordToDraft(card([...sources, 'Album Academicum'])), card([]));
    expect(saved.sources).toEqual([...sources, { text: 'Album Academicum' }]);
  });

  it('tühi rida kaob, teoseta tekstita rida ka; vigane lk jäetakse välja', () => {
    const draft = recordToDraft(card([]));
    draft.sources = [
      { text: '  ', note: 'x' },
      { text: '', note: '', work_id: 'w1', part_id: null, page: '0', printed_page: ' ' },
    ];
    expect(draftToPayload(draft, card([])).sources).toEqual([{ work_id: 'w1' }]);
  });
});
