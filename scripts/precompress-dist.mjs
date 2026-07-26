/**
 * Eelkompressioon: loob dist/ tekstivaradele .br ja .gz kõrvalfailid.
 *
 * nginx serveerib need `brotli_static on` / `gzip_static on` kaudu, seega
 * pakkimine toimub üks kord build'i ajal maksimaalse kvaliteediga (brotli 11),
 * mitte iga päringu peal (kus mõistlik lagi on ~5).
 *
 * Mõõdetud: br-11 annab gzip-6 peale 13–20% juurde; lennult br-5 andis 5–12%.
 *
 * Kasutab ainult Node'i sisseehitatud zlib-i — npm-sõltuvust ei lisa.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import zlib from 'node:zlib';

const DIST = join(process.cwd(), 'dist');

// Ainult tekstivormingud; pildid ja fondid on juba pakitud.
const EXTENSIONS = new Set(['.js', '.css', '.html', '.svg', '.json', '.txt', '.xml']);
// Alla selle pole pakkimisest kasu (HTTP-päised söövad võidu ära).
const MIN_BYTES = 1024;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

let files = 0;
let raw = 0;
let brotli = 0;
let gzip = 0;

for (const file of walk(DIST)) {
  if (!EXTENSIONS.has(extname(file))) continue;
  if (file.endsWith('.br') || file.endsWith('.gz')) continue;
  const data = readFileSync(file);
  if (data.length < MIN_BYTES) continue;

  const br = zlib.brotliCompressSync(data, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
    },
  });
  const gz = zlib.gzipSync(data, { level: 9 });

  // Kirjuta ainult siis, kui pakitud on päriselt väiksem kui originaal.
  if (br.length < data.length) writeFileSync(`${file}.br`, br);
  if (gz.length < data.length) writeFileSync(`${file}.gz`, gz);

  files += 1;
  raw += data.length;
  brotli += br.length;
  gzip += gz.length;
}

const kb = (n) => (n / 1024).toFixed(1).padStart(7);
console.log(
  `precompress: ${files} faili | raw ${kb(raw)} KB → gzip ${kb(gzip)} KB → brotli ${kb(brotli)} KB` +
  ` (br võit gzip'i ees ${(100 * (gzip - brotli) / gzip).toFixed(1)}%)`
);
