/** @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, cleanup, configure } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mitme järjestikuse päringuga voog: vaikimisi 1 s jääb täiskomplekti koormuse all väheks.
configure({ asyncUtilTimeout: 3000 });
import type { Page } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, d?: any) => (typeof d === 'string' ? d : k), i18n: { language: 'et' } }),
}));
vi.mock('react-router-dom', () => ({ Link: () => null }));
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
      metadata: { title: 'Trost-Zeilen', archive_refs: [{ archive_id: 'TÜR', reference: 'R Est.B-954' }] },
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

beforeEach(() => { calls.length = 0; });
afterEach(() => cleanup());

describe('MetadataModal — eksemplarid samas aknas', () => {
  it('salvestamata eksemplari mustandiga sulgemine küsib; „Salvesta ja jätka" saadab PUT-i ja sulgeb', async () => {
    const { onClose, onSaveSuccess } = renderModal();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getByLabelText('exemplars.edit'));
    fireEvent.change(screen.getByLabelText('exemplars.shelfmark'), { target: { value: 'R Est.B-954 (I)' } });

    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('unsavedChanges.saveAndContinue'));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const put = calls.find(c => c.method === 'PUT');
    expect(put?.body.shelfmark).toBe('R Est.B-954 (I)');
    // Tuletatud arhiiviviited loetakse serverist ja antakse Workspace'ile edasi
    await waitFor(() => expect(onSaveSuccess).toHaveBeenCalledWith({}, {
      archive_refs: [{ archive_id: 'TÜR', reference: 'R Est.B-954' }], convolute_count: 0,
      exemplars_rev: expect.any(Number),  // „Samas köites" laeb selle muutumisel uuesti
    }));
  });

  it('puhta olekuga sulgemine ei küsi midagi', async () => {
    const { onClose } = renderModal();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getByLabelText('common:buttons.close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('unsavedChanges.saveAndContinue')).toBeNull();
  });

  it('üldine „Salvesta" ei saada exemplars ega archive_refs välja', async () => {
    renderModal();
    await screen.findByText('· R Est.B-954');
    fireEvent.click(screen.getByText('metadata.save'));
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/update-work-metadata'))).toBe(true));
    const save = calls.find(c => c.url.endsWith('/update-work-metadata'))!;
    expect('exemplars' in save.body.metadata).toBe(false);
    expect('archive_refs' in save.body.metadata).toBe(false);
  });
});
