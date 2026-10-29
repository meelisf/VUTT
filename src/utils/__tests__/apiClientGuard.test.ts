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
  'src/config.ts',                            // ainult kommentaar
  'src/services/clientErrorReporter.ts',      // ei tohi ise vigu tekitada (#133)
  'src/contexts/UserContext.tsx',             // login (vale parool ≠ aegumine), verify-token, logout
  'src/contexts/MeilisearchContext.tsx',      // Meili token, oma värskendusloogika
  'src/services/wikidataService.ts',          // väline API
  'src/services/gndService.ts',               // väline API
  'src/services/viafService.ts',              // väline API
  'src/pages/Dashboard.tsx',                  // staatiline about.html
  'src/components/editor/useTranscriptionGuide.ts', // staatiline juhend
  'src/components/ImageViewer.tsx',           // pildi blob
]);

// Migreerimata — nimekiri AINULT kahaneb (nagu lint-lävi).
const PENDING = new Set([
  'src/pages/admin/Maintenance.tsx',
  'src/components/editor/useReOcr.ts',
  'src/pages/Review.tsx',
  'src/components/editor/HistoryTab.tsx',
  'src/components/UploadMetaForm.tsx',
  'src/components/MetadataModal.tsx',
  'src/pages/SetPassword.tsx',
  'src/components/editor/CharSetEditor.tsx',
  'src/components/CollectionEditor.tsx',
  'src/prosopography/pages/PersonEditPage.tsx',
  'src/pages/admin/Trash.tsx',
  'src/pages/admin/ClientErrorsPanel.tsx',
  'src/pages/Register.tsx',
  'src/pages/Admin.tsx',
  'src/components/editor/useSpecialChars.ts',
  'src/components/ArchiveSelect.tsx',
  'src/prosopography/components/AddPlaceModal.tsx',
  'src/pages/admin/Places.tsx',
  'src/components/editor/WorkInfoPanel.tsx',
  'src/components/editor/PageTagsPanel.tsx',
  'src/components/UserMenu.tsx',
  'src/components/CollectionCreateForm.tsx',
  'src/pages/search/hooks/useQCodeMaps.ts',
  'src/pages/search/hooks/useSearchFacets.ts',
  'src/pages/Workspace.tsx',
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
    const offenders = fetchers().filter((rel) => !EXCEPTIONS.has(rel) && !PENDING.has(rel));
    expect(offenders).toEqual([]);
  });

  it('migreeritud fail eemaldatakse PENDING-ust', () => {
    const current = new Set(fetchers());
    expect([...PENDING].filter((rel) => !current.has(rel))).toEqual([]);
  });
});
