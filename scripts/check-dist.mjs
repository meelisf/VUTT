/**
 * Buildi-järgsed valvurid `dist/` sisule.
 *
 * Jookseb `npm run build`-i sees pärast `vite build`-i. Siin on kohad, kus
 * build ise õnnestub, aga tulemus on tootmises katki ja seda ei näita ei
 * typecheck, lint ega testid — ainult brauser.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const DIST = join(process.cwd(), 'dist');

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/**
 * MapLibre 6 on ESM-only ja tööline ei ole enam bundle'i sees, vaid eraldi
 * fail, mille peab emitima bundler (`?worker&url`, vt HistoricalMapLayer.tsx).
 * Ilma selleta tuletab teek URL-i `import.meta.url`-ist → Vite'i buildis
 * olematusse `assets/maplibre-gl-worker.mjs`-i → 404 → ükski vektorplaat ei
 * laadi ja kaart jääb tühjaks ILMA nähtava veata (#378). Just seepärast on siin
 * valvur, mitte ainult kommentaar: eeldus sõltub teegi major-versioonist ja
 * bundleri käitumisest, mitte meie koodist.
 */
function assertMaplibreWorkerEmitted(paths) {
  const jsFiles = paths.filter(path => extname(path) === '.js' && !path.endsWith('.map'));
  const sources = new Map(jsFiles.map(path => [path, readFileSync(path, 'utf8')]));
  const allCode = [...sources.values()].join('\n');

  // MapLibre on buildis siis, kui tema töölise-URL-i otsingukood on kohal.
  // (Kaardita lehed ei pea MapLibre'i üldse laadima — siis pole midagi valvata.)
  const DEV_WORKER_NAME = 'maplibre-gl-worker-dev.mjs';
  if (!allCode.includes(DEV_WORKER_NAME)) return;

  const worker = jsFiles.find(path => basename(path).startsWith('maplibre-gl-worker'));
  if (!worker) {
    throw new Error(
      'MapLibre on buildis, aga töölise-chunk puudub. Kas `?worker&url` import '
      + 'sai `HistoricalMapLayer.tsx`-ist kaduma?',
    );
  }

  const workerName = basename(worker);
  if (!allCode.includes(workerName)) {
    throw new Error(
      `Töölise-chunk ${workerName} on emititud, aga ükski bundle ei viita sellele — `
      + 'kas `setWorkerUrl(maplibreWorkerUrl)` jäi tegemata?',
    );
  }

  // `?url` üksi emitiks faili muutmata kujul, aga tööline impordib naabri
  // `maplibre-gl-shared.mjs`, mida dist/-i siis ei tule → import sureb.
  if (sources.get(worker).includes('maplibre-gl-shared.mjs')) {
    throw new Error(
      `Töölise-chunk ${workerName} impordib maplibre-gl-shared.mjs — see tähendab, et `
      + 'fail on emititud `?url`-iga, mitte `?worker&url`-iga.',
    );
  }

  console.log(`check-dist: MapLibre'i töölise-chunk ${workerName} on olemas ja bundle viitab sellele`);
}

const paths = [...walk(DIST)];
assertMaplibreWorkerEmitted(paths);
