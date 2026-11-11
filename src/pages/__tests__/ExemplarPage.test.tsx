/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import type { WorkExemplarsResponse } from '../../services/workApi';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: unknown) => (o && typeof o === 'object' ? `${k}:${JSON.stringify(o)}` : typeof o === 'string' ? o : k),
    i18n: { language: 'et' },
  }),
}));
vi.mock('../../components/Header', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('../../components/ImageViewer', () => ({ default: ({ src }: { src: string }) => <img data-testid="viewer" src={src} /> }));
vi.mock('../../components/UnsavedChangesDialog', () => ({ default: () => null }));
vi.mock('../../hooks/useUnsavedChangesGuard', () => ({
  useUnsavedChangesGuard: () => ({ dialogProps: { open: false }, runGuarded: (fn: () => void) => fn() }),
}));

const state = { role: null as string | null };
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ user: state.role ? { username: 'u', role: state.role } : null, authToken: state.role ? 'tok' : null }),
}));
vi.mock('../../contexts/ImageTokenContext', () => ({
  useImageToken: () => null,
  withImageToken: (u: string) => u,
}));
vi.mock('../../contexts/MeilisearchContext', () => ({ useMeiliIndex: () => ({}) }));
vi.mock('../../contexts/FeedbackContext', () => ({ useNotify: () => vi.fn(), useConfirm: () => vi.fn() }));
vi.mock('../../services/workService', () => ({
  getWorkMetadata: () => Promise.resolve({ title: 'Teos', type: { id: 'Q1261026' } }),
}));
vi.mock('../../services/apiClient', async (orig) => ({
  ...(await orig<typeof import('../../services/apiClient')>()),
  apiGet: () => Promise.resolve({ archives: { TÜR: { name: 'Tartu Ülikooli raamatukogu' } } }),
}));

const getWorkExemplars = vi.fn();
vi.mock('../../services/workApi', async (orig) => ({
  ...(await orig<typeof import('../../services/workApi')>()),
  getWorkExemplars: (...a: unknown[]) => getWorkExemplars(...a),
}));
const fetchExemplarImages = vi.fn();
const patchExemplarImages = vi.fn();
vi.mock('../../services/exemplarImagesService', async (orig) => ({
  ...(await orig<typeof import('../../services/exemplarImagesService')>()),
  fetchExemplarImages: (...a: unknown[]) => fetchExemplarImages(...a),
  patchExemplarImages: (...a: unknown[]) => patchExemplarImages(...a),
}));

import ExemplarPage from '../ExemplarPage';

const files = (n: number) => Array.from({ length: n }, (_, i) => `w-${String(i + 1).padStart(3, '0')}.jpg`);
const resp = (over: Partial<WorkExemplarsResponse> = {}, n = 25): WorkExemplarsResponse => ({
  exemplars: [], unknown_pages: [],
  page_numbers: Object.fromEntries(files(n).map((f, i) => [f.replace('.jpg', ''), i + 1])),
  page_files: files(n), page_count: n, convolutes: [], images: {}, ...over,
});

const manifest = {
  revision: 2, imports: {},
  images: [
    { id: 'img001', label: 'tiitelleht', page: 'w-003', source: { kind: 'ada', ref: '10062/14332', page: 3 } },
    { id: 'img002', page: 'kadunud', source: { kind: 'photo', ref: 'M. F.' } },
    ...['img003', 'img004', 'img005', 'img006'].map(id => ({ id, source: { kind: 'photo' } })),
  ],
};

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname}{l.search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/work/:workId/exemplar/:exemplarId?" element={<><ExemplarPage /><Loc /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  state.role = null;
  getWorkExemplars.mockReset();
  fetchExemplarImages.mockReset();
  fetchExemplarImages.mockResolvedValue({ revision: 0, imports: {}, images: [] });
});

