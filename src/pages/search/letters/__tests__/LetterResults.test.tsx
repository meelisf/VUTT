/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
    i18n: { language: 'et' },
  }),
}));

vi.mock('../../../../contexts/UserContext', () => ({ useUser: () => ({ authToken: null }) }));

const previews = new Map<string, unknown>();
vi.mock('../useLetterPreviews', () => ({ useLetterPreviews: () => previews }));

import LetterResults from '../LetterResults';
import type { LetterHit } from '../../../../services/letterSearch';

const base: LetterHit = {
  id: 'w1__p1', work_id: 'w1', part_id: 'p1', title: '', incipit: '', abstract: '',
  authors: [], addressees: [], place_from: '', place_to: '', first_page: 6, page_count: 2,
  work_title: 'Briefe an Fischer',
};

describe('LetterResults', () => {
  it('link avab kirja koodeksis ?part=-iga; tühi kiri saab varukuva, mitte tühja rida', () => {
    render(<MemoryRouter><LetterResults hits={[base]} query="" /></MemoryRouter>);
    const [link] = screen.getAllByRole('link');
    expect(link.getAttribute('href')).toBe('/work/w1/6?part=p1');
    expect(link.textContent).toContain('letters.pageFallback:{"page":6}');
    expect(screen.queryByText('[teadmata]')).toBeNull();
  });

  it('tekstikatke esiletõstuga, ilma HTML-i süstimata', () => {
    const hit = { ...base, authors: ['Spener'], _formatted: { letter_text: 'a <mark>orati</mark> <img src=x>' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} query="" /></MemoryRouter>);
    expect(container.querySelector('mark')?.textContent).toBe('orati');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x>');
  });

  it('nimevaste: tekstikatket pole', () => {
    const hit = { ...base, authors: ['Spener'], _formatted: { letter_text: 'tekst ilma vasteta' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} query="" /></MemoryRouter>);
    expect(container.querySelector('p')).toBeNull();
  });

  it('allikakuju on hõljuva vihjena, mitte reas', () => {
    const hit = { ...base, dating: { start: '1703-03-03', source_text: 'Moskva, 03.03.1703 (märge)' } };
    render(<MemoryRouter><LetterResults hits={[hit]} query="" /></MemoryRouter>);
    const headline = screen.getByText('1703-03-03');
    expect(headline.getAttribute('title')).toBe('Moskva, 03.03.1703 (märge)');
  });
});

describe('LetterResults eelvaade: üks kuju (lehtede riba + sildiga lõigud)', () => {
  const part = { id: 'p1', kind: 'letter', pages: [], creators: [], abstract_et: 'Regest eesti keeles; ß jääb', abstract_en: null };
  const pages = Array.from({ length: 10 }, (_, i) => ({ page: 6 + i, thumb: `/t/${i}.jpg` }));
  const labels = (c: HTMLElement) => [...c.querySelectorAll('ol > li ul > li > span')].map(s => s.textContent);

  it('sirvides: riba lageni + „+N", iga pisipilt viib oma lehele; lõik = regest originaalkujul sildiga', () => {
    previews.set(base.id, { part, pages, pageHits: null });
    const { container } = render(<MemoryRouter><LetterResults hits={[base]} query="" /></MemoryRouter>);
    expect(container.querySelectorAll('img')).toHaveLength(8);
    expect(container.textContent).toContain('+2');
    expect(screen.getByLabelText('letters.page:{"page":7}').getAttribute('href')).toBe('/work/w1/7?part=p1');
    expect(labels(container)).toEqual(['letters.abstract']);
    expect(container.textContent).toContain('Regest eesti keeles; ß jääb');
    previews.clear();
  });

  it('otsides lehe tekstist: SAMA riba (tabatud leht esile) + lõik sildiga „lk N", kirja-tasandi lõiku pole', () => {
    previews.set(base.id, { part, pages, pageHits: [{ page: 7, thumb: '/t/1.jpg', snippet: 'a <mark>orati</mark>' }] });
    const hit = { ...base, _formatted: { letter_text: 'kogu kirja <mark>orati</mark>' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} query="orati" /></MemoryRouter>);
    expect(container.querySelectorAll('img')).toHaveLength(8);
    expect(screen.getByLabelText('letters.page:{"page":7}').querySelector('img')?.className).toContain('ring-');
    expect(screen.getByLabelText('letters.page:{"page":8}').querySelector('img')?.className).not.toContain('ring-');
    expect(labels(container)).toEqual(['letters.page:{"page":7}']);
    expect(container.textContent).not.toContain('kogu kirja');
    previews.clear();
  });

  it('vaste regestis: sama riba, lõik sildiga „Regest"', () => {
    previews.set(base.id, { part, pages, pageHits: [] });
    const hit = { ...base, _formatted: { abstract: 'regest <mark>orati</mark>' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} query="orati" /></MemoryRouter>);
    expect(container.querySelectorAll('img')).toHaveLength(8);
    expect(labels(container)).toEqual(['letters.abstract']);
    expect(container.querySelector('mark')?.textContent).toBe('orati');
    previews.clear();
  });

  it('vaste kirja tekstis, lehte ei leitud: lõik sildita (lehte ei oletata)', () => {
    previews.set(base.id, { part, pages, pageHits: [] });
    const hit = { ...base, _formatted: { letter_text: 'tekst <mark>orati</mark>' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} query="orati" /></MemoryRouter>);
    expect(labels(container)).toEqual(['']);
    previews.clear();
  });
});
