import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { BackendModule, ReadCallback } from 'i18next';
import {
  detectInitialLanguageFromBrowser,
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from './utils/detectLanguage';
import { NAMESPACES } from './locales/namespaces';

// Dünaamiline import → üks chunk keele kohta. `import()` vahemälustab lubaduse,
// seega 12 nimeruumi päringut ühe keele kohta toovad ikkagi ainult ühe chunki.
const LOADERS: Record<SupportedLanguage, () => Promise<{ default: Record<string, object> }>> = {
  et: () => import('./locales/et'),
  en: () => import('./locales/en'),
};

/**
 * Laisk backend: i18next küsib nimeruume vajaduse hetkel. Nii laeb esmasel
 * laadimisel ainult kasutaja keel ja teine keel alles keelevahetusel.
 *
 * Varem olid mõlema keele kõik 12 nimeruumi staatiliselt entry chunk'is —
 * 34,6 kB gzip, millest pool oli alati kasutu (#187).
 */
const lazyBackend: BackendModule = {
  type: 'backend',
  init: () => {},
  read(language: string, namespace: string, callback: ReadCallback) {
    const loader = LOADERS[language as SupportedLanguage];
    if (!loader) {
      callback(null, {});
      return;
    }
    loader()
      .then(module => callback(null, module.default[namespace] ?? {}))
      .catch(error => callback(error, false));
  },
};

const initialLanguage = detectInitialLanguageFromBrowser();

export const i18nReady = i18n
  .use(lazyBackend)
  .use(initReactI18next)
  .init({
    lng: initialLanguage,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    // Keeltevahelist varunduskeelt EI kasutata: see sunniks i18nexti laadima ka
    // teise keele paki ja võit kaoks. Võtmete kattuvust hoiab selle asemel
    // `localeParity.test.ts`, mis on rangem kui vaikne fallback.
    fallbackLng: false,
    defaultNS: 'common',
    ns: [...NAMESPACES],
    interpolation: {
      escapeValue: false, // React juba escapib
    },
  });

// Käsitsi valik püsib üle seansside. Varem tegi seda LanguageDetectori
// `caches: ['localStorage']`; detektor on nüüd asendatud oma tuvastusega.
i18n.on('languageChanged', lng => {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lng);
  } catch {
    /* privaatrežiim — valik ei püsi, aga rakendus töötab */
  }
});

/**
 * Soojendab teise keele paki jõudeajal, et keelevahetus oleks kohene ega
 * peataks rakendust Suspense'i taha.
 */
export function preloadOtherLanguage(): void {
  const other = SUPPORTED_LANGUAGES.find(l => l !== i18n.language);
  if (!other) return;
  const run = () => { void LOADERS[other]().catch(() => { /* parim-pingutus */ }); };
  const ric = (window as any).requestIdleCallback;
  if (typeof ric === 'function') ric(run, { timeout: 5000 });
  else window.setTimeout(run, 2000);
}

export default i18n;
