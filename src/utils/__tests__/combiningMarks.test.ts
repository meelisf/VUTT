import { describe, expect, it } from 'vitest';
import { markChangeAt, type CombiningMark } from '../combiningMarks';

// Rakendab muudatuse ja tagastab uue teksti (null → muutumatu).
function apply(text: string, kind: CombiningMark, pos = text.length): string {
  const ch = markChangeAt(text, pos, kind);
  return ch ? text.slice(0, ch.from) + ch.insert + text.slice(ch.to) : text;
}
const m = (text: string, pos?: number) => apply(text, 'macron', pos);

describe('makron (ADR 0062)', () => {
  it('lisab vokaalile precomposed makroni', () => {
    expect(m('cu')).toBe('cū');
    expect(m('no')).toBe('nō');
    expect(m('E')).toBe('Ē');
  });

  it('lisab konsonandile kombineeriva makroni (m\u0304 n\u0304 q\u0304)', () => {
    expect(m('Cam')).toBe('Cam\u0304');
    expect(m('vn')).toBe('vn\u0304');
    expect(m('q')).toBe('q\u0304');
  });

  it('teine vajutus eemaldab', () => {
    expect(m(m('cu'))).toBe('cu');
    expect(m(m('Cam'))).toBe('Cam');
  });

  it('asendab tilde ja ülakriipsu (ka precomposed ũ õ ñ)', () => {
    expect(m('cũ')).toBe('cū');
    expect(m('nõ')).toBe('nō');
    expect(m('vñ')).toBe('vn\u0304');
    expect(m('Camm\u0303')).toBe('Camm\u0304');
    expect(m('m\u0305')).toBe('m\u0304');
  });

  it('muudab ainult kursori ees olevat tähte', () => {
    expect(m('cum laude', 2)).toBe('cūm laude');
  });


  it('no-op: kreeka täht, number, tühik, algus, privaatala', () => {
    expect(markChangeAt('υ', 1, 'macron')).toBeNull();
    expect(markChangeAt('8', 1, 'macron')).toBeNull();
    expect(markChangeAt('a ', 2, 'macron')).toBeNull();
    expect(markChangeAt('abc', 0, 'macron')).toBeNull();
    expect(markChangeAt('\u{E8BF}', 1, 'macron')).toBeNull();
  });

  it('tulemus on NFC', () => {
    const out = m('e');
    expect(out).toBe(out.normalize('NFC'));
    expect(out).toBe('ē');
  });
});

describe('aktsendid: tsirkumfleks, akuut, graavis', () => {
  it('ladina: â á à, teine vajutus eemaldab', () => {
    expect(apply('a', 'circumflex')).toBe('â');
    expect(apply('a', 'acute')).toBe('á');
    expect(apply('a', 'grave')).toBe('à');
    expect(apply('á', 'acute')).toBe('a');
  });

  it('aktsendid välistavad üksteist (â → á → à)', () => {
    expect(apply('â', 'acute')).toBe('á');
    expect(apply('á', 'grave')).toBe('à');
    expect(apply('à', 'circumflex')).toBe('â');
  });

  it('kreeka: ά ὰ ᾶ (tsirkumfleks = perispomeni U+0342)', () => {
    expect(apply('α', 'acute')).toBe('ά');
    expect(apply('α', 'grave')).toBe('ὰ');
    expect(apply('α', 'circumflex')).toBe('ᾶ');
  });

  it('kreeka: aktsent läheb klaviatuurilt trükitud hõngusmärgi järele (ἄ ἂ ἆ ἅ)', () => {
    expect(apply('ἀ', 'acute')).toBe('ἄ');
    expect(apply('ἀ', 'grave')).toBe('ἂ');
    expect(apply('ἀ', 'circumflex')).toBe('ἆ');
    expect(apply('ἁ', 'acute')).toBe('ἅ');
  });

  it('aktsent täppide järele, iota subscriptum jääb (ΐ ǘ ᾴ)', () => {
    expect(apply('ϊ', 'acute')).toBe('ΐ');
    expect(apply('ü', 'acute')).toBe('ǘ');
    expect(apply('ᾳ', 'acute')).toBe('ᾴ');
  });
});

describe('makroni järjekord teiste märkidega', () => {
  it('makron täppide järele (ǖ), aktsendi ette (ḗ)', () => {
    expect(m('ü')).toBe('ǖ');
    expect(m('é')).toBe('ḗ');
  });
});
