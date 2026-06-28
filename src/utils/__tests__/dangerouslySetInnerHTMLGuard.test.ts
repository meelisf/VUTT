import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(process.cwd(), 'src');
const ALLOWED = new Set([
  'src/components/SafeHtml.tsx',
  'src/utils/__tests__/dangerouslySetInnerHTMLGuard.test.ts',
]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return walk(path);
    if (/\.(ts|tsx)$/.test(name)) return [path];
    return [];
  });
}

describe('dangerouslySetInnerHTML guard', () => {
  it('lubab HTML-i renderdamist ainult SafeHtml komponendi kaudu', () => {
    const offenders = walk(SRC_DIR)
      .map((path) => ({ path, rel: relative(process.cwd(), path) }))
      .filter(({ rel }) => !ALLOWED.has(rel))
      .filter(({ path }) => /dangerouslySetInnerHTML\s*=/.test(readFileSync(path, 'utf8')))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });
});
