import { describe, it, expect } from 'vitest';
import { creatorFromPicker, creatorToPickerValue } from '../creatorEntity';

describe('creatorToPickerValue', () => {
  it('lingitud isik → LinkedEntity', () => {
    expect(creatorToPickerValue({ name: 'Luden', role: 'auctor', id: 'Q1', source: 'wikidata' }))
      .toEqual({ id: 'Q1', label: 'Luden', source: 'wikidata', labels: { et: 'Luden' } });
  });
  it('registri isik hoiab oma allikat', () => {
    expect(creatorToPickerValue({ name: 'X', role: 'auctor', id: 'vutt:P1', source: 'manual' }))
      .toMatchObject({ id: 'vutt:P1', source: 'manual' });
  });
  it('lingita nimi → paljas string', () => {
    expect(creatorToPickerValue({ name: 'Keegi', role: 'auctor' })).toBe('Keegi');
  });
  it('tühi rida (osa isik ilma nimeta) → tühi string, mitte undefined', () => {
    expect(creatorToPickerValue({ role: 'addressee' })).toBe('');
  });
});

describe('creatorFromPicker', () => {
  it('local-allikas salvestub manual-ina, roll säilib', () => {
    expect(creatorFromPicker({ name: '', role: 'addressee' }, { id: null, label: 'Keegi', source: 'local' }))
      .toEqual({ name: 'Keegi', role: 'addressee', id: null, source: 'manual' });
  });
  it('tühjendamine', () => {
    expect(creatorFromPicker({ name: 'X', role: 'auctor', id: 'Q1', source: 'wikidata' }, null))
      .toEqual({ name: '', role: 'auctor', id: null, source: 'manual' });
  });
});
