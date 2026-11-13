// src/prosopography/utils/__tests__/closeCircle.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTER } from '../network';
import { closeCircleLayout, coParticipants, splitCloseCircle, spreadY, isKin } from '../closeCircle';
import type { PersonNetwork, NetworkEdge } from '../../services/networkService';

const F = 'vutt:Pfocus';
const P = (id: string, label = id) => ({ id, label, birth_year: null, death_year: null, origin: null });
const W = (work_id: string, year: number | null = 1658) => ({ work_id, title: work_id, year, place: null, genres: [], restricted: false });
const E = (kind: NetworkEdge['kind'], other: string, work: string | null, year: number | null = 1658, part?: string): NetworkEdge => ({
  kind, from: other, to: F, directed: false, year: work ? year : null, place: null,
  evidence: work ? { work_id: work, pages: [], ...(part ? { part_id: part } : {}) } : null,
});
/** n isikut p0…; `works(i)` annab isiku teoste id-d. */
function net(n: number, works: (i: number) => string[], extra: NetworkEdge[] = [], year = (_w: string) => 1658 as number | null) {
  const edges = Array.from({ length: n }, (_, i) => works(i).map(w => E('cotext', `p${i}`, w, year(w)))).flat().concat(extra);
  const ids = [...new Set(edges.map(e => e.evidence?.work_id).filter((w): w is string => !!w))];
  const raw: PersonNetwork = { focus: P(F), persons: Array.from({ length: n }, (_, i) => P(`p${i}`)), works: ids.map(w => W(w, year(w))), edges };
  return applyFilters(raw, DEFAULT_FILTER);
}
const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort();

describe('splitCloseCircle', () => {
  it('kuni 15 isikut: kõik lähikonnas', () => {
    const { close, rim } = splitCloseCircle(net(15, i => [`w${i}`]));
    expect(close).toHaveLength(15); expect(rim).toHaveLength(0);
  });
  it('üle 15: lähikonnas ≥ 2 teosega isikud ja sugulased', () => {
    const v = net(20, i => (i === 0 ? ['a', 'b', 'c'] : i === 1 ? ['a', 'b'] : [`w${i}`]), [E('family', 'p5', null)]);
    const { close, rim } = splitCloseCircle(v);
    expect(ids(close)).toEqual(['p0', 'p1', 'p5']); expect(rim).toHaveLength(17);
  });
  it('ülempiir 15: sugulane mahub alati, teoste järgi nõrgimad jäävad servale', () => {
    // p0..p19 kahe teosega (p0 kolmega), p20 ainult sugulane
    const v = net(21, i => (i === 20 ? [] : i === 0 ? ['x', 'y', 'z'] : [`a${i}`, `b${i}`]), [E('family', 'p20', null)]);
    const { close, rim } = splitCloseCircle(v);
    expect(close).toHaveLength(15);
    expect(close.map(p => p.id)).toContain('p20'); expect(close.map(p => p.id)).toContain('p0');
    expect(rim).toHaveLength(6);
  });
  it('üle 15 ja keegi ei kvalifitseeru: lähikond tühi', () => {
    expect(splitCloseCircle(net(16, i => [`w${i}`])).close).toHaveLength(0);
  });
  it('üle 15 sugulase: kõik sugulased, teoste järgi kedagi juurde ei tule', () => {
    const fam = Array.from({ length: 17 }, (_, i) => E('family', `p${i}`, null));
    const { close } = splitCloseCircle(net(20, i => (i >= 17 ? ['a', 'b'] : []), fam));
    expect(close).toHaveLength(17); expect(close.every(isKin)).toBe(true);
  });
});

