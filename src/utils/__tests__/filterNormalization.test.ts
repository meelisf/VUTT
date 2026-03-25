import { describe, it, expect } from 'vitest';
import { resolveFilterValue, resolveItemValue } from '../filterNormalization';
import type { FilterItem } from '../facetUtils';

const items = (entries: [string, string][]): FilterItem[] =>
  entries.map(([value, label]) => ({ value, label, count: 1 }));

// ---------------------------------------------------------------------------
// resolveFilterValue
// Kasutatakse AdvancedFilters-is effectiveSelectedGenre + effectiveSelectedType jaoks.
// ---------------------------------------------------------------------------
describe('resolveFilterValue', () => {
  it('null sisend → null', () => {
    expect(resolveFilterValue(null, [])).toBeNull();
  });

  it('PEAMINE VIGA: Q-kood on listis → tagastab Q-koodi, EI konverdi labeliks', () => {
    // See oli viga mis põhjustas 201 → 2 tulemuse efekti.
    // effectiveSelectedGenre tagastas "oratsioon" (label), mitte "Q861911",
    // mis põhjustas filter genre_et = "oratsioon" asemel genre_ids = "Q861911".
    const genreItems = items([['Q861911', 'oratsioon']]);
    const genreIdMap = { 'Q861911': 'oratsioon' };
    expect(resolveFilterValue('Q861911', genreItems, genreIdMap)).toBe('Q861911');
  });

  it('inglise UI: Q-kood on listis inglise labeliga → ikka Q-kood', () => {
    const genreItems = items([['Q861911', 'oration']]);
    const genreIdMap = { 'Q861911': 'oration' };
    expect(resolveFilterValue('Q861911', genreItems, genreIdMap)).toBe('Q861911');
  });

  it('Q-kood PUUDUB listist, aga on idToLabel kaardis → tagastab labeli (keeleülene normaliseerimine)', () => {
    // Näide: et UI-s on Q861911 → "oratsioon", en UI-s on Q861911 → "oration"
    // Kui kasutaja vahetas keelt et→en, on selectedGenre="Q861911", items sisaldab "oration"
    const genreItems = items([['Q100', 'disputatsioon']]);
    const genreIdMap = { 'Q861911': 'oratsioon' };
    expect(resolveFilterValue('Q861911', genreItems, genreIdMap)).toBe('oratsioon');
  });

  it('keelevahetuse stsenaarium et→en: URL-param "oratsioon" → normalized inglise label', () => {
    // Kasutaja on eesti keeles valinud "oratsioon", vahetas en keelde
    // crossLangMap: { oratsioon: 'oration' }
    const genreItemsEn = items([['Q861911', 'oration']]);
    const crossLangMap = { 'oratsioon': 'oration' };
    expect(resolveFilterValue('oratsioon', genreItemsEn, {}, crossLangMap)).toBe('oration');
  });

  it('keelevahetuse stsenaarium en→et: URL-param "oration" → normalized eesti label', () => {
    const genreItemsEt = items([['Q861911', 'oratsioon']]);
    const crossLangMap = { 'oration': 'oratsioon' };
    expect(resolveFilterValue('oration', genreItemsEt, {}, crossLangMap)).toBe('oratsioon');
  });

  it('vocabulary-põhine žanr (pole Q-kood) on listis → tagastatakse muutmata', () => {
    // Mõned žanrid on vocabulary-s stringina, mitte Q-koodina
    const genreItems = items([['disputatsioon', 'Disputatsioon']]);
    expect(resolveFilterValue('disputatsioon', genreItems)).toBe('disputatsioon');
  });

  it('täiesti tundmatu väärtus ilma kaardita → tagastatakse algne väärtus', () => {
    expect(resolveFilterValue('tundmatu-žanr', items([]), {}, {})).toBe('tundmatu-žanr');
  });

  it('crossLangMap prioriteet on madalam kui idToLabel', () => {
    // idToLabel leiab vastuse enne crossLangMap-i
    const crossLangMap = { 'Q861911': 'vale-tulemus' };
    const idToLabel = { 'Q861911': 'oige-tulemus' };
    expect(resolveFilterValue('Q861911', items([]), idToLabel, crossLangMap)).toBe('oige-tulemus');
  });
});

// ---------------------------------------------------------------------------
// resolveItemValue
// Kasutatakse AdvancedFilters-is selectedGenreItemValue + selectedTypeItemValue jaoks.
// Tagastab item.value formaadis väärtuse (Q-kood) — pill aktiivsuse tuvastamiseks.
// ---------------------------------------------------------------------------
describe('resolveItemValue', () => {
  it('null → null', () => {
    expect(resolveItemValue(null, [])).toBeNull();
  });

  it('Q-kood on listis → tagastab Q-koodi', () => {
    expect(resolveItemValue('Q861911', items([['Q861911', 'oratsioon']]))).toBe('Q861911');
  });

  it('label → leiab Q-koodi labelToId kaudu kui see on listis', () => {
    const genreItems = items([['Q861911', 'oratsioon']]);
    const labelToId = { 'oratsioon': 'Q861911' };
    expect(resolveItemValue('oratsioon', genreItems, labelToId)).toBe('Q861911');
  });

  it('label → null kui vastavat Q-koodi pole listis', () => {
    const genreItems = items([['Q100', 'disputatsioon']]);
    const labelToId = { 'oratsioon': 'Q861911' };
    expect(resolveItemValue('oratsioon', genreItems, labelToId)).toBeNull();
  });

  it('tundmatu väärtus → null', () => {
    expect(resolveItemValue('unknown', items([['Q861911', 'oratsioon']]))).toBeNull();
  });

  it('vocabulary-põhine string (pole Q-kood) on listis → tagastatakse see', () => {
    const genreItems = items([['disputatsioon', 'Disputatsioon']]);
    expect(resolveItemValue('disputatsioon', genreItems)).toBe('disputatsioon');
  });
});
