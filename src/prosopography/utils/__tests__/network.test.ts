// src/prosopography/utils/__tests__/network.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, evidenceTarget, familyRelation, personKinds, otherEnd, timelineRows, DEFAULT_FILTER } from '../network';
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

  it('sugulane-respondens: sõlm akadeemiline, loendur mõlemas liigis', () => {
    const net: PersonNetwork = {
      ...NET,
      persons: [P('s')],
      edges: [E('academic', 's', 'w1'),
              { kind: 'family', from: 's', to: F, directed: false, year: null, place: null, evidence: null,
                records: [{ source_id: F, target_id: 's', type: 'näälk' }] }],
    };
    const v = applyFilters(net, DEFAULT_FILTER);
    expect(v.persons[0].kind).toBe('academic');
    expect(v.counts.family).toBe(1);
    expect(v.counts.academic).toBe(1);
  });

  it('ringvaate jooned: sugulane + respondens → kaks liiki, nõrk isik → oma liik', () => {
    const net: PersonNetwork = {
      ...NET,
      persons: [P('s'), P('c')],
      edges: [E('academic', 's', 'w1'), E('cotext', 's', 'w2'), E('cotext', 'c', 'w2'),
              { kind: 'family', from: 's', to: F, directed: false, year: null, place: null, evidence: null,
                records: [{ source_id: F, target_id: 's', type: 'näälk' }] }],
    };
    const v = applyFilters(net, DEFAULT_FILTER);
    expect(personKinds(v.persons.find(p => p.id === 's')!)).toEqual(['academic', 'family']);
    expect(personKinds(v.persons.find(p => p.id === 'c')!)).toEqual(['cotext']);
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

describe('osad (#464)', () => {
  const partEdge = (other: string, part: string | undefined, pages: number[] = []): NetworkEdge => ({
    ...E('dedicated', other, 'w9', 1684), evidence: { work_id: 'w9', pages, ...(part ? { part_id: part } : {}) },
  });
  const net: PersonNetwork = {
    focus: P(F, 'Fookus'), persons: [P('a'), P('b'), P('c')], works: [W('w9', 1690)],
    parts: [{ work_id: 'w9', part_id: 'k1', kind: 'letter', title: 'Kiri', year: 1684, first_page: 7 },
            { work_id: 'w9', part_id: 'k2', kind: 'letter', title: '', year: null, first_page: 12 }],
    edges: [partEdge('a', 'k1'), partEdge('b', 'k2'), partEdge('c', 'k1', [8])],
  };

  it('evidenceTarget: tõendi leht, osa puhul osa esimene leht, muidu 1', () => {
    const v = applyFilters(net, DEFAULT_FILTER);
    expect(evidenceTarget(partEdge('c', 'k1', [8]), v)).toEqual({ page: 8, part: v.parts.get('k1') });
    expect(evidenceTarget(partEdge('a', 'k1'), v).page).toBe(7);
    expect(evidenceTarget(partEdge('a', undefined), v)).toEqual({ page: 1, part: undefined });
  });

  it('osadeta vastus (vana server) annab tühja kaardi', () => {
    const { parts, ...old } = net;
    expect(parts).toBeDefined();
    expect(applyFilters(old, DEFAULT_FILTER).parts.size).toBe(0);
  });
});

describe('otherEnd', () => {
  it('annab serva teise otsa sõltumata suunast', () => {
    expect(otherEnd({ ...E('academic', 'a', 'w1') }, F)).toBe('a');
    expect(otherEnd({ ...E('academic', 'a', 'w1'), from: F, to: 'a' }, F)).toBe('a');
  });
});

describe('familyRelation', () => {
  const edge: NetworkEdge = {
    kind: 'family', from: 'a', to: F, directed: false, year: null, place: null, evidence: null,
    records: [{ source_id: F, target_id: 'a', type: 'isa' }, { source_id: 'a', target_id: F, type: 'poeg' }],
  };
  const labelOf = (id: string) => ({ a: 'Hackspan', [F]: 'Fischer' } as Record<string, string>)[id] ?? id;

  it('eelistab fookuse kaardi kirjet: sihtisik on omaniku <tüüp>', () => {
    expect(familyRelation(edge, F, labelOf)).toEqual({ subject: 'Hackspan', owner: 'Fischer', type: 'isa' });
  });

  it('teise kaardi kirje: suunda ei pöörata', () => {
    const e2 = { ...edge, records: [edge.records![1]] };
    expect(familyRelation(e2, F, labelOf)).toEqual({ subject: 'Fischer', owner: 'Hackspan', type: 'poeg' });
  });

  it('Wikidata tüüp UI keeles, varuks en ja toorväärtus', () => {
    const labels = { en: 'wife', et: 'abielunaine' };
    const e4 = { ...edge, records: [{ source_id: F, target_id: 'a', type: 'wife', type_labels: labels }] };
    expect(familyRelation(e4, F, labelOf, 'et')?.type).toBe('abielunaine');
    expect(familyRelation(e4, F, labelOf, 'en')?.type).toBe('wife');
    const e5 = { ...edge, records: [{ source_id: F, target_id: 'a', type: 'wife', type_labels: { en: 'wife' } }] };
    expect(familyRelation(e5, F, labelOf, 'et')?.type).toBe('wife');
  });

  it('tüübita kirje → null', () => {
    const e3 = { ...edge, records: [{ source_id: F, target_id: 'a', type: null }] };
    expect(familyRelation(e3, F, labelOf)).toBeNull();
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
