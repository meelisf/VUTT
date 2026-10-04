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

  it('säilitab muud märgid (ü + makron)', () => {
    const out = m('ü').normalize('NFD');
    expect(out).toContain('\u0308');
    expect(out).toContain('\u0304');
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

describe('tsirkumfleks', () => {
  it('ladina täht → U+0302 (â), teine vajutus eemaldab', () => {
    expect(apply('a', 'circumflex')).toBe('â');
    expect(apply('â', 'circumflex')).toBe('a');
  });

  it('kreeka täht → perispomeni U+0342 (ᾶ)', () => {
    expect(apply('α', 'circumflex')).toBe('ᾶ');
  });

  it('kreeka: perispomeni läheb hõngusmärgi järele (ἆ, mitte ᾶ + lenis)', () => {
    expect(apply('ἀ', 'circumflex')).toBe('ἆ'); // ἀ → ἆ
  });
});

describe('hõngusmärgid', () => {
  it('lenis ja asper ainult kreeka tähel', () => {
    expect(apply('α', 'lenis')).toBe('ἀ');  // ἀ
    expect(apply('α', 'asper')).toBe('ἁ');  // ἁ
    expect(apply('ρ', 'asper')).toBe('ῥ');  // ῥ
    expect(markChangeAt('a', 1, 'lenis')).toBeNull();
  });

  it('asper vahetab lenise välja ja vastupidi; sama märk teist korda eemaldab', () => {
    expect(apply('ἀ', 'asper')).toBe('ἁ');
    expect(apply('ἁ', 'lenis')).toBe('ἀ');
    expect(apply('ἀ', 'lenis')).toBe('α');
  });

  it('hõngusmärk läheb aktsendi ette (ά → ἄ)', () => {
    expect(apply('ά', 'lenis')).toBe('ἄ');
  });

  it('suurtäht (Ἀ) ja iota subscriptum (ᾳ → ᾀ)', () => {
    expect(apply('Α', 'lenis')).toBe('Ἀ');
    expect(apply('ᾳ', 'lenis')).toBe('ᾀ');
  });
});
