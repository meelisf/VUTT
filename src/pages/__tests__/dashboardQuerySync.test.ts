import { describe, it, expect } from 'vitest';
import { sortAfterQueryChange } from '../dashboardQuerySync';

describe('sortAfterQueryChange', () => {
  it('tühjenenud päring + relevance → year_asc (ka vihje vastuvõtul, tahtlik)', () => {
    expect(sortAfterQueryChange('relevance', '')).toBe('year_asc');
  });
  it('tekst jääb → sort ei muutu', () => {
    expect(sortAfterQueryChange('relevance', 'constitu')).toBe('relevance');
  });
  it('muu sort ei muutu ka tühjenemisel', () => {
    expect(sortAfterQueryChange('az', '')).toBe('az');
  });
});
