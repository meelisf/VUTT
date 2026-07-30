import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { NAMESPACES } from '../namespaces';

/**
 * Kontrollib, et iga koodis kirjutatud `t('võti')` päriselt lahenduks.
 *
 * **Miks eraldi `localeParity.test.ts`-ist:** pariteeditest hoiab et/en
 * võtmestikud identsena, aga ei märka võtit, mis puudub MÕLEMAS keeles.
 * Selline kutse ei katkesta ei build'i ega tüübikontrolli — i18next lihtsalt
 * renderdab `defaultValue`'i (tavaliselt eestikeelse → ka ingliskeelses UI-s)
 * või, kui vaikeväärtust pole, TOORE VÕTME ("common:actions.cancel") otse
 * kasutajale. `fallbackLng: false` (ADR 0011) tähendab, et varuvõrku pole.
 *
 * Kontrollitakse ainult staatilisi ülakomadega literaale — dünaamiliselt
 * kokku pandud võtmed (`t(\`places.types.${x}\`)`) jäetakse teadlikult välja.
 */
const srcDir = resolve(__dirname, '../..');
const localesDir = resolve(__dirname, '..');
const LANGUAGES = ['et', 'en'] as const;

// i18next mitmuse-järelliited: `pagesCount` katab `pagesCount_one` jne.
const PLURAL_SUFFIXES = ['', '_one', '_other', '_zero', '_two', '_few', '_many'];

const resources = Object.fromEntries(
  LANGUAGES.map(lang => [
    lang,
    Object.fromEntries(
      NAMESPACES.map(ns => [
        ns,
        JSON.parse(readFileSync(resolve(localesDir, lang, `${ns}.json`), 'utf8')),
      ]),
    ),
  ]),
) as Record<string, Record<string, unknown>>;

function lookup(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    obj,
  );
}

const keyExists = (lang: string, ns: string, key: string): boolean =>
  PLURAL_SUFFIXES.some(suffix => typeof lookup(resources[lang][ns], key + suffix) === 'string');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

interface Unresolved {
  file: string;
  line: number;
  key: string;
  reason: string;
}

function findUnresolved(): Unresolved[] {
  const found: Unresolved[] = [];

  for (const file of sourceFiles(srcDir)) {
    const source = readFileSync(file, 'utf8');

    // Faili nimeruumid — kõigi useTranslation(...) kutsete ühend. Ühend on
    // tahtlikult leebe: alamkomponentide eristamine annaks valepositiivseid.
    const namespaces = new Set<string>();
    for (const call of source.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
      for (const quoted of call[1].matchAll(/['"]([a-zA-Z]+)['"]/g)) namespaces.add(quoted[1]);
    }
    if (namespaces.size === 0) continue;
    const defaultNs = [...namespaces][0];

    for (const call of source.matchAll(/\bt\(\s*'([^'\n]+)'/g)) {
      const raw = call[1];
      // Interpoleeritud või dünaamiline võti — ei saa staatiliselt kontrollida.
      if (raw.includes('${') || raw.includes('{{')) continue;

      const separator = raw.indexOf(':');
      const [ns, key] =
        separator === -1 ? [defaultNs, raw] : [raw.slice(0, separator), raw.slice(separator + 1)];

      // Nimeruumita eesliide (nt `t('some:thing')` mõnes muus tähenduses) —
      // kontrollime ainult päris nimeruume.
      if (!(NAMESPACES as readonly string[]).includes(ns)) continue;

      const line = source.slice(0, call.index).split('\n').length;

      if (!namespaces.has(ns)) {
        found.push({ file, line, key: raw, reason: `nimeruum '${ns}' puudub useTranslation-listis` });
        continue;
      }
      const missing = LANGUAGES.filter(lang => !keyExists(lang, ns, key));
      if (missing.length > 0) {
        found.push({ file, line, key: `${ns}:${key}`, reason: `võti puudub: ${missing.join(', ')}` });
      }
    }
  }
  return found;
}

describe('tõlkevõtmete lahenduvus', () => {
  it('iga staatiline t() kutse lahendub mõlemas keeles', () => {
    const unresolved = findUnresolved().map(u => `${u.file.replace(srcDir, 'src')}:${u.line} — ${u.key} (${u.reason})`);
    expect(unresolved).toEqual([]);
  });
});
