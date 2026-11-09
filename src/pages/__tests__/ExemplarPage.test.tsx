/** @vitest-environment jsdom */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) }),
}));
vi.mock('../../components/Header', () => ({ default: () => <div data-testid="header" /> }));
vi.mock('../../components/ImageViewer', () => ({ default: ({ src }: { src: string }) => <img data-testid="viewer" src={src} /> }));

const state = { role: 'viewer' as string | null };
vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({ user: state.role ? { username: 'u', role: state.role } : null, authToken: 'tok' }),
}));
vi.mock('../../contexts/ImageTokenContext', () => ({
  useImageToken: () => null,
  withImageToken: (u: string) => u,
}));
vi.mock('../../contexts/MeilisearchContext', () => ({ useMeiliIndex: () => ({}) }));
vi.mock('../../contexts/FeedbackContext', () => ({ useNotify: () => vi.fn(), useConfirm: () => vi.fn() }));
vi.mock('../../services/workService', () => ({
  getWorkMetadata: () => Promise.resolve({ title: 'Teos' }),
  getWorkPageList: () => Promise.resolve([
    { pageNum: 1, stem: 'w-001', imageUrl: '/api/images/f/w-001.jpg' },
    { pageNum: 2, stem: 'w-002', imageUrl: '/api/images/f/w-002.jpg' },
  ]),
}));

const getWorkExemplars = vi.fn();
vi.mock('../../services/workApi', () => ({ getWorkExemplars: (...a: unknown[]) => getWorkExemplars(...a) }));
const fetchExemplarImages = vi.fn();
vi.mock('../../services/exemplarImagesService', async (orig) => ({
  ...(await orig<typeof import('../../services/exemplarImagesService')>()),
  fetchExemplarImages: (...a: unknown[]) => fetchExemplarImages(...a),
}));

import ExemplarPage from '../ExemplarPage';

const manifest = {
  revision: 2, imports: {},
  images: [
    { id: 'img001', label: 'tiitelleht', source: { kind: 'ada', ref: '10062/14332', page: 3 } },
    { id: 'img002', source: { kind: 'photo', ref: 'M. F.' } },
  ],
};

function Loc() {
  const l = useLocation();
  return <div data-testid="loc">{l.search}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/work/:workId/exemplar/:exemplarId" element={<><ExemplarPage /><Loc /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);
beforeEach(() => {
  state.role = 'viewer';
  getWorkExemplars.mockResolvedValue({ exemplars: [{ id: 'a1b2c3', holder: 'TÜR', shelfmark: 'R 1' }],
    unknown_pages: [], page_numbers: {}, page_count: 3, convolutes: [], images: {} });
  fetchExemplarImages.mockResolvedValue(manifest);
});

describe('ExemplarPage', () => {
  it('pisipildid, esimene pilt suurena, allikarida lingiga', async () => {
    renderAt('/work/w1/exemplar/a1b2c3');
    await screen.findByTestId('viewer');
    expect(screen.getAllByTestId('exemplar-thumb')).toHaveLength(2);
    expect(screen.getByTestId('viewer').getAttribute('src')).toBe('/api/images/w1/_exemplars/a1b2c3/img001.jpg');
    const link = screen.getByTestId('exemplar-source').querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://hdl.handle.net/10062/14332');
    expect(screen.getByTestId('exemplar-source').textContent).toContain('tiitelleht');
    expect(screen.getByText(/TÜR/)).toBeTruthy();
  });

  it('?image= valib pildi; klõps vahetab ja kirjutab URL-i', async () => {
    renderAt('/work/w1/exemplar/a1b2c3?image=img002');
    await screen.findByTestId('viewer');
    expect(screen.getByTestId('viewer').getAttribute('src')).toContain('img002.jpg');
    fireEvent.click(screen.getAllByTestId('exemplar-thumb')[0]);
    await waitFor(() => expect(screen.getByTestId('viewer').getAttribute('src')).toContain('img001.jpg'));
    expect(screen.getByTestId('loc').textContent).toContain('image=img001');
  });

  it('mitte-toimetaja ei näe muutmisnuppu, admin näeb', async () => {
    renderAt('/work/w1/exemplar/a1b2c3');
    await screen.findByTestId('viewer');
    expect(screen.queryByText('exemplarImages.edit')).toBeNull();
    cleanup();
    state.role = 'admin';
    renderAt('/work/w1/exemplar/a1b2c3');
    await screen.findByTestId('viewer');
    expect(screen.getByText('exemplarImages.edit')).toBeTruthy();
  });

  it('tundmatu eksemplar → teade', async () => {
    renderAt('/work/w1/exemplar/zzzzzz');
    expect(await screen.findByText('exemplarImages.notFound')).toBeTruthy();
    expect(fetchExemplarImages).not.toHaveBeenCalledWith('w1', 'zzzzzz', expect.anything());
  });

  it('piltideta eksemplar → tühi olek', async () => {
    fetchExemplarImages.mockResolvedValue({ revision: 0, images: [], imports: {} });
    renderAt('/work/w1/exemplar/a1b2c3');
    expect(await screen.findByText('exemplarImages.empty')).toBeTruthy();
  });

  it('kõrvuta avab tunnistaja lehe pildi `page` järgi ja kirjutab ?compare=', async () => {
    fetchExemplarImages.mockResolvedValue({ ...manifest, images: [{ ...manifest.images[0], page: 'w-002' }] });
    renderAt('/work/w1/exemplar/a1b2c3');
    await screen.findByTestId('viewer');
    fireEvent.click(screen.getByText('exemplarImages.compare.open'));
    expect(await screen.findByTestId('compare-witness')).toBeTruthy();
    expect(screen.getByTestId('compare-witness').getAttribute('src')).toBe('/api/images/f/w-002.jpg');
    expect(screen.getByTestId('loc').textContent).toContain('compare=w-002');
  });

  it('?compare= tühjana: paar puudub', async () => {
    renderAt('/work/w1/exemplar/a1b2c3?compare=');
    expect(await screen.findByText('exemplarImages.compare.noPair')).toBeTruthy();
  });
});
