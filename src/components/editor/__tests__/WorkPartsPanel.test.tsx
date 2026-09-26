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
});
