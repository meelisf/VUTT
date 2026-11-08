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

  it('VUTT-i teose kirje: pealkiri teoselt, osa ja lk juures, link osa esimesele lehele (ADR 0078)', () => {
    render(<MemoryRouter><PersonSourcesCard
      person={{ sources: [
        { work_id: 'w1', part_id: 'k1', printed_page: '14', text: 'personaalia', note: 'märkus' },
        { work_id: 'w1', page: 9 },
        { text: '   ' },
      ], occupations: [], education: [] } as unknown as ProsopoRecord}
      workTitles={{ w1: 'Leichpredigt' }}
      parts={{ w1: { k1: { label: 'Proosatekst · Personalia', firstPage: 7 } } }} /></MemoryRouter>);
    const links = screen.getAllByRole('link', { name: 'Leichpredigt' });
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/work/w1/7', '/work/w1/9']);
    expect(screen.getByText(/Proosatekst · Personalia, lk 14, personaalia/)).toBeTruthy();
    expect(screen.getByText('märkus')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('tühja kaardi puhul ei renderda midagi', () => {
    const { container } = renderCard({ sources: [], occupations: [], education: [] });
    expect(container.textContent).toBe('');
  });
});
