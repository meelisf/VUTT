/** Draft ↔ payload ümarreis eluloo keeleväljadele. */
import { describe, expect, it } from 'vitest';
import { draftToPayload, recordToDraft } from '../helpers';
import { emptyDraft } from '../types';

const record = (o: Record<string, unknown>) =>
  ({ id: 'vutt:Pabc', updated_at: '2026-09-10T10:00:00+00:00',
     name: { label: 'Test' }, identifiers: [], ...o }) as any;

describe('recordToDraft', () => {
  it('loeb kolm tekstivälja', () => {
    const draft = recordToDraft(record({
      biography_et: 'Eesti', biography_en: 'English', aa_raw: '154. AA' }));
    expect(draft.biography_et).toBe('Eesti');
    expect(draft.biography_en).toBe('English');
    expect(draft.aa_raw).toBe('154. AA');
  });

  it('kinnitusruudud algavad märkimata', () => {
    const draft = recordToDraft(record({ biography_en: 'English' }));
    expect(draft.confirm_et).toBe(false);
    expect(draft.confirm_en).toBe(false);
  });
});

describe('draftToPayload', () => {
  it('saadab kolm välja, tühi → null', () => {
    const payload = draftToPayload({ ...emptyDraft(), biography_et: 'Eesti' }) as any;
    expect(payload.biography_et).toBe('Eesti');
    expect(payload.biography_en).toBeNull();
    expect(payload.aa_raw).toBeNull();
  });

  it('EI saada ankruid', () => {
    const payload = draftToPayload(emptyDraft()) as any;
    expect(payload.biography_et_src).toBeUndefined();
    expect(payload.biography_en_src).toBeUndefined();
  });

  it('lisab _confirm_translation ainult märgitud ruutude kohta', () => {
    expect((draftToPayload(emptyDraft()) as any)._confirm_translation).toBeUndefined();
    const payload = draftToPayload({ ...emptyDraft(), confirm_en: true }) as any;
    expect(payload._confirm_translation).toEqual(['biography_en']);
  });

  it('EI saada pärandvälja `biography`', () => {
    const payload = draftToPayload(emptyDraft()) as any;
    expect('biography' in payload).toBe(false);
  });
});
