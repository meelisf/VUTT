/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PlacesDetail from '../PlacesDetail';
import { updatePlace } from '../../../prosopography/services/prosopographyService';

const { t } = vi.hoisted(() => ({ t: (key: string) => key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
vi.mock('../PlacesMergeModal', () => ({ default: () => null }));
vi.mock('../../../prosopography/services/prosopographyService', () => ({ updatePlace: vi.fn(), deletePlace: vi.fn() }));
vi.mock('../../../prosopography/components/WikidataPlaceSearch', () => ({ default: ({ onSelect }: { onSelect: (a: unknown, b: unknown) => void }) =>
  <button onClick={() => onSelect({ q: 'Q3223979', label: 'Tønder' }, {
    labels: { en: 'Tønder', de: 'Tondern' }, type: 'city',
    coordinates: { lat: 54.942777777778, lon: 8.863888888889, source: 'wikidata', wikidata_property: 'P625' }, parents: [],
  })}>Select Tønder</button> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const entry = { id: 'Q3223979', labels: { et: 'Tønder' }, coordinates: null, group: 'muu', type: 'city' };
function openEditor() {
  render(<MemoryRouter><PlacesDetail placeKey="Tønder" entry={entry} places={{ 'Tønder': entry }}
    meta={null} personCount={1} personSample={[]} token="test" lang="et"
    onUpdated={() => {}} onMerged={() => {}} onDeleted={() => {}} onSelectKey={() => {}} /></MemoryRouter>);
  fireEvent.click(screen.getByRole('button', { name: 'places.edit' }));
}

describe('existing place coordinate repair', () => {
  it('fills Tønder coordinates before saving and preserves local labels and historical grouping', async () => {
    vi.mocked(updatePlace).mockResolvedValue({ key: 'Tønder', entry });
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Select Tønder' }));
    expect((screen.getByPlaceholderText('lat (57.18)') as HTMLInputElement).value).toBe('54.942777777778');
    expect(updatePlace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'places.save' }));
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith('Tønder', expect.objectContaining({
      id: 'Q3223979', labels: { et: 'Tønder', en: 'Tønder', de: 'Tondern' }, group: 'muu',
      coordinates: { lat: 54.942777777778, lon: 8.863888888889, source: 'wikidata', wikidata_property: 'P625' },
    }), 'test'));
  });
  it('does not silently save a malformed coordinate or erase the other coordinate', async () => {
    openEditor();
    fireEvent.change(screen.getByPlaceholderText('lat (57.18)'), { target: { value: '54oops' } });
    fireEvent.click(screen.getByRole('button', { name: 'places.save' }));
    expect(screen.getByText('prosopography:place.invalidCoordinates')).toBeTruthy();
    expect(updatePlace).not.toHaveBeenCalled();
  });
});
