import { describe, it, expect } from 'vitest';
import { normalizeExtId } from '../externalIds';

// Vt issue #240 ja server/prosopography/ext_ids.py — sama reegel mõlemas otsas.
describe('normalizeExtId', () => {
  it('eemaldab skeemi eesliite', () => {
    expect(normalizeExtId('gnd', 'GND:1029967695')).toBe('1029967695');
    expect(normalizeExtId('viaf', 'VIAF:316024504')).toBe('316024504');
    expect(normalizeExtId('wikidata', 'wikidata:Q42')).toBe('Q42');
    expect(normalizeExtId('album_academicum', 'AA:341')).toBe('341');
  });

  it('trimmib tühikud', () => {
    expect(normalizeExtId('album_academicum', ' 243 ')).toBe('243');
  });

  it('viib Wikidata Q-tähe suureks', () => {
    expect(normalizeExtId('wikidata', 'q42')).toBe('Q42');
  });

  it('viib GND kontrollnumbri suureks', () => {
    expect(normalizeExtId('gnd', '104367439x')).toBe('104367439X');
  });

  it('ei eemalda võõra skeemi eesliidet', () => {
    expect(normalizeExtId('gnd', 'AA:341')).toBe('AA:341');
  });

  it('tundmatut skeemi ainult trimmib', () => {
    expect(normalizeExtId('orcid', ' 0000-0002 ')).toBe('0000-0002');
  });

  it('tühi väärtus annab tühja stringi', () => {
    expect(normalizeExtId('gnd', '')).toBe('');
    expect(normalizeExtId('gnd', 'GND:')).toBe('');
  });
});
