import { describe, expect, it } from 'vitest';
import { recordToDraft, draftToPayload, applyEnrichmentToDraft } from '../helpers';
import type { ProsopoRecord, PlaceEntry } from '../../../types';

const places: Record<string, PlaceEntry> = {
  Riga: { id: 'Q1773', labels: { et: 'Riia' }, parent_key: 'Livland', type: 'city' },
  Livland: { id: 'Q1757', labels: { et: 'Liivimaa' }, type: 'historical_region' },
  Tonder: { id: 'Q3223979', labels: { en: 'Tønder' }, type: 'city' },
};
const card = (origin: string | null, qid = 'Q1773') => ({
  name: { label: 'Test' }, origin: { place: origin, coordinates: { lat: 1, lon: 2 } },
  birth: { date: '1645-01-01', precision: 'year', place: { id: qid, label: 'Riia' }, notes: 'Allikaviide' },
} as unknown as ProsopoRecord);

describe('one origin link', () => {
  it('prefers a registered city inside the recorded region and preserves date precision and source notes', () => {
    const original = card('Livland');
    const draft = recordToDraft(original, places);
    expect(draft.origin_place).toBe('Riga');
    const saved = draftToPayload(draft, original, [], [], places);
    expect(saved.origin).toMatchObject({ place: 'Riga', coordinates: null });
    expect(saved.birth).toMatchObject({ date: '1645-01-01', precision: 'year', place: null, notes: 'Allikaviide' });
    expect(saved.notes).toBeNull();
  });
  it('does not infer containment between unrelated places; archives the old birthplace on an explicit form save', () => {
    const original = card('Tonder');
    const draft = recordToDraft(original, places);
    expect(draft.origin_place).toBe('Tonder');
    const saved = draftToPayload(draft, original, [], [], places);
    expect(saved.notes).toBe('Varasem sünnikoht: Riia (Q1773)');
    expect(saved.birth?.place).toBeNull();
  });
  it('preserves an unresolved legacy birthplace until the user can link it', () => {
    const original = card(null, 'Q999999999');
    const saved = draftToPayload(recordToDraft(original, places), original, [], [], places);
    expect(saved.birth?.place?.id).toBe('Q999999999');
    expect(saved.origin?.place).toBeNull();
  });
  it('resolves birthplace enrichment even when the date was already present', () => {
    const original = card(null);
    original.birth.place = null;
    const draft = applyEnrichmentToDraft({ 'birth.place': { id: 'Q1773', label: 'Riia' } }, recordToDraft(original, places));
    const saved = draftToPayload(draft, original, [], [], places);
    expect(saved.origin?.place).toBe('Riga');
    expect(saved.birth?.place).toBeNull();
  });
  it('clearing the place does not resurrect the old birthplace or coordinates', () => {
    const original = card('Riga');
    const draft = { ...recordToDraft(original, places), origin_place: '' };
    draft.birth = { ...draft.birth, place: null };
    const saved = draftToPayload(draft, original, [], [], places);
    expect(saved.origin).toMatchObject({ place: null, coordinates: null });
    expect(saved.birth?.place).toBeNull();
  });
});
