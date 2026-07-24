import { describe, it, expect } from 'vitest';
import { NAMESPACES } from '../namespaces';
import etBundle from '../et';
import enBundle from '../en';

/**
 * Laisa laadimise ehitusplokid (#187).
 *
 * `src/i18n.ts` ise käivitab importimisel initsialiseerimise ja sõltub
 * brauseri API-dest, seega kontrollime siin seda, mille peal laisk backend
 * seisab: keelepakid peavad sisaldama täpselt neid nimeruume, mida i18next
 * küsib. Kui pakist puuduks nimeruum, tagastaks backend vaikselt `{}` ja
 * kasutaja näeks tõlkevõtmeid — ilma `fallbackLng`-ta ei püüaks seda enam
 * miski kinni.
 */
describe('keelepakid laisa laadimise jaoks', () => {
  const bundles = { et: etBundle, en: enBundle } as const;

  it.each(Object.keys(bundles) as (keyof typeof bundles)[])(
    'pakk "%s" sisaldab kõiki nimeruume',
    lang => {
      expect(Object.keys(bundles[lang]).sort()).toEqual([...NAMESPACES].sort());
    },
  );

  it.each(Object.keys(bundles) as (keyof typeof bundles)[])(
    'pakk "%s" ei sisalda tühje nimeruume',
    lang => {
      for (const ns of NAMESPACES) {
        const bundle = bundles[lang][ns] as Record<string, unknown>;
        expect(bundle, `${lang}/${ns}`).toBeTypeOf('object');
        expect(Object.keys(bundle).length, `${lang}/${ns} on tühi`).toBeGreaterThan(0);
      }
    },
  );

  it('paketid on eri keeltes tõesti erineva sisuga', () => {
    // Kaitse selle vastu, et mõlemad laadijad osutaksid kogemata samale kaustale
    expect(JSON.stringify(etBundle)).not.toEqual(JSON.stringify(enBundle));
  });
});
