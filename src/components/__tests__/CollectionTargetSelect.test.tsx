/** @vitest-environment jsdom */
/**
 * Upload'i sihtkogude valija: püsikogu + töökollektsioonid ühes kohas.
 *
 * Kolm lepingut:
 *  - töökollektsioone saab valida mitu, püsikogu sammus 1 ainult ühe;
 *  - pakutakse ainult kogusid, kuhu kutsuja tohib lisada (aktiivne + can_manage);
 *  - lemmikud tulevad esimesena ja otsing filtreerib kõiki jaotisi.
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateSettings = vi.fn(async () => true);
let favorites: string[] = [];

vi.mock('../../contexts/CollectionContext', () => ({
  useCollection: () => ({
    workSets: [
      { id: 'ws_seminar', name: { et: 'Klingeri seminar', en: 'Klinger seminar' },
        visibility: 'members', status: 'active', revision: 1, can_manage: true },
      { id: 'ws_konv', name: { et: 'Konverents', en: 'Conference' },
        visibility: 'members', status: 'active', revision: 1, can_manage: true },
      { id: 'ws_vaataja', name: { et: 'Ainult vaatan', en: 'View only' },
        visibility: 'members', status: 'active', revision: 1, can_manage: false },
      { id: 'ws_arhiiv', name: { et: 'Arhiivis', en: 'Archived' },
        visibility: 'members', status: 'archived', revision: 1, can_manage: true },
    ],
  }),
}));

vi.mock('../../contexts/UserContext', () => ({
  useUser: () => ({
    user: { username: 'admin', role: 'admin' },
    userSettings: { favorite_collections: favorites },
    updateSettings,
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_k: string, d?: string) => d ?? _k, i18n: { language: 'et' } }),
}));

import CollectionTargetSelect from '../CollectionTargetSelect';

const KOGUD = {
  universitas: { name: { et: 'Rootsi aja ülikool', en: 'Swedish university' } },
  klingeriana: { name: { et: 'Klingeriana', en: 'Klingeriana' }, parent: 'universitas' },
  varia: { name: { et: 'Varia', en: 'Varia' } },
};

function renderSelect(props: Partial<React.ComponentProps<typeof CollectionTargetSelect>> = {}) {
  const onCollectionsChange = vi.fn();
  const onWorkSetsChange = vi.fn();
  render(
    <CollectionTargetSelect
      collections={KOGUD as never}
      selectedCollections={[]}
      onCollectionsChange={onCollectionsChange}
      selectedWorkSets={[]}
      onWorkSetsChange={onWorkSetsChange}
      label="Kogud"
      lang="et"
      {...props}
    />,
  );
  fireEvent.click(screen.getByRole('button', { expanded: false }));
  return { onCollectionsChange, onWorkSetsChange };
}

describe('CollectionTargetSelect', () => {
  beforeEach(() => {
    favorites = [];
    updateSettings.mockClear();
  });

  it('pakub ainult aktiivseid ja hallatavaid töökollektsioone', () => {
    renderSelect();
    expect(screen.getByText('Klingeri seminar')).toBeTruthy();
    expect(screen.queryByText('Ainult vaatan')).toBeNull();
    expect(screen.queryByText('Arhiivis')).toBeNull();
  });

  it('töökollektsiooni valik lisab olemasolevale, mitte ei asenda', () => {
    const { onWorkSetsChange } = renderSelect({ selectedWorkSets: ['ws_konv'] });
    fireEvent.click(screen.getByText('Klingeri seminar'));
    expect(onWorkSetsChange).toHaveBeenCalledWith(['ws_konv', 'ws_seminar']);
  });

  it('sammus 1 asendab püsikogu valik eelmise', () => {
    const { onCollectionsChange } = renderSelect({ selectedCollections: ['varia'] });
    fireEvent.click(screen.getByText('Klingeriana'));
    expect(onCollectionsChange).toHaveBeenCalledWith(['klingeriana']);
  });

  it('mitme püsikogu režiimis lülitab', () => {
    const { onCollectionsChange } = renderSelect({
      selectedCollections: ['varia'], multipleCollections: true,
    });
    fireEvent.click(screen.getByText('Klingeriana'));
    expect(onCollectionsChange).toHaveBeenCalledWith(['varia', 'klingeriana']);
  });

  it('otsing filtreerib mõlemat jaotist', () => {
    renderSelect();
    fireEvent.change(screen.getByPlaceholderText('Otsi kogu nime järgi'), { target: { value: 'kling' } });
    expect(screen.getByText('Klingeriana')).toBeTruthy();
    expect(screen.getByText('Klingeri seminar')).toBeTruthy();
    expect(screen.queryByText('Varia')).toBeNull();
    expect(screen.queryByText('Konverents')).toBeNull();
  });

  it('lemmikud tulevad esimesena', () => {
    favorites = ['varia', 's:ws_konv'];
    renderSelect();
    const pealkiri = screen.getByText('Lemmikud');
    const plokk = pealkiri.parentElement!;
    const tekstid = Array.from(plokk.querySelectorAll('span.truncate')).map(e => e.textContent);
    // Esimesed kaks rida on lemmikud, alles siis täispuu.
    expect(tekstid.slice(0, 2)).toEqual(['Varia', 'Konverents']);
  });

  it('tärn salvestab lemmiku tokeni kujul s:<id>', () => {
    renderSelect();
    const rida = screen.getByText('Konverents').closest('div')!;
    fireEvent.click(within(rida).getByLabelText('Lisa lemmikuks'));
    expect(updateSettings).toHaveBeenCalledWith({ favorite_collections: ['s:ws_konv'] });
  });
});
