import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Ikoonisõnastiku valvur (ADR 0086). Tähendusega ikoon tuleb `src/components/icons.ts`-ist
// semantilise nimega; keelatud ikooni ei tohi kasutada üldse.

const SRC_DIR = join(process.cwd(), 'src');
const VOCAB_FILE = join(SRC_DIR, 'components', 'icons.ts');

// Lucide'i nimed, mida tohib importida AINULT icons.ts. Peab kattuma ADR 0086 tabeliga.
const VOCABULARY = [
  'Pencil',
  'MessageSquare', 'MessageSquarePlus', 'MessageSquareQuote',
  'PanelRightDashed', 'PanelRightOpen', 'PanelRightClose',
  'StickyNote',
  'Crop', 'Frame', 'Columns2', 'RotateCcw', 'RotateCw',
  'GalleryHorizontal', 'ArchiveRestore', 'ListRestart', 'Undo2',
];

// Üldised „muuda/kirjuta" variandid: konkureeriksid igas tähenduses Pencil'iga.
// (Edit = SquarePen, Edit2 = Pen, Edit3 = PenLine, PenBox = SquarePen.)
const BANNED = ['SquarePen', 'Edit', 'Edit2', 'Edit3', 'Pen', 'PenLine', 'PenBox', 'PencilLine'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : walk(path);
    if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) return [path];
    return [];
  });
}

// `PencilIcon` ja `LucidePencil` on lucide'is sama ikooni aliased.
const canonical = (name: string) => name.replace(/^Lucide/, '').replace(/Icon$/, '');

function lucideImports(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
      if (name) names.push(canonical(name));
    }
  }
  return names;
}

const files = walk(SRC_DIR);
const rel = (p: string) => relative(process.cwd(), p);

describe('ikoonisõnastiku valvur (ADR 0086)', () => {
  it('tähendusega ikoon imporditakse ainult icons.ts-ist', () => {
    const offenders = files
      .filter((p) => p !== VOCAB_FILE)
      .flatMap((p) => lucideImports(readFileSync(p, 'utf8'))
        .filter((n) => VOCABULARY.includes(n))
        .map((n) => `${rel(p)}: ${n}`));
    expect(offenders).toEqual([]);
  });

  it('keelatud ikoone ei kasutata kusagil', () => {
    const offenders = files.flatMap((p) => lucideImports(readFileSync(p, 'utf8'))
      .filter((n) => BANNED.includes(n))
      .map((n) => `${rel(p)}: ${n}`));
    expect(offenders).toEqual([]);
  });

  it('lucide-react ainult nimeliste importidega (valvur peab nägema nimesid)', () => {
    const offenders = files
      .filter((p) => /import\s*\*\s*as\s+\w+\s+from\s*['"]lucide-react|from\s*['"]lucide-react\//.test(readFileSync(p, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('icons.ts ekspordib kogu sõnastiku ja mitte midagi väljaspool seda', () => {
    const exported = lucideExports(readFileSync(VOCAB_FILE, 'utf8'));
    expect([...new Set(exported)].sort()).toEqual([...VOCABULARY].sort());
  });
});

function lucideExports(src: string): string[] {
  const m = src.match(/export\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/);
  if (!m) return [];
  return m[1].replace(/\/\/.*$/gm, '').split(',')
    .map((part) => canonical(part.trim().split(/\s+as\s+/)[0].trim()))
    .filter(Boolean);
}
