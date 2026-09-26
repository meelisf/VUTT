// src/prosopography/utils/__tests__/relationsMap.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTER } from '../network';
import { lifeStations, lifeView, mapYearOf, originGroups, originPrintLinks, printPlaces } from '../relationsMap';
import type { PersonNetwork } from '../../services/networkService';
import type { PlaceEntry, ProsopoRecord } from '../../types';

const F = 'vutt:Pfocus';
const RIGA = { lat: 56.95, lon: 24.1 };
const ALTDORF = { lat: 49.39, lon: 11.36 };
const NET: PersonNetwork = {
  focus: { id: F, label: 'Fischer', birth_year: 1636, death_year: 1705, origin: null },
  persons: [
    { id: 'a', label: 'A', birth_year: null, death_year: null, origin: { place: 'Riga', place_id: 'Q1773', coordinates: RIGA } },
    { id: 'b', label: 'B', birth_year: null, death_year: null, origin: { place: 'Riga', place_id: 'Q1773', coordinates: RIGA } },
    { id: 'c', label: 'C', birth_year: null, death_year: null, origin: null },
  ],
  works: [
    { work_id: 'w1', title: 'Disp', year: 1658, place: { id: 'Q435295', label: 'Altdorf', coordinates: ALTDORF }, genres: [], restricted: false },
    { work_id: 'w2', title: 'Funus', year: 1697, place: { id: null, label: 'Berliin', coordinates: null }, genres: [], restricted: false },
  ],
  edges: [
    { kind: 'academic', from: 'a', to: F, directed: true, year: 1658, place: null, roles: {}, evidence: { work_id: 'w1', pages: [] } },
    { kind: 'cotext', from: 'b', to: F, directed: false, year: 1697, place: null, roles: {}, evidence: { work_id: 'w2', pages: [] } },
    { kind: 'cotext', from: 'c', to: F, directed: false, year: 1697, place: null, roles: {}, evidence: { work_id: 'w2', pages: [] } },
  ],
};
const v = applyFilters(NET, DEFAULT_FILTER);

