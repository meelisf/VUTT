import { describe, it, expect } from 'vitest';
import { diffWords } from '../textDiff';

const join = (ops: ReturnType<typeof diffWords>, keep: 'del' | 'ins') =>
  ops.filter(o => o.op === 'eq' || o.op === keep).map(o => o.text).join('');

describe('diffWords', () => {
  it('märgendus on oma token', () => {
    const ops = diffWords('a <i>b</i> c', 'a b c');
    const del = ops.filter(o => o.op === 'del').map(o => o.text);
    expect(del).toContain('<i>');
    expect(del).toContain('</i>');
  });

  it('identne tekst → ainult eq', () => {
    expect(diffWords('üks kaks\nkolm', 'üks kaks\nkolm').every(o => o.op === 'eq')).toBe(true);
  });

  it('eq+del annab vana ja eq+ins uue teksti', () => {
    const a = 'leht 1 vana\nteine rida <m>ääre</m>\n';
    const b = 'leht 1 uus\nteine  rida <m>äärе</m>\nlisa\n';
    const ops = diffWords(a, b);
    expect(join(ops, 'del')).toBe(a);
    expect(join(ops, 'ins')).toBe(b);
  });

  it('pikk tekst langeb rea tasemele ja jääb korrektseks', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `sõna${i}`).join(' ');
    const b = a.replace('sõna1500', 'muudetud');
    const ops = diffWords(a, b);
    expect(join(ops, 'del')).toBe(a);
    expect(join(ops, 'ins')).toBe(b);
  });
});
