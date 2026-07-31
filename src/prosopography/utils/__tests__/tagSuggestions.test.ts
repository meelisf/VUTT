import { describe, it, expect } from 'vitest';
import { mapTagFacetsToSuggestions } from '../tagSuggestions';

const pietism = {
  value: 'Q193664',
  label: 'pietism',
  labels: { et: 'pietism', en: 'Pietism', de: 'Pietismus' },
  count: 3,
};
const kantsler = {
  value: 'Q373085',
  label: 'kantsler',
  labels: { et: 'kantsler', en: 'chancellor' },
  count: 7,
};

describe('mapTagFacetsToSuggestions', () => {
  it('eelistab aktiivse keele labelit', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'en')[0].label).toBe('Pietism');
    expect(mapTagFacetsToSuggestions([pietism], 'et')[0].label).toBe('pietism');
  });

  it('langeb tagasi et → en → label, kui keelt pole', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'fr')[0].label).toBe('pietism');
    const onlyEn = { value: 'Q1', label: 'raw', labels: { en: 'printer' }, count: 1 };
    expect(mapTagFacetsToSuggestions([onlyEn], 'fr')[0].label).toBe('printer');
    const noLabels = { value: 'Q2', label: 'raw', labels: null, count: 1 };
    expect(mapTagFacetsToSuggestions([noLabels], 'fr')[0].label).toBe('raw');
  });

  it('säilitab sisendjärjestuse (facet on juba sageduse järgi)', () => {
    const result = mapTagFacetsToSuggestions([kantsler, pietism], 'et');
    expect(result.map(r => r.label)).toEqual(['kantsler', 'pietism']);
  });

  it('Q-kood läheb id-ks', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'et')[0].id).toBe('Q193664');
  });

  it('Q-koodita väärtus annab id: null', () => {
    const bare = { value: 'kantsler', label: 'kantsler', labels: null, count: 1 };
    expect(mapTagFacetsToSuggestions([bare], 'et')[0].id).toBeNull();
  });

  it('annab labels muutmata edasi', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'et')[0].labels).toEqual(pietism.labels);
  });

  it('talub tühja ja puuduvat sisendit', () => {
    expect(mapTagFacetsToSuggestions([], 'et')).toEqual([]);
    expect(mapTagFacetsToSuggestions(null, 'et')).toEqual([]);
    expect(mapTagFacetsToSuggestions(undefined, 'et')).toEqual([]);
  });

  it('jätab labelita kirjed vahele', () => {
    const broken = [
      { value: '', label: '', labels: null, count: 1 },
      { value: 'Q9', label: '   ', labels: null, count: 1 },
      pietism,
    ];
    expect(mapTagFacetsToSuggestions(broken as any, 'et')).toHaveLength(1);
  });

  it('kasutab ainult keele baasosa (en-GB → en)', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'en-GB')[0].label).toBe('Pietism');
  });
});
