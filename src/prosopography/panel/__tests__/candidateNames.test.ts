import { describe, it, expect } from 'vitest';
import { chooseCardName, nameMatches } from '../candidateNames';
import type { CandidateName } from '../types';

const LUDEN: CandidateName[] = [
  { text: 'Lorenz Luden', lang: 'et', kind: 'label' },
  { text: 'Laurentius Ludenius', lang: 'mul', kind: 'alias' },
];

describe('nameMatches — sõna-eesliide', () => {
  it('iga otsitud sõna on mõne sõna algus', () => {
    expect(nameMatches('Luden', 'Laurentius Ludenius')).toBe(true);
    expect(nameMatches('laur lud', 'Laurentius Ludenius')).toBe(true);
    expect(nameMatches('denius', 'Laurentius Ludenius')).toBe(false);
  });
  it('NFC, tõstutundetu, ß = ss', () => {
    expect(nameMatches('GROSS', 'Johann Groß')).toBe(true);
    expect(nameMatches('müller', 'Müller')).toBe(true);
  });
});

describe('chooseCardName — spekk §5.2', () => {
  it('täpne täisnimi', () => {
    expect(chooseCardName('Laurentius Ludenius', LUDEN, 'Lorenz Luden').chosen).toBe('Laurentius Ludenius');
  });
  it('nimeosa → täisnimi, mis sisaldab', () => {
    expect(chooseCardName('Ludenius', LUDEN, 'Lorenz Luden').chosen).toBe('Laurentius Ludenius');
  });
  it('mitu sobivat → keelejärjestus la → mul → de → en → et', () => {
    expect(chooseCardName('Luden', LUDEN, 'Lorenz Luden').chosen).toBe('Laurentius Ludenius');
  });
  it('ainult põhinimi sobib', () => {
    expect(chooseCardName('Lorenz', LUDEN, 'Lorenz Luden').chosen).toBe('Lorenz Luden');
  });
  it('ükski ei sobi → põhinimi, mitte otsitud sõna', () => {
    expect(chooseCardName('jurist', LUDEN, 'Lorenz Luden').chosen).toBe('Lorenz Luden');
  });
  it('valimata nimed lähevad others-i, kordusteta', () => {
    const r = chooseCardName('Ludenius', [...LUDEN, { text: 'Lorenz Luden', lang: 'de', kind: 'alias' }], 'Lorenz Luden');
    expect(r.others).toEqual(['Lorenz Luden']);
    expect(r.matched).toEqual(['Laurentius Ludenius']);
  });
});
