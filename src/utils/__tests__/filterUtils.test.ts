import { describe, it, expect } from 'vitest';
import {
  buildTagFilter,
  buildPageTagFilter,
  buildGenreFilter,
  buildTypeFilter,
  buildPrinterFilter,
  buildMultiFilter,
} from '../filterUtils';

// ---------------------------------------------------------------------------
// buildTagFilter — teose märksõnade filter
// ---------------------------------------------------------------------------
describe('buildTagFilter', () => {
  it('Q-kood → tags_ids', () => {
    expect(buildTagFilter('Q12345')).toBe('tags_ids = "Q12345"');
  });

  it('vutt: isiku-ID → tags_ids (mitte tags_et/en)', () => {
    // See oli viga: isikute vutt: ID-d läksid tags_et filtrisse ja ei leidnud tulemusi
    expect(buildTagFilter('vutt:Pbfsvyp')).toBe('tags_ids = "vutt:Pbfsvyp"');
  });

  it('vutt: ID mis algab vutt:P-ga → tags_ids', () => {
    expect(buildTagFilter('vutt:P82rja6')).toBe('tags_ids = "vutt:P82rja6"');
  });

  it('eestikeelne label → tags_et OR tags_en', () => {
    expect(buildTagFilter('retoorika')).toBe('(tags_et = "retoorika" OR tags_en = "retoorika")');
  });

  it('ingliskeelne label → sama bilingvaalne muster', () => {
    expect(buildTagFilter('rhetoric')).toBe('(tags_et = "rhetoric" OR tags_en = "rhetoric")');
  });

  it('osalise Q-formaadiga string (Q123x) läheb labelina', () => {
    expect(buildTagFilter('Q123x')).toBe('(tags_et = "Q123x" OR tags_en = "Q123x")');
  });

  it('tühi string → label filter (ei krahhita)', () => {
    expect(buildTagFilter('')).toBe('(tags_et = "" OR tags_en = "")');
  });
});

// ---------------------------------------------------------------------------
// buildPageTagFilter — lehekülje märksõnade filter
// ---------------------------------------------------------------------------
describe('buildPageTagFilter', () => {
  it('Q-kood → page_tags_ids', () => {
    expect(buildPageTagFilter('Q999')).toBe('page_tags_ids = "Q999"');
  });

  it('label → page_tags_et OR page_tags_en', () => {
    expect(buildPageTagFilter('piibel')).toBe('(page_tags_et = "piibel" OR page_tags_en = "piibel")');
  });

  it('vutt: ID — lehekülje tags ei toeta vutt: ID-d, läheb labelina', () => {
    // Lehekülje tagid on vaid tekstitaseme annotatsioonid, mitte isikud
    expect(buildPageTagFilter('vutt:Ptest')).toBe('(page_tags_et = "vutt:Ptest" OR page_tags_en = "vutt:Ptest")');
  });
});

// ---------------------------------------------------------------------------
// buildGenreFilter — žanri filter
// ---------------------------------------------------------------------------
describe('buildGenreFilter', () => {
  it('Q-kood → genre_ids (peamine kasutusjuht)', () => {
    expect(buildGenreFilter('Q861911')).toBe('genre_ids = "Q861911"');
  });

  it('eestikeelne label → genre_et OR genre_en', () => {
    expect(buildGenreFilter('oratsioon')).toBe('(genre_et = "oratsioon" OR genre_en = "oratsioon")');
  });

  it('ingliskeelne label → sama bilingvaalne muster', () => {
    expect(buildGenreFilter('oration')).toBe('(genre_et = "oration" OR genre_en = "oration")');
  });

  it('ladinakeelne nimi → label filter', () => {
    expect(buildGenreFilter('Oratio')).toBe('(genre_et = "Oratio" OR genre_en = "Oratio")');
  });
});

// ---------------------------------------------------------------------------
// buildTypeFilter — tüübi filter
// ---------------------------------------------------------------------------
describe('buildTypeFilter', () => {
  it('Q-kood → type_ids', () => {
    expect(buildTypeFilter('Q7210')).toBe('type_ids = "Q7210"');
  });

  it('eestikeelne label → type_et OR type_en', () => {
    expect(buildTypeFilter('väitekiri')).toBe('(type_et = "väitekiri" OR type_en = "väitekiri")');
  });

  it('ingliskeelne label → type_et OR type_en', () => {
    expect(buildTypeFilter('dissertation')).toBe('(type_et = "dissertation" OR type_en = "dissertation")');
  });
});

// ---------------------------------------------------------------------------
// buildPrinterFilter — trükkali filter
// ---------------------------------------------------------------------------
describe('buildPrinterFilter', () => {
  it('Q-kood → publisher_id', () => {
    expect(buildPrinterFilter('Q456789')).toBe('publisher_id = "Q456789"');
  });

  it('label → publisher täpne vaste', () => {
    expect(buildPrinterFilter('Vogel')).toBe('publisher = "Vogel"');
  });

  it('GND-stiilis ID ei ole Q-kood → läheb labelina', () => {
    // GND ID-d pole Q-koodid (algavad numbriga, mitte Q-ga)
    expect(buildPrinterFilter('GND:118626949')).toBe('publisher = "GND:118626949"');
  });
});

// ---------------------------------------------------------------------------
// buildMultiFilter — OR-filter mitme väärtuse jaoks
// ---------------------------------------------------------------------------
describe('buildMultiFilter', () => {
  it('üks Q-kood → ilma lisasululudeta', () => {
    expect(buildMultiFilter(['Q861911'], buildGenreFilter)).toBe('genre_ids = "Q861911"');
  });

  it('kaks Q-koodi → OR suludes', () => {
    expect(buildMultiFilter(['Q861911', 'Q123'], buildGenreFilter)).toBe(
      '(genre_ids = "Q861911" OR genre_ids = "Q123")'
    );
  });

  it('kolm tüüpi Q-koodiga', () => {
    expect(buildMultiFilter(['Q1', 'Q2', 'Q3'], buildTypeFilter)).toBe(
      '(type_ids = "Q1" OR type_ids = "Q2" OR type_ids = "Q3")'
    );
  });

  it('Q-kood ja label koos → segafilter', () => {
    expect(buildMultiFilter(['Q861911', 'oratsioon'], buildGenreFilter)).toBe(
      '(genre_ids = "Q861911" OR (genre_et = "oratsioon" OR genre_en = "oratsioon"))'
    );
  });

  it('üks label → ilma lisasululudeta', () => {
    expect(buildMultiFilter(['oratsioon'], buildGenreFilter)).toBe(
      '(genre_et = "oratsioon" OR genre_en = "oratsioon")'
    );
  });

  it('kaks labeli keeleülene', () => {
    // Kui kasutaja on valinud nii eesti kui inglise labeli (peaks kasutama Q-koode, aga käidumine on määratletud)
    expect(buildMultiFilter(['oratsioon', 'oration'], buildGenreFilter)).toBe(
      '((genre_et = "oratsioon" OR genre_en = "oratsioon") OR (genre_et = "oration" OR genre_en = "oration"))'
    );
  });
});
