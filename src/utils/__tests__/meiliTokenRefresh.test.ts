import { describe, it, expect } from 'vitest';
import {
  TOKEN_TTL_MS,
  CHECK_INTERVAL_MS,
  REFRESH_LOOKAHEAD_MS,
  shouldRefreshToken,
  shouldRefreshOrPromote,
  tokenExpiresAtFromJwt,
  resolveTokenExpiresAt,
} from '../meiliTokenRefresh';

function fakeJwt(payload: object): string {
  const json = JSON.stringify(payload);
  const base64url = btoa(json).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `header.${base64url}.sig`;
}

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

  it('loeb aegumisaja JWT exp väljast', () => {
    const token = fakeJwt({ exp: 12345 });
    expect(tokenExpiresAtFromJwt(token)).toBe(12345 * 1000);
  });

  it('kasutab parsingu vea korral fallback TTL-i', () => {
    expect(tokenExpiresAtFromJwt('not-a-jwt')).toBeNull();
    expect(resolveTokenExpiresAt('not-a-jwt', 1000)).toBe(1000 + TOKEN_TTL_MS);
  });
});

describe('shouldRefreshOrPromote', () => {
  const fresh = TOKEN_TTL_MS; // expiresAt kaugel tulevikus, now=0 → ajapõhiselt ei vaja

  it('promoteerib KOHE kui sessioon on olemas, aga index on anon (desünk)', () => {
    // See on raporteeritud bug: öö läbi sisse logitud, index degradeerus anon-iks,
    // sessioon (vutt_token) endiselt kehtiv → piiratud kollektsioon tühi kuni reloadini.
    expect(shouldRefreshOrPromote(0, fresh, /*hasSession*/ true, /*isUserToken*/ false)).toBe(true);
  });

  it('ei promoteeri kui index on juba user-token ja token värske', () => {
    expect(shouldRefreshOrPromote(0, fresh, true, true)).toBe(false);
  });

  it('ei promoteeri kui sessiooni pole (anon kasutaja jääb anoniks)', () => {
    expect(shouldRefreshOrPromote(0, fresh, false, false)).toBe(false);
  });

  it('uuendab ajapõhiselt ka siis kui desünki pole (token aegumas)', () => {
    const expiresAt = 1000;
    expect(shouldRefreshOrPromote(expiresAt + 1, expiresAt, true, true)).toBe(true);
    expect(shouldRefreshOrPromote(expiresAt + 1, expiresAt, false, false)).toBe(true);
  });
});
