import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { escapeAccidentalOrderedLists } from '../markdownViewHelpers';

// Kontrollime nii teisenduse teksti kui ka seda, mida markdown-parser
// tulemusest teeb — invariant on „lõik jääb lõiguks".
const blockTypes = (md: string) =>
  unified().use(remarkParse).parse(md).children.map((n) => n.type);

const render = (md: string) => blockTypes(escapeAccidentalOrderedLists(md));

describe('escapeAccidentalOrderedLists', () => {
  it('aastaarvuga algav lõik ei muutu loendiks', () => {
    const src = '1759. aastal immatrikuleerus ta Tartus.';
    expect(blockTypes(src)).toEqual(['list']); // ilma paranduseta katki
    expect(escapeAccidentalOrderedLists(src)).toBe('1759\\. aastal immatrikuleerus ta Tartus.');
    expect(render(src)).toEqual(['paragraph']);
  });

  it('kaitseb ka mitut aastaarvuga algavat lõiku', () => {
    const src = '1759. aastal sündis.\n\n1780. aastal immatrikuleerus.';
    expect(render(src)).toEqual(['paragraph', 'paragraph']);
  });

  it('üksik kuupäevaga algav lõik ei muutu loendiks', () => {
    const src = '1. jaanuaril 1759 sündis ta Tallinnas.';
    expect(render(src)).toEqual(['paragraph']);
  });

  it('sulgmarker käitub samamoodi', () => {
    const src = '1759) aastal immatrikuleerus.';
    expect(escapeAccidentalOrderedLists(src)).toBe('1759\\) aastal immatrikuleerus.');
    expect(render(src)).toEqual(['paragraph']);
  });

  it('päris nummerdatud loend (kaks või rohkem punkti) jääb loendiks', () => {
    const src = '1. esimene\n2. teine\n3. kolmas';
    expect(escapeAccidentalOrderedLists(src)).toBe(src);
    expect(render(src)).toEqual(['list']);
  });

  it('loend jääb alles ka mitmerealise punkti korral', () => {
    const src = '1. esimene\n   jätkub siin\n2. teine';
    expect(escapeAccidentalOrderedLists(src)).toBe(src);
    expect(render(src)).toEqual(['list']);
  });

  it('aastaarv loendi sees escape\'itakse, loend ise jääb alles', () => {
    const src = '1. esimene\n2. teine\n1759. aastal';
    const out = escapeAccidentalOrderedLists(src);
    expect(out).toBe('1. esimene\n2. teine\n1759\\. aastal');
  });

  it('täpploend ja tavatekst jäävad puutumata', () => {
    const src = '- esimene\n- teine\n\nTavaline lõik, kus 1759. aastal ei ole rea alguses.';
    expect(escapeAccidentalOrderedLists(src)).toBe(src);
  });

  it('koodiploki sisu ei puudutata', () => {
    const src = '```\n1759. aastal\n```';
    expect(escapeAccidentalOrderedLists(src)).toBe(src);
  });

  it('tühi sisend ja tekst ilma markeriteta tulevad muutmata tagasi', () => {
    expect(escapeAccidentalOrderedLists('')).toBe('');
    expect(escapeAccidentalOrderedLists('Sündis Tartus.')).toBe('Sündis Tartus.');
  });
});
