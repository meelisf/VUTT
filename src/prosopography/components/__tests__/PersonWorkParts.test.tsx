/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
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

  it('üle kolme osa: kokkuvõte, ühine roll üks kord, klõps avab', () => {
    const many = [1664, 1667, 1694, 0].map((year, i) => ({
      part_id: `k${i}`, roles: ['addressee'],
      part: { kind: 'letter', title: '', year: year || null, first_page: i * 2 + 1, pages: [i * 2 + 1] } }));
    render(<MemoryRouter><PersonWorkParts workId="w1" parts={many} linked /></MemoryRouter>);
    expect(screen.getByText('4 kirja · 1664–1694')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getAllByText('Adressaat')).toHaveLength(1);
  });

  it('segarollid: rühm rolli kaupa, väike rühm kohe lahti oma sildiga', () => {
    const letter = (i: number, roles: string[]) => ({ part_id: `p${i}`, roles,
      part: { kind: 'letter', title: '', year: null, first_page: i, pages: [i] } });
    const mixed = [letter(1, ['addressee']), letter(2, ['auctor']), letter(3, ['addressee']),
                   letter(4, ['addressee']), letter(5, ['addressee'])];
    render(<MemoryRouter><PersonWorkParts workId="w1" parts={mixed} linked /></MemoryRouter>);
    expect(screen.getByText('4 kirja')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Autor')).toBeTruthy();
    expect(screen.getByText('Adressaat')).toBeTruthy();
  });
});
