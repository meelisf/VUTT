import { describe, it, expect, beforeEach } from 'vitest';
import { primeSearch, getLastSearchDisplay } from '../VuttSearchPanel';

describe('primeSearch', () => {
  beforeEach(() => {
    primeSearch(''); // reset
  });

  it('seab lastSearchDisplay antud termini peale', () => {
    primeSearch('metaphysica');
    expect(getLastSearchDisplay()).toBe('metaphysica');
  });

  it('tühi string kustutab eelmise väärtuse', () => {
    primeSearch('eelmine');
    primeSearch('');
    expect(getLastSearchDisplay()).toBe('');
  });
});
