/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import '../relations/__tests__/testI18n';
import PersonWorkParts from '../PersonWorkParts';

const parts = [{ part_id: 'k1', roles: ['auctor', 'addressee'],
                 part: { kind: 'letter', title: 'Fischerile', year: 1684, first_page: 7, pages: [7, 8, 9, 11] } }];

describe('PersonWorkParts', () => {
  it('osa rida: liik, pealkiri, aasta, lehed; link esimesele lehele', () => {
    render(<MemoryRouter><PersonWorkParts workId="w1" parts={parts} linked /></MemoryRouter>);
    expect(screen.getByText('Kiri · Fischerile · 1684 · lk 7–9, 11')).toBeTruthy();
    expect(screen.getByRole('link').getAttribute('href')).toBe('/work/w1/7');
    expect(screen.getByText('Autor, Adressaat')).toBeTruthy();
  });

  it('piiratud teos: lingita', () => {
    render(<MemoryRouter><PersonWorkParts workId="w1" parts={parts} linked={false} /></MemoryRouter>);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
