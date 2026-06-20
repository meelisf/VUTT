import { describe, it, expect } from 'vitest';
import { planChunks } from '../bulkAddChunks';

const f = (name: string, size: number): File =>
  ({ name, size } as File);

describe('planChunks', () => {
  it('üks partii kui mahub', () => {
    const plan = planChunks([f('a', 1), f('b', 1)], 5, 20, 1000);
    expect(plan).toHaveLength(1);
    expect(plan[0].afterPageNum).toBe(5);
    expect(plan[0].files).toHaveLength(2);
  });

  it('tükeldab arvu järgi ja nihutab positsiooni (P+K)', () => {
    const files = Array.from({ length: 5 }, (_, i) => f(`x${i}`, 1));
    const plan = planChunks(files, 10, 2, 1_000_000);
    expect(plan.map((c) => c.files.length)).toEqual([2, 2, 1]);
    // pärast 10: esimene after=10, järgmine 10+2=12, siis 12+2=14
    expect(plan.map((c) => c.afterPageNum)).toEqual([10, 12, 14]);
  });

  it('algusesse (0): nihkub K kaupa', () => {
    const files = Array.from({ length: 4 }, (_, i) => f(`x${i}`, 1));
    const plan = planChunks(files, 0, 2, 1_000_000);
    expect(plan.map((c) => c.afterPageNum)).toEqual([0, 2]);
  });

  it('lõppu (-1): iga partii jääb -1', () => {
    const files = Array.from({ length: 5 }, (_, i) => f(`x${i}`, 1));
    const plan = planChunks(files, -1, 2, 1_000_000);
    expect(plan.map((c) => c.afterPageNum)).toEqual([-1, -1, -1]);
  });

  it('tükeldab mahu järgi', () => {
    const plan = planChunks([f('a', 600), f('b', 600)], 0, 20, 1000);
    expect(plan).toHaveLength(2);   // 600+600 > 1000 → eraldi
  });
});
