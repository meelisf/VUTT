import { describe, it, expect } from 'vitest';
import { buildIdMap, buildLabelToIdMap } from '../buildObjectIdMap';

// --- buildIdMap ---

describe('buildIdMap', () => {
  it('tagastab tühja kaardi tühja hits-massiivi korral', () => {
    expect(buildIdMap([], 'genre_object', 'et')).toEqual({});
  });

  it('loob Q-kood → label kirje', () => {
    const hits = [{ genre_object: [{ id: 'Q861911', label: 'oratsioon', labels: { et: 'oratsioon', en: 'oration' } }] }];
    const map = buildIdMap(hits, 'genre_object', 'et');
    expect(map['Q861911']).toBe('Oratsioon');
  });

  it('teeb esimese tähe suureks', () => {
    const hits = [{ genre_object: [{ id: 'Q1', label: 'funeral sermon', labels: { en: 'funeral sermon' } }] }];
    expect(buildIdMap(hits, 'genre_object', 'en')['Q1']).toBe('Funeral sermon');
  });

  it('eelistab nõutud keelt et-le', () => {
    const hits = [{ genre_object: [{ id: 'Q1', labels: { et: 'oratsioon', en: 'oration' } }] }];
    expect(buildIdMap(hits, 'genre_object', 'en')['Q1']).toBe('Oration');
    expect(buildIdMap(hits, 'genre_object', 'et')['Q1']).toBe('Oratsioon');
  });

  it('langeb et-le kui nõutud keel puudub', () => {
    const hits = [{ genre_object: [{ id: 'Q1', labels: { et: 'oratsioon' } }] }];
    expect(buildIdMap(hits, 'genre_object', 'en')['Q1']).toBe('Oratsioon');
  });

  it('langeb item.label-ile kui labels puudub', () => {
    const hits = [{ genre_object: [{ id: 'Q1', label: 'oratsioon' }] }];
    expect(buildIdMap(hits, 'genre_object', 'et')['Q1']).toBe('Oratsioon');
  });

  it('lisab label-variandid (raw + capitalized) kaardile', () => {
    const hits = [{ genre_object: [{ id: 'Q1', label: 'oratsioon', labels: { et: 'oratsioon', en: 'oration' } }] }];
    const map = buildIdMap(hits, 'genre_object', 'et');
    expect(map['oratsioon']).toBe('Oratsioon');
    expect(map['Oratsioon']).toBe('Oratsioon');
    expect(map['oration']).toBe('Oratsioon');
    expect(map['Oration']).toBe('Oratsioon');
  });

  it('jätab vahele item-id kellel puudub id', () => {
    const hits = [{ genre_object: [{ label: 'tundmatu', labels: { et: 'tundmatu' } }] }];
    expect(buildIdMap(hits, 'genre_object', 'et')).toEqual({});
  });

  it('jätab vahele item-id kellel puudub nii labels kui label', () => {
    const hits = [{ genre_object: [{ id: 'Q1' }] }];
    expect(buildIdMap(hits, 'genre_object', 'et')).toEqual({});
  });

  it('jätab vahele hiti kus väli puudub', () => {
    const hits = [{ title: 'teos ilma žanrita' }, { genre_object: null }];
    expect(buildIdMap(hits, 'genre_object', 'et')).toEqual({});
  });

  it('töötab üksik-objektiga (mitte massiiviga)', () => {
    const hits = [{ genre_object: { id: 'Q1', labels: { et: 'oratsioon' } } }];
    expect(buildIdMap(hits, 'genre_object', 'et')['Q1']).toBe('Oratsioon');
  });

  it('mitme hiti ja sama Q-koodiga — viimane väärtus jääb (idempotentne)', () => {
    const hits = [
      { genre_object: [{ id: 'Q1', labels: { et: 'oratsioon' } }] },
      { genre_object: [{ id: 'Q1', labels: { et: 'oratsioon' } }] },
    ];
    const map = buildIdMap(hits, 'genre_object', 'et');
    expect(map['Q1']).toBe('Oratsioon');
  });

  it('kasutab enrichedLabels kui on olemas', () => {
    const hits = [{ genre_object: [{ id: 'Q1', labels: { et: 'vana label' } }] }];
    const enriched = { 'Q1': { et: 'uus label' } };
    expect(buildIdMap(hits, 'genre_object', 'et', enriched)['Q1']).toBe('Uus label');
  });

  it('töötab suvalise väljanimega (type_object, tags_object)', () => {
    const hits = [{ type_object: { id: 'Q2', labels: { et: 'kõne' } } }];
    expect(buildIdMap(hits, 'type_object', 'et')['Q2']).toBe('Kõne');
  });
});

// --- buildLabelToIdMap ---

describe('buildLabelToIdMap', () => {
  it('tagastab tühja kaardi tühja hits-massiivi korral', () => {
    expect(buildLabelToIdMap([], 'genre_object', 'et')).toEqual({});
  });

  it('loob label → Q-kood kirje', () => {
    const hits = [{ genre_object: [{ id: 'Q1', labels: { et: 'oratsioon', en: 'oration' } }] }];
    const map = buildLabelToIdMap(hits, 'genre_object', 'et');
    expect(map['oratsioon']).toBe('Q1');
    expect(map['Oratsioon']).toBe('Q1');
  });

  it('kasutab nõutud keele labeli', () => {
    const hits = [{ genre_object: [{ id: 'Q1', labels: { et: 'oratsioon', en: 'oration' } }] }];
    expect(buildLabelToIdMap(hits, 'genre_object', 'en')['oration']).toBe('Q1');
    expect(buildLabelToIdMap(hits, 'genre_object', 'en')['Oration']).toBe('Q1');
  });

  it('langeb et-le kui nõutud keel puudub', () => {
    const hits = [{ genre_object: [{ id: 'Q1', labels: { et: 'oratsioon' } }] }];
    expect(buildLabelToIdMap(hits, 'genre_object', 'en')['oratsioon']).toBe('Q1');
  });

  it('jätab vahele item-id kellel puudub id', () => {
    const hits = [{ genre_object: [{ labels: { et: 'tundmatu' } }] }];
    expect(buildLabelToIdMap(hits, 'genre_object', 'et')).toEqual({});
  });

  it('jätab vahele item-id kellel puudub labels', () => {
    const hits = [{ genre_object: [{ id: 'Q1', label: 'oratsioon' }] }];
    expect(buildLabelToIdMap(hits, 'genre_object', 'et')).toEqual({});
  });
});
