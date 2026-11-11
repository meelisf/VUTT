/** @vitest-environment jsdom */
import type React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, configure } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mitme järjestikuse päringuga voog: vaikimisi 1 s jääb täiskomplekti koormuse all väheks.
configure({ asyncUtilTimeout: 3000 });
import type { Page } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  Link: ({ to, children, onClick }: { to: string; children: React.ReactNode; onClick?: React.MouseEventHandler }) =>
    <a href={to} onClick={onClick}>{children}</a>,
  useNavigate: () => navigateMock,
}));
// Raskemad alamkomponendid ei puutu eksemplaride voogu
vi.mock('../EntityPicker', () => ({ default: () => null }));
vi.mock('../creators/CreatorsEditor', () => ({ default: () => null }));
vi.mock('../TitleVariantsFields', () => ({ default: () => null }));
vi.mock('../WorkDatingInput', () => ({ default: () => null }));
vi.mock('../ArchiveSelect', () => ({ default: () => null }));
vi.mock('../../services/collectionService', () => ({
  getVocabularies: vi.fn(async () => null),
  buildCollectionTree: () => [],
}));

const calls: { method: string; url: string; body: any }[] = [];
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  calls.push({ method, url, body });
  if (url.endsWith('/works/w1/exemplars') && method === 'GET') {
    return new Response(JSON.stringify({
      exemplars: [{ id: 'a1', holder: 'TÜR', shelfmark: 'R Est.B-954' }],
      unknown_pages: [], page_numbers: {}, page_count: 1, convolutes: [],
    }));
  }
  if (url.endsWith('/works/w1/exemplars/a1') && method === 'PUT') {
    return new Response(JSON.stringify({ id: 'a1', holder: 'TÜR', shelfmark: body.shelfmark }));
  }
  if (url.endsWith('/get-work-metadata')) {
    return new Response(JSON.stringify({
      status: 'success',
      metadata: { title: 'Trost-Zeilen', archive_refs: [{ archive_id: 'TÜR', reference: 'R Est.B-954' }],
        exemplars: [{ id: 'a1', holder: 'TÜR', shelfmark: 'R Est.B-954' }, { id: 'b2', holder: 'EAA' }] },
    }));
  }
  if (url.endsWith('/update-work-metadata')) return new Response(JSON.stringify({ status: 'success' }));
  return new Response('{}');
});
vi.mock('../../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: (url: string, init?: RequestInit) => fetchMock(url, init),
  getAuthHeaders: () => ({}),
}));

import { FeedbackProvider } from '../../contexts/FeedbackContext';
import MetadataModal from '../MetadataModal';

const page = { id: 'p1', page_number: 1 } as unknown as Page;

function renderModal(onClose = vi.fn(), onSaveSuccess = vi.fn()) {
  render(
    <FeedbackProvider>
      <MetadataModal isOpen onClose={onClose} page={page} workId="w1" authToken="tok" userRole="admin"
        collections={{}} onSaveSuccess={onSaveSuccess} />
    </FeedbackProvider>,
  );
  return { onClose, onSaveSuccess };
}

beforeEach(() => { calls.length = 0; navigateMock.mockReset(); });
afterEach(() => cleanup());

describe('MetadataModal — eksemplarid on eksemplaride lehel', () => {
  it('toimetamisplokki pole; viiterida arvuga ja link eksemplaride lehele', async () => {
    renderModal();
    const link = await screen.findByText(/metadata\.exemplarsMoved/);
    expect(link.closest('a')?.getAttribute('href')).toBe('/work/w1/exemplar');
    expect(screen.queryByTestId('exemplars-section')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('exemplars-row').textContent).toContain('2'));
    // Eksemplare ei laeta ega kirjutata modaalist
    expect(calls.some(c => c.url.includes('/exemplars'))).toBe(false);
  });

  it('puhta olekuga sulgemine ei ava salvestamata muudatuste dialoogi', async () => {
    const { onClose } = renderModal();
    await screen.findByText(/metadata\.exemplarsMoved/);
    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('unsavedChanges.saveAndContinue')).toBeNull();
  });

  it('üldine „Salvesta" ei saada exemplars ega archive_refs välja', async () => {
    renderModal();
    await screen.findByText(/metadata\.exemplarsMoved/);
    fireEvent.click(screen.getByText('metadata.save'));
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/update-work-metadata'))).toBe(true));
    const save = calls.find(c => c.url.endsWith('/update-work-metadata'))!;
    expect('exemplars' in save.body.metadata).toBe(false);
    expect('archive_refs' in save.body.metadata).toBe(false);
  });
});

describe('MetadataModal — salvestamata muudatuste kaitse', () => {
  /** Oota serveri kuju (pealkiri), siis muuda pealkirja. */
  async function editTitle(value = 'Trost-Zeilen, uus') {
    const title = await screen.findByDisplayValue('Trost-Zeilen');
    fireEvent.change(title, { target: { value } });
  }
  const notes = () => screen.getByPlaceholderText('Vabatekstilised märkused teose kohta...');

  it('muudetud vorm + rist → dialoog; „Jää" jätab lahti, „Loobu" sulgeb', async () => {
    const { onClose } = renderModal();
    await editTitle();
    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('unsavedChanges.stay'));
    expect(screen.queryByText('unsavedChanges.saveAndContinue')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    fireEvent.click(await screen.findByText('unsavedChanges.discard'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls.some(c => c.url.endsWith('/update-work-metadata'))).toBe(false);
  });

  it('„Tühista" + „Salvesta ja jätka" → salvestab muudetu ja sulgeb', async () => {
    const { onClose, onSaveSuccess } = renderModal();
    await editTitle('Uus pealkiri');
    fireEvent.click(screen.getByText('common:buttons.cancel'));
    fireEvent.click(await screen.findByText('unsavedChanges.saveAndContinue'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const save = calls.find(c => c.url.endsWith('/update-work-metadata'))!;
    expect(save.body.metadata.title).toBe('Uus pealkiri');
    expect(onSaveSuccess).toHaveBeenCalled();
  });

  it('taustaklõps muudetud vormiga küsib', async () => {
    const { onClose } = renderModal();
    await editTitle();
    // Taust on modaali välimine div; klõps selle peal (mitte sisu peal)
    const backdrop = document.querySelector('.fixed.inset-0.bg-black\\/50') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).not.toHaveBeenCalled();
    expect(await screen.findByText('unsavedChanges.saveAndContinue')).toBeTruthy();
  });

  it('ainult salvestusel kaduv muudatus (tühikud märkustes) ei küsi', async () => {
    const { onClose } = renderModal();
    await screen.findByDisplayValue('Trost-Zeilen');
    fireEvent.change(notes(), { target: { value: '   ' } });
    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('link eksemplaride lehele muudetud vormiga küsib; „Loobu" → navigeerib', async () => {
    renderModal();
    await editTitle();
    fireEvent.click(screen.getByText(/metadata\.exemplarsMoved/));
    expect(navigateMock).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('unsavedChanges.discard'));
    expect(navigateMock).toHaveBeenCalledWith('/work/w1/exemplar');
  });

  it('puhta vormiga link navigeerib kohe', async () => {
    renderModal();
    await screen.findByDisplayValue('Trost-Zeilen');
    fireEvent.click(screen.getByText(/metadata\.exemplarsMoved/));
    expect(navigateMock).toHaveBeenCalledWith('/work/w1/exemplar');
  });
});
