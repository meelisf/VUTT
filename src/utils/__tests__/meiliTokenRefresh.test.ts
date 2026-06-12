import { describe, it, expect } from 'vitest';
import {
  TOKEN_TTL_MS,
  CHECK_INTERVAL_MS,
  REFRESH_LOOKAHEAD_MS,
  shouldRefreshToken,
} from '../meiliTokenRefresh';

describe('meiliTokenRefresh', () => {
  it('uuendab tokeni ENNE aegumist, kui kontroll käib intervalliga CHECK_INTERVAL_MS', () => {
    // Simuleerime: token saadud t=0, aegub t=TOKEN_TTL_MS.
    // Interval-kontrollid t=CHECK_INTERVAL_MS, 2*CHECK_INTERVAL_MS, ...
    const expiresAt = TOKEN_TTL_MS;
    let refreshedAt: number | null = null;
    for (let now = CHECK_INTERVAL_MS; now <= TOKEN_TTL_MS * 2; now += CHECK_INTERVAL_MS) {
      if (shouldRefreshToken(now, expiresAt)) {
        refreshedAt = now;
        break;
      }
    }
    expect(refreshedAt).not.toBeNull();
    // Kriitiline: uuendus peab toimuma ENNE tokeni aegumist
    expect(refreshedAt!).toBeLessThan(expiresAt);
  });

  it('lookahead on suurem kui kontrolli intervall (muidu jääb aken vahele)', () => {
    expect(REFRESH_LOOKAHEAD_MS).toBeGreaterThan(CHECK_INTERVAL_MS);
  });

  it('aegunud tokeni korral nõuab kohe uuendust (nt unerežiimist ärkamisel)', () => {
    const expiresAt = 1000;
    expect(shouldRefreshToken(expiresAt + 1, expiresAt)).toBe(true);
  });

  it('värske tokeni korral ei uuenda', () => {
    const expiresAt = TOKEN_TTL_MS;
    expect(shouldRefreshToken(0, expiresAt)).toBe(false);
    expect(shouldRefreshToken(CHECK_INTERVAL_MS, expiresAt)).toBe(false);
  });
});
