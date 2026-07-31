import { describe, it, expect } from 'vitest';
import { appendTagParams } from '../tagParams';

const collect = (tag?: string | string[]) => {
  const params = new URLSearchParams();
  appendTagParams(params, tag);
  return params.getAll('tag');
};

describe('appendTagParams', () => {
  it('ei lisa midagi, kui väärtus puudub', () => {
    expect(collect(undefined)).toEqual([]);
  });

  it('lisab üksiku stringi', () => {
    expect(collect('Q193664')).toEqual(['Q193664']);
  });

  it('lisab iga loendi väärtuse eraldi võtmena (append, mitte set)', () => {
    expect(collect(['Q193664', 'Q175151'])).toEqual(['Q193664', 'Q175151']);
  });

  it('jätab tühjad ja tühikulised väärtused vahele', () => {
    expect(collect(['', '   ', 'Q1'])).toEqual(['Q1']);
  });

  it('eemaldab duplikaadid järjekorda säilitades', () => {
    expect(collect(['Q1', 'Q2', 'Q1'])).toEqual(['Q1', 'Q2']);
  });

  it('tühi loend ei lisa võtmeid', () => {
    expect(collect([])).toEqual([]);
  });
});
