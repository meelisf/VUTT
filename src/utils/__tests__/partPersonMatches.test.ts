import { describe, expect, it } from 'vitest';
import { partPersonMatches } from '../partPersonMatches';

const codex = {
  title: 'Johann Fischeri kirjad koodeksis HAB Wolfenbüttel',
  authors_text: [],
  part_persons_text: ['Joachim Salemann', 'Joachimus Saleman', 'Johann Fischer', 'Johannes Gezelius'],
};

describe('partPersonMatches', () => {
  it('leiab osade isiku, kui teose enda väljad vastet ei seleta', () => {
    expect(partPersonMatches(codex, 'salemann')).toEqual(['Joachim Salemann']);
  });

  it('viimane sõna on eesliide nagu Meilis', () => {
    expect(partPersonMatches(codex, 'Gezel')).toEqual(['Johannes Gezelius']);
  });

  it('pealkirjas olev nimi ei anna vihjet', () => {
    expect(partPersonMatches(codex, 'Fischer')).toEqual([]);
  });

  it('teose isik ei anna vihjet', () => {
    expect(partPersonMatches({ ...codex, authors_text: ['Joachim Salemann'] }, 'Salemann')).toEqual([]);
  });

  it('diakriitikud, ß ja ſ ei sega', () => {
    const w = { title: 'X', part_persons_text: ['Hans Groß', 'Jöns Schmidt'] };
    expect(partPersonMatches(w, 'gross')).toEqual(['Hans Groß']);
    expect(partPersonMatches(w, 'jons schmidt')).toEqual(['Jöns Schmidt']);
  });

  it('tühi päring või osadeta teos ei anna vihjet', () => {
    expect(partPersonMatches(codex, '  ')).toEqual([]);
    expect(partPersonMatches({ title: 'X' }, 'Salemann')).toEqual([]);
  });

  it('mittelõplik sõna peab olema terve', () => {
    expect(partPersonMatches(codex, 'Sale xyz')).toEqual([]);
    expect(partPersonMatches(codex, 'Salemann xyz')).toEqual(['Joachim Salemann']);
  });
});
