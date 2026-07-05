// Meilisearchi tenant tokeni uuendamise ajastus.
//
// Backend paneb JWT `exp` välja; frontend arvutab aegumise tokenist, mitte
// ei eelda fikseeritud TTL-i. Fallback jääb juhuks, kui tokenit ei saa parsida.
// Varasem bug: kontroll käis iga 55 min ja uuendas ainult 60s enne aegumist —
// t=55min oli aegumiseni veel 5 min, järgmine kontroll alles t=110min,
// seega vahemikus 60–110 min kasutati aegunud tokenit ("Tenant token expired").
// Reegel: REFRESH_LOOKAHEAD_MS > CHECK_INTERVAL_MS, muidu jääb aken vahele.

export const TOKEN_TTL_MS = 60 * 60 * 1000;
export const CHECK_INTERVAL_MS = 60 * 1000;
export const REFRESH_LOOKAHEAD_MS = 5 * 60 * 1000;

export function shouldRefreshToken(now: number, expiresAt: number): boolean {
  return now > expiresAt - REFRESH_LOOKAHEAD_MS;
}

function decodeBase64UrlJson(segment: string): any | null {
  try {
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function tokenExpiresAtFromJwt(token: string): number | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  const payload = decodeBase64UrlJson(payloadSegment);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp * 1000;
}

export function resolveTokenExpiresAt(token: string, now: number = Date.now()): number {
  return tokenExpiresAtFromJwt(token) ?? now + TOKEN_TTL_MS;
}

// Kas Meili-tokenit on vaja kontrollida/uuendada — ajapõhine aegumine PLUSS
// desünki-juhtum. Raporteeritud bug: kasutaja on öö läbi sisse logitud, index
// degradeerus taustatabis anon-iks (isUserToken=false), aga sessioon (vutt_token)
// on endiselt kehtiv → piiratud kollektsioon andis 0 vastet ("teoseid ei leitud")
// kuni full reloadini. Lahendus: kui sessioon on olemas, aga index on anon, proovi
// KOHE promoteerida user-tokeniks (mitte oodata anon-tokeni ajapõhist aegumist).
export function shouldRefreshOrPromote(
  now: number,
  expiresAt: number,
  hasSession: boolean,
  isUserToken: boolean,
): boolean {
  if (hasSession && !isUserToken) return true; // desünk: anon index + kehtiv sessioon
  return shouldRefreshToken(now, expiresAt);
}
