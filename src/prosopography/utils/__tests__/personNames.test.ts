import { describe, expect, it } from 'vitest';
import { looksLikeOtherName, possibleNameChange, splitNames, joinNames } from '../personNames';

// SAMAD juhtumid mis `tests/test_person_names.py::OTHER_NAME_CASES` — vormi vihje
// (klient) ja loendi filter (server) peavad andma sama vastuse (ADR 0083).
const CASES: [string, string, boolean][] = [
  ["Johan Stiernstråle", "Johannes Erici Stregnensis", true],
  ["Johann Erici Strognensis", "Johannes Erici Stregnensis", false],
  ["Emund Gripenhielm", "Emundus Figrelius", true],
  ["Olaus Swebilius", "Olaus Svebilius", false],
  ["Olavus Suebilius", "Olaus Svebilius", false],
  ["Ol. Swebelius", "Olaus Svebilius", false],
  ["Olao Svebilio", "Olaus Svebilius", false],
  ["Samuel von Pufendorf", "Samuel Pufendorf", false],
  ["Laurentius Ludenius", "Lorenz Luden", false],
  ["Ludenius", "Lorenz Luden", false],
  ["Nicolaus (Niclas) Silfverskiöld", "Nicolaus Hyltenius", true],
  ["", "Lorenz Luden", false],
  ["Sven Camenhjelm", "Sven Caméen", true],
  ["Petrus Cederschiöld", "Petrus Elias Gavelius", true],
  ["Rosine Elisabeth Marckthaler", "Rosine Elisabeth Fischer", true],
  ["Nicolaus Drysander", "Nicolaus Querculander", true],
  ["Scardanelli", "Friedrich Hölderlin", true],
  ["Esbernus Leimonius", "Esbernus Leiman", false],
  ["Georgius Langius", "Georgius Lange", false],
  ["Nicolaus Duncan", "Nicolaus Dunkanus", false],
  ["Joannes Paullius", "Joannes Pauli", false],
  ["Bengt Skydde", "Bengt Skytte", false],
  ["Jonas Johannis Scarinius", "Jonas Johannis Scarensis", false],
  ["Ericus Golstenius", "Ericus Gulsteen", false],
  ["Elaus Tellerus", "Elaus Tollenius", false],
  ["Jānis Rytter", "Jānis Reiters", false],
  ["Johan Heinrich Gerdtz", "Johann Heinrich Gerth", false],
  ["Michael Dau jun.", "Michael Dau", false],
  ["Michael Dau junior", "Michael Dau", false],
  ["Ammersbach, Heinrich, Ev. Theologe, Prof. an der Univ. Jena, später Pastor in Halberstadt", "Heinrich Ammersbach", false],
  ["Petrus Laurentii Arbogensis", "Petrus Laurentii", false],
  ["Friedrich Breckling Holsatus", "Friedrich Breckling", false],
  ["Kamenios, Jōannes Amos", "Johann Amos Comenius", false],
  ["Christianus Klockhoff", "Christianus Clocovius", false],
  ["Johannes Chemnitius", "Johannes Kamnitz", false],
  ["Erik Jönsson", "Erik Dahlberg", true],
  ["Lars Liljenstolpe", "Laurentius Micrander", true],
  ["Jacob Pistorius", "Jacob Becker", true],
];

describe('looksLikeOtherName', () => {
  it.each(CASES)('%s vs %s → %s', (alias, label, expected) => {
    expect(looksLikeOtherName(alias, label)).toBe(expected);
  });
});

describe('possibleNameChange', () => {
  it('ainult siis, kui nimeajalugu on tühi', () => {
    expect(possibleNameChange({ label: 'Emundus Figrelius', aliases: ['Emund Gripenhielm'] })).toBe(true);
    expect(possibleNameChange({ label: 'Emundus Figrelius', aliases: ['Emund Gripenhielm'],
      names: [{ label: 'Emund Gripenhielm', type: 'ennobled' }] })).toBe(false);
    expect(possibleNameChange({ label: 'Olaus Svebilius', aliases: ['Olaus Swebilius'] })).toBe(false);
  });
});

describe('splitNames / joinNames', () => {
  it('liigiga kuju ei ole samal ajal variant', () => {
    const { aliases, names } = joinNames(['Emund Gripenhielm', 'Emundus Figrelfius'],
      [{ label: 'Emund Gripenhielm', type: 'ennobled', from: '1654', to: '', source: '', notes: '' }]);
    expect(aliases).toEqual(['Emundus Figrelfius']);
    expect(names).toEqual([{ label: 'Emund Gripenhielm', type: 'ennobled', from: 1654, to: null, source: null, notes: null }]);
  });
  it('tühjad read jäävad välja', () => {
    expect(joinNames([], [{ label: '  ', type: 'other', from: '', to: '', source: '', notes: '' }]).names).toEqual([]);
  });
  it('kaardilt mustandiks ja tagasi', () => {
    const draft = splitNames([{ label: 'A B', type: 'married', from: 1700, to: null, source: 'X', notes: null }]);
    expect(draft).toEqual([{ label: 'A B', type: 'married', from: '1700', to: '', source: 'X', notes: '' }]);
  });
});
