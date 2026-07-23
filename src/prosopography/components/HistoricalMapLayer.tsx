import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import type { FilterSpecification, Map as MapLibreMap } from 'maplibre-gl';
import { useMap } from 'react-leaflet';
import '@maplibre/maplibre-gl-leaflet';

const HISTORICAL_STYLE_URL = 'https://www.openhistoricalmap.org/map-styles/historical/historical.json';
const OHM_ATTRIBUTION = '<a href="https://www.openhistoricalmap.org/">OpenHistoricalMap</a>';

interface HistoricalMapLayerProps {
  year: number;
}

function dateFilter(year: number): FilterSpecification {
  return [
    'all',
    [
      'any',
      ['!', ['has', 'start_decdate']],
      ['<=', ['to-number', ['get', 'start_decdate'], -10_000_000], year],
    ],
    [
      'any',
      ['!', ['has', 'end_decdate']],
      ['>=', ['to-number', ['get', 'end_decdate'], 10_000_000], year],
    ],
  ] as FilterSpecification;
}

/** Muudab ajalooliste halduspiiride ja piirkonnanimede hierarhia paremini loetavaks. */
function enhanceAdministrativeReadability(map: MapLibreMap): void {
  const paint = (layerId: string, property: string, value: unknown) => {
    if (map.getLayer(layerId)) map.setPaintProperty(layerId, property, value);
  };

  // Riigipiirile hele halo ja selle peale tumedam põhijoon.
  paint('admin_country_lines_z10_case', 'line-color', 'rgba(255, 253, 238, 0.85)');
  paint('admin_country_lines_z10_case', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 2, 2, 5, 3.5, 8, 5,
  ]);
  paint('admin_country_lines_z10', 'line-color', 'rgba(70, 86, 78, 0.9)');
  paint('admin_country_lines_z10', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 2, 0.8, 5, 1.5, 8, 2.2,
  ]);

  // Madalama taseme piirkonnad jäävad riigipiirist teadlikult pehmemaks.
  paint('state_lines_admin_4-case', 'line-color', 'rgba(255, 253, 238, 0.65)');
  paint('state_lines_admin_4-case', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 3, 1.5, 6, 2.5, 9, 4,
  ]);
  paint('state_lines_admin_4', 'line-color', 'rgba(100, 117, 107, 0.75)');
  paint('state_lines_admin_4', 'line-width', [
    'interpolate', ['linear'], ['zoom'], 3, 0.45, 6, 1, 9, 1.6,
  ]);
  paint('admin_admin3', 'line-color', 'rgba(112, 126, 117, 0.65)');

  // Hele halo jätab nimed reljeefse tausta ja markerite vahel loetavaks.
  for (const layerId of ['country_points_labels_cen', 'state_points_labels_centroids']) {
    paint(layerId, 'text-color', layerId === 'country_points_labels_cen' ? '#34463d' : '#52645b');
    paint(layerId, 'text-halo-color', 'rgba(255, 254, 242, 0.95)');
    paint(layerId, 'text-halo-width', 2.25);
    paint(layerId, 'text-halo-blur', 0.5);
  }
}

/** Leafleti sees renderduv OpenHistoricalMapi MapLibre-vektorkiht. */
const HistoricalMapLayer: React.FC<HistoricalMapLayerProps> = ({ year }) => {
  const map = useMap();
  const [mapLibre, setMapLibre] = useState<MapLibreMap | null>(null);
  const originalFilters = useRef(new Map<string, FilterSpecification | null>());

  useEffect(() => {
    const layer = L.maplibreGL({
      style: HISTORICAL_STYLE_URL,
      attributionControl: { customAttribution: OHM_ATTRIBUTION },
    }).addTo(map);
    setMapLibre(layer.getMaplibreMap());

    return () => {
      map.removeLayer(layer);
    };
  }, [map]);

  useEffect(() => {
    if (!mapLibre) return;

    const applyYear = () => {
      const layers = mapLibre.getStyle().layers ?? [];
      const temporalFilter = dateFilter(year);

      for (const layer of layers) {
        if (!('source' in layer) || layer.source !== 'ohm') continue;

        if (!originalFilters.current.has(layer.id)) {
          const original = mapLibre.getFilter(layer.id) as FilterSpecification | undefined;
          originalFilters.current.set(layer.id, original ?? null);
        }
        const original = originalFilters.current.get(layer.id);
        const combined = original
          ? ['all', temporalFilter, original] as FilterSpecification
          : temporalFilter;
        mapLibre.setFilter(layer.id, combined);
      }

      enhanceAdministrativeReadability(mapLibre);
    };

    if (mapLibre.isStyleLoaded()) applyYear();
    mapLibre.on('style.load', applyYear);
    return () => {
      mapLibre.off('style.load', applyYear);
    };
  }, [mapLibre, year]);

  return null;
};

export default HistoricalMapLayer;
