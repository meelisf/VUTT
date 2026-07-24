// Ühe keele kõik nimeruumid ühes moodulis. Dünaamiline import loob siit
// täpselt ühe chunki keele kohta — nimeruumide kaupa importimine annaks 12.
// Laadimist juhib `src/i18n.ts` laisk backend.
import admin from './admin.json';
import auth from './auth.json';
import common from './common.json';
import dashboard from './dashboard.json';
import prosopography from './prosopography.json';
import register from './register.json';
import review from './review.json';
import search from './search.json';
import settings from './settings.json';
import statistics from './statistics.json';
import upload from './upload.json';
import workspace from './workspace.json';

export default {
  admin,
  auth,
  common,
  dashboard,
  prosopography,
  register,
  review,
  search,
  settings,
  statistics,
  upload,
  workspace,
};