describe('ExemplarPage', () => {
  it('1. eksemplare ja lehti pole → tühi seis, pildikaarti pole', async () => {
    getWorkExemplars.mockResolvedValue(resp({}, 0));
    renderAt('/work/w1/exemplar');
    expect(await screen.findByText('exemplarPage.none')).toBeTruthy();
    expect(screen.queryByTestId('exemplar-material')).toBeNull();
  });

  it('2. hõre: id-ta URL → valitud „Teose lehed", 24 pisipilti + „Näita kõiki"', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'a1', holder: 'TÜR' }, { id: 'b2', holder: 'EAA' }, { id: 'c3', holder: 'LUAB' }],
    }));
    renderAt('/work/w1/exemplar');
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/work/w1/exemplar/pages'));
    const material = await screen.findByTestId('exemplar-material');
    expect(within(material).getAllByTestId('material-thumb')).toHaveLength(24);
    fireEvent.click(within(material).getByText(/exemplarPage\.showAll/));
    expect(within(material).getAllByTestId('material-thumb')).toHaveLength(25);
  });

  it('3. piltidega eksemplar: 6 kaarti, paarimärk kehtival paaril, rippuval mitte', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'a1', holder: 'TÜR', text_witness: true }, { id: 'b2', holder: 'UUB' }],
      images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    renderAt('/work/w1/exemplar');
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/work/w1/exemplar/b2'));
    const material = await screen.findByTestId('exemplar-material');
    await waitFor(() => expect(within(material).getAllByTestId('material-thumb')).toHaveLength(6));
    const badges = within(material).getAllByTestId('pair-badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toContain('"n":3');
  });

  it('4. avalik + pildita eksemplar: „Pilte ei ole" puudub, kaarti pole', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'a1', holder: 'TÜR', text_witness: true }, { id: 'b2', holder: 'LUAB' }],
    }));
    renderAt('/work/w1/exemplar/b2');
    await screen.findByText('LUAB');
    await waitFor(() => expect(getWorkExemplars).toHaveBeenCalled());
    expect(screen.queryByText('exemplarPage.noImages')).toBeNull();
    expect(screen.queryByTestId('exemplar-material')).toBeNull();
  });

  it('4b. admin + pildita eksemplar: üks rida „Pilte ei ole"', async () => {
    state.role = 'admin';
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'a1', holder: 'TÜR', text_witness: true }, { id: 'b2', holder: 'LUAB' }],
    }));
    renderAt('/work/w1/exemplar/b2');
    expect(await screen.findByText('exemplarPage.noImages')).toBeTruthy();
  });

  it('5. klõps pisipildil → ?image=<key>, modaal ja allikarida', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    renderAt('/work/w1/exemplar/b2');
    const material = await screen.findByTestId('exemplar-material');
    await waitFor(() => expect(within(material).getAllByTestId('material-thumb')).toHaveLength(6));
    fireEvent.click(within(material).getAllByTestId('material-thumb')[0]);
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('?image=img001'));
    const modal = await screen.findByTestId('exemplar-image-modal');
    expect(within(modal).getByTestId('viewer').getAttribute('src')).toBe('/api/images/w1/_exemplars/b2/img001.jpg');
    const src = within(modal).getByTestId('exemplar-source');
    expect(src.querySelector('a')?.getAttribute('href')).toBe('https://hdl.handle.net/10062/14332');
  });

  it('6. ?page=7 → tagasilink lehele 7', async () => {
    getWorkExemplars.mockResolvedValue(resp({ exemplars: [{ id: 'a1', holder: 'TÜR' }] }));
    renderAt('/work/w1/exemplar/a1?page=7');
    const back = await screen.findByText(/exemplarPage\.backToPage/);
    expect(back.closest('a')?.getAttribute('href')).toBe('/work/w1/7');
  });

  it('7. alus valitud + erandleht → aluse lehtede hulgas erandlehte pole', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'a1', holder: 'TÜR', text_witness: true }, { id: 'b2', holder: 'LUAB', pages: ['w-002'] }],
    }, 3));
    renderAt('/work/w1/exemplar/a1');
    const material = await screen.findByTestId('exemplar-material');
    const imgs = within(material).getAllByTestId('material-thumb').map(b => b.querySelector('img')?.getAttribute('src'));
    expect(imgs).toHaveLength(2);
    expect(imgs.some(s => s?.includes('w-002'))).toBe(false);
  });

  it('?cmp=katkine → kõrvutust ei ole, leht renderdub', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    renderAt('/work/w1/exemplar/b2?cmp=katkine');
    await screen.findByTestId('exemplar-material');
    expect(screen.queryByTestId('exemplar-compare-modal')).toBeNull();
  });

  it('piirist väljas indeks → kõrvutust ei ole', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    renderAt('/work/w1/exemplar/b2?cmp=b2:99~pages:0');
    await screen.findByTestId('exemplar-material');
    await waitFor(() => expect(fetchExemplarImages).toHaveBeenCalled());
    expect(screen.queryByTestId('exemplar-compare-modal')).toBeNull();
  });

  it('„Kõrvuta" → parem pool paari lehel; admin salvestab paari', async () => {
    state.role = 'admin';
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    patchExemplarImages.mockResolvedValue({ ...manifest, revision: 3 });
    renderAt('/work/w1/exemplar/b2');
    const material = await screen.findByTestId('exemplar-material');
    await waitFor(() => expect(within(material).getAllByTestId('material-thumb')).toHaveLength(6));
    fireEvent.click(within(material).getByText('exemplarPage.compare'));
    // img001 paar on w-003 → parem pool sellel lehel; URL kannab võtmeid, mitte indekseid
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('cmp=b2%3Aimg001%7Epages%3Aw-003'));
    const modal = await screen.findByTestId('exemplar-compare-modal');
    expect(within(modal).getByText('compare.pairSaved')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toContain('cmp=b2%3Aimg002%7Epages%3Aw-004'));
    fireEvent.click(within(screen.getByTestId('exemplar-compare-modal')).getByText(/compare\.savePair/));
    await waitFor(() => expect(patchExemplarImages).toHaveBeenCalled());
    const [, eid, rev, imgs] = patchExemplarImages.mock.calls[0];
    expect(eid).toBe('b2');
    expect(rev).toBe(2);
    expect(imgs[1].page).toBe('w-004');
  });

  it('vana indeksilink (enne 2026-11-11) avab sama kõrvutuse', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    renderAt('/work/w1/exemplar/b2?cmp=b2:0~pages:2');
    const modal = await screen.findByTestId('exemplar-compare-modal');
    const srcs = within(modal).getAllByTestId('viewer').map(v => v.getAttribute('src'));
    expect(srcs[0]).toContain('/b2/img001.jpg');
    expect(srcs[1]).toContain('w-003');
  });

  it('võtmelink jääb samale pildile ka pärast piltide ümberjärjestust', async () => {
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    // img005 on nüüd esimene — indeksilink näitaks valet pilti, võtmelink mitte
    fetchExemplarImages.mockResolvedValue({ ...manifest, images: [...manifest.images].reverse() });
    renderAt('/work/w1/exemplar/b2?cmp=b2:img005~pages:w-010');
    const modal = await screen.findByTestId('exemplar-compare-modal');
    const srcs = within(modal).getAllByTestId('viewer').map(v => v.getAttribute('src'));
    expect(srcs[0]).toContain('/b2/img005.jpg');
    expect(srcs[1]).toContain('w-010');
  });

  it('„Kopeeri link": püsiv link ilma ?page= kontekstita (pilt ja kõrvutus)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    getWorkExemplars.mockResolvedValue(resp({
      exemplars: [{ id: 'b2', holder: 'UUB' }], images: { b2: { count: 6, preview: [] } },
    }));
    fetchExemplarImages.mockResolvedValue(manifest);
    renderAt('/work/w1/exemplar/b2?page=7&image=img004');
    const modal = await screen.findByTestId('exemplar-image-modal');
    fireEvent.click(within(modal).getByTestId('copy-link'));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toBe(`${window.location.origin}/work/w1/exemplar/b2?image=img004`);

    cleanup();
    renderAt('/work/w1/exemplar/b2?page=7&cmp=b2:img001~pages:w-003');
    const cmpModal = await screen.findByTestId('exemplar-compare-modal');
    fireEvent.click(within(cmpModal).getByTestId('copy-link'));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    expect(writeText.mock.calls[1][0])
      .toBe(`${window.location.origin}/work/w1/exemplar/b2?cmp=b2%3Aimg001%7Epages%3Aw-003`);
  });
});
