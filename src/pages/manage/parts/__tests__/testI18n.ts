// Testide i18n: päris eestikeelsed failid, sünkroonne init (rakenduse i18n laeb
// nimeruumid laisalt — test näeks võtmeid, mitte silte).
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import workspace from '../../../../locales/et/workspace.json';
import common from '../../../../locales/et/common.json';

void i18next.use(initReactI18next).init({
  lng: 'et',
  resources: { et: { workspace, common } },
  defaultNS: 'workspace',
  interpolation: { escapeValue: false },
  initAsync: false,
});

export default i18next;
