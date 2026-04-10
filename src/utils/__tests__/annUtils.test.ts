import { describe, it, expect } from 'vitest';
import { nextAnnId, extractHighlightedText, removeAnnTags, containsAnnTag, findAnnIdsInText } from '../annUtils';
import type { TextAnnotation } from '../../types';

describe('nextAnnId', () => {
  it('tühi massiiv → 1', () => {
    expect(nextAnnId([])).toBe(1);
  });

  it('annid [1, 3] → 4 (max + 1)', () => {
    const anns: TextAnnotation[] = [
      { id: 1, comment: 'a', author: 'u', created_at: '2026-01-01' },
      { id: 3, comment: 'b', author: 'u', created_at: '2026-01-01' },
    ];
    expect(nextAnnId(anns)).toBe(4);
  });
});

describe('extractHighlightedText', () => {
  it('leiab annoteeritud teksti', () => {
    expect(extractHighlightedText('enne <ann2>märgitud sõnad</ann2> järel', 2)).toBe('märgitud sõnad');
  });

  it('puuduv id → tühi string', () => {
    expect(extractHighlightedText('mingi tekst', 5)).toBe('');
  });

  it('ei sega ann1 ja ann12 omavahel', () => {
    const text = '<ann12>pikk tekst</ann12> ja <ann1>lühike</ann1>';
    expect(extractHighlightedText(text, 1)).toBe('lühike');
    expect(extractHighlightedText(text, 12)).toBe('pikk tekst');
  });
});

describe('removeAnnTags', () => {
  it('eemaldab avava ja sulgeva tägi, jätab sisu', () => {
    expect(removeAnnTags('enne <ann2>märgitud sõnad</ann2> järel', 2)).toBe('enne märgitud sõnad järel');
  });

  it('puuduv id → tekst muutumata', () => {
    expect(removeAnnTags('mingi tekst', 99)).toBe('mingi tekst');
  });

  it('ei eemalda teist id-d (ann1 ei mõjuta ann12)', () => {
    const text = '<ann1>tekst</ann1> ja <ann12>pikk</ann12>';
    expect(removeAnnTags(text, 1)).toBe('tekst ja <ann12>pikk</ann12>');
  });
});

describe('containsAnnTag', () => {
  it('tagastab false tühja valiku korral', () => {
    expect(containsAnnTag('mingi tekst', 5, 5)).toBe(false);
  });

  it('tagastab true kui valikus on avav ann-täg', () => {
    expect(containsAnnTag('enne <ann3>tekst</ann3> järel', 4, 20)).toBe(true);
  });

  it('tagastab false kui ann-tägid on valikust väljas', () => {
    expect(containsAnnTag('<ann3>tekst</ann3> järel', 17, 23)).toBe(false);
  });
});

describe('findAnnIdsInText', () => {
  it('leiab kõik ann ID-d tekstist', () => {
    const text = '<ann1>a</ann1> tekst <ann3>b</ann3>';
    expect(findAnnIdsInText(text).sort()).toEqual([1, 3]);
  });

  it('tühi tekst → tühi massiiv', () => {
    expect(findAnnIdsInText('')).toEqual([]);
  });
});
