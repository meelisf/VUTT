// src/pages/manage/__tests__/partsModel.test.ts
import { describe, it, expect } from 'vitest';
import { draftFromPart, emptyDraft, initialManageTab, pageBadges, pageRanges, partFromDraft, sharedStems, sortParts, tabSwitch } from '../partsModel';
import type { WorkPart } from '../../../services/workPartsApi';

const STEMS = ['s1', 's2', 's3', 's4'];
const P = (id: string, pages: string[], extra: Partial<WorkPart> = {}): WorkPart =>
  ({ id, kind: 'letter', pages, creators: [], attached_to: null, needs_review: false, ...extra });

describe('partsModel', () => {
  it('sortParts: esimese lehe järgi, lehtedeta lõpus', () => {
    const out = sortParts([P('b', ['s3']), P('x', [], { needs_review: true }), P('a', ['s2', 's4'])], STEMS);
    expect(out.map(p => p.id)).toEqual(['a', 'b', 'x']);
  });

  it('pageBadges: jagatud lehel mitu märki, number = sisukorra järjekord', () => {
    const m = pageBadges([P('b', ['s3']), P('a', ['s2', 's3'])], STEMS);
    expect(m.get('s3')!.map(b => [b.partId, b.index])).toEqual([['a', 1], ['b', 2]]);
    expect(m.get('s1')).toBeUndefined();
  });

  it('sharedStems: teiste osadega jagatud tüved', () => {
    const a = P('a', ['s2', 's3']);
    expect([...sharedStems(a, [a, P('b', ['s3'])])]).toEqual([['s3', ['b']]]);
  });

  it('draft ↔ osa: tühjad väljad välja, place_to ainult kirjal', () => {
    const d = { ...emptyDraft('poem'), title: ' ', place_to: { id: 'Q1', label: 'X' } };
    const input = partFromDraft(d, ['s1']);
    expect(input).toEqual({ kind: 'poem', pages: ['s1'], creators: [], attached_to: null });
    const back = draftFromPart(P('a', ['s1'], { title: 'T', kind: 'letter', place_to: { id: 'Q1', label: 'X' } }));
    expect(partFromDraft(back, ['s1'])).toMatchObject({ title: 'T', place_to: { id: 'Q1', label: 'X' } });
  });
});

describe('partsModel: tundmatud väljad ei kao (arvustuse I1)', () => {
  it('PUT säilitab vormile tundmatud väljad (languages), tühjendatud pealkiri kaob', () => {
    const p = P('a', ['s1'], { title: 'Vana', languages: ['lat'], ...({ future_field: 1 } as object) });
    const d = { ...draftFromPart(p), title: '' };
    const out = partFromDraft(d, ['s1']) as Record<string, unknown>;
    expect(out.languages).toEqual(['lat']);
    expect(out.future_field).toBe(1);
    expect('title' in out).toBe(false);
  });
});

describe('initialManageTab / tabSwitch (arvustuse I2, I3)', () => {
  it('?focus=N avab lehtede vahekaardi (töölaua sügavlink), muidu osad', () => {
    expect(initialManageTab(7)).toBe('pages');
    expect(initialManageTab(null)).toBe('parts');
  });
  it('vahekaardi vahetust kaitstakse ainult osade mustandi korral', () => {
    const guarded: string[] = [];
    const run = (fn: () => void) => { guarded.push('guard'); fn(); };
    const done: string[] = [];
    tabSwitch(false, run, () => done.push('a'));
    tabSwitch(true, run, () => done.push('b'));
    expect(done).toEqual(['a', 'b']);
    expect(guarded).toEqual(['guard']);
  });

  it('pageRanges: järjestikused lehenumbrid vahemikuks, katkendlik komaga, tundmatu tüvi välja', () => {
    const nums = new Map([['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4], ['s9', 9]]);
    expect(pageRanges(['s3', 's1', 's2', 's9'], nums)).toBe('1–3, 9');
    expect(pageRanges(['s4'], nums)).toBe('4');
    expect(pageRanges(['s4', 'gone'], nums)).toBe('4');
    expect(pageRanges([], nums)).toBe('');
  });
});
