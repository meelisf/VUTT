import { describe, it, expect } from 'vitest';
import { computeBlockMoveOrder, VisiblePage } from '../blockReorder';

// Abifunktsioon: tee n lehte nähtavate numbritega 1..n, failinimi "f{num}"
const mk = (n: number): VisiblePage[] =>
  Array.from({ length: n }, (_, i) => ({ filename: `f${i + 1}`, visiblePageNum: i + 1 }));

const names = (r: { order: string[] }) => r.order;

describe('computeBlockMoveOrder', () => {
  it('liigutab ploki keskele (kasutaja näide: 1–5 → lehe 9 järele)', () => {
    const res = computeBlockMoveOrder(mk(10), new Set(['f1', 'f2', 'f3', 'f4', 'f5']), '9');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f6', 'f7', 'f8', 'f9', 'f1', 'f2', 'f3', 'f4', 'f5', 'f10']);
    expect(res.preview).toEqual({ kind: 'between', before: 9, after: 10 });
  });

  it('N=0 / tühi / negatiivne → algusesse', () => {
    for (const t of ['0', '', '-3']) {
      const res = computeBlockMoveOrder(mk(5), new Set(['f4', 'f5']), t);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(names(res)).toEqual(['f4', 'f5', 'f1', 'f2', 'f3']);
      expect(res.preview).toEqual({ kind: 'start' });
    }
  });

  it('N > pageCount → lõppu', () => {
    const res = computeBlockMoveOrder(mk(5), new Set(['f1']), '6');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f2', 'f3', 'f4', 'f5', 'f1']);
    expect(res.preview).toEqual({ kind: 'end' });
  });

  it('N === last, viimane EI valitud → lõppu', () => {
    const res = computeBlockMoveOrder(mk(5), new Set(['f1']), '5');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f2', 'f3', 'f4', 'f5', 'f1']);
    expect(res.preview).toEqual({ kind: 'end' });
  });

  it('N === last, viimane ON valitud → anchorInSelection', () => {
    const res = computeBlockMoveOrder(mk(5), new Set(['f5']), '5');
    expect(res).toEqual({ ok: false, reason: 'anchorInSelection' });
  });

  it('mittejärjestikune valik liigub kompaktse plokina, suhteline järjekord säilib', () => {
    const res = computeBlockMoveOrder(mk(8), new Set(['f2', 'f5', 'f7']), '8');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f1', 'f3', 'f4', 'f6', 'f8', 'f2', 'f5', 'f7']);
  });

  it('NaN sihtnumber → invalidTarget', () => {
    expect(computeBlockMoveOrder(mk(5), new Set(['f1']), 'abc')).toEqual({ ok: false, reason: 'invalidTarget' });
  });

  it('kümnendmurd trunkeeritakse (9.7 → 9)', () => {
    const res = computeBlockMoveOrder(mk(10), new Set(['f1']), '9.7');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.preview).toEqual({ kind: 'between', before: 9, after: 10 });
  });

  it('valitud failinimi, mida pole → invalidTarget', () => {
    expect(computeBlockMoveOrder(mk(5), new Set(['fX']), '2')).toEqual({ ok: false, reason: 'invalidTarget' });
  });

  it('tühi valik → emptySelection', () => {
    expect(computeBlockMoveOrder(mk(5), new Set(), '2')).toEqual({ ok: false, reason: 'emptySelection' });
  });

  it('kõik valitud + N=0 → ok, sama järjekord (no-op)', () => {
    const res = computeBlockMoveOrder(mk(3), new Set(['f1', 'f2', 'f3']), '0');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(names(res)).toEqual(['f1', 'f2', 'f3']);
  });

  it('kõik valitud + N keskel → anchorInSelection', () => {
    const res = computeBlockMoveOrder(mk(3), new Set(['f1', 'f2', 'f3']), '2');
    expect(res).toEqual({ ok: false, reason: 'anchorInSelection' });
  });

  it('effective järjekord: kui visiblePages on juba draft-järjekorras, N viitab nähtavale numbrile', () => {
    // Nähtav järjekord: f3(1), f1(2), f2(3); liiguta f3 lehe 3 järele
    const vp: VisiblePage[] = [
      { filename: 'f3', visiblePageNum: 1 },
      { filename: 'f1', visiblePageNum: 2 },
      { filename: 'f2', visiblePageNum: 3 },
    ];
    const res = computeBlockMoveOrder(vp, new Set(['f3']), '3');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order).toEqual(['f1', 'f2', 'f3']);
    expect(res.preview).toEqual({ kind: 'end' });
  });
});
