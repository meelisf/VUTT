import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NAMESPACES } from '../namespaces';

/**
 * Hoiab eesti ja inglise tõlked võtmete poolest identsena.
 *
 * **Miks see test on kohustuslik (#187):** varem oli `fallbackLng: ['en', 'et']`
 * — puuduv võti ühes keeles võeti vaikselt teisest. See varuvõrk sundis
 * i18nexti laadima mõlema keele paki ja tegi laiska laadimist mõttetuks, seega
 * eemaldati (`fallbackLng: false`). Ilma varuvõrguta ilmuks puuduv võti
 * kasutajale toorel kujul.
 *
 * See test on vaiksest fallbackist rangem: lahknevus katkestab build'i, mitte
 * ei kao märkamatult teise keele teksti taha.
 */
const localesDir = resolve(__dirname, '..');
const LANGUAGES = ['et', 'en'] as const;

function flatKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

const load = (lang: string, ns: string): unknown =>
  JSON.parse(readFileSync(resolve(localesDir, lang, `${ns}.json`), 'utf8'));

describe('lokaatide võtmete pariteet', () => {
  it('mõlemal keelel on samad nimeruumifailid', () => {
    const files = (lang: string) =>
      readdirSync(resolve(localesDir, lang)).filter(f => f.endsWith('.json')).sort();
    expect(files('en')).toEqual(files('et'));
  });

  it('namespaces.ts NAMESPACES vastab failidele kettal', () => {
    const onDisk = readdirSync(resolve(localesDir, 'et'))
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''))
      .sort();
    expect([...NAMESPACES].sort()).toEqual(onDisk);
  });

  it.each(NAMESPACES)('nimeruumil "%s" on mõlemas keeles samad võtmed', ns => {
    const [etKeys, enKeys] = LANGUAGES.map(lang => flatKeys(load(lang, ns)).sort());

    const onlyEt = etKeys.filter(k => !enKeys.includes(k));
    const onlyEn = enKeys.filter(k => !etKeys.includes(k));

    expect({ onlyEt, onlyEn }).toEqual({ onlyEt: [], onlyEn: [] });
  });
});
