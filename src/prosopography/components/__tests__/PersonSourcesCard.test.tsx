/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import '../relations/__tests__/testI18n';
import PersonSourcesCard from '../PersonSourcesCard';
import type { ProsopoRecord } from '../../types';

const renderCard = (person: Partial<ProsopoRecord>) => render(<MemoryRouter>
  <PersonSourcesCard person={person as ProsopoRecord} workTitles={{ w1: 'Consuetudines' }} /></MemoryRouter>);

describe('isikulehe allikad ja bibliograafia', () => {
  it('näitab käsitsi loendit ja tõenditest kogutud allikaid', () => {
    renderCard({
      sources: [{ text: 'Recke-Napiersky III, 213', note: 'lühike' }],
      occupations: [{ label: 'notar', evidence: [
        { source_kind: 'vutt_page', work_id: 'w1', page: 3 },
        { source_kind: 'literature', source_id: 'ABC', citation: 'Sak 1997, Artikkel', locator: 'lk 74' }] }] as never,
      education: [],
    });
    expect(screen.getByText('Allikad ja bibliograafia')).toBeTruthy();
    expect(screen.getByText('Recke-Napiersky III, 213')).toBeTruthy();
    expect(screen.getByText('lühike')).toBeTruthy();
    expect(screen.getByText('Tõendites kasutatud allikad')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Consuetudines' }).getAttribute('href')).toBe('/work/w1');
    expect(screen.getByText('Sak 1997, Artikkel')).toBeTruthy();
  });

  it('tühja kaardi puhul ei renderda midagi', () => {
    const { container } = renderCard({ sources: [], occupations: [], education: [] });
    expect(container.textContent).toBe('');
  });
});
