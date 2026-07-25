import tsParser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * ESLint on siin TEADLIKULT kitsas: ainult React Hooksi reeglid.
 *
 * Ajend on konkreetne vigaklass, mis 2026-07-25 andis kolm eksemplari korraga
 * (vt ADR 0010 punkt 5): effect on kirjutatud ühe olukorra jaoks, aga tema
 * dep-listis on objekt, mille identiteet muutub ka siis, kui sisu ei muutu.
 * Tagajärjed ulatusid asjatust võrgupäringust andmekaoni.
 *
 * Laiemad reeglistikud (typescript-eslint recommended jm) on teadlikult VÄLJAS:
 * `catch (e: any)` ja `as any` on selles koodibaasis levinud mustrid ja tooksid
 * sadu leide, mis mataksid signaali müra alla. Laiendada saab igal ajal.
 *
 * **Baseline-lävi.** `exhaustive-deps` on `warn`, mitte `error`, ja CI jookseb
 * `npm run lint:ci` = `--max-warnings 57` (seis 2026-07-25). Mõte: olemasolev
 * võlg on lubatud, uus mitte. Puuduva sõltuvuse "parandamine" ei ole mehaaniline
 * töö — lisamine võib tekitada lõputu tsükli või liigse päringu, ja mõni väljajätt
 * on täiesti õige (vt `PersonsMap.tsx` `filterKey`). Iga juhtum vajab otsust.
 * Kui parandad mõne, langeta arvu `package.json`-is.
 */
export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      // Hooksi kutsumise reeglid (tingimuslik hook jms) — need on alati päris
      // vead, mitte maitseküsimus.
      'react-hooks/rules-of-hooks': 'error',
      // Puuduvad/liigsed sõltuvused. Vt failipäist.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
