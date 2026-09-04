import { describe, it, expect } from 'vitest';
import { mergeAdaIntoForm } from '../adaApi';

const ADA = {
  title: '65 kirja Karl Morgensternile',
  year: '1812',
  year_display: '1812-1823',
  languages: ['deu'],
};

describe('mergeAdaIntoForm', () => {
  it('täidab tühjad väljad', () => {
    const { vaartused } = mergeAdaIntoForm({ title: '', year: '' }, ADA);
    expect(vaartused.title).toBe('65 kirja Karl Morgensternile');
    expect(vaartused.year).toBe('1812');
  });

  it('EI kirjuta üle admini käsitsi sisestatut', () => {
    const { vaartused } = mergeAdaIntoForm({ title: 'Minu pealkiri', year: '' }, ADA);
    expect(vaartused.title).toBe('Minu pealkiri');
    expect(vaartused.year).toBe('1812');
  });

  it('loetleb väljad, mille ADA väärtus erineb', () => {
    const { ulekirjutatavad } = mergeAdaIntoForm({ title: 'Minu pealkiri', year: '' }, ADA);
    expect(ulekirjutatavad.map((u) => u.vali)).toEqual(['title']);
    expect(ulekirjutatavad[0].adaVaartus).toBe('65 kirja Karl Morgensternile');
  });

  it('identne väärtus ei ole ülekirjutatav', () => {
    const { ulekirjutatavad } = mergeAdaIntoForm({ title: ADA.title, year: '1812' }, ADA);
    expect(ulekirjutatavad).toEqual([]);
  });

  it('tühi ADA väli ei kustuta admini oma', () => {
    const { vaartused } = mergeAdaIntoForm({ title: 'Minu' }, { ...ADA, title: '' });
    expect(vaartused.title).toBe('Minu');
  });
});
