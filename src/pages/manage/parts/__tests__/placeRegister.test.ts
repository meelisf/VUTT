import { describe, it, expect } from 'vitest';
import { placeSuggestions } from '../placeRegister';

describe('placeSuggestions', () => {
  it('silt kasutaja keeles, ajaloolised nimed sobitamiseks, sama ID üks kord', () => {
    const out = placeSuggestions({
      tartu: { id: 'Q13972', labels: { et: 'Tartu', de: 'Dorpat' }, historical_names: ['Tarbatum'] },
      dorpat: { id: 'Q13972', labels: { de: 'Dorpat' } },
      kyla: { id: null, labels: { et: 'Küla' } },
      tyhi: { id: 'Q1', labels: {} },
    }, 'et');
    expect(out).toEqual([
      { label: 'Tartu', id: 'Q13972', labels: { et: 'Tartu', de: 'Dorpat' }, aliases: ['Tarbatum'] },
      { label: 'Küla', id: null, labels: { et: 'Küla' }, aliases: [] },
    ]);
  });
});
