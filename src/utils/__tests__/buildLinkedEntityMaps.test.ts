import { describe, it, expect } from 'vitest';
import { buildLinkedEntityMaps, collectLinkedEntities } from '../buildLinkedEntityMaps';
import type { LinkedEntity } from '../../types/LinkedEntity';

// ---------------------------------------------------------------------------
// Testifixturid
// ---------------------------------------------------------------------------

const trukis: LinkedEntity = {
  id: 'Q1261026',
  label: 'trükis',
  source: 'wikidata',
  labels: { et: 'trükis', en: 'printed matter', de: 'Druckerzeugnis' },
};

const kasikiri: LinkedEntity = {
  id: 'Q87167',
  label: 'käsikiri',
  source: 'wikidata',
  labels: { et: 'käsikiri', en: 'manuscript', de: 'Handschrift' },
};

const disputatsioon: LinkedEntity = {
  id: 'Q1123131',
  label: 'disputatsioon',
  source: 'wikidata',
  labels: { et: 'disputatsioon', en: 'disputation', de: 'Disputation' },
};

const oratsioon: LinkedEntity = {
  id: 'Q861911',
  label: 'oratsioon',
  source: 'wikidata',
  labels: { et: 'oratsioon', en: 'oration', de: 'Rede' },
};

// ---------------------------------------------------------------------------
// collectLinkedEntities — kogub LinkedEntity objektid Work[] massiivist
// ---------------------------------------------------------------------------
describe('collectLinkedEntities', () => {
  it('üksik objekt (mitte massiiv) → tagastab ühe elemendi', () => {
    // REGRESSIOON: type väli on üksik LinkedEntity, mitte massiiv.
    // Dashboard kutsus w => (w as any).type_object (puudus), nüüd on w => w.type.
    const works = [{ type: trukis }, { type: kasikiri }];
    const result = collectLinkedEntities(works, w => (w as any).type);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('Q1261026');
    expect(result[1].id).toBe('Q87167');
  });

  it('massiiv väljas (genre) → kõik elemendid eraldi', () => {
    const works = [
      { genre: [disputatsioon, oratsioon] },
      { genre: [disputatsioon] },
    ];
    const result = collectLinkedEntities(works, w => (w as any).genre);
    expect(result).toHaveLength(3);
  });

  it('null/undefined → jäetakse vahele', () => {
    const works = [{ type: trukis }, { type: null }, { type: undefined }];
    const result = collectLinkedEntities(works, w => (w as any).type);
    expect(result).toHaveLength(1);
  });

  it('tühi massiiv → tühi tulemus', () => {
    expect(collectLinkedEntities([], w => (w as any).type)).toEqual([]);
  });

  it('getter mis tagastab puuduva välja (type_object normaliseeritud teoses) → tühi', () => {
    // REGRESSIOON: küsimine type_object (mitte type) annaks alati tühi nimekirja,
    // sest normalizeWork mapis hit.type_object → work.type
    const works = [{ type: trukis, genre: [disputatsioon] }];
    const wrongResult = collectLinkedEntities(works, w => (w as any).type_object);
    expect(wrongResult).toHaveLength(0); // type_object puudub normaliseeritud Work-il

    const correctResult = collectLinkedEntities(works, w => (w as any).type);
    expect(correctResult).toHaveLength(1); // type on õige väli
  });
});

