import { describe, it, expect } from 'vitest';
import { lineDiff } from '../lineDiff';

describe('lineDiff', () => {
  it('märgib täiesti erineva üherealise teksti del + add', () => {
    expect(lineDiff('A', 'C')).toEqual([
      { type: 'del', text: 'A' },
      { type: 'add', text: 'C' },
    ]);
  });

  it('identne tekst on ainult context', () => {
    expect(lineDiff('sama\ntekst', 'sama\ntekst')).toEqual([
      { type: 'context', text: 'sama' },
      { type: 'context', text: 'tekst' },
    ]);
  });

  it('säilitab muutmata read ja märgib ainult muudetud rea', () => {
    const res = lineDiff('rida1\nvana\nrida3', 'rida1\nuus\nrida3');
    expect(res).toEqual([
      { type: 'context', text: 'rida1' },
      { type: 'del', text: 'vana' },
      { type: 'add', text: 'uus' },
      { type: 'context', text: 'rida3' },
    ]);
  });

  it('lisatud rida = add', () => {
    expect(lineDiff('rida1', 'rida1\nrida2')).toEqual([
      { type: 'context', text: 'rida1' },
      { type: 'add', text: 'rida2' },
    ]);
  });

  it('eemaldatud rida = del', () => {
    expect(lineDiff('rida1\nrida2', 'rida1')).toEqual([
      { type: 'context', text: 'rida1' },
      { type: 'del', text: 'rida2' },
    ]);
  });

  it('tühi vana → kõik add', () => {
    expect(lineDiff('', 'uus')).toEqual([{ type: 'add', text: 'uus' }]);
  });
});
