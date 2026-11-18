/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../../components/relations/__tests__/testI18n';
import { StructuredInfoCard } from '../PersonDetailPage';
import type { ProsopoRecord } from '../../types';

const person = {
  id: 'vutt:P1', name: { aliases: [] },
  occupations: [
    { label: 'notar', date_from: { date: '1617' }, evidence: [
      { source_kind: 'vutt_page', work_id: 'w1', page: 5, printed_page: '3', quote: 'Notarius publicus' }] },
    { label: 'kaplan', evidence: [
      { source_kind: 'literature', source_id: 'ABC', citation: 'Donecker 2012, X', locator: 'lk 3' },
      { source_kind: 'literature', source_id: 'OLD', locator: 'lk 4' }] },
    { label: 'pastor' },
  ],
  education: [{ institution: 'Rostock', evidence: [{ source_kind: 'external', url: 'javascript:x' }] }],
} as unknown as ProsopoRecord;

describe('isikulehe joonealused viited', () => {
  it('nummerdab tõendid läbivalt ja näitab viiteid ploki all', () => {
    const { container } = render(<MemoryRouter><StructuredInfoCard person={person} workTitles={{ w1: 'Consuetudines' }} /></MemoryRouter>);
    expect([...container.querySelectorAll('sup')].map(s => s.textContent)).toEqual(['1', '2,3', '4']);
    const link = screen.getByRole('link', { name: 'Consuetudines' });
    expect(link.getAttribute('href')).toBe('/work/w1/5');
    expect(screen.getByText(/Donecker 2012, X/)).toBeTruthy();
    expect(screen.getByText(/^OLD/)).toBeTruthy();                     // varukuju ilma citation-ita
    expect(screen.queryByRole('link', { name: 'javascript:x' })).toBeNull();
    expect(screen.getByText('Notarius publicus')).toBeTruthy();
  });
});

// #834: sünni, surma ja päritolu tõend
import { LifeDates } from '../PersonDetailPage';

describe('eluandmete joonealused viited', () => {
  const ev = [{ source_kind: 'vutt_page', work_id: 'w1', page: 3 }];
  it('päritolu real on viide kaardi viidete hulgas', () => {
    const p = { id: 'vutt:P2', name: { aliases: [] }, occupations: [], education: [],
      origin: { place: 'Tartu', evidence: ev } } as unknown as ProsopoRecord;
    const { container } = render(<MemoryRouter><StructuredInfoCard person={p} workTitles={{ w1: 'Oratio' }} /></MemoryRouter>);
    expect([...container.querySelectorAll('sup')].map(s => s.textContent)).toEqual(['1']);
    expect(screen.getByRole('link', { name: 'Oratio' })).toBeTruthy();
  });

  it('sünni ja surma kuupäeva järel on viide ja viited ploki all', () => {
    const p = { birth: { date: '1755', evidence: ev },
      death: { date: '1807', evidence: [{ source_kind: 'literature', source_id: 'D', citation: 'Levitski 1902', locator: 'lk 106' }] },
    } as unknown as ProsopoRecord;
    const { container } = render(<MemoryRouter>
      <LifeDates person={p} birth="1755" death="1807" workTitles={{ w1: 'Oratio' }} /></MemoryRouter>);
    expect([...container.querySelectorAll('sup')].map(s => s.textContent)).toEqual(['1', '2']);
    expect(screen.getByRole('link', { name: 'Oratio' })).toBeTruthy();
    expect(screen.getByText(/Levitski 1902/)).toBeTruthy();
  });

  it('tõendita eluandmetel viiteid ei ole', () => {
    const { container } = render(<MemoryRouter>
      <LifeDates person={{ birth: { date: '1755' } } as unknown as ProsopoRecord} birth="1755" death="" workTitles={{}} /></MemoryRouter>);
    expect(container.querySelectorAll('sup')).toHaveLength(0);
  });
});
