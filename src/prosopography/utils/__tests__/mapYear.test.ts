import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_YEAR, deriveMapYear } from '../mapYear';

describe('deriveMapYear', () => {
  it('kasutab ilma filtrita vaikimisi aastat', () => {
    expect(deriveMapYear({})).toBe(DEFAULT_MAP_YEAR);
  });

  it('kasutab aastavahemiku keskpunkti', () => {
    expect(deriveMapYear({ year_from: 1632, year_to: 1710 })).toBe(1671);
  });

  it('kasutab ühepoolse vahemiku olemasolevat piiri', () => {
    expect(deriveMapYear({ year_from: 1640 })).toBe(1640);
    expect(deriveMapYear({ year_to: 1700 })).toBe(1700);
  });

  it('eelistab üldist aastafiltrit vanale immatrikuleerimisaasta filtrile', () => {
    expect(deriveMapYear({
      year_from: 1600,
      year_to: 1700,
      imm_year_from: 1800,
      imm_year_to: 1900,
    })).toBe(1650);
  });

  it('toetab vanu immatrikuleerimisaasta URL-e', () => {
    expect(deriveMapYear({ imm_year_from: 1620, imm_year_to: 1640 })).toBe(1630);
  });
});
