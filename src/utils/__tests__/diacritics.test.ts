import { describe, expect, it } from 'vitest';
import { normalizeForSearch } from '../diacritics';

describe('normalizeForSearch', () => {
  it('eemaldab diakriitikud ja väiketähestab', () => {
    expect(normalizeForSearch('Jõgi')).toBe('jogi');
    expect(normalizeForSearch('VENNASTEKOGUDUS')).toBe('vennastekogudus');
  });

  it('lõikab servatühikud ja talub tühja sisendit', () => {
    expect(normalizeForSearch('  Tartu  ')).toBe('tartu');
    expect(normalizeForSearch('')).toBe('');
  });
});
