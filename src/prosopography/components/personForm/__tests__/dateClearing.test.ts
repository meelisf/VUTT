import { describe, it, expect } from 'vitest';
import { draftToPayload, recordToDraft } from '../helpers';
import type { ProsopoRecord } from '../../../types';

// Sünni-/surmaaasta kustutamine EI salvestunud: `draftToPayload` tegi
// `buildDatePayload(draft.birth) ?? original.birth`, nii et tühi mustand
// langes tagasi vanale väärtusele. Ainus viis välja tühjendada oli kirjutada
// sinna `0000`, mis jäi kaardile alles (vt vutt:P5jq6zn).

const isik = {
  id: 'vutt:Ptest01',
  name: { label: 'Carolus Lund', aliases: [] },
  birth: { date: '1650-01-01', precision: 'year', is_circa: false, place: null },
  death: { date: '1700-01-01', precision: 'year', is_circa: false, place: null },
  identifiers: [],
} as unknown as ProsopoRecord;

describe('sünni- ja surmaaja tühjendamine', () => {
  it('tühi aasta kustutab sünniaja, mitte ei taasta vana', () => {
    const draft = { ...recordToDraft(isik), birth: { ...recordToDraft(isik).birth, year: '' } };
    expect(draftToPayload(draft, isik).birth).toBeNull();
  });

  it('tühi aasta kustutab surmaaja', () => {
    const draft = { ...recordToDraft(isik), death: { ...recordToDraft(isik).death, year: '' } };
    expect(draftToPayload(draft, isik).death).toBeNull();
  });

  it('täidetud aasta salvestub endiselt', () => {
    const base = recordToDraft(isik);
    const draft = { ...base, birth: { ...base.birth, year: '1651' } };
    expect((draftToPayload(draft, isik).birth as any).date).toBe('1651-01-01');
  });

  it('teise välja muutmine ei kustuta puutumata kuupäevi', () => {
    const draft = { ...recordToDraft(isik), name_label: 'Carl Lund' };
    const payload = draftToPayload(draft, isik);
    expect((payload.birth as any).date).toBe('1650-01-01');
    expect((payload.death as any).date).toBe('1700-01-01');
  });

  it('0000 laetakse vormi tühjana, mitte aastana null', () => {
    const nulliga = {
      ...isik,
      birth: { date: '0000-00-00', precision: 'day', is_circa: false, place: null },
    } as unknown as ProsopoRecord;
    expect(recordToDraft(nulliga).birth.year).toBe('');
  });

  it('0000-kaardi salvestamine tühjendab välja', () => {
    const nulliga = {
      ...isik,
      birth: { date: '0000-00-00', precision: 'day', is_circa: false, place: null },
    } as unknown as ProsopoRecord;
    expect(draftToPayload(recordToDraft(nulliga), nulliga).birth).toBeNull();
  });
});
