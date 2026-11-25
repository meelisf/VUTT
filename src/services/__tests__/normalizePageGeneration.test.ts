import { describe, expect, it } from 'vitest';
import { normalizePage } from '../meiliService';

// ADR 0089 p 4: Meili lehedokument kannab lehestiku asenduse põlvkonda.
describe('normalizePage — content_generation', () => {
  it('kannab põlvkonna üle', () => {
    expect(normalizePage({ id: 'w1-1', work_id: 'w1', content_generation: 'u2' }).content_generation).toBe('u2');
  });
  it('puuduv põlvkond → null', () => {
    expect(normalizePage({ id: 'w1-1', work_id: 'w1' }).content_generation).toBeNull();
  });
});
