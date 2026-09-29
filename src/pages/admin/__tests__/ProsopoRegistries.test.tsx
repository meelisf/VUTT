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
// Aken on eraldi testitud (RegistryEntryModal.test.tsx); siin ainult lehe ühendus.
vi.mock('../../../prosopography/components/RegistryEntryModal', () => ({
  default: (props: any) => <div>
    <span>modal:{props.kind}</span>
    <button onClick={() => props.onCreated('tartu-gumnaasium-1630', { id: 'Q20641850', labels: { et: 'Tartu gümnaasium' },
      variants: [], type: 'school', place_key: 'Dorpat', active_from: 1630, active_to: 1632 })}>stub-create</button>
  </div>,
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

const REG = { 'gymn-dorpat': { id: 'Q12376416', labels: { et: 'Tartu Gümnaasium' }, variants: ['Gymn. Dorpat'],
  type: 'gymnasium', place_key: 'Dorpat' } };

const asAdmin = () => { session.user = { role: 'admin' }; session.authToken = 'token'; };

it('admin laadib registri; vorm tuleb alles kirje valikul (vaba võtmesisestust pole)', async () => {
  asAdmin();
  fetchRegistry.mockResolvedValue(REG);
  open();
  await waitFor(() => expect(fetchRegistry).toHaveBeenCalledWith('institution'));
  expect(screen.getByText('prosopoRegistries.chooseOrCreate')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'prosopoRegistries.save' })).toBeNull();
  fireEvent.click(await screen.findByText('Tartu Gümnaasium'));
  expect(screen.getByRole('button', { name: 'prosopoRegistries.save' })).toBeTruthy();
});

it('„Koht ajas" ainult aastatega ei lähe serverisse, vaid annab rea ja põhjuse', async () => {
  // Enne: „1804–1890" läks kohavõtmena serverisse → paljas unknown_place_key.
  asAdmin();
  fetchRegistry.mockResolvedValue(REG);
  open();
  fireEvent.click(await screen.findByText('Tartu Gümnaasium'));
  fireEvent.change(screen.getByPlaceholderText(/Dorpat: –1699/), { target: { value: '1804–1890' } });
  fireEvent.click(screen.getByRole('button', { name: 'prosopoRegistries.save' }));
  expect((await screen.findByRole('alert')).textContent).toBe('prosopoRegistries.placePeriodsError.years_only');
  expect(saveRegistryEntry).not.toHaveBeenCalled();
});

it('tegutsemisaeg salvestub oma väljadena, mitte kohana ajas', async () => {
  asAdmin();
  fetchRegistry.mockResolvedValue(REG);
  saveRegistryEntry.mockImplementation(async (_k: string, _key: string, value: unknown) => value);
  open();
  fireEvent.click(await screen.findByText('Tartu Gümnaasium'));
  fireEvent.change(screen.getByPlaceholderText('1630–1632'), { target: { value: '1804–1890' } });
  fireEvent.click(screen.getByRole('button', { name: 'prosopoRegistries.save' }));
  await waitFor(() => expect(saveRegistryEntry).toHaveBeenCalled());
  const [, key, value] = saveRegistryEntry.mock.calls[0];
  expect(key).toBe('gymn-dorpat');
  expect(value).toMatchObject({ active_from: 1804, active_to: 1890, place_periods: [] });
});

it('„Uus kirje" avab akna; loodud kirje valitakse redaktorisse', async () => {
  asAdmin();
  fetchRegistry.mockResolvedValue(REG);
  open();
  await waitFor(() => expect(fetchRegistry).toHaveBeenCalled());
  fireEvent.click(screen.getByText('prosopoRegistries.new'));
  expect(screen.getByText('modal:institution')).toBeTruthy();
  fireEvent.click(screen.getByText('stub-create'));
  expect(await screen.findByText('tartu-gumnaasium-1630')).toBeTruthy();
  expect(screen.getByDisplayValue('1630–1632')).toBeTruthy();
});
