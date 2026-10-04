import { describe, expect, it } from 'vitest';
import { macronChangeAt } from '../macron';

// Rakendab muudatuse ja tagastab uue teksti (null → muutumatu).
function apply(text: string, pos = text.length): string {
  const ch = macronChangeAt(text, pos);
  return ch ? text.slice(0, ch.from) + ch.insert + text.slice(ch.to) : text;
}

describe('macronChangeAt', () => {
  it('lisab vokaalile precomposed makroni', () => {
    expect(apply('cu')).toBe('cū');
    expect(apply('no')).toBe('nō');
    expect(apply('E')).toBe('Ē');
  });

  it('lisab konsonandile kombineeriva makroni (m̄ n̄ q̄)', () => {
    expect(apply('Cam')).toBe('Cam̄');
    expect(apply('vn')).toBe('vn̄');
    expect(apply('q')).toBe('q̄');
  });

  it('teine vajutus eemaldab makroni', () => {
    expect(apply(apply('cu'))).toBe('cu');
    expect(apply(apply('Cam'))).toBe('Cam');
  });

  it('asendab tilde ja ülakriipsu makroniga (ka precomposed ũ õ ñ)', () => {
    expect(apply('cũ')).toBe('cū');
    expect(apply('nõ')).toBe('nō');
    expect(apply('vñ')).toBe('vn̄');
    expect(apply('Camm̃')).toBe('Camm̄');
    expect(apply('m̅')).toBe('m̄');
  });

  it('töötab keset teksti — muudab ainult kursori ees olevat tähte', () => {
    expect(apply('cum laude', 2)).toBe('cūm laude');
  });

  it('säilitab muud kombineerivad märgid', () => {
    // ü + makron: täpid jäävad, NFC järjestab
    const out = apply('ü');
    expect(out.normalize('NFD')).toContain('̈');
    expect(out.normalize('NFD')).toContain('̄');
  });

  it('no-op: mitte-ladina täht, number, tühik, algus', () => {
    expect(macronChangeAt('υ', 1)).toBeNull();       // kreeka
    expect(macronChangeAt('8', 1)).toBeNull();
    expect(macronChangeAt('a ', 2)).toBeNull();
    expect(macronChangeAt('abc', 0)).toBeNull();
    expect(macronChangeAt('\u{E8BF}', 1)).toBeNull(); // privaatala (MUFI), mitte ladina
  });

  it('tulemus on NFC', () => {
    const out = apply('e');
    expect(out).toBe(out.normalize('NFC'));
    expect(out).toBe('ē');
  });
});
