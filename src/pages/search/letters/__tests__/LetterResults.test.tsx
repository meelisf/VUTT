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

const fetchSpy = vi.fn();
vi.stubGlobal('fetch', fetchSpy);

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
    const [link] = screen.getAllByRole('link');
    expect(link.getAttribute('href')).toBe('/work/w1/6?part=p1');
    expect(link.textContent).toContain('letters.pageFallback:{"page":6}');
    expect(screen.queryByText('[teadmata]')).toBeNull();
  });

  it('tekstikatke esiletõstuga, ilma HTML-i süstimata', () => {
    const text = 'a orati <img src=x>';
    const hit = { ...base, letter_text: text, _matchesPosition: { letter_text: [{ start: 2, length: 5 }] } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(container.querySelector('mark')?.textContent).toBe('orati');
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x>');
  });

  it('nimevaste: tekstikatket pole', () => {
    const hit = { ...base, authors: ['Spener'], letter_text: 'tekst ilma vasteta', _matchesPosition: { names_text: [{ start: 0, length: 6 }] } };
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

describe('LetterResults: üks kuju (lehtede riba + sildiga lõigud), kõik kirjadokumendist', () => {
  const pages = Array.from({ length: 10 }, (_, i) => ({ n: 6 + i, img: `a-${6 + i}.jpg`, start: i * 6 }));
  // 10 lehte à 'lk0 x' (5 baiti) + '\n' → lehe i algus = i * 6.
  const letter_text = Array.from({ length: 10 }, (_, i) => `lk${i} x`).join('\n');
  const labels = (c: HTMLElement) => [...c.querySelectorAll('ol > li ul > li > span')].map(s => s.textContent);

  it('sirvides: riba lageni + „+N", iga pisipilt viib oma lehele; lõik = regest originaalkujul sildiga', () => {
    const hit = { ...base, pages, letter_text, abstract_et: 'Regest eesti keeles; ß jääb' };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(container.querySelectorAll('img')).toHaveLength(8);
    expect(container.textContent).toContain('+2');
    expect(screen.getByLabelText('letters.page:{"page":7}').getAttribute('href')).toBe('/work/w1/7?part=p1');
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/api/images/w1/_thumbs/_thumb_a-6.jpg');
    expect(labels(container)).toEqual(['letters.abstract']);
    expect(container.textContent).toContain('Regest eesti keeles; ß jääb');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('otsides lehe tekstist: tabatud leht esile + lõik sildiga „lk N"', () => {
    const hit = { ...base, pages, letter_text, abstract_et: 'Regest', _matchesPosition: { letter_text: [{ start: 6 + 4, length: 1 }] } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(screen.getByLabelText('letters.page:{"page":7}').querySelector('img')?.className).toContain('ring-');
    expect(screen.getByLabelText('letters.page:{"page":8}').querySelector('img')?.className).not.toContain('ring-');
    expect(labels(container)).toEqual(['letters.page:{"page":7}']);
    expect(container.querySelector('mark')?.textContent).toBe('x');
    expect(container.textContent).not.toContain('Regest');
  });

  it('vaste regestis: lõik sildiga „Regest"', () => {
    const hit = { ...base, pages, letter_text, _formatted: { abstract: 'regest <mark>orati</mark>' } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(container.querySelectorAll('img')).toHaveLength(8);
    expect(labels(container)).toEqual(['letters.abstract']);
    expect(container.querySelector('mark')?.textContent).toBe('orati');
  });

  it('indeks enne taasehitust (lehti pole): riba puudub, tekstikatke sildita', () => {
    const hit = { ...base, letter_text: 'tekst orati', _matchesPosition: { letter_text: [{ start: 6, length: 5 }] } };
    const { container } = render(<MemoryRouter><LetterResults hits={[hit]} /></MemoryRouter>);
    expect(container.querySelectorAll('img')).toHaveLength(0);
    expect(labels(container)).toEqual(['']);
  });
});
