export const SUPPORTED_LANGUAGES = ['et', 'en'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_STORAGE_KEY = 'vutt_language';

/** Vaikekeel: rahvusvaheline publik saab inglise keele. */
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

function isSupported(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** `EN-us` → `en`; toetamata või puuduv → null. */
function normalize(value: string | null | undefined): SupportedLanguage | null {
  if (typeof value !== 'string') return null;
  const base = value.toLowerCase().split('-')[0];
  return isSupported(base) ? base : null;
}

/**
 * Valib algkeele. Kordab senist `i18next-browser-languagedetector` käitumist
 * (`order: ['localStorage', 'navigator']`), aga teeb seda **enne** i18n
 * initsialiseerimist, et osata laadida ainult ühe keele pakk.
 *
 * Miks käsitsi: kui jätta tuvastus i18nexti hooleks koos `fallbackLng`-ga,
 * laadib i18next ka varukeele paki. Eestikeelne kasutaja saaks siis ikka
 * mõlemad ja kogu #187 võit kaoks.
 *
 * Järjekord:
 * 1. URL-i `?lang=` — kaalukaim (#298). Kutse- ja parooli-taastekirja link
 *    kannab saaja keelt: kiri oli tema keeles, seega peab ka leht olema,
 *    ka siis kui brauser või varem salvestatud valik ütleb muud. Saaja ei ole
 *    veel sisse loginud, seega `user_settings` keelt siin veel ei ole.
 * 2. Käsitsi valik localStorage'is (`vutt_language`).
 * 3. Brauseri keeled: esimene toetatud vaste (`et-EE` → `et`).
 * 4. Inglise keel.
 */
export function detectInitialLanguage(
  stored: string | null | undefined,
  navigatorLanguages: readonly string[] | undefined,
  urlLanguage?: string | null,
): SupportedLanguage {
  const fromUrl = normalize(urlLanguage);
  if (fromUrl) return fromUrl;
  if (isSupported(stored)) return stored;

  for (const raw of navigatorLanguages ?? []) {
    if (typeof raw !== 'string') continue;
    // Piirkonnakood maha: `et-EE` → `et`
    const base = raw.toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }

  return DEFAULT_LANGUAGE;
}

/** Brauserist lugev variant. Testides kasuta puhast `detectInitialLanguage`-i. */
export function detectInitialLanguageFromBrowser(): SupportedLanguage {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    /* privaatrežiim või blokeeritud salvestus — jätkame tuvastusega */
  }
  const langs = typeof navigator !== 'undefined'
    ? navigator.languages ?? (navigator.language ? [navigator.language] : [])
    : [];

  let urlLanguage: string | null = null;
  try {
    urlLanguage = new URLSearchParams(window.location.search).get('lang');
  } catch {
    /* SSR või katkine URL — tuvastus jätkab ilma selleta */
  }

  return detectInitialLanguage(stored, langs, urlLanguage);
}
