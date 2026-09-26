// Testide i18n: päris eestikeelsed failid, sünkroonne init (rakenduse i18n laeb
// nimeruumid laisalt ja asünkroonselt — test näeks siis võtmeid, mitte silte).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import prosopography from '../../../../locales/et/prosopography.json';
import workspace from '../../../../locales/et/workspace.json';
import common from '../../../../locales/et/common.json';

void i18next.use(initReactI18next).init({
  lng: 'et',
  resources: { et: { prosopography, workspace, common } },
  defaultNS: 'prosopography',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18next;
