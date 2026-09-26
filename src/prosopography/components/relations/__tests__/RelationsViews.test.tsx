// src/prosopography/components/relations/__tests__/RelationsViews.test.tsx
/** @vitest-environment jsdom */
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

describe('RelationsGraph', () => {
  it('fookus keskel sildiga, seotud isikud nimedega', () => {
    withPopover(p => <RelationsGraph net={v} popover={p} highlight={null} onHighlight={() => {}} />);
    expect(screen.getByText('Fookus Isik')).toBeTruthy();
    expect(screen.getByText('Anna Praeses')).toBeTruthy();
  });

  it('hõljutus teatab esiletõstu', () => {
    const onHighlight = vi.fn();
    withPopover(p => <RelationsGraph net={v} popover={p} highlight={null} onHighlight={onHighlight} />);
    fireEvent.mouseEnter(screen.getByTestId('node-a'));
    expect(onHighlight).toHaveBeenCalledWith('a');
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
