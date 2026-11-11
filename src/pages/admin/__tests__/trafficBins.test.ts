import { describe, expect, it } from 'vitest';
import { binMinutes, lastWindow, TrafficMinute } from '../trafficBins';

const m = (i: number, total: number, extra: Partial<TrafficMinute> = {}): TrafficMinute => ({
  minute: `2026-11-11T12:${String(i).padStart(2, '0')}:00+00:00`,
  total, anon: 0, errors: 0, slow: 0, ips: 0, ...extra,
});

describe('binMinutes', () => {
  it('liidab loendurid, aga IP-de puhul võtab maksimumi', () => {
    const [b] = binMinutes([m(0, 3, { ips: 2, anon: 1 }), m(1, 5, { ips: 4, anon: 2 })], 10);
    expect(b).toEqual({ start: m(0, 0).minute, total: 8, anon: 3, errors: 0, slow: 0, maxIps: 4 });
  });

  it('viimane kast võib olla poolik', () => {
    const bins = binMinutes(Array.from({ length: 25 }, (_, i) => m(i, 1)), 10);
    expect(bins.map(b => b.total)).toEqual([10, 10, 5]);
  });

  it('tühi sisend = tühi graafik', () => {
    expect(binMinutes([], 10)).toEqual([]);
  });
});

describe('lastWindow', () => {
  it('jätab jooksva minuti välja', () => {
    // 3 täis minutit à 60 + pooleli minut 6000 → 1 päring/s, mitte 34.
    const w = lastWindow([m(0, 60), m(1, 60), m(2, 60), m(3, 6000)], 10);
    expect(w.rps).toBe(1);
  });

  it('anonüümsete osakaal ja IP-de maksimum', () => {
    const w = lastWindow([m(0, 10, { anon: 5, ips: 3 }), m(1, 10, { anon: 10, ips: 7 }), m(2, 0)], 10);
    expect(w.anonShare).toBe(0.75);
    expect(w.maxIps).toBe(7);
  });

  it('tühi aken ei jaga nulliga', () => {
    expect(lastWindow([], 10)).toEqual({ rps: 0, anonShare: 0, maxIps: 0, errors: 0 });
  });
});
