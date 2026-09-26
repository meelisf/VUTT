// src/prosopography/utils/__tests__/network.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, coEdges, familyLabel, otherEnd, radialLayout, timelineRows, DEFAULT_FILTER } from '../network';
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

describe('radialLayout', () => {
  it('rühmitab liigi järgi, siis esimese aasta järgi, ringil', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    const { nodes, cx, cy, radius } = radialLayout(v, { w: 600, h: 600 });
    expect(nodes.map(n => n.person.id)).toEqual(['a', 'b', 'c']);   // academic, siis cotext (b 1658 enne c 1660)
    for (const n of nodes) {
      expect(Math.hypot(n.x - cx, n.y - cy)).toBeCloseTo(radius, 5);
    }
  });

  it('üle 40 isiku: sildid ainult suurima seosega isikutel', () => {
    const many: PersonNetwork = {
      ...NET,
      persons: Array.from({ length: 60 }, (_, i) => P(`p${i}`)),
      edges: Array.from({ length: 60 }, (_, i) => E('cotext', `p${i}`, i < 5 ? 'w1' : `x${i}`)),
      works: [W('w1'), ...Array.from({ length: 60 }, (_, i) => W(`x${i}`))],
    };
    // p0..p4 saavad lisaks teise teose → workCount 2
    many.edges.push(...Array.from({ length: 5 }, (_, i) => E('cotext', `p${i}`, 'w2')));
    many.works.push(W('w2'));
    const { nodes } = radialLayout(applyFilters(many, DEFAULT_FILTER), { w: 800, h: 800 });
    const labelled = nodes.filter(n => n.labelled).map(n => n.person.id).sort();
    expect(labelled).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
  });

  it('kuni 40 isikut: kõik sildiga', () => {
    const { nodes } = radialLayout(applyFilters(NET, DEFAULT_FILTER), { w: 600, h: 600 });
    expect(nodes.every(n => n.labelled)).toBe(true);
  });
});

describe('timelineRows', () => {
  it('sama aasta teosed = üks liitmärk, tugevaim liik', () => {
    const v = applyFilters(NET, DEFAULT_FILTER);
    const a = timelineRows(v).rows.find(r => r.person.id === 'a')!;
    const y1658 = a.marks.find(m => m.year === 1658)!;
    expect(y1658.works).toEqual(['w1']);
    expect(y1658.kind).toBe('academic');
  });

  it('aastata teos ja pereserv → „Aeg teadmata" (year null), rida ei kao', () => {
    const net: PersonNetwork = {
      ...NET,
      persons: [P('d'), P('fam')],
      works: [W('w3', null)],
      edges: [E('cotext', 'd', 'w3', null),
              { kind: 'family', from: 'fam', to: F, directed: false, year: null, place: null, evidence: null,
                records: [{ source_id: F, target_id: 'fam', type: 'isa' }] }],
    };
    const t = timelineRows(applyFilters(net, DEFAULT_FILTER));
    expect(t.hasUndated).toBe(true);
    expect(t.rows.map(r => r.person.id).sort()).toEqual(['d', 'fam']);
    expect(t.rows.every(r => r.marks.every(m => m.year === null))).toBe(true);
    expect(t.minYear).toBeNull();
  });

  it('read järjestatud esimese aasta järgi, aastata read lõpus', () => {
    const net: PersonNetwork = { ...NET, persons: [...NET.persons, P('d')], works: [...NET.works],
      edges: [...NET.edges, E('cotext', 'd', 'w3', null)] };
    const ids = timelineRows(applyFilters(net, DEFAULT_FILTER)).rows.map(r => r.person.id);
    expect(ids[ids.length - 1]).toBe('d');
    expect(ids.indexOf('a')).toBeLessThan(ids.indexOf('c'));
  });
});