describe('coParticipants', () => {
  it('ühine teos seob, kaal = ühiste võtmete arv', () => {
    const co = coParticipants(net(3, i => (i === 2 ? ['z'] : ['a', 'b'])));
    expect(co.get('p0')?.get('p1')).toBe(2); expect(co.get('p0')?.has('p2')).toBe(false); expect(co.get('p0')?.has('p0')).toBe(false);
  });
  it('sama teose eri osad EI seo (kirjakogu)', () => {
    const v = net(2, () => [], [E('dedicated', 'p0', 'kogu', 1660, 'k1'), E('dedicated', 'p1', 'kogu', 1661, 'k2')]);
    expect(coParticipants(v).get('p0')?.has('p1') ?? false).toBe(false);
  });
});

describe('closeCircleLayout', () => {
  const finite = (l: ReturnType<typeof closeCircleLayout>) =>
    [...l.close, ...l.rim].every(n => Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.r));
  it('rohkem ühiseid teoseid → fookusele lähemal', () => {
    const l = closeCircleLayout(net(20, i => (i === 0 ? ['a', 'b', 'c', 'd'] : i === 1 ? ['a', 'b'] : [`w${i}`])));
    const f = Object.fromEntries(l.close.map(n => [n.person.id, n.f]));
    expect(f.p0).toBeCloseTo(0.5); expect(f.p1).toBeCloseTo(1.0);
    expect(l.cx).toBe(450); expect(l.cy).toBe(300);
  });
  it('kõigil kaks teost → f = 0.75; teoseta sugulane → 0.625', () => {
    const l = closeCircleLayout(net(20, i => (i < 2 ? ['a', 'b'] : i === 2 ? [] : [`w${i}`]), [E('family', 'p2', null)]));
    const f = Object.fromEntries(l.close.map(n => [n.person.id, n.f]));
    expect(f.p0).toBeCloseTo(0.75); expect(f.p2).toBeCloseTo(0.625);
  });
  it('serv on ajajärjestuses, aastata lõpus; märgid aasta vahetusel', () => {
    const year = (w: string) => (w === 'w3' ? null : w === 'w2' ? 1640 : 1650);
    const l = closeCircleLayout(net(16, i => [i === 3 ? 'w3' : i === 2 ? 'w2' : `v${i}`], [], year));
    expect(l.rim[0].person.id).toBe('p2'); expect(l.rim.at(-1)!.person.id).toBe('p3');
    expect(l.ticks.map(t => t.year)).toEqual([1640, 1650, null]);
    for (let i = 1; i < l.rim.length; i++) expect(l.rim[i].angle).toBeGreaterThan(l.rim[i - 1].angle);
  });
  it('üle 110 servaisiku: iga teine täpp sissepoole', () => {
    const l = closeCircleLayout(net(120, i => [`w${i}`]));
    const d = (n: { x: number; y: number }) => Math.hypot((n.x - 450) / 405, (n.y - 300) / 266);
    expect(d(l.rim[0])).toBeCloseTo(1); expect(d(l.rim[1])).toBeCloseTo(0.94);
  });
  it('Review Focus 2: ainult teoseta sugulased → lõplikud arvud', () => {
    const l = closeCircleLayout(net(3, () => [], [0, 1, 2].map(i => E('family', `p${i}`, null))));
    expect(l.close).toHaveLength(3); expect(l.maxWorks).toBe(0); expect(finite(l)).toBe(true);
  });
  it('Review Focus 3: üks isik; kõik servaisikud aastata', () => {
    expect(finite(closeCircleLayout(net(1, () => ['a'])))).toBe(true);
    const l = closeCircleLayout(net(16, i => [`w${i}`], [], () => null));
    expect(finite(l)).toBe(true); expect(l.ticks.map(t => t.year)).toEqual([null]);
  });
});

describe('spreadY', () => {
  it('lükkab kattuvad lahku, järjekord ja sisendi indeksid säilivad', () => {
    const out = spreadY([10, 12, 40, 11], 10);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(out[0]).toBeLessThan(out[3]); expect(out[3]).toBeLessThan(out[1]); expect(out[2]).toBeGreaterThanOrEqual(40);
  });
  it('piisava vahega sisend ei muutu', () => { expect(spreadY([0, 20, 40], 10)).toEqual([0, 20, 40]); });
});
