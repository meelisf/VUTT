/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
}));

import LetterResults from '../LetterResults';
import type { LetterHit } from '../../../../services/letterSearch';

const base: LetterHit = {
  id: 'w1__p1', work_id: 'w1', part_id: 'p1', title: '', incipit: '', abstract: '',
  authors: [], addressees: [], place_from: '', place_to: '', first_page: 6, page_count: 2,
  work_title: 'Briefe an Fischer',
};

describe('LetterResults', () => {
  it('link avab kirja koodeksis ?part=-iga; tühi kiri saab varukuva, mitte tühja rida', () => {
    render(<MemoryRouter><LetterResults hits={[base]} /></MemoryRouter>);
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('/work/w1/6?part=p1');
    expect(link.textContent).toContain('letters.pageFallback:{"page":6}');
    expect(screen.queryByText('[teadmata]')).toBeNull();
  });

  it('tekstikatke esiletõstuga, ilma HTML-i süstimata', () => {
    const hit = { ...base, authors: ['Spener'], _formatted: { letter_text: 'a <mark>orati</mark> <img src=x>' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(container.querySelector('mark')?.textContent).toBe('orati');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x>');
  });

  it('nimevaste: tekstikatket pole', () => {
    const hit = { ...base, authors: ['Spener'], _formatted: { letter_text: 'tekst ilma vasteta' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(container.querySelector('p')).toBeNull();
  });

  it('allikakuju on hõljuva vihjena, mitte reas', () => {
    const hit = { ...base, dating: { start: '1703-03-03', source_text: 'Moskva, 03.03.1703 (märge)' } };
    render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    const headline = screen.getByText('1703-03-03');
    expect(headline.getAttribute('title')).toBe('Moskva, 03.03.1703 (märge)');
  });
});
