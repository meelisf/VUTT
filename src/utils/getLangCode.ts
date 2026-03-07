/**
 * Normaliseerib i18n keelekoodi kahemärgilisel kujule.
 * "et-EE" → "et", "en-US" → "en", tundmatu → "et"
 */
export function getLangCode(lang: string): 'et' | 'en' {
  const code = lang.split('-')[0];
  return code === 'en' ? 'en' : 'et';
}
