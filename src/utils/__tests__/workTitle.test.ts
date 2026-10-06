import { describe, it, expect } from 'vitest';
import { workDisplayTitle, otherTitles } from '../workTitle';

// 0ajcsn — ADR 0064 näide
const protokoll = {
  title: 'Tartu Ülikooli (Academia Gustaviana) senati protokollid : kontseptid',
  title_en: 'Minutes of the Senate of Tartu Ülikool (Academia Gustaviana) : drafts',
  title_original: 'Protocollum Sub Rectore Magnifico Andreae Virginio D. D. Theol.',
  title_devised: true,
};

describe('workDisplayTitle', () => {
  it('koostatud pealkiri: eesti liideses põhipealkiri, originaal teisel real', () => {
    expect(workDisplayTitle(protokoll, 'et')).toEqual({
      main: protokoll.title,
      secondary: protokoll.title_original,
    });
  });

  it('koostatud pealkiri: inglise liideses tõlge põhireal', () => {
    expect(workDisplayTitle(protokoll, 'en')).toEqual({
      main: protokoll.title_en,
      secondary: protokoll.title_original,
    });
  });

  it('koostatud pealkiri ilma tõlketa: inglise liides näitab title-it', () => {
    const work = { title: 'Kiri Karl Morgensternile', title_devised: true };
    expect(workDisplayTitle(work, 'en')).toEqual({ main: work.title, secondary: null });
  });

  it('transkribeeritud pealkiri jääb põhireale ka tõlke olemasolul', () => {
    const work = { title: 'Disputatio theologica, de peccato', title_en: 'Theological disputation on sin' };
    expect(workDisplayTitle(work, 'en')).toEqual({ main: work.title, secondary: work.title_en });
    expect(workDisplayTitle(work, 'et')).toEqual({ main: work.title, secondary: null });
  });

  it('otsus tuleb lipust, mitte tüübist: liputa käsikiri käitub transkribeerituna', () => {
    const work = { title: 'Senati protokollid', title_en: 'Minutes', type: { id: 'Q87167' } };
    expect(workDisplayTitle(work, 'en').main).toBe('Senati protokollid');
  });

  it('tundmatu keel kukub tagasi title-ile', () => {
    expect(workDisplayTitle(protokoll, 'de').main).toBe(protokoll.title);
  });
});

describe('otherTitles', () => {
  it('koostatud pealkiri inglise liideses: eestikeelne ja originaal sildiga', () => {
    expect(otherTitles(protokoll, 'en')).toEqual([
      { key: 'titleInEstonian', value: protokoll.title },
      { key: 'titleOriginal', value: protokoll.title_original },
    ]);
  });

  it('eesti liideses: ingliskeelne ja originaal', () => {
    expect(otherTitles(protokoll, 'et')).toEqual([
      { key: 'titleEn', value: protokoll.title_en },
      { key: 'titleOriginal', value: protokoll.title_original },
    ]);
  });

  it('ainult title: midagi lisaks ei näidata', () => {
    expect(otherTitles({ title: 'Disputatio' }, 'en')).toEqual([]);
  });
});
