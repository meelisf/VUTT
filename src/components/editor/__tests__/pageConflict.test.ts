import { describe, expect, it } from 'vitest';
import { PageStatus, type Annotation } from '../../../types';
import {
  PageConflictError,
  annotationsForText,
  assembleChunks,
  baseFromSavedState,
  conflictFromResponse,
  minimalTextChange,
  retryBase,
  wordDiff,
  type PageFields,
  type TextChunk,
} from '../pageConflict';

const c = (id: string, text = 't', replies: unknown[] = []) =>
  ({ id, text, author: 'u', replies } as unknown as Annotation);

const leht = (over: Partial<PageFields> = {}): PageFields => ({
  text_content: 'tekst',
  status: PageStatus.RAW,
  page_tags: [],
  comments: [],
  text_annotations: [],
  ...over,
});

describe('baseFromSavedState', () => {
  it('kaardistab salvestatud seisu serveri base-väljadeks', () => {
    const saved = { text: 'x', status: PageStatus.IN_PROGRESS, comments: [c('c1')], page_tags: [], text_annotations: [] };
    expect(baseFromSavedState(saved)).toEqual({
      text_content: 'x', status: PageStatus.IN_PROGRESS, comments: [c('c1')], page_tags: [], text_annotations: [],
    });
  });
});

describe('retryBase — „Salvesta minu versioon"', () => {
  it('konfliktis tekst: baasi tekst ja kirjed = serveri omad', () => {
    const base = leht();
    const current = leht({ text_content: 'nende', text_annotations: [{ id: 1 } as never] });
    const uus = retryBase(base, current, ['text']);
    expect(uus.text_content).toBe('nende');
    expect(uus.text_annotations).toEqual([{ id: 1 }]);
  });

  it('konfliktita üksused jäävad vana baasi omaks (nende muudatus säilib)', () => {
    const base = leht({ status: PageStatus.RAW });
    const current = leht({ text_content: 'nende', status: PageStatus.CORRECTED });
    const uus = retryBase(base, current, ['text']);
    expect(uus.status).toBe(PageStatus.RAW);
  });

  it('konfliktis kommentaar: baasi kirje asendatakse serveri omaga', () => {
    const base = leht({ comments: [c('c1', 'a'), c('c2')] });
    const current = leht({ comments: [c('c1', 'nende'), c('c2')] });
    expect(retryBase(base, current, ['comments:c1']).comments).toEqual([c('c1', 'nende'), c('c2')]);
  });

  it('serveris kustutatud kommentaar eemaldatakse baasist', () => {
    const base = leht({ comments: [c('c1'), c('c2')] });
    const current = leht({ comments: [c('c2')] });
    expect(retryBase(base, current, ['comments:c1']).comments).toEqual([c('c2')]);
  });

  it('baasis puuduv, serveris olev konfliktne kommentaar lisatakse', () => {
    const base = leht({ comments: [] });
    const current = leht({ comments: [c('c1', 'nende')] });
    expect(retryBase(base, current, ['comments:c1']).comments).toEqual([c('c1', 'nende')]);
  });

  it('konfliktis annotatsioon: ainult see kirje võetakse serverist', () => {
    const a = (id: number, comment: string) => ({ id, comment, author: 'u', created_at: '' });
    const base = leht({ text_annotations: [a(1, 'vana'), a(2, 'b')] });
    const current = leht({ text_annotations: [a(1, 'nende'), a(2, 'serveri b')] });
    expect(retryBase(base, current, ['annotations:1']).text_annotations).toEqual([a(1, 'nende'), a(2, 'b')]);
    expect(base.text_annotations[0].comment).toBe('vana');
  });
});

describe('conflictFromResponse', () => {
  it('409 keha → PageConflictError', () => {
    const current = leht({ text_content: 'nende' });
    const err = conflictFromResponse(409, { detail: { conflict: true, fields: ['text'], current } });
    expect(err).toBeInstanceOf(PageConflictError);
    expect(err?.fields).toEqual(['text']);
    expect(err?.current.text_content).toBe('nende');
  });

  it('muu staatus või kuju → null', () => {
    expect(conflictFromResponse(500, { detail: 'x' })).toBeNull();
    expect(conflictFromResponse(409, { detail: 'Commit ei kuulu' })).toBeNull();
  });
});

describe('tükkide kaupa lahendus (#612)', () => {
  const tükid: TextChunk[] = [
    { kind: 'ok', text: 'üks\n' },
    { kind: 'conflict', base: 'kaks\n', mine: 'KAKS\n', theirs: 'kaks!\n' },
    { kind: 'ok', text: 'kolm\n' },
    { kind: 'conflict', base: 'neli', mine: 'NELI', theirs: 'neli!' },
  ];

  it('conflictFromResponse loeb tükid ja viimase muutja', () => {
    const e = conflictFromResponse(409, { detail: {
      conflict: true, fields: ['text'], current: leht(), text_chunks: tükid,
      theirs_last: { author: 'mari', date: '2026-10-16T10:00:00+03:00' },
    } });
    expect(e?.textChunks).toEqual(tükid);
    expect(e?.theirsLast).toEqual({ author: 'mari', date: '2026-10-16T10:00:00+03:00' });
  });

  it('tundmatu tüki kuju → tükke ei kasutata (tagasi tervikvalikule)', () => {
    const e = conflictFromResponse(409, { detail: {
      conflict: true, fields: ['text'], current: leht(), text_chunks: [{ kind: 'muu' }],
    } });
    expect(e?.textChunks).toBeNull();
    expect(e?.theirsLast).toBeNull();
  });

  it('assembleChunks: minu / tema / mõlemad', () => {
    expect(assembleChunks(tükid, ['mine', 'theirs'])).toBe('üks\nKAKS\nkolm\nneli!');
    expect(assembleChunks(tükid, ['both', 'both'])).toBe('üks\nkaks!\nKAKS\nkolm\nneli!\nNELI');
  });

  it('annotationsForText: tema tükist tulnud ankur saab tema kirje, minu väljajäänud kirje kukub', () => {
    const a = (id: number, comment: string) => ({ id, comment, author: 'u', created_at: '' });
    const minu = [a(1, 'minu üks'), a(2, 'minu kaks'), a(9, 'vana orb')];
    const nende = [a(1, 'nende üks'), a(3, 'nende kolm')];
    const tekst = '<ann1>x</ann1> <ann3>y</ann3>';
    const minuTekst = '<ann1>x</ann1> <ann2>z</ann2>';
    expect(annotationsForText(tekst, minu, nende, minuTekst)).toEqual([a(1, 'minu üks'), a(9, 'vana orb'), a(3, 'nende kolm')]);
  });

  it('wordDiff tõstab esile ainult erineva sõna', () => {
    const d = wordDiff('in der Stadt', 'in der Stadſ');
    expect(d.a).toEqual([{ text: 'in der ', changed: false }, { text: 'Stadt', changed: true }]);
    expect(d.b).toEqual([{ text: 'in der ', changed: false }, { text: 'Stadſ', changed: true }]);
  });

  it('minimalTextChange jätab ühise alguse ja lõpu puutumata', () => {
    expect(minimalTextChange('abc\nxyz', 'abc\nXyz')).toEqual({ from: 4, to: 5, insert: 'X' });
    expect(minimalTextChange('aa', 'aaa')).toEqual({ from: 2, to: 2, insert: 'a' });
  });
});
