// src/pages/manage/__tests__/partsModel.test.ts
import { describe, it, expect } from 'vitest';
import { compactNumbers, draftFromPart, emptyDraft, PartDatingError, initialManageTab, pageBadges, pageRangeList, pageRanges, partAbstract, partFromDraft, partPermalink, partWorkspacePath, sharedStems, sortParts, tabSwitch } from '../partsModel';
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
  it('avaneb alati lehtede vahekaardil — osad on teisel kohal', () => {
    expect(initialManageTab(7)).toBe('pages');
    expect(initialManageTab(null)).toBe('pages');
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

  it('compactNumbers: leheküljenumbrid tekstina', () => {
    expect(compactNumbers([11, 7, 8, 9])).toBe('7–9, 11');
    expect(compactNumbers([])).toBe('');
  });

  it('pageRangeList: vahemikud lingiks (from/to)', () => {
    const nums = new Map([['s1', 1], ['s2', 2], ['s4', 4]]);
    expect(pageRangeList(['s4', 's2', 's1'], nums)).toEqual([{ from: 1, to: 2 }, { from: 4, to: 4 }]);
  });
});

describe('partsModel: dateering lihtsast lahtrist', () => {
  it('kirjutatud aasta salvestub, mitte ei kao vaikselt (o17ekb)', () => {
    const d = { ...emptyDraft('letter'), datingText: '1667', dating: null };
    expect(partFromDraft(d, ['s1']).dating).toEqual({ start: '1667' });
  });

  it('vahemik tekstina saab alguse ja lõpu', () => {
    const d = { ...emptyDraft('letter'), datingText: '1667–1668', dating: null };
    expect(partFromDraft(d, ['s1']).dating).toEqual({ start: '1667', end: '1668' });
  });

  it('tõlgendamatu tekst ei kao vaikselt, vaid peatab salvestuse', () => {
    const d = { ...emptyDraft('letter'), datingText: 'umbes suvel', dating: null };
    expect(() => partFromDraft(d, ['s1'])).toThrow(PartDatingError);
  });

  it('tühi tekst = dateering puudub', () => {
    const d = { ...emptyDraft('letter'), datingText: '  ', dating: null };
    expect(partFromDraft(d, ['s1']).dating).toBeUndefined();
  });
});

describe('osa kokkuvõte kahes keeles (ADR 0063)', () => {
  const base: WorkPart = { id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false };

  it('lugeja keel, puudumisel teine keel koos märgiga', () => {
    const both = { abstract_et: 'Kiri.', abstract_en: 'Letter.' };
    expect(partAbstract(both, 'en')).toEqual({ text: 'Letter.', otherLang: null });
    expect(partAbstract({ abstract_et: 'Kiri.' }, 'en')).toEqual({ text: 'Kiri.', otherLang: 'et' });
    expect(partAbstract({ abstract_en: 'Letter.' }, 'et')).toEqual({ text: 'Letter.', otherLang: 'en' });
    expect(partAbstract({}, 'et')).toBeNull();
  });

  it('ankrut ei saadeta; kinnitus läheb kaasa ainult ingliskeelse tekstiga', () => {
    const d = draftFromPart({ ...base, abstract_et: 'Kiri.', abstract_en: 'Letter.', abstract_en_src: 'abcdefabcdef', notes: 'Indeks F1' });
    expect(d.abstractAnchor).toBe('abcdefabcdef');
    const out = partFromDraft({ ...d, confirmEn: true }, ['s1']);
    expect(out).toMatchObject({ abstract_et: 'Kiri.', abstract_en: 'Letter.', notes: 'Indeks F1', confirm_abstract_translation: true });
    expect('abstract_en_src' in out).toBe(false);
    expect('confirm_abstract_translation' in partFromDraft({ ...d, abstract_en: ' ', confirmEn: true }, ['s1'])).toBe(false);
  });
});

describe('partsModel: osa püsilink (#526)', () => {
  it('püsilink ei sisalda lehenumbrit', () => {
    expect(partPermalink('ms169i', 'dqap1p')).toBe('/work/ms169i/part/dqap1p');
  });

  it('lahendub osa esimesele lehele praeguses järjestuses, mitte tüvede järjekorras', () => {
    const nums = new Map([['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4]]);
    expect(partWorkspacePath('w', P('a', ['s4', 's3']), nums)).toBe('/work/w/3?part=a');
    // Lehed järjestati ümber: sama osa, uus esimene leht.
    const moved = new Map([['s4', 1], ['s3', 2]]);
    expect(partWorkspacePath('w', P('a', ['s4', 's3']), moved)).toBe('/work/w/1?part=a');
  });

  it('kõik lehed kadunud → null (mitte vaikne leht 1)', () => {
    expect(partWorkspacePath('w', P('a', ['x9']), new Map([['s1', 1]]))).toBeNull();
  });
});
