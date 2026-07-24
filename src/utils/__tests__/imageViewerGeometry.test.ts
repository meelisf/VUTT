import { describe, it, expect } from 'vitest';
import { panOffsetForTop } from '../imageViewerGeometry';

describe('panOffsetForTop', () => {
  it('mahtuv pilt jääb tsentreerituks', () => {
    // 600px pilt 800px konteineris, suurendus 1 → ülejääki pole
    expect(panOffsetForTop(600, 1, 800)).toBe(0);
  });

  it('täpselt mahtuv pilt jääb tsentreerituks', () => {
    expect(panOffsetForTop(800, 1, 800)).toBe(0);
  });

  it('suurendatud pilt nihutatakse poole ülejäägi võrra alla', () => {
    // 800px pilt suurendusega 2 = 1600px; konteiner 800px → ülejääk 800px.
    // Tsentreerituna ulatub pilt -400..1200, ülaserva toomiseks nihe +400.
    expect(panOffsetForTop(800, 2, 800)).toBe(400);
  });

  it('murdosaline suurendus', () => {
    expect(panOffsetForTop(1000, 1.5, 900)).toBe(300);
  });

  it('pikk pilt ilma suurenduseta vajab samuti nihet', () => {
    // Skaneeringud on sageli konteinerist kõrgemad ka suurenduseta
    expect(panOffsetForTop(2000, 1, 800)).toBe(600);
  });

  it('nullmõõtmed ei tekita NaN-i', () => {
    expect(panOffsetForTop(0, 1, 0)).toBe(0);
    expect(panOffsetForTop(0, 1, 800)).toBe(0);
  });

  it('mõõtmata element (NaN) annab tsentreeritud asendi', () => {
    expect(panOffsetForTop(NaN, 1, 800)).toBe(0);
  });
});
