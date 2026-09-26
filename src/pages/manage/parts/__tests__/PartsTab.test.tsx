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
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord/ }));
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
    fireEvent.click(screen.getByTestId('badge-s1-a'));
    expect(await screen.findByText(/kuulub ka teise osasse/)).toBeTruthy();
  });

  it('valitud lehtede lisamine aktiivsele osale', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('badge-s1-a'));
    fireEvent.click(screen.getByTestId('page-s3'));
    fireEvent.click(screen.getByRole('button', { name: 'Lisa valitud lehed osale' }));
    await waitFor(() => expect(api.calls).toContain('pages:a:+s3:-'));
  });

  it('serveri viga: teade serveri tekstiga', async () => {
    api.fail = { status: 409, message: 'Osale viitavad lisad' };
    api.parts = [{ id: 'a', kind: 'session', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('badge-s1-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Kustuta osa' }));
    expect(await screen.findByText(/Osale viitavad lisad/)).toBeTruthy();
  });

  it('pealkirja muutmine teatab salvestamata muudatusest', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('badge-s1-a'));
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

  it('sisukorra vaatest osa avamine', async () => {
    api.parts = [{ id: 'a', kind: 'letter', title: 'Kiri Ludenile', pages: ['s2'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: /Sisukord/ }));
    fireEvent.click(await screen.findByTestId('part-a'));
    expect(await screen.findByRole('dialog', { name: 'Kiri Ludenile' })).toBeTruthy();
  });

  it('paneel on hõljuv (mitte modaalne) ja isikud on vormis esimesed', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('badge-s1-a'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(dialog.className).toContain('z-[1300]');
    const persons = screen.getByText('Isikud');
    const kind = screen.getByLabelText('Liik');
    expect(persons.compareDocumentPosition(kind) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('paneeli sulgemine käib salvestamata-kaitse kaudu', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    const guarded: string[] = [];
    render(
      <MemoryRouter>
        <PartsTab workId="w1" pages={PAGES} token="t" imageToken={null} thumbCacheBust={0}
          onDirtyChange={d => dirty.push(d)} runGuarded={fn => { guarded.push('x'); fn(); }} saveRef={{ current: async () => true }} />
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByTestId('badge-s1-a'));
    await screen.findByRole('dialog');
    const before = guarded.length;
    fireEvent.click(screen.getByRole('button', { name: 'Sulge' }));
    expect(guarded.length).toBe(before + 1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('kokkutõmmatud paneel peidab vormi, päis jääb', async () => {
    api.parts = [{ id: 'a', kind: 'letter', pages: ['s1'], creators: [], attached_to: null, needs_review: false }];
    renderTab();
    fireEvent.click(await screen.findByTestId('badge-s1-a'));
    fireEvent.click(await screen.findByRole('button', { name: 'Tõmba kokku' }));
    expect(screen.queryByLabelText('Pealkiri')).toBeNull();
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ava' }));
    expect(screen.getByLabelText('Pealkiri')).toBeTruthy();
  });

  it('suuruse liugur muudab ruudustiku veeru laiust; valiku saab tühistada', async () => {
    renderTab();
    await screen.findByText(/Osi pole veel märgitud/);
    fireEvent.change(screen.getByLabelText('Pisipildi suurus'), { target: { value: '240' } });
    expect(screen.getByTestId('parts-grid').style.gridTemplateColumns).toContain('240px');
    fireEvent.click(screen.getByTestId('page-s1'));
    fireEvent.click(screen.getByRole('button', { name: 'Tühista valik' }));
    expect(screen.queryByText('1 leht valitud')).toBeNull();
  });
});
