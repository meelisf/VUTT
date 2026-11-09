/** @vitest-environment jsdom */
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import L from 'leaflet';
import './testI18n';
import RelationsMap from '../RelationsMap';
import type { VisibleNetwork } from '../../../utils/network';
import type { ProsopoRecord } from '../../../types';

// Päris Leaflet ja react-leaflet: Polyline'i mock peidaks renderdaja vead.
vi.mock('../../HistoricalMapLayer', () => ({ default: () => null }));
vi.mock('../../../services/prosopographyService', () => ({
  fetchPlaces: async () => ({
    Tartu: { id: 'Q13972', labels: { et: 'Tartu' }, coordinates: { lat: 58.38, lon: 26.72 } },
    Riga: { id: 'Q1773', labels: { et: 'Riga' }, coordinates: { lat: 56.95, lon: 24.1 } },
  }),
  fetchInstitutions: async () => ({}),
  fetchRegistry: async () => ({}),
}));

const defaultSvg = Object.getOwnPropertyDescriptor(L.Browser, 'svg')!;
afterEach(() => { Object.defineProperty(L.Browser, 'svg', defaultSvg); vi.restoreAllMocks(); });

describe('RelationsMap renderer', () => {
  it('draws life paths and unmounts without an SVG renderer', async () => {
    // Brauser, kus Leafleti SVG-tuvastus ebaõnnestub.
    Object.defineProperty(L.Browser, 'svg', { ...defaultSvg, value: false });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(520);
    const stroke = vi.fn();
    const context = new Proxy({ stroke }, {
      get(target, key) { return key in target ? target[key as keyof typeof target] : () => {}; },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
    const net = {
      focus: { id: 'vutt:Ptest', label: 'Test', origin: null },
      persons: [], works: [], edges: [],
    } as unknown as VisibleNetwork;
    const card = {
      id: 'vutt:Ptest',
      birth: { date: '1600', place: { id: 'Q13972', label: 'Tartu' } },
      death: { date: '1670', place: { id: 'Q1773', label: 'Riga' } },
      education: [], occupations: [],
    } as unknown as ProsopoRecord;
    const { container, unmount } = render(
      <MemoryRouter>
        <RelationsMap net={net} card={card} layers={['life']}
          popover={{ pin: vi.fn() } as never} highlight={null} onHighlight={() => {}} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(stroke).toHaveBeenCalled());
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(() => unmount()).not.toThrow();
  });
});
