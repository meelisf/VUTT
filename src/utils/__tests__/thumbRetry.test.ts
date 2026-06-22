import { describe, it, expect } from 'vitest';
import { THUMB_MAX_RETRIES, thumbRetryDelay, buildThumbUrl } from '../thumbRetry';

describe('thumbRetryDelay', () => {
  it('kasvab eksponentsiaalselt (jitterita baas)', () => {
    expect(thumbRetryDelay(1, 0)).toBe(500);
    expect(thumbRetryDelay(2, 0)).toBe(1000);
    expect(thumbRetryDelay(3, 0)).toBe(2000);
    expect(thumbRetryDelay(4, 0)).toBe(4000);
  });

  it('on ülempiiratud 5000ms baasiga', () => {
    expect(thumbRetryDelay(10, 0)).toBe(5000);
  });

  it('lisab jitterit (väldib thundering herdi)', () => {
    expect(thumbRetryDelay(1, 0.5)).toBe(650);
    expect(thumbRetryDelay(1, 1)).toBe(800);
  });

  it('MAX_RETRIES on mõistlik (>1, et transientne viga ei oleks püsiv)', () => {
    expect(THUMB_MAX_RETRIES).toBeGreaterThan(1);
  });
});

describe('buildThumbUrl', () => {
  it('baas ilma tokenita ja ilma retryta jääb muutmata', () => {
    expect(buildThumbUrl('http://x/_thumb?v=1', '', 0)).toBe('http://x/_thumb?v=1');
  });

  it('lisab retry-nonce (&, sest baasil on juba query)', () => {
    expect(buildThumbUrl('http://x/_thumb?v=1', '', 2)).toBe('http://x/_thumb?v=1&retry=2');
  });

  it('lisab tokeni ja retry koos', () => {
    expect(buildThumbUrl('http://x/_thumb?v=1', '&exp=9&sig=a', 3))
      .toBe('http://x/_thumb?v=1&exp=9&sig=a&retry=3');
  });

  it('valib ? kui baasil pole query-d', () => {
    expect(buildThumbUrl('http://x/_thumb', '', 1)).toBe('http://x/_thumb?retry=1');
  });
});
