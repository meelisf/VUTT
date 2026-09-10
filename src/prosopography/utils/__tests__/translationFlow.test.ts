/**
 * Tõlkevoo kolm kaitset (spekk, otsused 5 ja 8). Need on OTSUSED, mitte
 * renderdus — seepärast on nad siin puhaste funktsioonidena testitavad.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_KEY, OTHER_FIELD, confirmClearPatch, isAnchorStale, isStaleResult,
  needsOverwriteConfirm, translateErrorKey,
} from '../translationFlow';

describe('needsOverwriteConfirm', () => {
  it('tühi sihtväli ei vaja kinnitust', () => {
    expect(needsOverwriteConfirm('')).toBe(false);
    expect(needsOverwriteConfirm('   \n ')).toBe(false);
  });
  it('täidetud sihtväli vajab kinnitust', () => {
    expect(needsOverwriteConfirm('Olemasolev tõlge.')).toBe(true);
  });
});

describe('isStaleResult', () => {
  const snap = { biography_et: 'Eesti', biography_en: '' };
  it('muutumatu olek ei ole aegunud', () => {
    expect(isStaleResult(snap, { ...snap })).toBe(false);
  });
  it('LÄHTEteksti muutus tõlke ajal → aegunud', () => {
    expect(isStaleResult(snap, { biography_et: 'Muudetud', biography_en: '' })).toBe(true);
  });
  it('SIHTteksti muutus tõlke ajal → samuti aegunud', () => {
    // Mõlema välja hetktõmmis, mitte ainult lähte oma: toimetaja võis
    // vahepeal sihtvälja ise kirjutama hakata.
    expect(isStaleResult(snap, { biography_et: 'Eesti', biography_en: 'Käsitsi' })).toBe(true);
  });
});

describe('confirmClearPatch', () => {
  it('LÄHTEteksti muutmine kustutab teise keele kinnituse', () => {
    expect(confirmClearPatch('biography_et', { confirm_et: false, confirm_en: true }))
      .toEqual({ confirm_en: false });
  });
  it('SIHTteksti toimetamine EI kustuta kinnitust', () => {
    // Toimetaja parandab tõlget — see on kinnituse SISU, mitte selle rikkumine.
    expect(confirmClearPatch('biography_en', { confirm_et: false, confirm_en: true }))
      .toEqual({});
  });
  it('juba märkimata ruut ei tekita tühja patchi', () => {
    expect(confirmClearPatch('biography_et', { confirm_et: false, confirm_en: false }))
      .toEqual({});
  });
});

describe('isAnchorStale', () => {
  it('ankruta väli EI ole vananenud', () => {
    // `null` tähendab „seost ei ole salvestatud", MITTE „vananenud" (ADR 0039).
    expect(isAnchorStale(null, 'abc123abc123')).toBe(false);
    expect(isAnchorStale(undefined, 'abc123abc123')).toBe(false);
  });
  it('sama räsi → ei ole vananenud', () => {
    expect(isAnchorStale({ hash: 'abc123abc123', at: 'x' }, 'abc123abc123')).toBe(false);
  });
  it('erinev räsi → vananenud', () => {
    expect(isAnchorStale({ hash: 'abc123abc123', at: 'x' }, 'zzz999zzz999')).toBe(true);
  });
});

describe('kaardistused ja veavõtmed', () => {
  it('OTHER_FIELD ja CONFIRM_KEY on ristis õigetpidi', () => {
    expect(OTHER_FIELD.biography_en).toBe('biography_et');
    expect(OTHER_FIELD.biography_et).toBe('biography_en');
    expect(CONFIRM_KEY.biography_en).toBe('confirm_en');
  });
  it('iga veatüüp annab oma i18n võtme', () => {
    const kõik = (['blocked', 'rate_limited', 'other'] as const).map(translateErrorKey);
    expect(new Set(kõik).size).toBe(3);
    expect(kõik.every(k => k.startsWith('form.'))).toBe(true);
  });
});
