import { describe, it, expect } from 'vitest';
import { nextAnnId, extractHighlightedText, removeAnnTags, containsAnnTag, findAnnIdsInText, annotationRange, annotationSegments } from '../annUtils';
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

describe('annotationRange', () => {
  // Abiline: valik antakse alamstringi kaudu, tagastatakse annoteeritav lõik.
  const pick = (doc: string, sel: string, at = 0) => {
    const from = doc.indexOf(sel, at);
    const r = annotationRange(doc, from, from + sel.length);
    return r && doc.slice(r.from, r.to);
  };

  it('tavaline valik jääb samaks', () => {
    expect(pick('enne märgitud järel', 'märgitud')).toBe('märgitud');
  });

  it('marginaalia rida reavahetusega → </m> ja reavahetus jäävad välja (#1645 lk 6)', () => {
    const doc = '<m><i>Jocoſer:</i></m>\n<m><i>[---]76.</i></m>\nlaniaſſe credebatur.';
    expect(pick(doc, '<i>[---]76.</i></m>\n')).toBe('<i>[---]76.</i>');
  });

  it('terve marginaaliaplokk → <m> ise jääb välja (m on välimine täg)', () => {
    const doc = 'x\n<m><i>Ratio 3.</i></m>\ny';
    expect(pick(doc, '<m><i>Ratio 3.</i></m>')).toBe('<i>Ratio 3.</i>');
  });

  it('serval poolik avatäg kukub ära, tasakaalus paar jääb', () => {
    expect(pick('<i>ab</i> cd', '</i> cd')).toBe('cd');
    expect(pick('ab <i>cd</i>', 'ab <i>')).toBe('ab');
    expect(pick('<i>ab</i> cd', '<i>ab</i> cd')).toBe('<i>ab</i> cd');
  });

  it('kahe marginaaliaploki üle → null (ühte ankrut ei saa kahte plokki panna)', () => {
    const doc = '<m><i>Jocoſer:</i></m>\n<m><i>[---]76.</i></m>';
    expect(pick(doc, 'Jocoſer:</i></m>\n<m><i>[---]76.')).toBeNull();
  });

  it('valik keset ristuvat tägi → null', () => {
    expect(pick('a<i>bc de</i>f', 'c de</i>f')).toBeNull();
    expect(pick('<b>a<i>bc</b> de</i>', 'a<i>bc</b> de')).toBeNull();
  });

  it('<pb/> ei sega', () => {
    expect(pick('ab <pb/> cd', 'ab <pb/> cd')).toBe('ab <pb/> cd');
  });

  it('ainult tägid / tühik → null', () => {
    expect(pick('<m><i></i></m>\n', '<m><i></i></m>\n')).toBeNull();
    expect(pick('a   b', '   ')).toBeNull();
  });
});

describe('annotationSegments', () => {
  const segs = (doc: string, sel: string) => {
    const from = doc.indexOf(sel);
    const r = annotationSegments(doc, from, from + sel.length);
    return r && r.map(s => doc.slice(s.from, s.to));
  };

  it('ühe rea valik → üks tükk', () => {
    expect(segs('<m><i>x</i></m>\ny', '<m><i>x</i></m>\n')).toEqual(['<i>x</i>']);
  });

  it('põhiteksti mitmerealine valik → üks ankur', () => {
    expect(segs('ab\ncd\nef', 'b\ncd\ne')).toEqual(['b\ncd\ne']);
  });

  it('mitmerealine marginaaliakaart → tükk igal real (#1645 lk 6)', () => {
    const doc = '<m><i>Jocoſer:</i></m>\n<m><i>[---]76.</i></m>\nlaniaſſe';
    expect(segs(doc, '<m><i>Jocoſer:</i></m>\n<m><i>[---]76.</i></m>\n'))
      .toEqual(['<i>Jocoſer:</i>', '<i>[---]76.</i>']);
    expect(segs(doc, 'Jocoſer:</i></m>\n<m><i>[---]7'))
      .toEqual(['Jocoſer:', '[---]7']);
  });

  it('marginaalia rida keset põhiteksti valikut → tükid, <m> ei jää ankru sisse', () => {
    expect(segs('ab\n<m>x</m>\ncd', 'ab\n<m>x</m>\ncd')).toEqual(['ab', 'x', 'cd']);
  });

  it('mõni rida ristub → null', () => {
    expect(segs('<m>x</m>\na<i>b c</i>', 'x</m>\na<i>b')).toBeNull();
  });
});

describe('mitme tükiga ankur', () => {
  it('extractHighlightedText liidab tükid', () => {
    expect(extractHighlightedText('<m><ann3>a</ann3></m>\n<m><ann3>b</ann3></m>', 3)).toBe('a b');
  });
});
