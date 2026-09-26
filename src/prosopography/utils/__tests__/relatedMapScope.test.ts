import { describe, it, expect } from 'vitest';
import { relatedMapScope } from '../relatedMapScope';

const scope = { collection: 'academia-gustavo-carolina', work_set: undefined };

describe('relatedMapScope', () => {
  it('tavaline kaart rakendab valiku alati', () => {
    expect(relatedMapScope('', null, scope)).toEqual({ applied: true, filters: scope });
  });

  it('seoste kaart eirab valikut vaikimisi', () => {
    expect(relatedMapScope('vutt:Pu837uz', null, scope)).toEqual({ applied: false, filters: {} });
  });

  it('seoste kaart eirab ka töökollektsiooni', () => {
    const r = relatedMapScope('vutt:Pu837uz', null, { work_set: 'abc' });
    expect(r.filters).toEqual({});
  });

  it('related_scope=collection piirab seoste kaardi valikuga', () => {
    expect(relatedMapScope('vutt:Pu837uz', 'collection', scope)).toEqual({ applied: true, filters: scope });
  });

  it('tundmatu related_scope väärtus ei piira', () => {
    expect(relatedMapScope('vutt:Pu837uz', 'muu', scope).applied).toBe(false);
  });
});
