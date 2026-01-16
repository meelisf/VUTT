import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Tõlked
import etCommon from './locales/et/common.json';
import etAuth from './locales/et/auth.json';
import etDashboard from './locales/et/dashboard.json';
import etWorkspace from './locales/et/workspace.json';
import etSearch from './locales/et/search.json';
import etStatistics from './locales/et/statistics.json';
import etAdmin from './locales/et/admin.json';
import etRegister from './locales/et/register.json';
import etReview from './locales/et/review.json';

import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enDashboard from './locales/en/dashboard.json';
import enWorkspace from './locales/en/workspace.json';
import enSearch from './locales/en/search.json';
import enStatistics from './locales/en/statistics.json';
import enAdmin from './locales/en/admin.json';
import enRegister from './locales/en/register.json';
import enReview from './locales/en/review.json';

const resources = {
  et: {
    common: etCommon,
    auth: etAuth,
    dashboard: etDashboard,
    workspace: etWorkspace,
    search: etSearch,
    statistics: etStatistics,
    admin: etAdmin,
    register: etRegister,
    review: etReview,
  },
  en: {
    common: enCommon,
    auth: enAuth,
    dashboard: enDashboard,
    workspace: enWorkspace,
    search: enSearch,
    statistics: enStatistics,
    admin: enAdmin,
    register: enRegister,
    review: enReview,
  },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'et',
    defaultNS: 'common',
    ns: ['common', 'auth', 'dashboard', 'workspace', 'search', 'statistics', 'admin', 'register', 'review'],

    detection: {
      order: ['localStorage'],
      lookupLocalStorage: 'vutt_language',
      caches: ['localStorage'],
    },
    lng: localStorage.getItem('vutt_language') || 'et', // Vaikimisi eesti keel

    interpolation: {
      escapeValue: false, // React juba escapib
    },
  });

export default i18n;
