/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '../../../pages/manage/parts/__tests__/testI18n';

const { api } = vi.hoisted(() => ({ api: { parts: [] as any[], nums: {} as Record<string, number>, fail: false, updates: [] as any[] } }));
vi.mock('../../../services/workPartsApi', async (orig) => ({
  ...(await orig<typeof import('../../../services/workPartsApi')>()),
  getPartsToc: async () => {
    if (api.fail) throw new Error('403');
    return { parts: api.parts, pageNumbers: api.nums };
  },
  updatePart: async (_w: string, id: string, part: any) => {
    api.updates.push({ id, part });
    api.parts = api.parts.map(p => (p.id === id ? { ...part, id, needs_review: false } : p));
    return { ...part, id, needs_review: false };
  },
}));
// UserContext impordib rakenduse i18n-i (init kirjutaks testi tõlked üle) — CreatorsEditor kasutab seda.
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => ({ user: { role: 'editor' } }) }));
vi.mock('../../../hooks/usePersonSources', () => ({ usePersonSources: () => ({ authors: [], peopleRegister: [] }) }));
vi.mock('../../EntityPicker', () => ({ default: () => <input aria-label="entity" /> }));
vi.mock('../../WorkDatingInput', () => ({ default: () => <input aria-label="dating" /> }));

import WorkPartsPanel from '../WorkPartsPanel';

const LETTER = { id: 'a', kind: 'letter', pages: ['s2', 's3', 's5'], attached_to: null, needs_review: false,
  creators: [{ name: 'Luden', role: 'auctor' }, { name: 'Virginius', role: 'addressee' }], dating: { start: '1652-03-01' } };
const POEM = { id: 'b', kind: 'poem', title: 'Carmen', pages: ['s7'], creators: [], attached_to: null, needs_review: false };

const renderPanel = (page = 1) => render(
  <MemoryRouter><WorkPartsPanel workId="w1" token={null} currentPage={page} /></MemoryRouter>,
);

beforeEach(() => {
  api.parts = [POEM, LETTER]; api.nums = { s2: 2, s3: 3, s5: 5, s7: 7 }; api.fail = false; api.updates = [];
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

  it('muutmisõigusega: pliiats avab osa vormi ja salvestus uuendab osa', async () => {
    render(<MemoryRouter><WorkPartsPanel workId="w1" token="t" currentPage={1} canEdit /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord \(2\)/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Näita osa andmeid' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Muuda osa' }));
    const saveBtn = await screen.findByRole('button', { name: 'Salvesta osa' });
    expect(saveBtn.className).not.toContain('bg-amber-500');
    fireEvent.change(screen.getByLabelText('Pealkiri'), { target: { value: 'Uus' } });
    expect(saveBtn.className).toContain('bg-amber-500');       // salvestamata muudatus → kollane
    fireEvent.click(saveBtn);
    await waitFor(() => expect(api.updates).toHaveLength(1));
    await waitFor(() => expect(saveBtn.className).not.toContain('bg-amber-500'));
    expect(api.updates[0].id).toBe('a');
    expect(api.updates[0].part.pages).toEqual(['s2', 's3', 's5']);
  });

  it('ilma muutmisõiguseta pliiatsit ei ole', async () => {
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord \(2\)/ }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Näita osa andmeid' })[0]);
    expect(screen.queryByRole('button', { name: 'Muuda osa' })).toBeNull();
  });
});

