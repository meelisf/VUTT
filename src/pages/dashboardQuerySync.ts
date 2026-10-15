/**
 * Avalehe päringu ↔ sort reegel, eraldatud URL-i sünkrooniva effecti seest,
 * et see oleks testitav (#605: vihje vastuvõtt võib päringu tühjendada).
 * Ilma päringuta pole relevantsusel tähendust → aasta järgi.
 */
export function sortAfterQueryChange(sort: string, newQuery: string): string {
  return !newQuery && sort === 'relevance' ? 'year_asc' : sort;
}