// ---------------------------------------------------------------------------
// buildLinkedEntityMaps — ehitab idToLabel ja labelToId kaardid
// ---------------------------------------------------------------------------
describe('buildLinkedEntityMaps', () => {
  it('üksik type LinkedEntity → idToLabel sisaldab Q-koodi', () => {
    const result = buildLinkedEntityMaps([trukis], 'et');
    expect(result.idToLabel['Q1261026']).toBe('Trükis');
  });

  it('eesti keeles → eestikeelne label', () => {
    const result = buildLinkedEntityMaps([trukis, kasikiri], 'et');
    expect(result.idToLabel['Q1261026']).toBe('Trükis');
    expect(result.idToLabel['Q87167']).toBe('Käsikiri');
  });

  it('inglise keeles → ingliskeelne label', () => {
    const result = buildLinkedEntityMaps([trukis, kasikiri], 'en');
    expect(result.idToLabel['Q1261026']).toBe('Printed matter');
    expect(result.idToLabel['Q87167']).toBe('Manuscript');
  });

  it('labelToId: eestikeelne label → Q-kood', () => {
    const result = buildLinkedEntityMaps([trukis], 'et');
    expect(result.labelToId['trükis']).toBe('Q1261026');
    expect(result.labelToId['Trükis']).toBe('Q1261026');
  });

  it('kõik keelevariantid → idToLabel kõigile', () => {
    // Q-koodile viitab nii "trükis", "printed matter", "Druckerzeugnis"
    const result = buildLinkedEntityMaps([trukis], 'et');
    expect(result.idToLabel['printed matter']).toBe('Trükis');
    expect(result.idToLabel['Druckerzeugnis']).toBe('Trükis');
  });

  it('enrichedLabels overrides labels field', () => {
    const enriched: Record<string, Record<string, string>> = {
      'Q861911': { et: 'kõne', en: 'speech' }, // serveri canonical label
    };
    const result = buildLinkedEntityMaps([oratsioon], 'et', enriched);
    // enrichedLabels['Q861911']['et'] = 'kõne' > labels.et = 'oratsioon'
    expect(result.idToLabel['Q861911']).toBe('Kõne');
  });

  it('enrichedLabels puudumisel tagastab labels välja labeli', () => {
    const result = buildLinkedEntityMaps([oratsioon], 'et');
    expect(result.idToLabel['Q861911']).toBe('Oratsioon');
  });

  it('mitu erinevat entity → kõik kaardis', () => {
    const result = buildLinkedEntityMaps([disputatsioon, oratsioon], 'et');
    expect(Object.keys(result.idToLabel)).toContain('Q1123131');
    expect(Object.keys(result.idToLabel)).toContain('Q861911');
  });

  it('tühi massiiv → tühjad kaardid', () => {
    const result = buildLinkedEntityMaps([], 'et');
    expect(result.idToLabel).toEqual({});
    expect(result.labelToId).toEqual({});
  });

  it('null elemendid → jäetakse vahele', () => {
    const result = buildLinkedEntityMaps([null, trukis, undefined], 'et');
    expect(result.idToLabel['Q1261026']).toBe('Trükis');
    expect(Object.keys(result.idToLabel).length).toBeGreaterThan(0);
  });

  it('ilma Q-koodita entity → label kaardistub idToLabel-is aga labelToId jääb tühjaks', () => {
    const noId: LinkedEntity = {
      id: null,
      label: 'käsikiri',
      source: 'manual',
      labels: { et: 'käsikiri', en: 'manuscript' },
    };
    const result = buildLinkedEntityMaps([noId], 'et');
    expect(result.idToLabel['käsikiri']).toBe('Käsikiri');
    // labelToId vajab id-d, seega tühi
    expect(result.labelToId['käsikiri']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dashboard stsenaarium — typeIdMap type_object vs type regressioon
// ---------------------------------------------------------------------------
describe('Dashboard typeIdMap stsenaarium', () => {
  it('normalizeWork-sarnane struktuur: type väljas → typeIdMap täidetud', () => {
    // normalizeWork: type: hit.type_object ?? null
    // Seega normaliseeritud Work-il on .type, MITTE .type_object
    const works = [
      { type: trukis, genre: [disputatsioon] },
      { type: kasikiri, genre: [oratsioon] },
      { type: null, genre: [] },
    ];

    const typeItems = collectLinkedEntities(works, w => (w as any).type);
    const { idToLabel: typeIdMap } = buildLinkedEntityMaps(typeItems, 'et');

    expect(typeIdMap['Q1261026']).toBe('Trükis');
    expect(typeIdMap['Q87167']).toBe('Käsikiri');
  });

  it('vale getter (type_object) → typeIdMap tühi — regressioonitesti', () => {
    // See oli viga enne parandust: Dashboard kasutas w => (w as any).type_object
    const works = [{ type: trukis }, { type: kasikiri }];
    const wrongItems = collectLinkedEntities(works, w => (w as any).type_object);
    const { idToLabel } = buildLinkedEntityMaps(wrongItems, 'et');
    expect(Object.keys(idToLabel)).toHaveLength(0); // tühi — viga
  });

  it('õige getter (type) → typeIdMap täidetud — fix kinnitus', () => {
    const works = [{ type: trukis }, { type: kasikiri }];
    const correctItems = collectLinkedEntities(works, w => (w as any).type);
    const { idToLabel } = buildLinkedEntityMaps(correctItems, 'et');
    expect(idToLabel['Q1261026']).toBe('Trükis');
    expect(idToLabel['Q87167']).toBe('Käsikiri');
  });
});
