import { describe, it, expect } from 'vitest';
import { personImageProps, PERSON_IMAGE_WIDTHS } from '../personImage';

describe('personImageProps', () => {
  it('lisab laiuse versioonita URL-ile', () => {
    const p = personImageProps('/api/files/prosopography/vutt%3APabc/image', '80px');
    expect(p.src).toBe('/api/files/prosopography/vutt%3APabc/image?w=320');
    expect(p.srcSet).toBe(
      '/api/files/prosopography/vutt%3APabc/image?w=160 160w, '
      + '/api/files/prosopography/vutt%3APabc/image?w=320 320w, '
      + '/api/files/prosopography/vutt%3APabc/image?w=640 640w',
    );
    expect(p.sizes).toBe('80px');
  });

  it('säilitab versiooni ja lisab laiuse & abil', () => {
    const p = personImageProps('/api/files/prosopography/x/image?v=18a', '96px');
    expect(p.src).toBe('/api/files/prosopography/x/image?v=18a&w=320');
    expect(p.srcSet.split(', ')).toHaveLength(PERSON_IMAGE_WIDTHS.length);
    expect(p.srcSet).toContain('/api/files/prosopography/x/image?v=18a&w=640 640w');
  });
});
