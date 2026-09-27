/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../pages/manage/parts/__tests__/testI18n';

const { api } = vi.hoisted(() => ({ api: { parts: [] as any[], nums: {} as Record<string, number>, fail: false } }));
vi.mock('../../../services/workPartsApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/workPartsApi')>()),
  getPartsToc: async () => {
    if (api.fail) throw new Error('403');
    return { parts: api.parts, pageNumbers: api.nums };
  },
}));

import WorkPartsPanel from '../WorkPartsPanel';

const LETTER = { id: 'a', kind: 'letter', pages: ['s2', 's3', 's5'], attached_to: null, needs_review: false,
  creators: [{ name: 'Luden', role: 'auctor' }, { name: 'Virginius', role: 'addressee' }], dating: { start: '1652-03-01' } };
const POEM = { id: 'b', kind: 'poem', title: 'Carmen', pages: ['s7'], creators: [], attached_to: null, needs_review: false };

const renderPanel = (page = 1) => render(
  <MemoryRouter><WorkPartsPanel workId="w1" token={null} currentPage={page} /></MemoryRouter>,
);

beforeEach(() => {
  api.parts = [POEM, LETTER]; api.nums = { s2: 2, s3: 3, s5: 5, s7: 7 }; api.fail = false;
  try { localStorage.clear(); } catch { /* */ }
});

describe('WorkPartsPanel', () => {
  it('osadeta teosel (või vea korral) paneeli pole', async () => {
    api.parts = [];
    const { container } = renderPanel();
    await new Promise(r => setTimeout(r, 0));
    expect(container.textContent).toBe('');
    api.fail = true; api.parts = [LETTER];
    const r2 = renderPanel();
    await new Promise(r => setTimeout(r, 0));
    expect(r2.container.textContent).toBe('');
  });

  it('vaikimisi kokku; avamisel read teose järjekorras, kiri = kellelt → kellele, lehevahemikud lingid', async () => {
    renderPanel();
    const toggle = await screen.findByRole('button', { name: /Sisukord \(2\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Luden → Virginius')).toBeNull();
    fireEvent.click(toggle);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].textContent).toContain('Luden → Virginius');
    expect(rows[0].textContent).toContain('1652');
    expect(rows[1].textContent).toContain('Carmen');
    expect(screen.getByRole('link', { name: '2–3' }).getAttribute('href')).toBe('/work/w1/2');
    expect(screen.getByRole('link', { name: '5' }).getAttribute('href')).toBe('/work/w1/5');
  });

  it('avatud olek jääb meelde', async () => {
    const r = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord/ }));
    r.unmount();
    renderPanel();
    expect((await screen.findByRole('button', { name: /Sisukord/ })).getAttribute('aria-expanded')).toBe('true');
  });

  it('praegust lehte sisaldav osa on märgitud', async () => {
    renderPanel(3);
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord/ }));
    const rows = screen.getAllByRole('listitem');
    expect(rows[0].getAttribute('aria-current')).toBe('true');
    expect(rows[1].getAttribute('aria-current')).toBeNull();
  });

  it('osa andmed lahti: märkused, koht, sihtkoht, isikud rollidega (lingiga), lisad', async () => {
    api.parts = [
      { ...LETTER, notes: 'Kiri on säilinud koopiana.', place: { id: 'Q1794', label: 'Frankfurt' },
        place_to: { id: null, label: 'Tartu' }, languages: ['lat'],
        creators: [{ id: 'vutt:Pluden', name: 'Luden', role: 'auctor' }, { name: 'Virginius', role: 'addressee' }] },
      { id: 'c', kind: 'attachment', title: 'Luuletus kirja juures', pages: ['s5'], creators: [], attached_to: 'a', needs_review: false },
    ];
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord \(2\)/ }));
    expect(screen.queryByText('Kiri on säilinud koopiana.')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Näita osa andmeid' })[0]);
    expect(screen.getByText('Kiri on säilinud koopiana.')).toBeTruthy();
    expect(screen.getByText('Frankfurt → Tartu')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Luden' }).getAttribute('href')).toBe('/persons/vutt:Pluden');
    expect(screen.getByText('Virginius')).toBeTruthy();
    expect(screen.getAllByText(/Luuletus kirja juures/)).toHaveLength(2);   // oma rida + kirja lisad
  });

  it('ilma lisaandmeteta osal lahtikeeramise nuppu ei ole', async () => {
    api.parts = [POEM];
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord \(1\)/ }));
    expect(screen.queryByRole('button', { name: 'Näita osa andmeid' })).toBeNull();
  });
});

