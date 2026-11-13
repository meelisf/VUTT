// src/prosopography/components/relations/__tests__/RelationsViews.test.tsx
/** @vitest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import './testI18n';
import RelationsGraph from '../RelationsGraph';
import RelationsTimeline from '../RelationsTimeline';
import RelationsTable from '../RelationsTable';
import { usePopover } from '../RelationPopover';
import { applyFilters, DEFAULT_FILTER } from '../../../utils/network';
import type { PersonNetwork } from '../../../services/networkService';

const F = 'vutt:Pfocus';
const NET: PersonNetwork = {
  focus: { id: F, label: 'Fookus Isik', birth_year: 1636, death_year: 1705, origin: null },
  persons: [
    { id: 'a', label: 'Anna Praeses', birth_year: 1600, death_year: 1660, origin: { place: 'Riga', place_id: null, coordinates: null } },
    { id: 'u', label: 'Undated Isik', birth_year: null, death_year: null, origin: null },
  ],
  works: [{ work_id: 'w1', title: 'Disputatio', year: 1658, place: null, genres: [], restricted: false },
          { work_id: 'w2', title: 'Aastata', year: null, place: null, genres: [], restricted: false }],
  edges: [
    { kind: 'academic', from: 'a', to: F, directed: true, year: 1658, place: null, roles: { a: ['praeses'], [F]: ['respondens'] }, evidence: { work_id: 'w1', pages: [] } },
    { kind: 'cotext', from: 'u', to: F, directed: false, year: null, place: null, roles: { u: ['gratulator'], [F]: ['gratulator'] }, evidence: { work_id: 'w2', pages: [] } },
  ],
};
const v = applyFilters(NET, DEFAULT_FILTER);

function withPopover(ui: (p: ReturnType<typeof usePopover>) => React.ReactElement) {
  const { result } = renderHook(() => usePopover());
  return render(<MemoryRouter>{ui(result.current)}</MemoryRouter>);
}

import type { PopoverState } from '../RelationPopover';
const G = (n: number, works: (i: number) => string[]): PersonNetwork => ({
  focus: NET.focus,
  persons: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, label: `Isik ${i}`, birth_year: null, death_year: null, origin: null })),
  works: [...new Set(Array.from({ length: n }, (_, i) => works(i)).flat())].map(w => ({ work_id: w, title: w, year: 1658, place: null, genres: [], restricted: false })),
  edges: Array.from({ length: n }, (_, i) => works(i).map(w => ({ kind: 'cotext' as const, from: `p${i}`, to: F, directed: false, year: 1658, place: null, evidence: { work_id: w, pages: [] } }))).flat(),
});
// p0: a,b,c · p1: a,b · p2: a · ülejäänud oma teos
const big = applyFilters(G(20, i => (i === 0 ? ['a', 'b', 'c'] : i === 1 ? ['a', 'b'] : i === 2 ? ['a'] : [`w${i}`])), DEFAULT_FILTER);
const fakePopover = (state: PopoverState | null) =>
  ({ state, hover: vi.fn(), leave: vi.fn(), pin: vi.fn(), close: vi.fn() }) as unknown as ReturnType<typeof usePopover>;
const graph = (pop: ReturnType<typeof usePopover>, highlight: string | null = null, onHighlight = vi.fn(), net = big) =>
  render(<MemoryRouter><RelationsGraph net={net} popover={pop} highlight={highlight} onHighlight={onHighlight} /></MemoryRouter>);
const pinnedAt = (personId: string): PopoverState => ({ personId, x: 0, y: 0, pinned: true });

describe('RelationsGraph', () => {
  it('lähikond nimedega, serv nimedeta; viewBox 900×600', () => {
    const { container } = graph(fakePopover(null));
    expect(screen.getByText('Fookus Isik')).toBeTruthy();
    expect(screen.getByText('Isik 0')).toBeTruthy();
    expect(screen.queryByText('Isik 7')).toBeNull();
    expect(container.querySelectorAll('[data-ring="close"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-ring="rim"]')).toHaveLength(18);
    expect(container.querySelector('svg')!.getAttribute('viewBox')).toBe('0 0 900 600');
    expect(container.querySelector('[data-testid="co-arc"]')).toBeNull();
  });
  it('hõljutus teatab esiletõstu; esiletõst jätab heledaks kaasosalised', () => {
    const onHighlight = vi.fn();
    graph(fakePopover(null), null, onHighlight);
    fireEvent.mouseEnter(screen.getByTestId('node-p0'));
    expect(onHighlight).toHaveBeenCalledWith('p0');
    const { container } = graph(fakePopover(null), 'p0');
    const lit = (id: string) => container.querySelector(`[data-testid="node-${id}"]`)!.getAttribute('data-lit');
    expect(lit('p0')).toBe('true'); expect(lit('p1')).toBe('true'); expect(lit('p2')).toBe('true'); expect(lit('p7')).toBe('false');
    expect(container.querySelectorAll('[data-testid="co-arc"]')).toHaveLength(1);   // p0–p1
  });
  it('klõps kinnitab kaardi, esiletõstu otse ei sea', () => {
    const pop = fakePopover(null); const onHighlight = vi.fn();
    graph(pop, null, onHighlight);
    fireEvent.click(screen.getByTestId('node-p1'));
    expect(pop.pin).toHaveBeenCalledWith('p1', expect.anything());
    expect(onHighlight).not.toHaveBeenCalled();
  });
  it('kinnitatud kaart = valik: rõngas, servanimed; hõljutus ei muuda esiletõstu', () => {
    const onHighlight = vi.fn();
    graph(fakePopover(pinnedAt('p0')), null, onHighlight);
    expect(screen.getByTestId('selected-ring')).toBeTruthy();
    expect(screen.getByTestId('rim-label-p2').textContent).toContain('Isik 2');
    expect(screen.queryByTestId('rim-label-p7')).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId('node-p7'));
    expect(onHighlight).not.toHaveBeenCalled();
    expect(screen.getByTestId('rim-label-p7')).toBeTruthy();          // hõljutatud täpi nimi
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('false');
  });
  it('kaardi sulgemine taastab algkuju', () => {
    const { rerender } = graph(fakePopover(pinnedAt('p0')));
    rerender(<MemoryRouter><RelationsGraph net={big} popover={fakePopover(null)} highlight={null} onHighlight={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId('selected-ring')).toBeNull();
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('true');
  });
  it('klõps → hiir ära → kaardi sulgemine: esiletõst ei jää kinni', () => {
    const Host: React.FC<{ pop: ReturnType<typeof usePopover> }> = ({ pop }) => {
      const [hl, setHl] = React.useState<string | null>(null);
      return <MemoryRouter><RelationsGraph net={big} popover={pop} highlight={hl} onHighlight={setHl} /></MemoryRouter>;
    };
    const { rerender } = render(<Host pop={fakePopover(null)} />);
    fireEvent.mouseEnter(screen.getByTestId('node-p0'));
    rerender(<Host pop={fakePopover(pinnedAt('p0'))} />);
    fireEvent.mouseLeave(screen.getByTestId('node-p0'));
    rerender(<Host pop={fakePopover(null)} />);
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('true');
  });
  it('Review Focus 1: valitud isik ei ole enam võrgustikus → ei kuku, valikut ei ole', () => {
    graph(fakePopover(pinnedAt('kadunud')));
    expect(screen.queryByTestId('selected-ring')).toBeNull();
    expect(screen.getByTestId('node-p9').getAttribute('data-lit')).toBe('true');
  });
  it('tühi lähikond: selgitav rida', () => {
    graph(fakePopover(null), null, vi.fn(), applyFilters(G(16, i => [`w${i}`]), DEFAULT_FILTER));
    expect(screen.getByText(/Lähikond ei eristu/)).toBeTruthy();
  });
  it('väike võrgustik: kõik nimedega (olemasolev fikstuur)', () => {
    graph(fakePopover(null), null, vi.fn(), v);
    expect(screen.getByText('Anna Praeses')).toBeTruthy(); expect(screen.getByText('Undated Isik')).toBeTruthy();
  });
});

describe('RelationsTimeline', () => {
  it('aastata isik on „Aeg teadmata" veerus', () => {
    withPopover(p => <RelationsTimeline net={v} popover={p} highlight={null} onHighlight={() => {}} />);
    expect(screen.getByText('Aeg teadmata')).toBeTruthy();
    expect(screen.getByText('Undated Isik')).toBeTruthy();
  });
});

describe('RelationsTable', () => {
  it('rida isiku kohta, liik sõnaga, lingiga isikulehele', () => {
    render(<MemoryRouter><RelationsTable net={v} /></MemoryRouter>);
    expect(screen.getByText('Akadeemiline akt')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Anna Praeses' }).getAttribute('href')).toBe('/persons/a');
  });
});

describe('RelationsTable ligipääsetav tekstivaade', () => {
  it('näitab isiku rolle ja ühiseid teoseid linkidena (klaviatuuriga kättesaadav)', () => {
    render(<MemoryRouter><RelationsTable net={v} /></MemoryRouter>);
    expect(screen.getByText('Eesistuja')).toBeTruthy();                    // Anna: praeses
    expect(screen.getByRole('link', { name: /Disputatio/ }).getAttribute('href')).toBe('/work/w1/1');
  });
});

describe('RelationsTimeline telg', () => {
  it('telg on samas keritavas konteineris kui read (sama laius → sama skaala)', () => {
    const { container } = withPopover(p => <RelationsTimeline net={v} popover={p} highlight={null} onHighlight={() => {}} />);
    const scroller = container.querySelector('[data-timeline-scroller]');
    expect(scroller).toBeTruthy();
    expect(scroller!.querySelector('[data-timeline-axis]')).toBeTruthy();
  });
});
