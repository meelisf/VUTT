// src/prosopography/utils/__tests__/network.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, coEdges, familyLabel, otherEnd, DEFAULT_FILTER } from '../network';
import type { PersonNetwork, NetworkEdge } from '../../services/networkService';

const F = 'vutt:Pfocus';
const P = (id: string, label = id) => ({ id, label, birth_year: null, death_year: null, origin: null });
const W = (work_id: string, year: number | null = 1658) =>
  ({ work_id, title: `T ${work_id}`, year, place: null, genres: [], restricted: false });
const E = (kind: NetworkEdge['kind'], other: string, work: string | null, year: number | null = 1658): NetworkEdge => ({
  kind, from: other, to: F, directed: kind === 'academic', year, place: null,
  evidence: work ? { work_id: work, pages: [] } : null,
  roles: work ? { [F]: ['respondens'], [other]: ['praeses'] } : undefined,
});

const NET: PersonNetwork = {
  focus: P(F, 'Fookus'),
  persons: [P('a'), P('b'), P('c'), P('t')],
  works: [W('w1'), W('w2', 1660), W('w3', null)],
  edges: [
    E('academic', 'a', 'w1'),
    E('cotext', 'a', 'w2', 1660),        // sama isik, nõrgem serv
    E('mention', 'b', 'w1'),
    E('cotext', 'b', 'w2', 1660),
    E('cotext', 'c', 'w2', 1660),
    E('cotext', 'c', 'w2', 1660),        // kaks serva samast teosest (mitu rolli) → 1 teos
    E('printer', 't', 'w1'),
  ],
};

describe('applyFilters', () => {
  it('vaikimisi peidab trükkalid ja eemaldab seosteta isikud', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.map(p => p.id).sort()).toEqual(['a', 'b', 'c']);
    expect(v.edges.some(e => e.kind === 'printer')).toBe(false);
  });

  it('isiku liik = tugevaim NÄHTAV serv', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.find(p => p.id === 'a')!.kind).toBe('academic');
    // b: mention (w1) + cotext (w2); KIND_ORDER-is on cotext tugevam kui mention
    expect(v.persons.find(p => p.id === 'b')!.kind).toBe('cotext');
  });

  it('peidetud tugevaim serv → liik järgmisest nähtavast', () => {
    const v = applyFilters(NET, { cotext: false, mention: true, printer: false });
    expect(v.persons.find(p => p.id === 'b')!.kind).toBe('mention');
  });

  it('ühiseid teoseid = unikaalsed work_id-d, mitte servad', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.find(p => p.id === 'c')!.workCount).toBe(1);
    expect(v.persons.find(p => p.id === 'a')!.workCount).toBe(2);
  });

  it('loendurid on nähtavate isikute liikide järgi', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.counts.academic).toBe(1);
    expect(v.counts.printer).toBe(0);
  });

  it('kõik servad peidetud → 0 isikut', () => {
    const onlyPrinter: PersonNetwork = { ...NET, persons: [P('t')], edges: [E('printer', 't', 'w1')] };
    expect(applyFilters(onlyPrinter, DEFAULT_FILTER).persons).toEqual([]);
  });

  it('firstYear on väikseim aasta, aastata servad ei loe', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    expect(v.persons.find(p => p.id === 'a')!.firstYear).toBe(1658);
  });
});

describe('coEdges', () => {
  it('seob isikud, kes esinevad samas teoses, kaaluga = ühiste teoste arv', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    const byPair = Object.fromEntries(coEdges(v).map(c => [`${c.a}|${c.b}`, c.weight]));
    expect(byPair['a|b']).toBe(2);        // w1 ja w2
    expect(byPair['a|c']).toBe(1);
    expect(byPair['b|c']).toBe(1);
  });
});

describe('otherEnd', () => {
  it('annab serva teise otsa sõltumata suunast', () => {
    expect(otherEnd({ ...E('academic', 'a', 'w1') }, F)).toBe('a');
    expect(otherEnd({ ...E('academic', 'a', 'w1'), from: F, to: 'a' }, F)).toBe('a');
  });
});

describe('familyLabel', () => {
  const edge: NetworkEdge = {
    kind: 'family', from: 'a', to: F, directed: false, year: null, place: null, evidence: null,
    records: [{ source_id: F, target_id: 'a', type: 'isa' }, { source_id: 'a', target_id: F, type: 'poeg' }],
  };
  const labelOf = (id: string) => ({ a: 'Hackspan', [F]: 'Fischer' } as Record<string, string>)[id] ?? id;

  it('eelistab fookuse kaardi kirjet', () => {
    expect(familyLabel(edge, F, labelOf)).toBe('isa');
  });

  it('teise kaardi kirje koos allikaga', () => {
    const e2 = { ...edge, records: [edge.records![1]] };
    expect(familyLabel(e2, F, labelOf)).toBe('Hackspan: poeg');
  });

  it('tüübita kirje → null', () => {
    const e3 = { ...edge, records: [{ source_id: F, target_id: 'a', type: null }] };
    expect(familyLabel(e3, F, labelOf)).toBeNull();
  });
});
