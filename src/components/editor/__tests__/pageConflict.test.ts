import { describe, expect, it } from 'vitest';
import { PageStatus, type Annotation } from '../../../types';
import {
  PageConflictError,
  baseFromSavedState,
  conflictFromResponse,
  retryBase,
  type PageFields,
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
