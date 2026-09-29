/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const { session, fetchRegistry, saveRegistryEntry } = vi.hoisted(() => ({
  session: { user: null as { role: string } | null, authToken: null as string | null, isLoading: false },
  fetchRegistry: vi.fn(),
  saveRegistryEntry: vi.fn(),
}));
vi.mock('../../../contexts/UserContext', () => ({ useUser: () => session }));
vi.mock('../../../components/Header', () => ({ default: () => null }));
vi.mock('../../../prosopography/services/prosopographyService', () => ({
  fetchRegistry,
  saveRegistryEntry,
  fetchPlaces: vi.fn(async () => ({ Dorpat: { labels: { et: 'Tartu' }, type: 'city' } })),
  fetchPlacesMeta: vi.fn(async () => ({ groups: {}, allowed_types: [] })),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'et' } }),
}));

import ProsopoRegistries from '../ProsopoRegistries';

const open = (url = '/admin/prosopo-registries') => render(<MemoryRouter initialEntries={[url]}>
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
  saveRegistryEntry.mockReset();
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

it('isikuvormi link eeltäidab uue kirje: silt, nimevariant, Q-kood', async () => {
  session.user = { role: 'admin' };
  session.authToken = 'token';
  open('/admin/prosopo-registries?kind=institution&label=Tartu+g%C3%BCmnaasium&qid=Q20641850');
  await waitFor(() => expect(fetchRegistry).toHaveBeenCalledWith('institution'));
  expect(screen.getByDisplayValue('Q20641850')).toBeTruthy();
  expect(screen.getAllByDisplayValue('Tartu gümnaasium')).toHaveLength(2);   // silt ET + nimevariant
});

it('„Koht ajas" ainult aastatega ei lähe serverisse, vaid annab rea ja põhjuse', async () => {
  // Enne: „1804–1890" läks kohavõtmena serverisse → paljas unknown_place_key.
  session.user = { role: 'admin' };
  session.authToken = 'token';
  open('/admin/prosopo-registries?kind=institution&label=Tartu+g%C3%BCmnaasium');
  await waitFor(() => expect(fetchRegistry).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('prosopoRegistries.key'), { target: { value: 'gymn-tartu-1630' } });
  fireEvent.change(screen.getByLabelText('prosopoRegistries.type'), { target: { value: 'gymnasium' } });
  fireEvent.change(screen.getByPlaceholderText(/Dorpat: –1699/), { target: { value: '1804–1890' } });
  fireEvent.click(screen.getByRole('button', { name: 'prosopoRegistries.save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('prosopoRegistries.placePeriodsError.years_only');
  expect(saveRegistryEntry).not.toHaveBeenCalled();
});
