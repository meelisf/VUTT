import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// VUTT-i backend'i päringud käivad apiClient-i kaudu (#671): 401 kaasa antud
// tokeniga → sessiooni aegumise dialoog, ühtne veateade, ApiError. Otse
// fetch/fetchWithTimeout annab aegunud sessioonil valdkonna veateate
// („Salvestamine ebaõnnestus") ja kasutaja otsib viga valest kohast.

const SRC_DIR = join(process.cwd(), 'src');

// Püsivad erandid — igal oma põhjus.
const EXCEPTIONS = new Set([
  'src/utils/fetchWithTimeout.ts',            // määratlus
  'src/services/apiClient.ts',                // kiht ise
  'src/services/clientErrorReporter.ts',      // ei tohi ise vigu tekitada (#133)
  'src/contexts/UserContext.tsx',             // login (vale parool ≠ aegumine), verify-token, logout
  'src/pages/Register.tsx',                   // autentimata voog — sessiooni ei ole
  'src/pages/SetPassword.tsx',                // autentimata voog (kutse / parooli taaste)
  'src/contexts/MeilisearchContext.tsx',      // Meili token, oma värskendusloogika
  'src/services/wikidataService.ts',          // väline API
  'src/services/gndService.ts',               // väline API
  'src/services/viafService.ts',              // väline API
  'src/prosopography/components/AddPlaceModal.tsx', // väline API (Wikidata)
  'src/pages/Dashboard.tsx',                  // staatiline about.html
  'src/components/editor/useTranscriptionGuide.ts', // staatiline juhend
  'src/components/ImageViewer.tsx',           // pildi blob
  'src/components/editor/useSpecialChars.ts', // staatiline special_characters.json (/user-chars käib apiClient-iga)
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return name === '__tests__' ? [] : walk(path);
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) return [path];
    return [];
  });
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const callsFetch = (src: string) => /(?:^|[^\w.$])(?:fetch|fetchWithTimeout)\s*\(/.test(stripComments(src));

const fetchers = () => walk(SRC_DIR)
  .filter((path) => callsFetch(readFileSync(path, 'utf8')))
  .map((path) => relative(process.cwd(), path));

describe('apiClient valvur (#671)', () => {
  it('backend-päringud käivad apiClient-i kaudu', () => {
    const offenders = fetchers().filter((rel) => !EXCEPTIONS.has(rel));
    expect(offenders).toEqual([]);
  });

  it('erand ilma fetch-kutseta eemaldatakse nimekirjast', () => {
    const current = new Set(fetchers());
    expect([...EXCEPTIONS].filter((rel) => !current.has(rel))).toEqual([]);
  });
});
