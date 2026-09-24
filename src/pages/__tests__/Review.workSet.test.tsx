/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const state = vi.hoisted(() => ({
  selection: { kind: 'work_set', id: 'a' },
  user: { username: 'admin', role: 'admin' },
  fetch: vi.fn(),
  setSelection: vi.fn(),
}));
vi.mock('../../components/Header', () => ({ default: () => null }));
vi.mock('../../contexts/UserContext', () => ({ useUser: () => ({ user: state.user, authToken: 'token', isLoading: false }) }));
vi.mock('../../contexts/CollectionContext', () => ({ useCollection: () => ({
  selection: state.selection, setSelection: state.setSelection, selectedCollection: null,
  collections: {}, isLoading: false, getCollectionName: (id: string) => id,
  workSets: [{ id: 'a', name: { et: 'Kogu A' } }, { id: 'b', name: { et: 'Kogu B' } }],
}) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'et' } }) }));
vi.mock('../../utils/fetchWithTimeout', () => ({ fetchWithTimeout: state.fetch, getAuthHeaders: () => ({}) }));
import Review from '../Review';

afterEach(cleanup);
it('vahetab töökollektsiooni, säilitab filtri lehitsemisel ja eirab vana vastust', async () => {
  state.selection = { kind: 'work_set', id: 'a' };
  let resolveOld!: (value: unknown) => void;
  const oldResponse = new Promise(resolve => { resolveOld = resolve; });
  const commit = { full_hash: 'hash', commit_hash: 'hash', author: 'anne', date: '2026-09-24', formatted_date: '24.09.2026', message: 'Muudatus', work_id: 'wB', title: 'B teos', filepath: 'b/1.txt', lehekylje_number: 1 };
  state.fetch.mockImplementation((url: string) => {
    if (url.includes('/admin/users')) return Promise.resolve({ json: async () => ({ status: 'success', users: [] }) });
    if (url.includes('set=a')) return oldResponse;
    return Promise.resolve({ json: async () => ({ status: 'success', commits: url.includes('offset=0') ? [commit] : [], has_more: url.includes('offset=0'), is_admin: true }) });
  });
  const view = render(<MemoryRouter><Review /></MemoryRouter>);
  await waitFor(() => expect(state.fetch).toHaveBeenCalledWith(expect.stringContaining('set=a'), expect.anything()));
  state.selection = { kind: 'work_set', id: 'b' };
  view.rerender(<MemoryRouter><Review /></MemoryRouter>);
  await screen.findByText('B teos');
  expect(screen.getByText('Kogu B')).toBeTruthy();
  fireEvent.click(screen.getByText('loadMore'));
  await waitFor(() => expect(state.fetch).toHaveBeenCalledWith(expect.stringContaining('offset=1&set=b'), expect.anything()));
  await act(async () => { resolveOld({ json: async () => ({ status: 'success', commits: [], has_more: false, is_admin: true }) }); });
  expect(screen.getByText('B teos')).toBeTruthy();
  fireEvent.click(screen.getByText('common:collections.all'));
  expect(state.setSelection).toHaveBeenCalledWith({ kind: 'all' });
});
