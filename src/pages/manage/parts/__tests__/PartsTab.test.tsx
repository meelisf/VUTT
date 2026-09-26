/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import './testI18n';

// Mock tavafunktsioonidega (vitest 4 vi.fn käsitleb tagasi lükatud lubadust testi veana).
const { api } = vi.hoisted(() => ({ api: {
  parts: [] as any[], calls: [] as string[], fail: null as null | { status: number; message: string },
} }));
vi.mock('../../../../services/workPartsApi', async (orig) => ({
  ...(await orig<typeof import('../../../../services/workPartsApi')>()),
  listParts: async () => api.parts,
  createPart: async (_w: string, p: any) => {
    api.calls.push(`create:${p.pages.join(',')}`);
    const np = { ...p, id: 'n1', needs_review: false }; api.parts = [...api.parts, np]; return np;
  },
  updatePart: async (_w: string, id: string, p: any) => { api.calls.push(`update:${id}`); return { ...p, id, needs_review: false }; },
  deletePart: async () => {
    api.calls.push('delete');
    if (api.fail) { const e: any = new Error(api.fail.message); e.status = api.fail.status; throw e; }
  },
  changePartPages: async (_w: string, id: string, add: string[], remove: string[]) => {
    api.calls.push(`pages:${id}:+${add.join(',')}:-${remove.join(',')}`);
    return api.parts.find(p => p.id === id);
  },
}));
vi.mock('../../PageThumb', () => ({ default: () => <div /> }));
vi.mock('../../../../components/EntityPicker', () => ({ default: () => <input aria-label="entity" /> }));
vi.mock('../../../../components/WorkDatingInput', () => ({ default: () => <input aria-label="dating" /> }));

import PartsTab from '../PartsTab';

const PAGES = ['s1', 's2', 's3'].map((s, i) => ({ page_num: i + 1, sequence: i, base_name: s, filename: `${s}.jpg`,
  lehekylje_pilt: `/x/${s}.jpg`, status: 'Toores', has_text: true }));
const dirty: boolean[] = [];
const renderTab = () => render(
  <MemoryRouter>
    <PartsTab workId="w1" pages={PAGES} token="t" imageToken={null} thumbCacheBust={0}
      onDirtyChange={d => dirty.push(d)} runGuarded={fn => fn()} saveRef={{ current: async () => true }} />
  </MemoryRouter>,
);

beforeEach(() => { api.parts = []; api.calls = []; api.fail = null; dirty.length = 0; });

describe('PartsTab', () => {
  it('tühi olek + osa loomine valitud lehtedest (Shift-vahemik)', async () => {
    renderTab();
    expect(await screen.findByText(/Osi pole veel märgitud/)).toBeTruthy();
    fireEvent.click(screen.getByTestId('page-s1'));
    fireEvent.click(screen.getByTestId('page-s3'), { shiftKey: true });
    expect(screen.getByText('3 lehte valitud')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Loo osa valitud lehtedest' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Salvesta osa' }));
    await waitFor(() => expect(api.calls).toContain('create:s1,s2,s3'));
  });

  it('needs_review osa on esile tõstetud', async () => {
    api.parts = [{ id: 'x', kind: 'letter', pages: [], creators: [], attached_to: null, needs_review: true }];
    renderTab();
    expect(await screen.findByText('Lehed puuduvad — vaata üle')).toBeTruthy();
  });

  it('jagatud leht: kaks märki ja hoiatus vormis', async () => {
    api.parts = [
      { id: 'a', kind: 'letter', pages: ['s1', 's2'], creators: [], attached_to: null, needs_review: false },
      { id: 'b', kind: 'letter', pages: ['s2', 's3'], creators: [], attached_to: null, needs_review: false },
    ];
    renderTab();
    expect(await screen.findByTestId('badge-s2-a')).toBeTruthy();
    expect(screen.getByTestId('badge-s2-b')).toBeTruthy();
    fireEvent.click(screen.getByTestId('part-a'));
    expect(await screen.findByText(/kuulub ka teise osasse/)).toBeTruthy();
  });

  it('valitud lehtede lisamine aktiivsele osale', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('part-a'));
    fireEvent.click(screen.getByTestId('page-s3'));
    fireEvent.click(screen.getByRole('button', { name: 'Lisa valitud lehed osale' }));
    await waitFor(() => expect(api.calls).toContain('pages:a:+s3:-'));
  });

  it('serveri viga: teade serveri tekstiga', async () => {
    api.fail = { status: 409, message: 'Osale viitavad lisad' };
    api.parts = [{ id: 'a', kind: 'session', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('part-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Kustuta osa' }));
    expect(await screen.findByText(/Osale viitavad lisad/)).toBeTruthy();
  });

  it('pealkirja muutmine teatab salvestamata muudatusest', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('part-a'));
    fireEvent.change(screen.getByLabelText('Pealkiri'), { target: { value: 'Uus' } });
    await waitFor(() => expect(dirty[dirty.length - 1]).toBe(true));
  });
  it('sulgemisel mustandiga: dirty-lipp nullitakse ja saveRef ei salvesta enam (arvustuse C1)', async () => {
    const saveRef = { current: async () => true };
    const { unmount } = render(
      <MemoryRouter>
        <PartsTab workId="w1" pages={PAGES} token="t" imageToken={null} thumbCacheBust={0}
          onDirtyChange={d => dirty.push(d)} runGuarded={fn => fn()} saveRef={saveRef} />
      </MemoryRouter>,
    );
    await screen.findByText(/Osi pole veel märgitud/);
    fireEvent.click(screen.getByTestId('page-s1'));
    fireEvent.click(screen.getByRole('button', { name: 'Loo osa valitud lehtedest' }));
    await waitFor(() => expect(dirty[dirty.length - 1]).toBe(true));
    unmount();
    expect(dirty[dirty.length - 1]).toBe(false);
    expect(await saveRef.current()).toBe(true);
    expect(api.calls.filter(c => c.startsWith('create'))).toEqual([]);   // loobutud osa ei looda
  });
});
