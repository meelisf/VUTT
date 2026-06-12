// Meilisearchi tenant tokeni uuendamise ajastus.
//
// Backend väljastab tokeni TTL-iga 3600s (server/main.py, generate_meili_token).
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
