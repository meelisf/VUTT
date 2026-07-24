/**
 * i18n nimeruumid. Eraldi moodulis, et neid saaks importida ilma `src/i18n.ts`
 * kõrvalmõjuta — selle importimine käivitab i18nexti initsialiseerimise.
 *
 * Peab vastama failidele `src/locales/{et,en}/*.json`; seda kontrollib
 * `__tests__/localeParity.test.ts`.
 */
export const NAMESPACES = [
  'common', 'auth', 'dashboard', 'workspace', 'search', 'statistics',
  'admin', 'register', 'review', 'upload', 'prosopography', 'settings',
] as const;

export type Namespace = (typeof NAMESPACES)[number];
