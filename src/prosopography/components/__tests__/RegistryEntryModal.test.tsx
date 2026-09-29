/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchWikidata, getWikidataEntity, getEntityDescriptions, createRegistryEntry } = vi.hoisted(() => ({
  searchWikidata: vi.fn(), getWikidataEntity: vi.fn(), getEntityDescriptions: vi.fn(), createRegistryEntry: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: any) => (o?.key ? `${k}:${o.key}` : k), i18n: { language: 'et' } }),
}));
vi.mock('../../../services/wikidataService', () => ({ searchWikidata, getWikidataEntity, getEntityDescriptions }));
vi.mock('../../services/prosopographyService', async () => {
  class RegistryDuplicateError extends Error { constructor(public key: string) { super('duplicate_id'); } }
  return {
    createRegistryEntry, RegistryDuplicateError,
    fetchPlaces: vi.fn(async () => ({ Dorpat: { id: 'Q13972', labels: { et: 'Tartu' }, type: 'city' } })),
    fetchPlacesMeta: vi.fn(async () => ({ groups: {}, allowed_types: [] })),
  };
});

import RegistryEntryModal from '../RegistryEntryModal';
import { RegistryDuplicateError } from '../../services/prosopographyService';

const time = (y: number) => ({ mainsnak: { datavalue: { value: { time: `+${y}-00-00T00:00:00Z` } } } });
const TARTU_1630 = {
  id: 'Q20641850', labels: { et: { value: 'Tartu gümnaasium' }, en: { value: 'Tartu Gymnasium' } }, aliases: {},
  descriptions: { et: { value: 'kool Rootsi-aegses Tartus (1630–1632)' } },
  claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q3914' } } } }], P571: [time(1630)], P576: [time(1632)] },
};
const REG = {
  'gymn-dorpat': { id: 'Q12376416', labels: { et: 'Tartu Gümnaasium' }, variants: [], place_key: 'Dorpat', active_from: 1804, active_to: 1890 },
  'univ-rostock': { id: 'Q159895', labels: { et: 'Rostocki ülikool' }, variants: [] },
};

function setup(initialQuery = 'Gymn. Tarbat.') {
  const onCreated = vi.fn(); const onUseExisting = vi.fn(); const onClose = vi.fn();
  render(<RegistryEntryModal kind="institution" initialQuery={initialQuery} registry={REG} token="t" lang="et"
    onCreated={onCreated} onUseExisting={onUseExisting} onClose={onClose} />);
  return { onCreated, onUseExisting };
}

beforeEach(() => {
  searchWikidata.mockReset().mockResolvedValue([
    { id: 'Q20641850', label: 'Tartu gümnaasium', description: 'kool 1630–1632', url: '' },
    { id: 'Q159895', label: 'Rostocki Ülikool', description: 'ülikool', url: '' },
  ]);
  getWikidataEntity.mockReset().mockResolvedValue(TARTU_1630);
  getEntityDescriptions.mockReset().mockResolvedValue({ Q12376416: 'endine gümnaasium Tartus 1804-1890' });
  createRegistryEntry.mockReset();
});

describe('RegistryEntryModal', () => {
  it('otsing algab välja tekstist; registris olev Q-kood pakub olemasolevat, mitte uut', async () => {
    const { onUseExisting } = setup();
    await waitFor(() => expect(searchWikidata).toHaveBeenCalledWith('Gymn. Tarbat.', 'et', { throwOnError: true }));
    fireEvent.click(await screen.findByText('registryModal.alreadyInRegistry:univ-rostock'));
    expect(onUseExisting).toHaveBeenCalledWith('univ-rostock');
    expect(getWikidataEntity).not.toHaveBeenCalled();
  });

  it('sarnane nimi nõuab kinnitust; salvestus saadab aastad, koha ja allika sõnastuse variandina', async () => {
    createRegistryEntry.mockImplementation(async (_kind: string, entry: any) => ({ key: 'tartu-gumnaasium-1630', entry }));
    const { onCreated } = setup();
    fireEvent.click(await screen.findByText('Tartu gümnaasium'));
    await screen.findByDisplayValue('1630–1632');
    expect(screen.getByText('registryModal.similarTitle')).toBeTruthy();
    expect(screen.getByText('gymn-dorpat')).toBeTruthy();
    expect(screen.getByText('Q12376416 · 1804–1890 · Dorpat')).toBeTruthy();
    // Wikidata kirjeldus tuuakse sarnase kirje Q järgi — aitab ka aastateta kirjel.
    expect(await screen.findByText('endine gümnaasium Tartus 1804-1890')).toBeTruthy();
    expect(getEntityDescriptions).toHaveBeenCalledWith(['Q12376416'], 'et');
    const save = screen.getByRole('button', { name: 'registryModal.save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(screen.getByText('tartu-gumnaasium').tagName).toBe('CODE');   // kokkupõrget pole → aastata
    fireEvent.click(screen.getByLabelText('registryModal.confirmDifferent'));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(createRegistryEntry.mock.calls[0][1]).toEqual({
      id: 'Q20641850', labels: { et: 'Tartu gümnaasium', en: 'Tartu Gymnasium' },
      variants: ['Gymn. Tarbat.'], type: 'school', place_key: null, active_from: 1630, active_to: 1632,
    });
    expect(onCreated.mock.calls[0][0]).toBe('tartu-gumnaasium-1630');
  });

  it('„Kasuta seda" sarnase kirje juures seob olemasolevaga', async () => {
    const { onUseExisting } = setup();
    fireEvent.click(await screen.findByText('Tartu gümnaasium'));
    fireEvent.click(await screen.findByText('registryModal.useThis'));
    expect(onUseExisting).toHaveBeenCalledWith('gymn-dorpat');
  });

  it('vahepeal lisatud sama Q (409) näitab olemasoleva võtit', async () => {
    createRegistryEntry.mockRejectedValue(new RegistryDuplicateError('tartu-gumnaasium-1630'));
    setup();
    fireEvent.click(await screen.findByText('Tartu gümnaasium'));
    fireEvent.click(await screen.findByLabelText('registryModal.confirmDifferent'));
    fireEvent.click(screen.getByRole('button', { name: 'registryModal.save' }));
    expect((await screen.findByRole('alert')).textContent).toBe('registryModal.duplicateId:tartu-gumnaasium-1630');
  });

  it('ilma Wikidatata: nimi otsingust, vigased aastad hoiavad salvestuse kinni', async () => {
    setup('Trivialschule Dorpat');
    await waitFor(() => expect(searchWikidata).toHaveBeenCalled());
    fireEvent.click(screen.getByText('registryModal.manual'));
    expect(screen.getByDisplayValue('Trivialschule Dorpat')).toBeTruthy();
    expect(screen.getByText('registryModal.noWikidata')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('1630–1632'), { target: { value: 'umbes 1630' } });
    expect(screen.getByText('registryModal.missing.type')).toBeTruthy();
    const save = screen.getByRole('button', { name: 'registryModal.save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });
});
