import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(process.cwd(), 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) return name === '__tests__' ? [] : walk(path);
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) return [path];
    return [];
  });
}

// Kommentaarid välja: „asendab alert() kõnesid" ja XSS-näide `onerror=alert(1)` ei ole kutsed.
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('natiivsete dialoogide valvur (#672)', () => {
  it('alert/confirm/prompt asemel useNotify/useConfirm (FeedbackContext)', () => {
    const offenders = walk(SRC_DIR)
      .filter((path) => /(?:^|[^\w.$])(?:window\.)?(?:alert|confirm|prompt)\s*\(|window\.(?:alert|confirm|prompt)\b/
        .test(stripComments(readFileSync(path, 'utf8'))))
      .map((path) => relative(process.cwd(), path));

    expect(offenders).toEqual([]);
  });
});
