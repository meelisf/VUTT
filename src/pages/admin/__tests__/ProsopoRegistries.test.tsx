/** @vitest-environment jsdom */
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { session, fetchRegistry } = vi.hoisted(() => ({
  session: { user: null as { role: string } | null, authToken: null as string | null, isLoading: false },
  fetchRegistry: vi.fn(),
}));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => session }));
vi.mock('../../../components/Header', () => ({ default: () => null }));
vi.mock('../../../prosopography/services/prosopographyService', () => ({
  fetchRegistry,
  saveRegistryEntry: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'et' } }),
}));

import ProsopoRegistries from '../ProsopoRegistries';

const open = () => render(<MemoryRouter initialEntries={['/admin/prosopo-registries']}>
  <Routes>
    <Route path="/" element={<div>Avaleht</div>} />
    <Route path="/admin/prosopo-registries" element={<ProsopoRegistries />} />
  </Routes>
</MemoryRouter>);

beforeEach(() => {
  session.user = null;
  session.authToken = null;
  session.isLoading = false;
  fetchRegistry.mockReset().mockResolvedValue({});
});

it('sisselogimata külastaja ei näe adminivormi ega lae registrit', async () => {
  open();
  await screen.findByText('Avaleht');
  expect(screen.queryByRole('button', { name: 'prosopoRegistries.save' })).toBeNull();
  expect(fetchRegistry).not.toHaveBeenCalled();
});

it('admin näeb vormi ja laadib registri', async () => {
  session.user = { role: 'admin' };
  session.authToken = 'token';
  open();
  expect(screen.getByRole('button', { name: 'prosopoRegistries.save' })).toBeTruthy();
  await waitFor(() => expect(fetchRegistry).toHaveBeenCalledWith('institution'));
});
