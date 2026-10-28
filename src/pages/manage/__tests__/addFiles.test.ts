import { describe, it, expect } from 'vitest';
import { afterToAnchor, classifyAddFiles } from '../addFiles';

const f = (name: string, type: string) => new File(['x'], name, { type });
const PAGES = [
  { page_num: 1, filename: 't-w1-a.jpg' },
  { page_num: 2, filename: 't-w1-b.jpg' },
];

describe('classifyAddFiles (ADR 0074)', () => {
  it('üks PDF → pdf', () => {
    const pdf = f('lisa.pdf', 'application/pdf');
    expect(classifyAddFiles([pdf])).toEqual({ kind: 'pdf', file: pdf });
  });

  it('pildid → images', () => {
    expect(classifyAddFiles([f('a.jpg', 'image/jpeg'), f('b.png', 'image/png')])).toEqual({ kind: 'images' });
  });

  it('PDF koos pildiga → mixed', () => {
    expect(classifyAddFiles([f('a.jpg', 'image/jpeg'), f('l.pdf', 'application/pdf')]))
      .toEqual({ kind: 'invalid', reason: 'mixed' });
  });

  it('kaks PDF-i → multiplePdf', () => {
    expect(classifyAddFiles([f('a.pdf', 'application/pdf'), f('b.pdf', 'application/pdf')]))
      .toEqual({ kind: 'invalid', reason: 'multiplePdf' });
  });

  it('suurtäheline laiend tühja MIME-ga on PDF', () => {
    const pdf = f('FOO.PDF', '');
    expect(classifyAddFiles([pdf])).toEqual({ kind: 'pdf', file: pdf });
  });
});

describe('afterToAnchor', () => {
  it('0 → start, -1 → end, number → selle lehe pildifail', () => {
    expect(afterToAnchor(0, PAGES)).toBe('start');
    expect(afterToAnchor(-1, PAGES)).toBe('end');
    expect(afterToAnchor(2, PAGES)).toBe('t-w1-b.jpg');
  });

  it('tundmatu lehenumber → end', () => {
    expect(afterToAnchor(9, PAGES)).toBe('end');
  });
});
