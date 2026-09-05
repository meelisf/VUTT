/** Registreerimisvormi keelevalik. Sama reegel mis serveris:
 *  väiksed tähed → `-`-i eest osa → et|en, muidu et. */
export type UiLanguage = 'et' | 'en';

export const defaultRegistrationLanguage = (uiLanguage?: string): UiLanguage => {
  const code = (uiLanguage || '').trim().toLowerCase().split('-')[0];
  return code === 'en' ? 'en' : 'et';
};
