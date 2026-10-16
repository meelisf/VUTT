// TS-parser peab andma Pythoniga sama tõlgenduse (ühine fikstuur, ADR 0070).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageMarkSpans, parsePageMarks } from '../pageMarks';
import { PAGE_MARK_KINDS } from '../vuttTags';

interface Case { name: string; text: string; spans: { kind: string; inner: string }[] }
const CASES: Case[] = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tests/fixtures/page_marks_cases.json'), 'utf-8'),
);

describe('pageMarkSpans — ühine fikstuur', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const got = pageMarkSpans(c.text).map(p => ({ kind: p.kind, inner: c.text.slice(p.openTo, p.closeFrom) }));
      expect(got).toEqual(c.spans);
    });
  }
});

describe('parsePageMarks', () => {
  it('tagastab kehtetud ja sisemised paarid ning orvud', () => {
    const { pairs, orphans } = parsePageMarks('<fw>12<pb/><sig>B</sig></fw> <rh>x');
    const fw = pairs.find(p => p.kind === 'fw')!;
    const sig = pairs.find(p => p.kind === 'sig')!;
    expect([fw.valid, fw.outer]).toEqual([false, true]);
    expect([sig.valid, sig.outer]).toEqual([true, false]);
    expect(orphans).toHaveLength(1);
  });

  it('liigid registrist', () => {
    expect(PAGE_MARK_KINDS).toEqual(['fw', 'sig', 'catch', 'rh']);
  });
});
