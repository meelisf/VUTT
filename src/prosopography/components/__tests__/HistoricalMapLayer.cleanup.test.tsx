/** @vitest-environment jsdom */
/**
 * Mahavõetud MapLibre'i kaarti ei tohi enam puutuda.
 *
 * REGRESSIOON (2026-09-15, tootmine): isiku juurde navigeerimine seoste
 * kaardilt andis veaekraani „can't access property setFeatureState,
 * this.style is undefined". MapLibre'i `remove()` nullib `style` välja, aga
 * `mapLibre` viide jääb kehtima — objekti olemasolust EI PIISA.
 *
 * React kutsub ühe komponendi effect-koristused DEKLAREERIMISE järjekorras.
 * Kihi eemaldav effect on failis esimene, hover-effect viimane:
 *
 *   cleanup #1:  map.removeLayer(layer)  →  MapLibre.remove()  →  style = undefined
 *   cleanup #3:  clearHover()            →  mapLibre.setFeatureState(…)  →  💥
 *
 * Test hoiab just seda järjekorda: `removeLayer` märgib kaardi surnuks ja
 * `setFeatureState` viskab pärast seda, täpselt nagu päris MapLibre.
 */
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mockid enne mooduli importi -------------------------------------------

const leafletHandlers = new Map<string, (e: unknown) => void>();
let mapLibreRemoved = false;
let setFeatureStateCalls: unknown[] = [];

const mapLibreStub = {
  // Kordab päris `remove()` semantikat: pärast mahavõtmist viskab.
  setFeatureState: (...args: unknown[]) => {
    if (mapLibreRemoved) {
      throw new TypeError("can't access property \"setFeatureState\", this.style is undefined");
    }
    setFeatureStateCalls.push(args);
  },
  project: () => ({ x: 0, y: 0 }),
  getZoom: () => 8,
  getLayer: () => ({}),
  queryRenderedFeatures: () => [{ id: 'r1', properties: { name: 'Liivimaa' } }],
  getSource: () => undefined,
  getStyle: () => ({ layers: [] }),
  isStyleLoaded: () => false,
  on: () => undefined,
  off: () => undefined,
};

const layerStub = { getMaplibreMap: () => mapLibreStub, addTo: () => layerStub };

vi.mock('leaflet', () => ({
  default: {
    maplibreGL: () => layerStub,
    tooltip: () => ({
      setLatLng() { return this; },
      setContent() { return this; },
      addTo() { return this; },
      remove() { return this; },
    }),
  },
}));
vi.mock('@maplibre/maplibre-gl-leaflet', () => ({}));
vi.mock('../../services/prosopographyService', () => ({
  fetchHistoricalRegions: () => new Promise(() => undefined), // ei lahene kunagi
}));
vi.mock('../../utils/regionLayers', () => ({
  REGION_SOURCE_ID: 'regions',
  pickRegionFeature: (_zoom: number, query: (id: string) => unknown[]) => {
    const hits = query('regions-fill') as { id: string; properties: unknown }[];
    return hits[0];
  },
  regionLayerSpecs: () => [],
}));

const leafletMapStub = {
  on: (event: string, fn: (e: unknown) => void) => { leafletHandlers.set(event, fn); },
  off: () => undefined,
  removeLayer: () => { mapLibreRemoved = true; },
  getContainer: () => document.createElement('div'),
  getBounds: () => ({
    getEast: () => 30, getWest: () => 20, getNorth: () => 60, getSouth: () => 55,
  }),
};

vi.mock('react-leaflet', () => ({ useMap: () => leafletMapStub }));

const { default: HistoricalMapLayer } = await import('../HistoricalMapLayer');

describe('HistoricalMapLayer — koristus mahavõetud kaardil', () => {
  beforeEach(() => {
    leafletHandlers.clear();
    setFeatureStateCalls = [];
    mapLibreRemoved = false;
  });

  it('ei kutsu setFeatureState-i pärast kihi eemaldamist', () => {
    const { unmount } = render(<HistoricalMapLayer year={1650} lang="et" />);

    // Hõlju piirkonna kohal → `hoveredId` saab väärtuse. Ilma selleta
    // `clearHover` ei jõuagi `setFeatureState`-ini ja test oleks tühi.
    const onMouseMove = leafletHandlers.get('mousemove');
    expect(onMouseMove, 'mousemove kuulaja peab olema registreeritud').toBeTypeOf('function');
    onMouseMove!({ latlng: { lat: 58, lng: 26 } });
    expect(setFeatureStateCalls.length, 'hõljumine peab oleku seadma').toBeGreaterThan(0);

    // Mahavõtmine: cleanup #1 tapab kaardi, cleanup #3 tahaks olekut lähtestada.
    expect(() => unmount()).not.toThrow();
    expect(mapLibreRemoved, 'kiht peab olema eemaldatud').toBe(true);
  });
});
