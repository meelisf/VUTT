/**
 * Avalehe päringu ↔ sort reegel, eraldatud URL-i sünkrooniva effecti seest,
 * et see oleks testitav (#605: vihje vastuvõtt võib päringu tühjendada).
 * Ilma päringuta pole relevantsusel tähendust → aasta järgi.
 */
export function sortAfterQueryChange(sort: string, newQuery: string): string {
  return !newQuery && sort === 'relevance' ? 'year_asc' : sort;
}

// Avalehe filtriparameetrid URL-is — need, mida URL → olek effect olekusse kannab
const FILTER_URL_PARAMS = ['q', 'ys', 'ye', 'sort', 'tags', 'genre', 'type', 'langs', 'status'];

/** URL-i filtriosa võti (lehekülg, kogu jm ei loe). */
export function filterUrlKey(params: URLSearchParams): string {
  return FILTER_URL_PARAMS.map(k => `${k}=${params.get(k) ?? ''}`).join('&');
}

/**
 * Avalehe oma URL-i kirjutuse kaja tuvastaja.
 *
 * Olek → URL kirjutus jookseb 400 ms viitega; router annab muutuse tagasi
 * renderduse võrra hiljem. Kui kasutaja trükib selles aknas, tooks URL → olek
 * effect vana väärtuse tagasi ja trükitud täht kaoks (sama filtritega). Oma
 * kirjutuse kaja ei kanna seepärast olekusse midagi — olek on sellest juba ees
 * või sellega võrdne. Kaja tarbitakse ÜKS kord: hilisem sama URL (tagasinupp,
 * link) on päris muutus.
 */
export function createUrlEchoGuard() {
  let last: string | null = null;
  return {
    wrote(params: URLSearchParams) { last = filterUrlKey(params); },
    isEcho(params: URLSearchParams): boolean {
      const hit = last !== null && filterUrlKey(params) === last;
      last = null;
      return hit;
    },
  };
}
