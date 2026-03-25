import { describe, it, expect } from 'vitest';
import { mergeFacetItems, FilterItem } from '../facetUtils';

const item = (value: string, label: string, count: number): FilterItem => ({ value, label, count });

// ---------------------------------------------------------------------------
// mergeFacetItems — facet de-duplikatsioon Q-koodi järgi
// ---------------------------------------------------------------------------
describe('mergeFacetItems', () => {
  it('ilma kaartideta → tagastatakse muutmata', () => {
    const input = [item('oratsioon', 'oratsioon', 5)];
    expect(mergeFacetItems(input)).toEqual(input);
  });

  it('kaks sama labeli varianti → liidetakse kokku', () => {
    // Meilisearch võib tagastada nii "oratsioon" kui "Oratsioon" (suur/väike täht)
    const input = [item('oratsioon', 'oratsioon', 5), item('Oratsioon', 'Oratsioon', 3)];
    const labelToId = { 'Oratsioon': 'Q861911' };
    const idToLabel = { 'Q861911': 'oratsioon' };
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ value: 'Q861911', label: 'oratsioon', count: 8 });
  });

  it('capitalize normaliseerimine: "oratsioon" → labelToId["Oratsioon"] töötab', () => {
    // mergeFacetItems proovib labelToId[capitalize(item.value)] kui otse ei leia
    const input = [item('oratsioon', 'oratsioon', 4)];
    const labelToId = { 'Oratsioon': 'Q861911' }; // ainult suure tähega kirje
    const idToLabel = { 'Q861911': 'oratsioon' };
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('Q861911');
    expect(result[0].count).toBe(4);
  });

  it('inglise keele facetid: "oration" → Q861911', () => {
    const input = [item('oration', 'oration', 7)];
    const labelToId = { 'Oration': 'Q861911' };
    const idToLabel = { 'Q861911': 'oration' };
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result[0]).toMatchObject({ value: 'Q861911', label: 'oration', count: 7 });
  });

  it('kaks erinevat žanri → jäävad eraldi', () => {
    const input = [
      item('oratsioon', 'oratsioon', 5),
      item('disputatsioon', 'disputatsioon', 3),
    ];
    const labelToId = { 'Oratsioon': 'Q861911', 'Disputatsioon': 'Q789' };
    const idToLabel = { 'Q861911': 'oratsioon', 'Q789': 'disputatsioon' };
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result).toHaveLength(2);
  });

  it('keelevahetuse stsenaarium: eesti + inglise label samale teosele liidetakse', () => {
    // Kui indeksis on mõlemat keelt (migratsiooni ajal või segaandmetes)
    const input = [
      item('oratsioon', 'oratsioon', 10),
      item('oration', 'oration', 10),
    ];
    const labelToId = { 'Oratsioon': 'Q861911', 'Oration': 'Q861911' };
    const idToLabel = { 'Q861911': 'oratsioon' };
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(20);
    expect(result[0].label).toBe('oratsioon');
    expect(result[0].value).toBe('Q861911');
  });

  it('inglise UI: idToLabel annab ingliskeelse labeli', () => {
    const input = [item('oration', 'oration', 6)];
    const labelToId = { 'Oration': 'Q861911' };
    const idToLabel = { 'Q861911': 'oration' }; // inglise keele kaart
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result[0].label).toBe('oration');
  });

  it('tundmatu label ilma kaardita → läbib muutmata', () => {
    const input = [item('uus-žanr', 'uus-žanr', 2)];
    const result = mergeFacetItems(input, {}, {});
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe('uus-žanr');
    expect(result[0].label).toBe('uus-žanr');
  });

  it('tühi nimekiri → tühi tulemus', () => {
    expect(mergeFacetItems([])).toEqual([]);
  });

  it('kolm faceti kaks ühte Q-koodi → üks kirje, üks eraldi', () => {
    const input = [
      item('disputatsioon', 'disputatsioon', 15),
      item('Disputatsioon', 'Disputatsioon', 5),
      item('oratsioon', 'oratsioon', 8),
    ];
    const labelToId = {
      'Disputatsioon': 'Q789',
      'disputatsioon': 'Q789',
      'Oratsioon': 'Q861911',
    };
    const idToLabel = { 'Q789': 'disputatsioon', 'Q861911': 'oratsioon' };
    const result = mergeFacetItems(input, labelToId, idToLabel);
    expect(result).toHaveLength(2);
    const disp = result.find(r => r.value === 'Q789');
    expect(disp?.count).toBe(20);
  });
});
