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

  describe('topInset — varu pildi peal olevatele juhtnuppudele', () => {
    it('nihutab suurendatud pilti veel varu võrra allapoole', () => {
      // Ilma varuta 400; 62px riba alt algamiseks 462
      expect(panOffsetForTop(800, 2, 800, 62)).toBe(462);
    });

    it('täpselt mahtuv pilt nihkub varu võrra, et ülaserv jääks riba alla', () => {
      expect(panOffsetForTop(800, 1, 800, 62)).toBe(62);
    });

    it('väike pilt jääb tsentreerituks — varu ei tohi teda alla lükata', () => {
      // Pilt on poole konteineri kõrgusest: ülaserv on niigi ribast allpool
      expect(panOffsetForTop(400, 1, 800, 62)).toBe(0);
    });

    it('varu ei muuda tulemust negatiivseks', () => {
      expect(panOffsetForTop(100, 1, 800, 20)).toBe(0);
    });

    it('mõõtmata riba (NaN) käitub nagu varu puuduks', () => {
      expect(panOffsetForTop(800, 2, 800, NaN)).toBe(400);
    });
  });
});
