/**
 * Buildi-järgsed valvurid `dist/` sisule.
 *
 * Jookseb `npm run build`-i sees pärast `vite build`-i. Siin on kohad, kus
 * build ise õnnestub, aga tulemus on tootmises katki ja seda ei näita ei
 * typecheck, lint ega testid — ainult brauser.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');

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
function assertMaplibreWorkerEmitted(paths, pkg) {
  // Kas valvatavat teeki üldse on, otsustab MEIE `package.json`, mitte teegi
  // sisemine string. Sõltuvuse eemaldamine on teadlik otsus; sentineli
  // kadumine ei ole (vt allpool).
  if (!pkg.dependencies?.['maplibre-gl']) return;

  const jsFiles = paths.filter(path => extname(path) === '.js');
  const sources = new Map(jsFiles.map(path => [path, readFileSync(path, 'utf8')]));
  const allCode = [...sources.values()].join('\n');

  // MapLibre'i töölise-URL-i tuletamise kood (`…-dev.mjs` haru) on tõend, et
  // teek on buildis ja et ta lahendab URL-i endiselt ise. See string on teegi
  // SISEASI: kui uus major ta ümber nimetab, ei tohi valvur vaikselt läbi
  // lasta — just versioonivahetus on see hetk, mille jaoks valvur olemas on.
  const DEV_WORKER_NAME = 'maplibre-gl-worker-dev.mjs';
  if (!allCode.includes(DEV_WORKER_NAME)) {
    throw new Error(
      `Valvur ei tunne MapLibre'i buildis ära: stringi ${DEV_WORKER_NAME} ei ole üheski chunk'is, `
      + 'kuigi `maplibre-gl` on sõltuvus. Kas teek nimetas oma töölise-failid ümber (uus major) '
      + 'või ei jõua kaardikood enam buildi? Kontrolli üle ja uuenda seda valvurit — vaikne '
      + 'läbilaskmine tähendaks tühja kaarti ilma veata (#378).',
    );
  }

  const worker = jsFiles.find(path => basename(path).startsWith('maplibre-gl-worker'));
  if (!worker) {
    throw new Error(
      'MapLibre on buildis, aga töölise-chunk puudub. Kas `?worker&url` import '
      + 'sai `HistoricalMapLayer.tsx`-ist kaduma?',
    );
  }

  // Viidet otsime KÕIGIST TEISTEST chunk'idest: worker-fail ise võib oma nime
  // sisaldada (nt `sourceMappingURL`, kui sourcemap'id sisse lülitatakse) ja
  // teeks kontrollist tautoloogia.
  const workerName = basename(worker);
  const otherCode = jsFiles.filter(path => path !== worker).map(path => sources.get(path)).join('\n');
  if (!otherCode.includes(workerName)) {
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
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
assertMaplibreWorkerEmitted(paths, pkg);
