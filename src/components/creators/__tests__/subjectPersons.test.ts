import { describe, expect, it } from 'vitest';
import { acceptSubjectPerson, isSubjectPerson } from '../subjectPersons';
import type { LinkedEntity } from '../../../types/LinkedEntity';

const e = (o: Partial<LinkedEntity>): LinkedEntity => ({ id: null, label: 'X', source: 'manual', ...o });

describe('isSubjectPerson (#743)', () => {
  it('VUTT-i isik ja isikuks märgitud välise ID-ga kirje on „Kelle kohta"', () => {
    expect(isSubjectPerson(e({ id: 'vutt:Pabc', source: 'local' }))).toBe(true);
    expect(isSubjectPerson(e({ id: 'Q123', source: 'wikidata', entity_type: 'person' }))).toBe(true);
  });
  it('teema, vabatekst ja ID-ta isik jäävad märksõnadeks', () => {
    expect(isSubjectPerson('teoloogia')).toBe(false);
    expect(isSubjectPerson(e({ id: 'Q9', source: 'wikidata' }))).toBe(false);
    expect(isSubjectPerson(e({ entity_type: 'person' }))).toBe(false);
  });
});

describe('acceptSubjectPerson (#743)', () => {
  it('VUTT-i ja välisallika isik võetakse vastu ja märgitakse isikuks', () => {
    expect(acceptSubjectPerson(e({ id: 'vutt:Pabc', source: 'local' }))?.entity_type).toBe('person');
    expect(acceptSubjectPerson(e({ id: 'GND:118', source: 'gnd' }))?.entity_type).toBe('person');
    expect(acceptSubjectPerson(e({ id: 'Q1', source: 'wikidata' }))?.entity_type).toBe('person');
  });
  it('vabatekstiline või sidumata nimi lükatakse tagasi', () => {
    expect(acceptSubjectPerson(null)).toBeNull();
    expect(acceptSubjectPerson(e({ source: 'manual' }))).toBeNull();
    expect(acceptSubjectPerson(e({ id: 'local-x', source: 'manual' }))).toBeNull();
  });
});
