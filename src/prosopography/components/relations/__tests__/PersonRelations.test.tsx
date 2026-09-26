// src/prosopography/components/relations/__tests__/PersonRelations.test.tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './testI18n';

// vi.fn salvestab ainult kutsed; vastuse annab tavaline funktsioon. vitest 4 vi.fn
// käsitleb tagasi lükatud lubadust testi veana ka siis, kui komponent selle püüab.
const { fetchMock, impl } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  impl: { fn: (..._a: unknown[]): Promise<unknown> => new Promise(() => {}) },
}));
vi.mock('../../../services/networkService', async (orig) => ({
  ...(await orig<typeof import('../../../services/networkService')>()),
  fetchPersonNetwork: (...a: unknown[]) => { fetchMock(...a); return impl.fn(...a); },
}));
vi.mock('../../../../contexts/CollectionContext', () => ({
  useCollection: () => ({ selectedCollection: 'agc', getCollectionName: () => 'Rootsi aja ülikool' }),
}));

import PersonRelations from '../PersonRelations';

const F = 'vutt:Pfocus';
const net = (edges: unknown[], persons: unknown[]) => ({
  focus: { id: F, label: 'Fookus', birth_year: null, death_year: null, origin: null },
  persons, works: [{ work_id: 'w1', title: 'Disp', year: 1658, place: null, genres: [], restricted: false }], edges,
});
const A = { id: 'a', label: 'Anna', birth_year: null, death_year: null, origin: null };
const T = { id: 't', label: 'Trükkal', birth_year: null, death_year: null, origin: null };
const acad = { kind: 'academic', from: 'a', to: F, directed: true, year: 1658, place: null, roles: {}, evidence: { work_id: 'w1', pages: [] } };
const prn = { kind: 'printer', from: 't', to: F, directed: false, year: 1658, place: null, roles: {}, evidence: { work_id: 'w1', pages: [] } };

const renderIt = (id = F) => render(<MemoryRouter><PersonRelations personId={id} /></MemoryRouter>);

beforeEach(() => { fetchMock.mockReset(); impl.fn = () => new Promise(() => {}); });

describe('PersonRelations', () => {
  it('näitab vahekaarte ja võrgustikku', async () => {
    impl.fn = async () => net([acad], [A]);
    renderIt();
    expect(await screen.findByRole('tab', { name: 'Võrgustik' })).toBeTruthy();
    expect(screen.getByText('Anna')).toBeTruthy();
  });

  it('seosteta isik: üks rida, vahekaarte ei ole', async () => {
    impl.fn = async () => net([], []);
    renderIt();
    expect(await screen.findByText('Seoseid ei leitud.')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('ainult trükkalid (vaikimisi peidus): tühi olek, trükkalifilter toob tagasi', async () => {
    impl.fn = async () => net([prn], [T]);
    renderIt();
    expect(await screen.findByText('Seoseid ei leitud.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Trükkal'));
    expect(await screen.findByText('Trükkal', { selector: 'text' })).toBeTruthy();
  });

  it('viga: teade, leht ei kuku', async () => {
    impl.fn = () => Promise.reject(new Error('500'));
    renderIt();
    await waitFor(() => expect(screen.getByText('Seoste laadimine ebaõnnestus.')).toBeTruthy());
  });

  it('vana vastus ei kirjuta uut isikut üle', async () => {
    let resolveOld: (v: unknown) => void = () => {};
    const answers = [() => new Promise(r => { resolveOld = r; }), async () => net([acad], [A])];
    impl.fn = () => answers.shift()!();
    const { rerender } = renderIt('vutt:Pold');
    rerender(<MemoryRouter><PersonRelations personId={F} /></MemoryRouter>);
    expect(await screen.findByText('Anna')).toBeTruthy();
    // Tühjenda mikroülesanded, et vana lubaduse .then jõuaks joosta, siis kontrolli.
    await act(async () => { resolveOld(net([], [])); await Promise.resolve(); });
    expect(screen.getByText('Anna')).toBeTruthy();
    expect(screen.queryByText('Seoseid ei leitud.')).toBeNull();
  });

  it('kogu lüliti küsib uuesti collection-parameetriga', async () => {
    impl.fn = async () => net([acad], [A]);
    renderIt();
    await screen.findByText('Anna');
    fireEvent.click(screen.getByLabelText('Ainult kogus: Rootsi aja ülikool'));
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(F, 'agc'));
  });
  it('kogu lüliti: sektsioon ja lüliti jäävad nähtavaks, kuni uus vastus tuleb', async () => {
    impl.fn = async () => net([acad], [A]);
    renderIt();
    await screen.findByText('Anna');
    impl.fn = () => new Promise(() => {});                 // uus päring jääb ootele
    fireEvent.click(screen.getByLabelText('Ainult kogus: Rootsi aja ülikool'));
    expect(screen.getByLabelText('Ainult kogus: Rootsi aja ülikool')).toBeTruthy();
    expect(screen.getByText('Anna')).toBeTruthy();
  });

  it('kogu lüliti: vea järel saab lüliti tagasi keerata', async () => {
    impl.fn = async () => net([acad], [A]);
    renderIt();
    await screen.findByText('Anna');
    impl.fn = () => Promise.reject(new Error('500'));
    fireEvent.click(screen.getByLabelText('Ainult kogus: Rootsi aja ülikool'));
    await screen.findByText('Seoste laadimine ebaõnnestus.');
    impl.fn = async () => net([acad], [A]);
    fireEvent.click(screen.getByLabelText('Ainult kogus: Rootsi aja ülikool'));
    expect(await screen.findByText('Anna')).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith(F, null);
  });
});

