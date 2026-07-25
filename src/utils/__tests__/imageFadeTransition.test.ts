import { describe, it, expect } from 'vitest';
import { imageFadeStyle, FADE_IN_MS, FADE_OUT_MS } from '../imageFadeTransition';

describe('imageFadeStyle', () => {
  it('eellaetud pilt dipi ajal on peidetud ja kasutab väljumise kestust', () => {
    expect(imageFadeStyle({ imageLoading: false, dipDone: false, reducedMotion: false })).toEqual({
      opacity: 0,
      durationMs: FADE_OUT_MS,
    });
  });

  it('eellaetud pilt pärast dipi tuleb nähtavale sissetuleku kestusega', () => {
    expect(imageFadeStyle({ imageLoading: false, dipDone: true, reducedMotion: false })).toEqual({
      opacity: 1,
      durationMs: FADE_IN_MS,
    });
  });

  it('aeglane pilt jääb peidetuks ka pärast dipi lõppu', () => {
    expect(imageFadeStyle({ imageLoading: true, dipDone: true, reducedMotion: false })).toEqual({
      opacity: 0,
      durationMs: FADE_OUT_MS,
    });
  });

  it('reduced-motion korral pole üleminekut ja nähtavus sõltub ainult laadimisest', () => {
    expect(imageFadeStyle({ imageLoading: false, dipDone: false, reducedMotion: true })).toEqual({
      opacity: 1,
      durationMs: 0,
    });
    expect(imageFadeStyle({ imageLoading: true, dipDone: true, reducedMotion: true })).toEqual({
      opacity: 0,
      durationMs: 0,
    });
  });

  it('kestused on mõistlikus vahemikus ka pärast timmimist', () => {
    // Kaitse hooletu timmimise vastu: liiga lühike ei ole märgatav, liiga pikk
    // võtab tagasi selle, milleks eellaadimine tehti.
    expect(FADE_OUT_MS).toBeGreaterThanOrEqual(40);
    expect(FADE_OUT_MS).toBeLessThanOrEqual(200);
    expect(FADE_IN_MS).toBeGreaterThanOrEqual(60);
    expect(FADE_IN_MS).toBeLessThanOrEqual(400);
  });
});