describe('originGroups', () => {
  it('rühmitab päritolu järgi, liikide jaotusega; päritoluta eraldi', () => {
    const { groups, unmapped } = originGroups(v);
    expect(groups).toHaveLength(1);
    expect(groups[0].persons.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(groups[0].kinds).toEqual({ academic: 1, cotext: 1 });
    expect(unmapped.map(p => p.id)).toEqual(['c']);
  });
});

describe('printPlaces ja originPrintLinks', () => {
  it('trükikohad ainult koordinaadiga; academic loendus', () => {
    const pp = printPlaces(v);
    expect(pp.map(p => p.label)).toEqual(['Altdorf']);
    expect(pp[0].academic).toBe(1);
  });

  it('jooned ainult academic servadele, mõlemal otsal koordinaat', () => {
    expect(originPrintLinks(v)).toEqual([{ personId: 'a', from: RIGA, to: ALTDORF, workId: 'w1' }]);
  });
});

describe('mapYearOf', () => {
  it('servade aastate mediaan; aastateta varuväärtus', () => {
    expect(mapYearOf(v)).toBe(1697);
    expect(mapYearOf({ ...v, edges: [] }, 1650)).toBe(1650);
  });
});

const REG: Record<string, PlaceEntry> = {
  'Lübeck': { id: 'Q2843', labels: { et: 'Lübeck' }, coordinates: { lat: 53.87, lon: 10.69 } },
  'Magdeburg': { id: 'Q1733', labels: { et: 'Magdeburg' }, coordinates: { lat: 52.13, lon: 11.62 } },
  'Liivimaa': { id: 'Q183464', labels: { et: 'Liivimaa' }, coordinates: null },
};
const date = (d: string | null, place: { id: string | null; label: string } | null = null) =>
  ({ original_text: null, date: d, date_to: null, bound: null, precision: 'year', calendar: null, is_circa: false, place, notes: null });
const CARD = {
  id: F,
  birth: date('1636-01-01', { id: 'Q2843', label: 'Lübeck' }),
  death: date('1705-05-17', { id: 'Q1733', label: 'Magdeburg' }),
  origin: { place: 'Lübeck', place_id: 'Q2843', geonames_id: null, coordinates: null },
  occupations: [
    { label: 'Superintendent', institution: 'Pfalz-Sulzbach', institution_id: 'Q454436', date_from: date('1667-01-01') },
    { label: 'Superintendent', institution: 'Liivimaa', institution_id: 'Q183464', date_from: date('1673-01-01') },
    { label: 'Superintendent', institution: 'Magdeburg', institution_id: 'Q1733', date_from: date('1700-01-01') },
    { label: 'Pastor', institution: null, institution_id: null },
  ],
  education: [],
  burial: null,
} as unknown as ProsopoRecord;

describe('lifeStations (Fischer)', () => {
  const { mapped, unmapped } = lifeStations(CARD, REG);

  it('päritolu = sünnikoht → üks jaam; järjekord sünd → ametid → surm; numbrid', () => {
    expect(mapped.map(s => [s.kind, s.year, s.placeLabel, s.n])).toEqual([
      ['birth', 1636, 'Lübeck', 1],
      ['occupation', 1700, 'Magdeburg', 2],
      ['death', 1705, 'Magdeburg', 3],
    ]);
  });

  it('kaardita jaamad põhjusega; kuupäevata amet alles', () => {
    expect(unmapped.map(s => [s.placeLabel, s.reason])).toEqual([
      ['Pfalz-Sulzbach', 'not_in_registry'],
      ['Liivimaa', 'no_coordinates'],
      [null, 'no_place'],
    ]);
  });

  it('Q-koodita koht leitakse sildi järgi', () => {
    const card = { ...CARD, birth: date('1636', { id: null, label: 'Lübeck' }), origin: { ...CARD.origin, place_id: null } } as ProsopoRecord;
    expect(lifeStations(card, REG).mapped[0]).toMatchObject({ kind: 'birth', placeLabel: 'Lübeck' });
  });
});

describe('lifeStations kuupäevaväljad (arvustuse I2)', () => {
  const REG2: Record<string, PlaceEntry> = { ...REG, 'Riia': { id: 'Q1773', labels: { et: 'Riia' }, coordinates: { lat: 56.95, lon: 24.1 } } };
  it('haridus: kanooniline date_from, mitte ainult date_start; järjestus õige', () => {
    const card = { ...CARD, education: [{ institution: 'Riia', institution_id: 'Q1773', date_from: { date: '1655-09-25', precision: 'day' } }] } as unknown as ProsopoRecord;
    const kinds = lifeStations(card, REG2).mapped.map(s => [s.kind, s.year]);
    expect(kinds.slice(0, 3)).toEqual([['birth', 1636], ['education', 1655], ['occupation', 1700]]);
  });
  it('vanad year_from / year väljad', () => {
    const card = { ...CARD, occupations: [{ label: 'Pastor', institution: 'Riia', institution_id: 'Q1773', year_from: 1690 }],
                   education: [{ institution: 'Riia', institution_id: 'Q1773', year: 1655 }] } as unknown as ProsopoRecord;
    const years = lifeStations(card, REG2).mapped.map(s => s.year);
    expect(years).toEqual([1636, 1655, 1690, 1705]);
  });
});

describe('lifeView registri olek (arvustuse M2)', () => {
  it('laadimisel ja vea korral ei väida, et koht registris puudub', () => {
    expect(lifeView(CARD, 'loading').status).toBe('loading');
    expect(lifeView(CARD, 'error').status).toBe('error');
    const ready = lifeView(CARD, REG);
    expect(ready.status).toBe('ready');
    expect(ready.mapped.length).toBe(3);
  });
});
