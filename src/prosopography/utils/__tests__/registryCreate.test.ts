import { describe, it, expect } from 'vitest';
import { entityToRegistryDraft, formatYears, parseYears, previewKey, sameIdEntry, similarEntries, slugKey } from '../registryCreate';

const time = (year: number) => ({ mainsnak: { datavalue: { value: { time: `+${year}-00-00T00:00:00Z` } } } });
const item = (id: string) => ({ mainsnak: { datavalue: { value: { id } } } });

// Wikidata wbgetentities kuju (Q20641850 lühendatult).
const TARTU_1630 = {
  id: 'Q20641850',
  labels: { et: { value: 'Tartu gümnaasium' }, en: { value: 'Tartu Gymnasium' }, fr: { value: 'Gymnase de Tartu' } },
  aliases: { de: [{ value: 'Gymnasium Dorpatense' }, { value: 'tartu gümnaasium' }] },
  descriptions: { et: { value: 'kool Rootsi-aegses Tartus (1630–1632)' } },
  claims: { P31: [item('Q3914')], P571: [time(1630)], P576: [time(1632)], P131: [item('Q13972')] },
};

const REG = {
  'gymn-dorpat': { id: 'Q12376416', labels: { et: 'Tartu Gümnaasium', en: 'Tartu Governorate Gymnasium' }, variants: ['Gymn. Dorpat'] },
  'univ-rostock': { id: 'Q159895', labels: { et: 'Rostocki ülikool' }, variants: [] },
  'tartu-ulikool': { id: 'Q204181', labels: { et: 'Tartu ülikool' }, variants: [] },
};

describe('entityToRegistryDraft', () => {
  it('asutus: sildid, aliased variantideks (kordused välja), liik, aastad, koht Q järgi', () => {
    const draft = entityToRegistryDraft(TARTU_1630, 'institution', { Dorpat: { id: 'Q13972' }, Reval: { id: 'Q1770' } });
    expect(draft).toEqual({
      id: 'Q20641850', labels: { et: 'Tartu gümnaasium', en: 'Tartu Gymnasium' },
      variants: ['Gymnasium Dorpatense'], description: 'kool Rootsi-aegses Tartus (1630–1632)',
      type: 'school', place_key: 'Dorpat', active_from: 1630, active_to: 1632,
    });
  });

  it('mitmetähenduslik koht jääb sidumata; amet ei saa liiki, kohta ega aastaid', () => {
    const twice = entityToRegistryDraft(TARTU_1630, 'institution', { Dorpat: { id: 'Q13972' }, Tartu: { id: 'Q13972' } });
    expect(twice.place_key).toBeUndefined();
    const occupation = entityToRegistryDraft(TARTU_1630, 'occupation', { Dorpat: { id: 'Q13972' } });
    expect(Object.keys(occupation).sort()).toEqual(['description', 'id', 'labels', 'variants']);
  });
});

describe('aastad', () => {
  it('parse ja format', () => {
    expect(parseYears('1630–1632')).toEqual({ active_from: 1630, active_to: 1632 });
    expect(parseYears(' 1630 - ')).toEqual({ active_from: 1630 });
    expect(parseYears('–1632')).toEqual({ active_to: 1632 });
    expect(parseYears('1630')).toEqual({ active_from: 1630, active_to: 1630 });
    expect(parseYears('')).toEqual({});
    expect(parseYears('1632–1630')).toBeNull();
    expect(parseYears('umbes 1630')).toBeNull();
    expect(parseYears('–')).toBeNull();
    expect(formatYears(1630, 1632)).toBe('1630–1632');
    expect(formatYears(1630)).toBe('1630–');
    expect(formatYears(undefined, 1632)).toBe('–1632');
  });
});

describe('võti ja kontroll', () => {
  it('eelvaade kordab serverit: slug, kokkupõrkel aasta, siis number', () => {
    expect(slugKey('Åbo Akademi / Turu')).toBe('abo-akademi-turu');
    const draft = { id: null, labels: { et: 'Tartu gümnaasium' }, variants: [], active_from: 1630 };
    expect(previewKey({}, draft)).toBe('tartu-gumnaasium');
    expect(previewKey({ 'tartu-gumnaasium': 1 }, draft)).toBe('tartu-gumnaasium-1630');
    expect(previewKey({ 'tartu-gumnaasium': 1, 'tartu-gumnaasium-1630': 1 }, draft)).toBe('tartu-gumnaasium-1630-2');
    expect(previewKey({ 'tartu-gumnaasium': 1 }, { ...draft, active_from: undefined })).toBe('tartu-gumnaasium-2');
  });

  it('sama Q-kood leitakse eraldi; sarnane nimi on ülevaatamiseks, mitte sama Q', () => {
    expect(sameIdEntry(REG, 'Q159895')).toBe('univ-rostock');
    expect(sameIdEntry(REG, 'Q1')).toBeNull();
    const draft = { id: 'Q20641850', labels: { et: 'Tartu gümnaasium', en: 'Tartu Gymnasium' }, variants: [] };
    expect(similarEntries(REG, draft, 'et').map(s => s.key)).toEqual(['gymn-dorpat']);
    // Sama Q ei ole „sarnane" — see on sameIdEntry.
    expect(similarEntries(REG, { ...draft, id: 'Q12376416' }, 'et')).toEqual([]);
    // Lühike ühisosa ei loe: „Tartu" ≠ „Tartu ülikool".
    expect(similarEntries(REG, { id: null, labels: { et: 'Tartu' }, variants: [] }, 'et')).toEqual([]);
  });
});
